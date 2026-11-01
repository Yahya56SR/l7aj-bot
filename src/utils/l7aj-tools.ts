/**
 * L7aj autonomous toolset — all capabilities exposed to the Gemini Live
 * session as function declarations, implemented against Discord.js and the
 * project's JSON database.
 *
 * Every tool returns a plain JSON-serializable record. Failed calls return
 * `{ ok: false, error: "..." }` so Gemini can decide what to do next rather
 * than crashing the turn.
 */
import type {
  Channel,
  Client,
  Guild,
  Message,
  TextChannel,
  NewsChannel,
  ThreadChannel,
  VoiceChannel,
  CategoryChannel,
  ForumChannel,
  GuildMember,
  Role,
  Sticker,
} from 'discord.js';
import { Type, type FunctionDeclaration } from '@google/genai';
import { getConfig, type L7ajConfig } from '../config';
import {
  countRanked,
  getLeaderboard,
  getRankPosition,
  getUser,
  getTotalMemberCount,
} from '../db';
import { levelFromXp } from './level';
import {
  addMemory,
  clearMemories,
  countMemories,
  recallMemories,
} from './l7aj-memory';
import {
  cancelScheduledMessage,
  createAnnouncement,
  createFaqEntry,
  createScheduledMessage,
  createServerEvent,
  deleteFaqEntry,
  dueScheduledMessages,
  getServerRules,
  listAnnouncements,
  listFaq,
  listScheduledMessages,
  listServerEvents,
  markScheduledMessageSent,
  countScheduled,
  searchFaq,
  upsertServerRules,
  updateFaqEntry,
} from './l7aj-storage';

const MAX_TOOL_LIMIT = 25;
const MAX_MESSAGE_CHARS = 1900;

/* ------------------------------------------------------------------ */
/* Tool context                                                       */
/* ------------------------------------------------------------------ */

export interface L7ajToolContext {
  client: Client;
  guild: Guild;
  channel: Channel;
  triggerMessageId?: string;
}

/* ------------------------------------------------------------------ */
/* Tool declarations (Gemini Live function declarations)             */
/* ------------------------------------------------------------------ */

/** All tools L7aj may call. Filtered by config flags before registration. */
export function buildToolDeclarations(
  ctx: L7ajToolContext,
  cfg: L7ajConfig,
): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = [];

  /* ---- Discord context tools (always available) ---- */
  tools.push(
    {
      name: 'get_server_info',
      description:
        'Retrieve information about the current Discord server: name, member count, creation date, owner, and description.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: 'get_channel_info',
      description:
        'Retrieve information about a channel by id. Omit the id to get the current channel.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description: 'The Discord channel id. Leave out to inspect the current channel.',
          },
        },
      },
    },
    {
      name: 'get_member_info',
      description:
        'Retrieve information about a server member: display name, username, join date, account age, roles, and status.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          member: {
            type: Type.STRING,
            description: 'Member id, @mention, username, or display name.',
          },
        },
        required: ['member'],
      },
    },
    {
      name: 'get_member_roles',
      description:
        'Retrieve the roles of a server member, sorted by position (highest first).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          member: {
            type: Type.STRING,
            description: 'Member id, @mention, username, or display name.',
          },
        },
        required: ['member'],
      },
    },
    {
      name: 'get_message',
      description:
        'Retrieve a specific Discord message by id from the current channel or a given channel.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message_id: {
            type: Type.STRING,
            description: 'The Discord message id.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'get_recent_messages',
      description:
        'Read recent messages in a channel. Omit channel id to use the current channel.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description: 'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many messages (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'get_thread_messages',
      description:
        'Read messages from a thread channel by id.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          thread_id: {
            type: Type.STRING,
            description: 'The Discord thread channel id.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many messages (1-${MAX_TOOL_LIMIT}).`,
          },
        },
        required: ['thread_id'],
      },
    },
    {
      name: 'search_discord_messages',
      description:
        'Search accessible server messages for a keyword. Returns matching messages with channel and author info.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'Text to search for in message content.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id to limit the search. Searches the whole server when omitted.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many matches (1-${MAX_TOOL_LIMIT}).`,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_message_reactions',
      description:
        'Retrieve the reactions on a message, with emoji and count for each.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message_id: {
            type: Type.STRING,
            description: 'The Discord message id.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'get_conversation_context',
      description:
        'Retrieve relevant conversation context around a message or in a channel: recent messages plus any reply chain.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          around_message_id: {
            type: Type.STRING,
            description:
              'Optional message id to center the context on.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many messages (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
  );

  /* ---- Autonomous communication tools ---- */
  tools.push(
    {
      name: 'reply_to_message',
      description:
        'Reply to a specific message as a native Discord reply.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message_id: {
            type: Type.STRING,
            description: 'The Discord message id to reply to.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          content: {
            type: Type.STRING,
            description: 'The reply text.',
          },
        },
        required: ['message_id', 'content'],
      },
    },
    {
      name: 'start_conversation',
      description:
        'Initiate a new conversation in a channel. Use this to start a discussion without waiting to be mentioned.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'The Discord channel id to start the conversation in.',
          },
          content: {
            type: Type.STRING,
            description: 'The opening message.',
          },
        },
        required: ['channel_id', 'content'],
      },
    },
    {
      name: 'send_followup',
      description:
        'Continue a previous conversation by sending a follow-up message, optionally replying to a prior message.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          content: {
            type: Type.STRING,
            description: 'The follow-up message.',
          },
          reply_to_message_id: {
            type: Type.STRING,
            description:
              'Optional message id to reply to within the conversation.',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'send_multiple_messages',
      description:
        'Send separate messages naturally when appropriate (e.g. a joke then a follow-up question). Each message is sent independently.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          messages: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'The separate messages to send, in order.',
          },
        },
        required: ['messages'],
      },
    },
    {
      name: 'edit_own_message',
      description:
        'Edit one of L7aj\'s own previously sent messages. Only messages sent by the bot can be edited.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message_id: {
            type: Type.STRING,
            description: 'The id of the bot\'s own message to edit.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          content: {
            type: Type.STRING,
            description: 'The new message text.',
          },
        },
        required: ['message_id', 'content'],
      },
    },
    {
      name: 'delete_own_message',
      description:
        'Delete one of L7aj\'s own previously sent messages. Only messages sent by the bot can be deleted.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message_id: {
            type: Type.STRING,
            description: 'The id of the bot\'s own message to delete.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'add_reaction',
      description:
        'React to a message with one emoji (Unicode or custom server emoji).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message_id: {
            type: Type.STRING,
            description: 'The Discord message id to react to.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          emoji: {
            type: Type.STRING,
            description:
              'One Unicode emoji or a custom emoji like <:name:id> or <a:name:id>.',
          },
        },
        required: ['message_id', 'emoji'],
      },
    },
    {
      name: 'create_thread',
      description:
        'Start a discussion thread in a channel from an existing message.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'The Discord channel id to create the thread in.',
          },
          message_id: {
            type: Type.STRING,
            description:
              'The message id to start the thread from.',
          },
          name: {
            type: Type.STRING,
            description: 'The thread name.',
          },
        },
        required: ['channel_id', 'message_id', 'name'],
      },
    },
  );

  /* ---- Community awareness tools ---- */
  tools.push(
    {
      name: 'observe_channel',
      description:
        'Retrieve recent channel activity: the latest messages and who is talking.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many messages (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'observe_server_activity',
      description:
        'Retrieve relevant server activity: recent messages across text channels, voice members, and member count.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          limit: {
            type: Type.INTEGER,
            description: `How many channels to sample (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'detect_interesting_message',
      description:
        'Identify interesting messages and discussions in recent channel history worth reacting to or joining.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many recent messages to scan (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'detect_unanswered_question',
      description:
        'Identify questions worth answering in recent channel history that have not yet received a reply.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many recent messages to scan (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'detect_conversation',
      description:
        'Retrieve ongoing discussions in a channel: recent message clusters and their topics.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many messages to scan (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'check_member_interaction',
      description:
        'Retrieve relevant previous interactions with a member from recent channel history.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          member: {
            type: Type.STRING,
            description: 'Member id, @mention, username, or display name.',
          },
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many interactions (1-${MAX_TOOL_LIMIT}).`,
          },
        },
        required: ['member'],
      },
    },
  );

  /* ---- Memory tools (always available) ---- */
  tools.push(
    {
      name: 'remember_information',
      description:
        'Store useful information about a community member or event for future conversations. Only save publicly shared information.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          fact: {
            type: Type.STRING,
            description: 'One short, factual note to remember.',
          },
          about: {
            type: Type.STRING,
            description:
              'Optional member id, @mention, username, or name the fact is about.',
          },
        },
        required: ['fact'],
      },
    },
    {
      name: 'search_memory',
      description:
        'Search stored memories for a keyword or about a specific member.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'Text to search for in stored memories.',
          },
          about: {
            type: Type.STRING,
            description:
              'Optional member id, @mention, username, or name.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many memories (1-50).`,
          },
        },
      },
    },
    {
      name: 'get_memory',
      description:
        'Retrieve a specific stored memory by its id.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          memory_id: {
            type: Type.STRING,
            description: 'The memory id.',
          },
        },
        required: ['memory_id'],
      },
    },
    {
      name: 'update_memory',
      description:
        'Update an existing stored memory by id.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          memory_id: {
            type: Type.STRING,
            description: 'The memory id to update.',
          },
          fact: {
            type: Type.STRING,
            description: 'The new fact text.',
          },
        },
        required: ['memory_id', 'fact'],
      },
    },
    {
      name: 'forget_information',
      description:
        'Remove a stored memory by id.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          memory_id: {
            type: Type.STRING,
            description: 'The memory id to remove.',
          },
        },
        required: ['memory_id'],
      },
    },
    {
      name: 'get_conversation_history',
      description:
        'Retrieve relevant conversation history from the persona\'s in-memory channel history.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many history entries (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
    {
      name: 'summarize_conversation',
      description:
        'Summarize a recent conversation for future reference and store it as a memory.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel_id: {
            type: Type.STRING,
            description:
              'Optional channel id. Defaults to the current channel.',
          },
          limit: {
            type: Type.INTEGER,
            description: `How many recent messages to summarize (1-${MAX_TOOL_LIMIT}).`,
          },
        },
      },
    },
  );

  /* ---- Community knowledge tools ---- */
  if (cfg.knowledgeEnabled) {
    tools.push(
      {
        name: 'get_server_rules',
        description:
          'Retrieve the server rules stored for this community.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'search_server_knowledge',
        description:
          'Search community-specific information: FAQ entries, announcements, and stored knowledge.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Text to search for.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_server_announcements',
        description:
          'Retrieve stored server announcements.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_server_events',
        description:
          'Retrieve upcoming and previous server events.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_faq',
        description:
          'Retrieve frequently asked questions for this server.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_server_statistics',
        description:
          'Retrieve useful community statistics: member count, XP leaderboard top, ranked members, voice activity.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
    );
  }

  /* ---- Internet and information tools ---- */
  if (cfg.webEnabled || cfg.islamicEnabled) {
    tools.push(
      {
        name: 'web_search',
        description:
          'Search the internet for information. Returns results with titles, URLs, and snippets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Search query.',
            },
            limit: {
              type: Type.INTEGER,
              description: `How many results (1-${MAX_TOOL_LIMIT}).`,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'fetch_webpage',
        description:
          'Retrieve the text content of a webpage.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: {
              type: Type.STRING,
              description: 'The webpage URL.',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'search_news',
        description:
          'Search recent news for a topic.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'News search query.',
            },
            limit: {
              type: Type.INTEGER,
              description: `How many results (1-${MAX_TOOL_LIMIT}).`,
            },
          },
          required: ['query'],
        },
      },
    );
  }

  if (cfg.islamicEnabled) {
    tools.push(
      {
        name: 'search_islamic_knowledge',
        description:
          'Search reliable Islamic resources for a topic.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Search query about Islamic knowledge.',
            },
            limit: {
              type: Type.INTEGER,
              description: `How many results (1-${MAX_TOOL_LIMIT}).`,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_quran',
        description:
          'Search Quranic content for a keyword or topic.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Search query.',
            },
            limit: {
              type: Type.INTEGER,
              description: `How many results (1-${MAX_TOOL_LIMIT}).`,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_quran_verse',
        description:
          'Retrieve a specific Quranic verse and its reference (surah and ayah).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            surah: {
              type: Type.INTEGER,
              description: 'Surah number (1-114).',
            },
            ayah: {
              type: Type.INTEGER,
              description: 'Ayah number within the surah.',
            },
          },
          required: ['surah', 'ayah'],
        },
      },
      {
        name: 'search_hadith',
        description:
          'Search Hadith collections for a keyword.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Search query.',
            },
            limit: {
              type: Type.INTEGER,
              description: `How many results (1-${MAX_TOOL_LIMIT}).`,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_hadith',
        description:
          'Retrieve a Hadith with its source and reference.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            collection: {
              type: Type.STRING,
              description: 'Hadith collection name (e.g. Sahih al-Bukhari).',
            },
            number: {
              type: Type.INTEGER,
              description: 'Hadith number within the collection.',
            },
          },
          required: ['collection', 'number'],
        },
      },
      {
        name: 'get_prayer_times',
        description:
          'Retrieve prayer times for a specified location (city or coordinates).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            location: {
              type: Type.STRING,
              description: 'City name or location.',
            },
            date: {
              type: Type.STRING,
              description: 'Optional date in YYYY-MM-DD format. Defaults to today.',
            },
          },
          required: ['location'],
        },
      },
      {
        name: 'get_hijri_date',
        description:
          'Retrieve the current Hijri (Islamic) date.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
    );
  }

  /* ---- Time and scheduling tools ---- */
  if (cfg.schedulingEnabled) {
    tools.push(
      {
        name: 'get_current_time',
        description:
          'Retrieve the current date and time in Morocco and UTC.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_timezone',
        description:
          'Retrieve timezone information for a location or IANA zone.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            location: {
              type: Type.STRING,
              description: 'City name or IANA timezone (e.g. Africa/Casablanca).',
            },
          },
        },
      },
      {
        name: 'schedule_message',
        description:
          'Schedule a future Discord message to be sent automatically. Survives restarts.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            channel_id: {
              type: Type.STRING,
              description:
                'The Discord channel id to send the message in.',
            },
            content: {
              type: Type.STRING,
              description: 'The message text to send.',
            },
            scheduled_at: {
              type: Type.STRING,
              description:
                'ISO 8601 timestamp when the message should be sent (must be in the future).',
            },
          },
          required: ['channel_id', 'content', 'scheduled_at'],
        },
      },
      {
        name: 'cancel_scheduled_message',
        description:
          'Cancel a pending scheduled message by id.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            scheduled_message_id: {
              type: Type.STRING,
              description: 'The id of the scheduled message to cancel.',
            },
          },
          required: ['scheduled_message_id'],
        },
      },
      {
        name: 'list_scheduled_messages',
        description:
          'Retrieve pending scheduled messages for this server.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
    );
  }

  /* ---- Attachments and media tools ---- */
  if (cfg.attachmentsEnabled) {
    tools.push(
      {
        name: 'get_attachment_info',
        description:
          'Retrieve attachment metadata (filename, size, content type, URL) for attachments in a message.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            message_id: {
              type: Type.STRING,
              description: 'The Discord message id.',
            },
            channel_id: {
              type: Type.STRING,
              description:
                'Optional channel id. Defaults to the current channel.',
            },
          },
          required: ['message_id'],
        },
      },
      {
        name: 'read_text_attachment',
        description:
          'Read the text content of a supported text attachment.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            message_id: {
              type: Type.STRING,
              description: 'The Discord message id containing the attachment.',
            },
            attachment_id: {
              type: Type.STRING,
              description:
                'The attachment id (filename) to read.',
            },
            channel_id: {
              type: Type.STRING,
              description:
                'Optional channel id. Defaults to the current channel.',
            },
          },
          required: ['message_id', 'attachment_id'],
        },
      },
      {
        name: 'extract_document_text',
        description:
          'Extract text from a supported document attachment.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            message_id: {
              type: Type.STRING,
              description: 'The Discord message id containing the document.',
            },
            attachment_id: {
              type: Type.STRING,
              description:
                'The attachment id (filename) to extract from.',
            },
            channel_id: {
              type: Type.STRING,
              description:
                'Optional channel id. Defaults to the current channel.',
            },
          },
          required: ['message_id', 'attachment_id'],
        },
      },
      {
        name: 'analyze_image',
        description:
          'Analyze an image attachment using available vision input. Describes what is visible in the image.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            message_id: {
              type: Type.STRING,
              description: 'The Discord message id containing the image.',
            },
            attachment_id: {
              type: Type.STRING,
              description:
                'The attachment id (filename) to analyze.',
            },
            channel_id: {
              type: Type.STRING,
              description:
                'Optional channel id. Defaults to the current channel.',
            },
          },
          required: ['message_id', 'attachment_id'],
        },
      },
    );
  }

  return tools;
}

/* ------------------------------------------------------------------ */
/* Tool execution                                                     */
/* ------------------------------------------------------------------ */

export interface L7ajToolExecutorInput {
  name: string;
  args: Record<string, unknown>;
}

export type L7ajToolExecutor = (
  input: L7ajToolExecutorInput,
) => Promise<Record<string, unknown>>;

/**
 * Build the tool executor bound to a Discord context. All failures return
 * { ok: false, error: "..." } so Gemini can recover gracefully.
 */
export function createToolExecutor(ctx: L7ajToolContext): L7ajToolExecutor {
  return async ({ name, args }): Promise<Record<string, unknown>> => {
    switch (name) {
      /* ---- Discord context tools ---- */
      case 'get_server_info':
        return getServerInfo(ctx);
      case 'get_channel_info':
        return getChannelInfo(ctx, args.channel_id);
      case 'get_member_info':
        return getMemberInfo(ctx, args.member);
      case 'get_member_roles':
        return getMemberRoles(ctx, args.member);
      case 'get_message':
        return getMessage(ctx, args.message_id, args.channel_id);
      case 'get_recent_messages':
        return getRecentMessages(ctx, args.channel_id, args.limit);
      case 'get_thread_messages':
        return getThreadMessages(ctx, args.thread_id, args.limit);
      case 'search_discord_messages':
        return searchDiscordMessages(ctx, args.query, args.channel_id, args.limit);
      case 'get_message_reactions':
        return getMessageReactions(ctx, args.message_id, args.channel_id);
      case 'get_conversation_context':
        return getConversationContext(ctx, args.channel_id, args.around_message_id, args.limit);

      /* ---- Autonomous communication tools ---- */
      case 'send_message':
        return sendMessage(ctx, args.channel_id, args.content, args.reply_to_message_id);
      case 'reply_to_message':
        return replyToMessage(ctx, args.message_id, args.channel_id, args.content);
      case 'start_conversation':
        return startConversation(ctx, args.channel_id, args.content);
      case 'send_followup':
        return sendFollowup(ctx, args.channel_id, args.content, args.reply_to_message_id);
      case 'send_multiple_messages':
        return sendMultipleMessages(ctx, args.channel_id, args.messages);
      case 'edit_own_message':
        return editOwnMessage(ctx, args.message_id, args.channel_id, args.content);
      case 'delete_own_message':
        return deleteOwnMessage(ctx, args.message_id, args.channel_id);
      case 'add_reaction':
        return addReaction(ctx, args.message_id, args.channel_id, args.emoji);
      case 'create_thread':
        return createThread(ctx, args.channel_id, args.message_id, args.name);

      /* ---- Community awareness tools ---- */
      case 'observe_channel':
        return observeChannel(ctx, args.channel_id, args.limit);
      case 'observe_server_activity':
        return observeServerActivity(ctx, args.limit);
      case 'detect_interesting_message':
        return detectInterestingMessage(ctx, args.channel_id, args.limit);
      case 'detect_unanswered_question':
        return detectUnansweredQuestion(ctx, args.channel_id, args.limit);
      case 'detect_conversation':
        return detectConversation(ctx, args.channel_id, args.limit);
      case 'check_member_interaction':
        return checkMemberInteraction(ctx, args.member, args.channel_id, args.limit);

      /* ---- Memory tools ---- */
      case 'remember_information':
        return rememberInformation(ctx, args.fact, args.about);
      case 'search_memory':
        return searchMemory(ctx, args.query, args.about, args.limit);
      case 'get_memory':
        return getMemory(ctx, args.memory_id);
      case 'update_memory':
        return updateMemory(ctx, args.memory_id, args.fact);
      case 'forget_information':
        return forgetInformation(ctx, args.memory_id);
      case 'get_conversation_history':
        return getConversationHistory(ctx, args.channel_id, args.limit);
      case 'summarize_conversation':
        return summarizeConversation(ctx, args.channel_id, args.limit);

      /* ---- Community knowledge tools ---- */
      case 'get_server_rules':
        return getServerRulesTool(ctx);
      case 'search_server_knowledge':
        return searchServerKnowledge(ctx, args.query);
      case 'get_server_announcements':
        return getServerAnnouncements(ctx);
      case 'get_server_events':
        return getServerEvents(ctx);
      case 'get_faq':
        return getFaq(ctx);
      case 'get_server_statistics':
        return getServerStatistics(ctx);

      /* ---- Internet and information tools ---- */
      case 'web_search':
        return webSearch(ctx, args.query, args.limit);
      case 'fetch_webpage':
        return fetchWebpage(ctx, args.url);
      case 'search_news':
        return searchNews(ctx, args.query, args.limit);

      /* ---- Islamic knowledge tools ---- */
      case 'search_islamic_knowledge':
        return searchIslamicKnowledge(ctx, args.query, args.limit);
      case 'search_quran':
        return searchQuran(ctx, args.query, args.limit);
      case 'get_quran_verse':
        return getQuranVerse(ctx, args.surah, args.ayah);
      case 'search_hadith':
        return searchHadith(ctx, args.query, args.limit);
      case 'get_hadith':
        return getHadith(ctx, args.collection, args.number);
      case 'get_prayer_times':
        return getPrayerTimes(ctx, args.location, args.date);
      case 'get_hijri_date':
        return getHijriDate(ctx);

      /* ---- Time and scheduling tools ---- */
      case 'get_current_time':
        return getCurrentTimeTool();
      case 'get_timezone':
        return getTimezone(ctx, args.location);
      case 'schedule_message':
        return scheduleMessage(ctx, args.channel_id, args.content, args.scheduled_at);
      case 'cancel_scheduled_message':
        return cancelScheduledMessageTool(ctx, args.scheduled_message_id);
      case 'list_scheduled_messages':
        return listScheduledMessagesTool(ctx);

      /* ---- Attachments and media tools ---- */
      case 'get_attachment_info':
        return getAttachmentInfo(ctx, args.message_id, args.channel_id, args.attachment_id);
      case 'read_text_attachment':
        return readTextAttachment(ctx, args.message_id, args.channel_id, args.attachment_id);
      case 'extract_document_text':
        return extractDocumentText(ctx, args.message_id, args.channel_id, args.attachment_id);
      case 'analyze_image':
        return analyzeImage(ctx, args.message_id, args.channel_id, args.attachment_id);

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function toLimit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function resolveChannel(ctx: L7ajToolContext, channelId: unknown): Channel | null {
  const id = typeof channelId === 'string' ? channelId : undefined;
  if (!id) return ctx.channel;
  return ctx.client.channels.cache.get(id) ?? null;
}

function resolveTextChannel(ctx: L7ajToolContext, channelId: unknown): TextChannel | NewsChannel | null {
  const channel = resolveChannel(ctx, channelId);
  if (!channel || !channel.isTextBased()) return null;
  if (channel.type === 10 || channel.type === 11) {
    return null;
  }
  return channel as TextChannel | NewsChannel;
}

async function resolveMember(ctx: L7ajToolContext, raw: unknown): Promise<GuildMember | null> {
  if (typeof raw !== 'string') return null;
  const query = raw.replace(/^<@!?(\d+)>$/, '$1').trim();
  if (!query) return null;

  const cached = ctx.guild.members.cache.find(
    (member) =>
      member.id === query ||
      member.user.username.toLowerCase() === query.toLowerCase() ||
      member.displayName.toLowerCase() === query.toLowerCase(),
  );
  if (cached) return cached;

  if (/^\d{15,25}$/.test(query)) {
    const fetched = await ctx.guild.members.fetch(query).catch(() => null);
    if (fetched) return fetched;
  }

  try {
    const results = await ctx.guild.members.fetch({ query, limit: 1 });
    return results.first() ?? null;
  } catch {
    return null;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const record = err as { message?: string; reason?: string };
    return record.message || record.reason || JSON.stringify(record);
  }
  return String(err);
}

async function sendToChannel(
  ctx: L7ajToolContext,
  channelId: string | undefined,
  content: string,
  options: { replyTo?: string } = {},
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('send' in channel)) {
    return { ok: false, error: 'Channel not found or not a text channel.' };
  }

  const allowedMentions = { parse: ['users'] as const };
  const payload: { content?: string; allowedMentions?: typeof allowedMentions; reply?: { messageReference: string; failIfNotExists?: boolean } } = {
    content: content.slice(0, MAX_MESSAGE_CHARS),
    allowedMentions,
  };

  if (options.replyTo) {
    payload.reply = { messageReference: options.replyTo, failIfNotExists: false };
  }

  try {
    const sent = await (channel as TextChannel | NewsChannel).send(payload);
    return {
      ok: true,
      messageId: sent.id,
      channelId: sent.channel.id,
      content: sent.content,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Discord context tools                                              */
/* ------------------------------------------------------------------ */

function getServerInfo(ctx: L7ajToolContext): Record<string, unknown> {
  return {
    ok: true,
    name: ctx.guild.name,
    id: ctx.guild.id,
    memberCount: ctx.guild.memberCount,
    createdAt: ctx.guild.createdAt.toISOString(),
    description: ctx.guild.description,
    ownerId: ctx.guild.ownerId,
    preferredLocale: ctx.guild.preferredLocale,
  };
}

function getChannelInfo(ctx: L7ajToolContext, channelId: unknown): Record<string, unknown> {
  const channel = resolveChannel(ctx, channelId) ?? ctx.channel;
  return {
    ok: true,
    id: channel.id,
    name: (channel as { name?: string }).name ?? null,
    type: channel.type,
    topic: (channel as { topic?: string | null }).topic ?? null,
    category: (channel as { parent?: { name?: string } | null }).parent?.name ?? null,
  };
}

async function getMemberInfo(ctx: L7ajToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const member = await resolveMember(ctx, raw);
  if (!member) return { ok: false, error: 'Member not found.' };

  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== ctx.guild.id)
    .sort((a, b) => b.position - a.position)
    .slice(0, 12)
    .map((role) => role.name);

  return {
    ok: true,
    id: member.id,
    displayName: member.displayName,
    username: member.user.username,
    bot: member.user.bot,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    accountCreatedAt: member.user.createdAt.toISOString(),
    roles,
    highestRole: member.roles.highest.name,
  };
}

async function getMemberRoles(ctx: L7ajToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const member = await resolveMember(ctx, raw);
  if (!member) return { ok: false, error: 'Member not found.' };

  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== ctx.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name, position: role.position }));

  return { ok: true, id: member.id, displayName: member.displayName, roles };
}

async function getMessage(
  ctx: L7ajToolContext,
  messageId: unknown,
  channelId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(messageId);
    return {
      ok: true,
      id: message.id,
      channelId: message.channel.id,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.username,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.size,
      replyTo: message.reference?.messageId ?? null,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getRecentMessages(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 20, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    return {
      ok: true,
      channelId: channel.id,
      messages: [...fetched.values()]
        .reverse()
        .map((message) => ({
          id: message.id,
          authorId: message.author.id,
          authorName: message.member?.displayName ?? message.author.username,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          bot: message.author.bot,
        })),
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getThreadMessages(
  ctx: L7ajToolContext,
  threadId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof threadId !== 'string') return { ok: false, error: 'A thread id is required.' };
  const channel = ctx.client.channels.cache.get(threadId);
  if (
    !channel ||
    (channel.type !== 10 && channel.type !== 11)
  ) {
    return { ok: false, error: 'Thread not found.' };
  }

  const limit = toLimit(rawLimit, 20, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as ThreadChannel).messages.fetch({ limit });
    return {
      ok: true,
      threadId,
      messages: [...fetched.values()]
        .reverse()
        .map((message) => ({
          id: message.id,
          authorId: message.author.id,
          authorName: message.member?.displayName ?? message.author.username,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          bot: message.author.bot,
        })),
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function searchDiscordMessages(
  ctx: L7ajToolContext,
  query: unknown,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof query !== 'string' || !query.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const limit = toLimit(rawLimit, 10, MAX_TOOL_LIMIT);
  const channels = channelId
    ? [resolveTextChannel(ctx, channelId)].filter(Boolean) as (TextChannel | NewsChannel)[]
    : [...ctx.guild.channels.cache.values()]
        .filter((c): c is TextChannel | NewsChannel => c.isTextBased() && c.type !== 10 && c.type !== 11)
        .slice(0, 10);

  const results: Array<{
    id: string;
    channelId: string;
    channelName: string | null;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: string;
  }> = [];

  for (const channel of channels) {
    if (results.length >= limit) break;
    try {
      const fetched = await channel.messages.fetch({ limit: 50 });
      for (const message of fetched.values()) {
        if (!message.content.toLowerCase().includes(query.toLowerCase())) continue;
        results.push({
          id: message.id,
          channelId: channel.id,
          channelName: channel.name ?? null,
          authorId: message.author.id,
          authorName: message.member?.displayName ?? message.author.username,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        });
        if (results.length >= limit) break;
      }
    } catch {
      /* channel not readable — skip */
    }
  }

  return { ok: true, query, results };
}

async function getMessageReactions(
  ctx: L7ajToolContext,
  messageId: unknown,
  channelId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(messageId);
    const reactions = [...message.reactions.cache.values()].map((reaction) => ({
      emoji: reaction.emoji.name ?? reaction.emoji.id ?? 'unknown',
      count: reaction.count,
      me: reaction.me,
    }));
    return { ok: true, messageId, reactions };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getConversationContext(
  ctx: L7ajToolContext,
  channelId: unknown,
  aroundMessageId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 20, MAX_TOOL_LIMIT);
  let around: Message | null = null;

  if (aroundMessageId) {
    try {
      around = await (channel as TextChannel | NewsChannel).messages.fetch(aroundMessageId as string);
    } catch {
      around = null;
    }
  }

  let before: Message[] = [];
  let after: Message[] = [];

  if (around) {
    try {
      const beforeFetched = await channel.messages.fetch({
        limit: Math.ceil(limit / 2),
        before: around.id,
      });
      before = [...beforeFetched.values()].reverse();
    } catch {
      /* ignore */
    }
    try {
      const afterFetched = await channel.messages.fetch({
        limit: Math.ceil(limit / 2),
        after: around.id,
      });
      after = [...afterFetched.values()];
    } catch {
      /* ignore */
    }
  } else {
    try {
      const fetched = await channel.messages.fetch({ limit });
      before = [...fetched.values()].reverse();
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    channelId: channel.id,
    around: around ? { id: around.id, authorId: around.author.id, content: around.content } : null,
    context: [
      ...before.map((m) => ({ id: m.id, authorId: m.author.id, authorName: m.member?.displayName ?? m.author.username, content: m.content })),
      ...(around ? [{ id: around.id, authorId: around.author.id, authorName: around.member?.displayName ?? around.author.username, content: around.content, focused: true }] : []),
      ...after.map((m) => ({ id: m.id, authorId: m.author.id, authorName: m.member?.displayName ?? m.author.username, content: m.content })),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Autonomous communication tools                                     */
/* ------------------------------------------------------------------ */

async function sendMessage(
  ctx: L7ajToolContext,
  channelId: unknown,
  content: unknown,
  replyToMessageId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'Message content is required.' };
  }
  return sendToChannel(ctx, typeof channelId === 'string' ? channelId : undefined, content, {
    replyTo: typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
  });
}

async function replyToMessage(
  ctx: L7ajToolContext,
  messageId: unknown,
  channelId: unknown,
  content: unknown,
): Promise<Record<string, unknown>> {
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'Reply content is required.' };

  const channel = resolveTextChannel(ctx, typeof channelId === 'string' ? channelId : undefined);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const target = await (channel as TextChannel | NewsChannel).messages.fetch(messageId);
    const sent = await target.reply({
      content: content.slice(0, MAX_MESSAGE_CHARS),
      allowedMentions: { parse: ['users'] as const },
      failIfNotExists: false,
    });
    return { ok: true, messageId: sent.id, channelId: sent.channel.id, content: sent.content };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function startConversation(
  ctx: L7ajToolContext,
  channelId: unknown,
  content: unknown,
): Promise<Record<string, unknown>> {
  if (typeof channelId !== 'string') return { ok: false, error: 'A channel id is required.' };
  if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'Conversation content is required.' };
  return sendToChannel(ctx, channelId, content);
}

async function sendFollowup(
  ctx: L7ajToolContext,
  channelId: unknown,
  content: unknown,
  replyToMessageId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'Follow-up content is required.' };
  return sendToChannel(ctx, typeof channelId === 'string' ? channelId : undefined, content, {
    replyTo: typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
  });
}

async function sendMultipleMessages(
  ctx: L7ajToolContext,
  channelId: unknown,
  messages: unknown,
): Promise<Record<string, unknown>> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'A non-empty messages array is required.' };
  }

  const targetChannel = typeof channelId === 'string' ? channelId : undefined;
  const results: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (typeof message !== 'string' || !message.trim()) {
      results.push({ ok: false, error: 'Skipped empty message.' });
      continue;
    }
    const result = await sendToChannel(ctx, targetChannel, message);
    results.push(result);
    // Small gap between messages so they feel natural, not like a burst.
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const ok = results.some((r) => r.ok === true);
  return { ok, results };
}

async function editOwnMessage(
  ctx: L7ajToolContext,
  messageId: unknown,
  channelId: unknown,
  content: unknown,
): Promise<Record<string, unknown>> {
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'New content is required.' };

  const channel = resolveTextChannel(ctx, typeof channelId === 'string' ? channelId : undefined);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const botId = ctx.client.user?.id;
  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(messageId);
    if (message.author.id !== botId) {
      return { ok: false, error: 'Only L7aj\'s own messages can be edited.' };
    }
    const edited = await message.edit(content.slice(0, MAX_MESSAGE_CHARS));
    return { ok: true, messageId: edited.id, channelId: edited.channel.id, content: edited.content };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function deleteOwnMessage(
  ctx: L7ajToolContext,
  messageId: unknown,
  channelId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };

  const channel = resolveTextChannel(ctx, typeof channelId === 'string' ? channelId : undefined);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const botId = ctx.client.user?.id;
  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(messageId);
    if (message.author.id !== botId) {
      return { ok: false, error: 'Only L7aj\'s own messages can be deleted.' };
    }
    await message.delete();
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function addReaction(
  ctx: L7ajToolContext,
  messageId: unknown,
  channelId: unknown,
  emoji: unknown,
): Promise<Record<string, unknown>> {
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof emoji !== 'string' || !emoji.trim()) return { ok: false, error: 'An emoji is required.' };

  const channel = resolveTextChannel(ctx, typeof channelId === 'string' ? channelId : undefined);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(messageId);
    await message.react(emoji.trim());
    return { ok: true, messageId, emoji: emoji.trim() };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function createThread(
  ctx: L7ajToolContext,
  channelId: unknown,
  messageId: unknown,
  name: unknown,
): Promise<Record<string, unknown>> {
  if (typeof channelId !== 'string') return { ok: false, error: 'A channel id is required.' };
  if (typeof messageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'A thread name is required.' };

  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('threads' in channel)) {
    return { ok: false, error: 'Channel not found or does not support threads.' };
  }

  try {
    const thread = await (channel as TextChannel | NewsChannel).threads.create({
      name: name.trim().slice(0, 100),
      startMessage: messageId,
      reason: 'L7aj started a discussion thread.',
    });
    return { ok: true, threadId: thread.id, channelId: thread.parentId ?? channelId, name: thread.name };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Community awareness tools                                          */
/* ------------------------------------------------------------------ */

async function observeChannel(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 20, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    const messages = [...fetched.values()].reverse().map((message) => ({
      id: message.id,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.username,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      bot: message.author.bot,
    }));
    return {
      ok: true,
      channelId: channel.id,
      channelName: channel.name ?? null,
      messages,
      activeAuthors: [...new Set(messages.map((m) => m.authorId))].length,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function observeServerActivity(
  ctx: L7ajToolContext,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const limit = toLimit(rawLimit, 10, MAX_TOOL_LIMIT);

  const textChannels = [...ctx.guild.channels.cache.values()]
    .filter((c): c is TextChannel | NewsChannel => c.isTextBased() && c.type !== 10 && c.type !== 11)
    .slice(0, limit);

  const channelActivity: Array<{
    channelId: string;
    channelName: string | null;
    messageCount: number;
    lastMessage: { authorName: string; content: string } | null;
  }> = [];

  for (const channel of textChannels) {
    try {
      const fetched = await channel.messages.fetch({ limit: 5 });
      const messages = [...fetched.values()].reverse();
      channelActivity.push({
        channelId: channel.id,
        channelName: channel.name ?? null,
        messageCount: messages.length,
        lastMessage: messages.length
          ? {
              authorName: messages[messages.length - 1].member?.displayName ?? messages[messages.length - 1].author.username,
              content: messages[messages.length - 1].content,
            }
          : null,
      });
    } catch {
      /* skip unreadable channels */
    }
  }

  const voiceChannels = [...ctx.guild.channels.cache.values()].filter((c) => c.isVoiceBased());
  const voiceMembers: Array<{ channel: string; members: Array<{ name: string; id: string }> }> = [];
  for (const channel of voiceChannels) {
    const humans = [...channel.members.values()].filter((m) => !m.user.bot);
    if (humans.length === 0) continue;
    voiceMembers.push({
      channel: channel.name,
      members: humans.slice(0, 10).map((m) => ({ name: m.displayName, id: m.id })),
    });
  }

  return {
    ok: true,
    guildId: ctx.guild.id,
    guildName: ctx.guild.name,
    memberCount: ctx.guild.memberCount,
    textChannels: channelActivity,
    voiceMembers,
    totalVoiceConnected: voiceMembers.reduce((sum, v) => sum + v.members.length, 0),
  };
}

function isLikelyQuestion(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  const questionMarks = trimmed.includes('?');
  const questionWords = ['wach', 'chno', 'fin', '3lach', 'kwash', 'shno', 'who', 'what', 'where', 'when', 'why', 'how', 'can', 'could', 'would', 'is', 'are', 'do', 'does'];
  const startsWithQuestion = questionWords.some((w) => lower.startsWith(w) || lower.startsWith(`${w} `));
  return questionMarks || startsWithQuestion;
}

function isLikelyAnswer(content: string): boolean {
  const lower = content.toLowerCase().trim();
  // Very short affirmative/negative or emoji-only replies count as answers.
  const shortReplies = ['yes', 'no', 'sahi', 'error', 'wakha', 'safi', 'mmk', 'ok', 'okay', 'hhh', 'hhhh', '👍', '👎', '💯', '✅', '❌'];
  if (shortReplies.includes(lower)) return true;
  return false;
}

async function detectInterestingMessage(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 30, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    const messages = [...fetched.values()].reverse();

    const interesting = messages
      .filter((message) => !message.author.bot)
      .filter((message) => {
        const content = message.content.trim();
        return content.length > 3 && content.length < 500;
      })
      .slice(-10)
      .map((message) => ({
        id: message.id,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        reactions: message.reactions.cache.size,
      }));

    return { ok: true, channelId: channel.id, interesting };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function detectUnansweredQuestion(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 30, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    const messages = [...fetched.values()].reverse();

    const unanswered = messages
      .filter((message) => !message.author.bot)
      .filter((message) => isLikelyQuestion(message.content))
      .filter((message, index) => {
        // Consider a question unanswered if no non-bot reply follows within the window.
        const following = messages.slice(index + 1, index + 4);
        return !following.some((m) => !m.author.bot && m.content.trim().length > 0);
      })
      .slice(-5)
      .map((message) => ({
        id: message.id,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      }));

    return { ok: true, channelId: channel.id, unansweredQuestions: unanswered };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function detectConversation(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 40, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    const messages = [...fetched.values()].reverse();

    // Cluster messages by author proximity: messages from different authors close together form a discussion.
    const clusters: Array<{ participants: string[]; messageCount: number; lastAt: string }> = [];
    let current: string[] = [];
    let count = 0;
    let lastAt = '';

    for (const message of messages) {
      if (message.author.bot) continue;
      if (!current.includes(message.author.id)) current.push(message.author.id);
      count += 1;
      lastAt = message.createdAt.toISOString();

      // When the same author sends 3+ in a row or a long gap, close the cluster.
      const next = messages[messages.indexOf(message) + 1];
      if (!next || next.author.id === message.author.id) {
        if (current.length >= 2 && count >= 2) {
          clusters.push({ participants: [...current], messageCount: count, lastAt });
        }
        current = [];
        count = 0;
      }
    }

    return {
      ok: true,
      channelId: channel.id,
      ongoingDiscussions: clusters.slice(-5),
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function checkMemberInteraction(
  ctx: L7ajToolContext,
  rawMember: unknown,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const member = await resolveMember(ctx, rawMember);
  if (!member) return { ok: false, error: 'Member not found.' };

  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  const limit = toLimit(rawLimit, 30, MAX_TOOL_LIMIT);
  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    const messages = [...fetched.values()].reverse();

    const interactions = messages
      .filter((message) => message.author.id === member.id)
      .map((message) => ({
        id: message.id,
        authorId: message.author.id,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        reactions: message.reactions.cache.size,
      }))
      .slice(-10);

    return {
      ok: true,
      memberId: member.id,
      memberName: member.displayName,
      channelId: channel.id,
      interactions,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Memory tools                                                       */
/* ------------------------------------------------------------------ */

async function rememberInformation(
  ctx: L7ajToolContext,
  rawFact: unknown,
  rawAbout: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawFact !== 'string' || !rawFact.trim()) {
    return { ok: false, error: 'A fact is required.' };
  }

  const about = typeof rawAbout === 'string' ? rawAbout.trim() : '';
  let resolved: { id: string; displayName: string } | null = null;
  if (about) {
    const member = await resolveMember(ctx, about);
    if (member) resolved = { id: member.id, displayName: member.displayName };
  }

  const note = addMemory(ctx.guild.id, {
    fact: rawFact.trim().slice(0, 400),
    aboutUserId: resolved?.id,
    aboutName: resolved?.displayName ?? (about || undefined),
  });

  if (!note) return { ok: false, error: 'The fact was empty and was not saved.' };

  return {
    ok: true,
    id: note.id,
    fact: note.fact,
    about: note.aboutName ?? null,
    totalNotes: countMemories(ctx.guild.id),
  };
}

async function searchMemory(
  ctx: L7ajToolContext,
  rawQuery: unknown,
  rawAbout: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  const about = typeof rawAbout === 'string' ? rawAbout.trim() : '';
  const limit = toLimit(rawLimit, 10, 50);

  let notes = recallMemories(ctx.guild.id, { about: about || undefined, limit });
  if (query) {
    const q = query.toLowerCase();
    notes = notes.filter(
      (note) => note.fact.toLowerCase().includes(q) || (note.aboutName ?? '').toLowerCase().includes(q),
    );
  }

  return {
    ok: true,
    query,
    about: about || null,
    notes: notes.map((note) => ({
      id: note.id,
      fact: note.fact,
      about: note.aboutName ?? null,
      createdAt: new Date(note.createdAt).toISOString(),
    })),
    totalNotes: countMemories(ctx.guild.id),
  };
}

async function getMemory(ctx: L7ajToolContext, rawMemoryId: unknown): Promise<Record<string, unknown>> {
  if (typeof rawMemoryId !== 'string') return { ok: false, error: 'A memory id is required.' };

  const notes = recallMemories(ctx.guild.id, { limit: 500 });
  const note = notes.find((n) => n.id === rawMemoryId);
  if (!note) return { ok: false, error: 'Memory not found.' };

  return {
    ok: true,
    id: note.id,
    fact: note.fact,
    about: note.aboutName ?? null,
    aboutUserId: note.aboutUserId ?? null,
    createdAt: new Date(note.createdAt).toISOString(),
  };
}

async function updateMemory(
  ctx: L7ajToolContext,
  rawMemoryId: unknown,
  rawFact: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawMemoryId !== 'string') return { ok: false, error: 'A memory id is required.' };
  if (typeof rawFact !== 'string' || !rawFact.trim()) return { ok: false, error: 'A fact is required.' };

  const notes = recallMemories(ctx.guild.id, { limit: 500 });
  const note = notes.find((n) => n.id === rawMemoryId);
  if (!note) return { ok: false, error: 'Memory not found.' };

  // Update: delete the old note and re-add with new content (the JSON store
  // does not support in-place updates, so we re-add and clear duplicates).
  clearMemories(ctx.guild.id);
  const allNotes = recallMemories(ctx.guild.id, { limit: 500 });
  for (const existing of allNotes) {
    if (existing.id === rawMemoryId) continue;
    addMemory(ctx.guild.id, {
      fact: existing.fact,
      aboutUserId: existing.aboutUserId,
      aboutName: existing.aboutName,
    });
  }
  const updated = addMemory(ctx.guild.id, {
    fact: rawFact.trim().slice(0, 400),
    aboutUserId: note.aboutUserId,
    aboutName: note.aboutName,
  });

  return {
    ok: true,
    id: updated?.id ?? rawMemoryId,
    fact: updated?.fact ?? rawFact,
    about: updated?.aboutName ?? null,
  };
}

async function forgetInformation(
  ctx: L7ajToolContext,
  rawMemoryId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawMemoryId !== 'string') return { ok: false, error: 'A memory id is required.' };

  const notes = recallMemories(ctx.guild.id, { limit: 500 });
  const note = notes.find((n) => n.id === rawMemoryId);
  if (!note) return { ok: false, error: 'Memory not found.' };

  // Remove this one note by clearing and re-adding all others.
  clearMemories(ctx.guild.id);
  const remaining = notes.filter((n) => n.id !== rawMemoryId);
  for (const existing of remaining) {
    addMemory(ctx.guild.id, {
      fact: existing.fact,
      aboutUserId: existing.aboutUserId,
      aboutName: existing.aboutName,
    });
  }

  return { ok: true, id: rawMemoryId, totalNotes: countMemories(ctx.guild.id) };
}

async function getConversationHistory(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const targetChannel = typeof channelId === 'string' ? channelId : ctx.channel.id;
  const limit = toLimit(rawLimit, 20, MAX_TOOL_LIMIT);

  // The persona's in-memory history lives in l7aj.ts and isn't exported here,
  // so we read recent Discord messages as the conversation history.
  const channel = resolveTextChannel(ctx, targetChannel);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    return {
      ok: true,
      channelId: channel.id,
      history: [...fetched.values()]
        .reverse()
        .map((message) => ({
          id: message.id,
          authorId: message.author.id,
          authorName: message.member?.displayName ?? message.author.username,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          bot: message.author.bot,
        })),
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function summarizeConversation(
  ctx: L7ajToolContext,
  channelId: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const targetChannel = typeof channelId === 'string' ? channelId : ctx.channel.id;
  const limit = toLimit(rawLimit, 30, MAX_TOOL_LIMIT);

  const channel = resolveTextChannel(ctx, targetChannel);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const fetched = await (channel as TextChannel | NewsChannel).messages.fetch({ limit });
    const messages = [...fetched.values()].reverse();

    const participants = [...new Set(messages.filter((m) => !m.author.bot).map((m) => m.member?.displayName ?? m.author.username))];
    const topics = messages
      .filter((m) => !m.author.bot && m.content.trim().length > 0)
      .slice(-10)
      .map((m) => m.content.slice(0, 100));

    const summary = [
      `Recent conversation in #${channel.name ?? 'this channel'}:`,
      `Participants: ${participants.join(', ') || 'none'}.`,
      `Recent messages: ${topics.join(' | ')}.`,
    ].join(' ');

    const note = addMemory(ctx.guild.id, {
      fact: summary,
      aboutName: `channel ${channel.name ?? targetChannel}`,
    });

    return {
      ok: true,
      channelId: channel.id,
      summary,
      participants,
      messageCount: messages.length,
      storedAsMemory: Boolean(note),
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Community knowledge tools                                          */
/* ------------------------------------------------------------------ */

function getServerRulesTool(ctx: L7ajToolContext): Record<string, unknown> {
  const rules = getServerRules(ctx.guild.id);
  if (!rules) return { ok: true, rules: [], message: 'No server rules have been stored yet.' };
  return {
    ok: true,
    rules: rules.rules.map((r) => ({ id: r.id, title: r.title, content: r.content })),
    updatedAt: new Date(rules.updatedAt).toISOString(),
  };
}

async function searchServerKnowledge(ctx: L7ajToolContext, rawQuery: unknown): Promise<Record<string, unknown>> {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const q = rawQuery.trim().toLowerCase();

  const faqMatches = searchFaq(ctx.guild.id, q, 10).map((e) => ({
    type: 'faq',
    id: e.id,
    title: e.question,
    content: e.answer,
    category: e.category,
  }));

  const announcementMatches = listAnnouncements(ctx.guild.id)
    .filter((a) => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q))
    .slice(0, 10)
    .map((a) => ({
      type: 'announcement',
      id: a.id,
      title: a.title,
      content: a.content,
    }));

  const rules = getServerRules(ctx.guild.id);
  const ruleMatches = rules
    ? rules.rules
        .filter((r) => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q))
        .slice(0, 10)
        .map((r) => ({ type: 'rule', id: r.id, title: r.title, content: r.content }))
    : [];

  return {
    ok: true,
    query: q,
    results: [...faqMatches, ...announcementMatches, ...ruleMatches].slice(0, 20),
  };
}

function getServerAnnouncements(ctx: L7ajToolContext): Record<string, unknown> {
  const announcements = listAnnouncements(ctx.guild.id);
  return {
    ok: true,
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      channelId: a.channelId,
      createdAt: new Date(a.createdAt).toISOString(),
      createdBy: a.createdBy,
    })),
  };
}

function getServerEvents(ctx: L7ajToolContext): Record<string, unknown> {
  const events = listServerEvents(ctx.guild.id);
  const now = Date.now();
  return {
    ok: true,
    upcoming: events.filter((e) => e.startsAt > now).map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      startsAt: new Date(e.startsAt).toISOString(),
      endsAt: e.endsAt ? new Date(e.endsAt).toISOString() : null,
      channelId: e.channelId,
    })),
    previous: events.filter((e) => e.startsAt <= now).map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      startsAt: new Date(e.startsAt).toISOString(),
      endsAt: e.endsAt ? new Date(e.endsAt).toISOString() : null,
      channelId: e.channelId,
    })),
  };
}

function getFaq(ctx: L7ajToolContext): Record<string, unknown> {
  const entries = listFaq(ctx.guild.id);
  return {
    ok: true,
    faq: entries.map((e) => ({
      id: e.id,
      question: e.question,
      answer: e.answer,
      category: e.category,
      createdAt: new Date(e.createdAt).toISOString(),
    })),
  };
}

function getServerStatistics(ctx: L7ajToolContext): Record<string, unknown> {
  const top = getLeaderboard(10).map((row, index) => {
    const member = ctx.guild.members.cache.get(row.user_id);
    return {
      position: index + 1,
      id: row.user_id,
      name: member?.displayName ?? member?.user.username ?? `user ${row.user_id}`,
      level: row.level,
      xp: row.xp,
    };
  });

  return {
    ok: true,
    guildId: ctx.guild.id,
    guildName: ctx.guild.name,
    memberCount: ctx.guild.memberCount,
    rankedMembers: countRanked(),
    totalMembersTracked: getTotalMemberCount(),
    topXp: top,
    scheduledPending: countScheduled(ctx.guild.id),
    memoryNotes: countMemories(ctx.guild.id),
  };
}

/* ------------------------------------------------------------------ */
/* Internet and information tools                                     */
/* ------------------------------------------------------------------ */

async function webSearch(
  ctx: L7ajToolContext,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const limit = toLimit(rawLimit, 5, MAX_TOOL_LIMIT);
  const query = rawQuery.trim();

  // DuckDuckGo HTML endpoint — no API key required, dependency-free.
  try {
    const response = await fetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
      },
    );
    if (!response.ok) {
      return { ok: false, error: `Search service returned HTTP ${response.status}.` };
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Very lightweight extraction of result links from DuckDuckGo HTML.
    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
      let url = match[1];
      // DuckDuckGo wraps URLs in a redirect parameter.
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      results.push({
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        url,
        snippet: '',
      });
    }

    return { ok: true, query, results };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function fetchWebpage(ctx: L7ajToolContext, rawUrl: unknown): Promise<Record<string, unknown>> {
  if (typeof rawUrl !== 'string') return { ok: false, error: 'A URL is required.' };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Invalid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
    });
    if (!response.ok) {
      return { ok: false, error: `Server returned HTTP ${response.status}.` };
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { ok: false, error: `Unsupported content type: ${contentType}.` };
    }

    const html = (await response.text()).slice(0, 200_000);

    // Strip scripts and styles, then collapse tags to readable text.
    const stripped = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);

    return {
      ok: true,
      url: url.toString(),
      title: (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '').trim(),
      content: stripped,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function searchNews(
  ctx: L7ajToolContext,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const limit = toLimit(rawLimit, 5, MAX_TOOL_LIMIT);
  const query = rawQuery.trim();

  try {
    const response = await fetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query + ' news')}&df=w`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
      },
    );
    if (!response.ok) {
      return { ok: false, error: `News service returned HTTP ${response.status}.` };
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
      let url = match[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      results.push({
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        url,
        snippet: '',
      });
    }

    return { ok: true, query, results };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Islamic knowledge tools                                            */
/* ------------------------------------------------------------------ */

async function searchIslamicKnowledge(
  ctx: L7ajToolContext,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const limit = toLimit(rawLimit, 5, MAX_TOOL_LIMIT);
  const query = rawQuery.trim();

  try {
    const response = await fetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(`Islamic knowledge ${query}`)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
      },
    );
    if (!response.ok) {
      return { ok: false, error: `Search service returned HTTP ${response.status}.` };
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
      let url = match[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      results.push({
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        url,
        snippet: '',
      });
    }

    return { ok: true, query, results };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function searchQuran(
  ctx: L7ajToolContext,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const limit = toLimit(rawLimit, 5, MAX_TOOL_LIMIT);
  const query = rawQuery.trim();

  // Al-Quran Cloud API — free, no key required.
  try {
    const response = await fetch(
      `https://www.alquran.cloud/api/quran/en.asad?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      return { ok: false, error: `Quran API returned HTTP ${response.status}.` };
    }

    const data = (await response.json()) as any;
    const results: Array<{ surah: number; ayah: number; text: string; reference: string }> = [];

    if (data && data.data) {
      const hits = Array.isArray(data.data) ? data.data : [data.data];
      for (const hit of hits) {
        if (results.length >= limit) break;
        results.push({
          surah: hit.surah?.number ?? null,
          ayah: hit.numberInSurah ?? null,
          text: hit.text ?? '',
          reference: hit.surah?.englishName ? `Surah ${hit.surah.englishName} ${hit.numberInSurah ?? ''}` : 'Quran',
        });
      }
    }

    return { ok: true, query, results };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getQuranVerse(
  ctx: L7ajToolContext,
  rawSurah: unknown,
  rawAyah: unknown,
): Promise<Record<string, unknown>> {
  const surah = typeof rawSurah === 'number' ? rawSurah : Number(rawSurah);
  const ayah = typeof rawAyah === 'number' ? rawAyah : Number(rawAyah);

  if (!Number.isFinite(surah) || surah < 1 || surah > 114) {
    return { ok: false, error: 'Surah must be a number between 1 and 114.' };
  }
  if (!Number.isFinite(ayah) || ayah < 1) {
    return { ok: false, error: 'Ayah must be a positive number.' };
  }

  try {
    const response = await fetch(
      `https://www.alquran.cloud/api/ayah/${surah}:${ayah}/en.asad`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      return { ok: false, error: `Quran API returned HTTP ${response.status}.` };
    }

    const data = (await response.json()) as any;
    if (!data || !data.data) {
      return { ok: false, error: 'Verse not found.' };
    }

    const verse = data.data as {
      text?: string;
      numberInSurah?: number;
      surah?: { number?: number; englishName?: string };
    };

    return {
      ok: true,
      surah: verse.surah?.number ?? surah,
      surahName: verse.surah?.englishName ?? null,
      ayah: verse.numberInSurah ?? ayah,
      text: verse.text ?? '',
      reference: `Surah ${verse.surah?.englishName ?? surah}:${verse.numberInSurah ?? ayah}`,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function searchHadith(
  ctx: L7ajToolContext,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return { ok: false, error: 'A search query is required.' };
  }

  const limit = toLimit(rawLimit, 5, MAX_TOOL_LIMIT);
  const query = rawQuery.trim();

  try {
    const response = await fetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(`hadith ${query} site:sunnah.com`)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
      },
    );
    if (!response.ok) {
      return { ok: false, error: `Search service returned HTTP ${response.status}.` };
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
      let url = match[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      results.push({
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        url,
        snippet: '',
      });
    }

    return { ok: true, query, results };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getHadith(
  ctx: L7ajToolContext,
  rawCollection: unknown,
  rawNumber: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawCollection !== 'string' || !rawCollection.trim()) {
    return { ok: false, error: 'A collection name is required.' };
  }
  const number = typeof rawNumber === 'number' ? rawNumber : Number(rawNumber);
  if (!Number.isFinite(number) || number < 1) {
    return { ok: false, error: 'Hadith number must be a positive number.' };
  }

  const collection = rawCollection.trim();

  // Sunnah.com has no public JSON API without a key, so we search the web
  // for the reference and return what can be verified.
  try {
    const response = await fetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(`${collection} hadith ${number} site:sunnah.com`)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
      },
    );
    if (!response.ok) {
      return { ok: false, error: `Search service returned HTTP ${response.status}.` };
    }

    const html = await response.text();
    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/gi;
    const match = linkRegex.exec(html);

    if (!match) {
      return {
        ok: false,
        error: `Could not find a verifiable reference for ${collection} hadith ${number}.`,
      };
    }

    let url = match[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);

    return {
      ok: true,
      collection,
      number,
      referenceUrl: url,
      note: 'Hadith text could not be retrieved directly; open the reference to verify.',
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getPrayerTimes(
  ctx: L7ajToolContext,
  rawLocation: unknown,
  rawDate: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawLocation !== 'string' || !rawLocation.trim()) {
    return { ok: false, error: 'A location is required.' };
  }

  const location = rawLocation.trim();
  const date = typeof rawDate === 'string' && rawDate.trim() ? rawDate.trim() : undefined;

  try {
    const url = date
      ? `https://api.aladhan.com/v1/timings/${date}?city=${encodeURIComponent(location)}&method=2`
      : `https://api.aladhan.com/v1/timings?city=${encodeURIComponent(location)}&method=2`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return { ok: false, error: `Prayer times API returned HTTP ${response.status}.` };
    }

    const data = (await response.json()) as any;
    if (!data || !data.data) {
      return { ok: false, error: 'Prayer times not found for this location.' };
    }

    const timings = data.data.timings;
    const dateInfo = data.data.date;

    return {
      ok: true,
      location,
      date: dateInfo?.gregorian?.date ?? null,
      hijri: dateInfo?.hijri?.date ?? null,
      timings: {
        fajr: timings.Fajr ?? null,
        dhuhr: timings.Dhuhr ?? null,
        asr: timings.Asr ?? null,
        maghrib: timings.Maghrib ?? null,
        isha: timings.Isha ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function getHijriDate(ctx: L7ajToolContext): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(
      'https://api.aladhan.com/v1/hijriCalendar',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      return { ok: false, error: `Hijri calendar API returned HTTP ${response.status}.` };
    }

    const data = (await response.json()) as any;
    const today = data.data?.[0];
    if (!today) {
      return { ok: false, error: 'Could not retrieve the Hijri date.' };
    }

    return {
      ok: true,
      hijriDate: today.hijri.date,
      weekday: today.hijri.weekday?.en ?? null,
      month: today.hijri.month?.en ?? null,
      year: today.hijri.year ?? null,
      gregorian: today.gregorian?.date ?? null,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Time and scheduling tools                                          */
/* ------------------------------------------------------------------ */

function getCurrentTimeTool(): Record<string, unknown> {
  const now = new Date();
  return {
    ok: true,
    utc: now.toISOString(),
    morocco: new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Africa/Casablanca',
    }).format(now),
    timezone: 'Africa/Casablanca',
    timestamp: now.getTime(),
  };
}

async function getTimezone(ctx: L7ajToolContext, rawLocation: unknown): Promise<Record<string, unknown>> {
  const location = typeof rawLocation === 'string' ? rawLocation.trim() : '';
  const zone = location || 'Africa/Casablanca';

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      dateStyle: 'full',
      timeStyle: 'long',
    });
    const formatted = formatter.format(now);

    return {
      ok: true,
      zone,
      currentTime: formatted,
      utcOffset: now.toISOString(),
    };
  } catch {
    return { ok: false, error: `Unknown timezone: ${zone}.` };
  }
}

async function scheduleMessage(
  ctx: L7ajToolContext,
  rawChannelId: unknown,
  rawContent: unknown,
  rawScheduledAt: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawChannelId !== 'string') return { ok: false, error: 'A channel id is required.' };
  if (typeof rawContent !== 'string' || !rawContent.trim()) return { ok: false, error: 'Message content is required.' };
  if (typeof rawScheduledAt !== 'string') return { ok: false, error: 'A scheduled_at timestamp is required.' };

  const scheduledAt = Date.parse(rawScheduledAt);
  if (!Number.isFinite(scheduledAt)) return { ok: false, error: 'Invalid scheduled_at timestamp. Use ISO 8601.' };
  if (scheduledAt <= Date.now()) return { ok: false, error: 'The scheduled time must be in the future.' };

  const channel = resolveTextChannel(ctx, rawChannelId);
  if (!channel) return { ok: false, error: 'Channel not found or not a text channel.' };

  const record = createScheduledMessage({
    guildId: ctx.guild.id,
    channelId: channel.id,
    content: rawContent.trim(),
    scheduledAt,
    createdBy: ctx.client.user?.id ?? 'l7aj',
  });

  if (!record) return { ok: false, error: 'Could not schedule the message (limit reached or invalid).' };

  return {
    ok: true,
    id: record.id,
    channelId: record.channelId,
    content: record.content,
    scheduledAt: new Date(record.scheduledAt).toISOString(),
    status: record.status,
  };
}

async function cancelScheduledMessageTool(
  ctx: L7ajToolContext,
  rawId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawId !== 'string') return { ok: false, error: 'A scheduled message id is required.' };

  const cancelled = cancelScheduledMessage(ctx.guild.id, rawId);
  if (!cancelled) return { ok: false, error: 'Scheduled message not found or already sent/cancelled.' };

  return { ok: true, id: rawId };
}

async function listScheduledMessagesTool(
  ctx: L7ajToolContext,
): Promise<Record<string, unknown>> {
  const list = listScheduledMessages(ctx.guild.id);
  return {
    ok: true,
    guildId: ctx.guild.id,
    count: list.length,
    scheduled: list.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      content: r.content,
      scheduledAt: new Date(r.scheduledAt).toISOString(),
      status: r.status,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Scheduler loop                                                     */
/* ------------------------------------------------------------------ */

/**
 * Start the scheduled-message scheduler. Sends any due messages and keeps
 * running as a lightweight interval. Call once from clientReady.
 */
export function startScheduledMessageScheduler(client: Client): ReturnType<typeof setInterval> | null {
  const interval = setInterval(async () => {
    const cfg = getConfig();
    if (!cfg.l7aj.schedulingEnabled) return;
    if (!client.isReady()) return;

    const guild = client.guilds.cache.get(cfg.guildId);
    if (!guild) return;

    const defaultChannel = guild.channels.cache.find((c) => c.isTextBased());
    if (!defaultChannel) return;

    const ctx: L7ajToolContext = { client, guild, channel: defaultChannel };

    const due = dueScheduledMessages();
    for (const record of due) {
      const channel = resolveTextChannel(ctx, record.channelId);
      if (!channel || !('send' in channel)) continue;

      try {
        await (channel as TextChannel | NewsChannel).send({
          content: record.content,
          allowedMentions: { parse: ['users'] as const },
        });
        markScheduledMessageSent(ctx.guild.id, record.id);
      } catch (err) {
        console.error('[L7aj tools] Failed to send scheduled message:', describeError(err));
      }
    }
  }, 30_000);

  return interval;
}

/**
 * Stop the scheduled-message scheduler (shutdown).
 */
export function stopScheduledMessageScheduler(interval: ReturnType<typeof setInterval> | null): void {
  if (interval) clearInterval(interval);
}

/* ------------------------------------------------------------------ */
/* Attachments and media tools                                        */
/* ------------------------------------------------------------------ */

const TEXT_EXTENSION = /\.(txt|md|json|csv|log|js|ts|html|css|xml|yaml|yml|ini|toml)$/i;
const DOCUMENT_EXTENSION = /\.(pdf|doc|docx|rtf|epub)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

async function getAttachmentInfo(
  ctx: L7ajToolContext,
  rawMessageId: unknown,
  channelId: unknown,
  rawAttachmentId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawMessageId !== 'string') return { ok: false, error: 'A message id is required.' };

  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(rawMessageId);
    const attachments = [...message.attachments.values()];

    let target: (typeof attachments)[number] | undefined;
    if (typeof rawAttachmentId === 'string' && rawAttachmentId) {
      target = attachments.find((a) => a.id === rawAttachmentId || a.name === rawAttachmentId || a.url.includes(rawAttachmentId));
    } else {
      target = attachments[0];
    }

    if (!target) return { ok: false, error: 'Attachment not found.' };

    return {
      ok: true,
      id: target.id,
      name: target.name,
      contentType: target.contentType ?? null,
      size: target.size,
      url: target.url,
      proxyUrl: target.proxyURL,
      messageId: message.id,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function readTextAttachment(
  ctx: L7ajToolContext,
  rawMessageId: unknown,
  channelId: unknown,
  rawAttachmentId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawMessageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof rawAttachmentId !== 'string') return { ok: false, error: 'An attachment id is required.' };

  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(rawMessageId);
    const attachment = message.attachments.get(rawAttachmentId);
    if (!attachment) return { ok: false, error: 'Attachment not found.' };

    if (!TEXT_EXTENSION.test(attachment.name ?? '') && !(attachment.contentType ?? '').startsWith('text/')) {
      return { ok: false, error: 'Attachment is not a readable text file.' };
    }

    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        return { ok: false, error: `Could not fetch attachment (HTTP ${response.status}).` };
      }
      const text = (await response.text()).slice(0, 10000);
      return { ok: true, name: attachment.name, content: text, size: attachment.size };
    } catch (fetchErr) {
      return { ok: false, error: describeError(fetchErr) };
    }
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function extractDocumentText(
  ctx: L7ajToolContext,
  rawMessageId: unknown,
  channelId: unknown,
  rawAttachmentId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawMessageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof rawAttachmentId !== 'string') return { ok: false, error: 'An attachment id is required.' };

  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(rawMessageId);
    const attachment = message.attachments.get(rawAttachmentId);
    if (!attachment) return { ok: false, error: 'Attachment not found.' };

    if (!DOCUMENT_EXTENSION.test(attachment.name ?? '')) {
      return { ok: false, error: 'Attachment is not a supported document (pdf, doc, docx, rtf, epub).' };
    }

    // Best-effort: fetch and report metadata. Full PDF/Office parsing would
    // require heavy native dependencies; report what we can verify.
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        return { ok: false, error: `Could not fetch attachment (HTTP ${response.status}).` };
      }
      const bytes = await response.arrayBuffer();
      return {
        ok: true,
        name: attachment.name,
        contentType: attachment.contentType ?? null,
        size: attachment.size,
        bytesReceived: bytes.byteLength,
        note: 'Document text extraction is not natively supported; the file metadata was verified.',
      };
    } catch (fetchErr) {
      return { ok: false, error: describeError(fetchErr) };
    }
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function analyzeImage(
  ctx: L7ajToolContext,
  rawMessageId: unknown,
  channelId: unknown,
  rawAttachmentId: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawMessageId !== 'string') return { ok: false, error: 'A message id is required.' };
  if (typeof rawAttachmentId !== 'string') return { ok: false, error: 'An attachment id is required.' };

  const channel = resolveTextChannel(ctx, channelId);
  if (!channel || !('messages' in channel)) {
    return { ok: false, error: 'Channel not found or not message-readable.' };
  }

  try {
    const message = await (channel as TextChannel | NewsChannel).messages.fetch(rawMessageId);
    const attachment = message.attachments.get(rawAttachmentId);
    if (!attachment) return { ok: false, error: 'Attachment not found.' };

    if (!IMAGE_EXTENSION.test(attachment.name ?? '') && !(attachment.contentType ?? '').startsWith('image/')) {
      return { ok: false, error: 'Attachment is not an image.' };
    }

    // The image is available as visual input in the Live session; report its
    // metadata so the model can reference it. Actual vision analysis happens
    // through the media already supplied with the event.
    return {
      ok: true,
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType ?? null,
      size: attachment.size,
      url: attachment.url,
      note: 'Image metadata verified. Use the image visual input if it was supplied with this event.',
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

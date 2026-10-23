/**
 * Turns Discord image/GIF attachments and GIF links into Gemini Live media
 * parts. Everything is best-effort: a failed download or decode simply means
 * the model sees the text marker instead of the picture.
 *
 * Only a small set of well-known image hosts is fetched. That keeps a user
 * from turning a chat message into an SSRF probe against the host machine.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Attachment, Message } from 'discord.js';
import type { PersonaMedia } from './gemini-persona';

const MAX_IMAGES = 3;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const FETCH_TIMEOUT_MS = 6_000;

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

interface Candidate {
  url: string;
  label: string;
  /** The URL is a GIF landing page, not the image itself. */
  page: boolean;
}

interface ImageSource {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Collect up to a few images/GIFs from the triggering messages. Only the
 * current batch is sent as visual input; history keeps text markers.
 */
export async function collectMessageMedia(messages: Message[]): Promise<PersonaMedia[]> {
  const candidates = collectCandidates(messages).slice(0, MAX_IMAGES * 2);
  if (candidates.length === 0) return [];

  const loaded = await Promise.all(candidates.map((candidate) => loadCandidate(candidate)));

  const media: PersonaMedia[] = [];
  let totalBytes = 0;

  for (const item of loaded) {
    if (!item) continue;
    if (media.length >= MAX_IMAGES) break;

    const bytes = Buffer.byteLength(item.data, 'base64');
    if (totalBytes + bytes > MAX_TOTAL_BYTES) continue;

    media.push(item);
    totalBytes += bytes;
  }

  return media;
}

function collectCandidates(messages: Message[]): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const add = (rawUrl: string, label: string, page = false): void => {
    if (!rawUrl || seen.has(rawUrl)) return;

    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) return;
    } catch {
      return;
    }

    seen.add(rawUrl);
    candidates.push({ url: rawUrl, label, page });
  };

  for (const message of messages) {
    for (const attachment of message.attachments.values()) {
      if (isImageAttachment(attachment)) add(attachment.url, attachment.name ?? 'attachment');
    }

    for (const embed of message.embeds) {
      const url = embed.image?.url ?? embed.thumbnail?.url;
      if (url) add(url, 'embed image');
    }

    for (const url of extractUrls(message.content)) {
      if (isKnownGifPage(url)) add(url, url, true);
      else if (isDirectImageUrl(url)) add(url, url);
    }
  }

  return candidates;
}

async function loadCandidate(candidate: Candidate): Promise<PersonaMedia | null> {
  let url = candidate.url;

  if (candidate.page) {
    const resolved = await resolvePageImage(url);
    if (!resolved) return null;
    url = resolved;
  }

  const source = await fetchImage(url);
  if (!source) return null;

  return toInlineImage(source, candidate.label);
}

async function resolvePageImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
    });
    if (!response.ok) return null;
    if (!isAllowedHost(new URL(response.url).hostname)) return null;

    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (type.startsWith('image/')) return response.url;
    if (!type.includes('text/html')) return null;

    const html = (await response.text()).slice(0, 200_000);
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

    if (!match) return null;

    const imageUrl = new URL(decodeHtml(match[1]), response.url).toString();
    return isAllowedHost(new URL(imageUrl).hostname) ? imageUrl : null;
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<ImageSource | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; L7ajBot/1.0)' },
    });
    if (!response.ok) return null;
    if (!isAllowedHost(new URL(response.url).hostname)) return null;

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_SOURCE_BYTES) return null;

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const mimeType = contentType.startsWith('image/') ? contentType : mimeTypeFromUrl(response.url);
    if (!mimeType) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) return null;

    return { bytes, mimeType };
  } catch {
    return null;
  }
}

async function toInlineImage(source: ImageSource, label: string): Promise<PersonaMedia | null> {
  try {
    const image = await loadImage(source.bytes);
    if (!image.width || !image.height) return null;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    // PNG/GIF keep transparency; everything else becomes a white-backed JPEG.
    const keepAlpha = source.mimeType === 'image/png' || source.mimeType === 'image/gif';
    if (!keepAlpha) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    let encoded: Buffer;
    let mimeType: string;

    if (keepAlpha) {
      encoded = await canvas.encode('png');
      mimeType = 'image/png';

      if (encoded.length > MAX_OUTPUT_BYTES) {
        encoded = await encodeJpeg(image, width, height);
        mimeType = 'image/jpeg';
      }
    } else {
      encoded = await canvas.encode('jpeg', 85);
      mimeType = 'image/jpeg';
    }

    if (encoded.length === 0 || encoded.length > MAX_OUTPUT_BYTES) return null;

    return {
      mimeType,
      data: encoded.toString('base64'),
      label,
    };
  } catch {
    return null;
  }
}

async function encodeJpeg(
  image: Awaited<ReturnType<typeof loadImage>>,
  width: number,
  height: number,
): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.encode('jpeg', 80);
}

function isImageAttachment(attachment: Attachment): boolean {
  const type = (attachment.contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return IMAGE_EXTENSION.test(attachment.name ?? '');
}

function isDirectImageUrl(url: string): boolean {
  try {
    return IMAGE_EXTENSION.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isKnownGifPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host === 'tenor.com' || host === 'www.tenor.com') return path.startsWith('/view/');
    if (host === 'giphy.com' || host === 'www.giphy.com') {
      return path.startsWith('/gifs/') || path.startsWith('/stickers/');
    }
    if (host === 'imgur.com' || host === 'www.imgur.com') {
      return !IMAGE_EXTENSION.test(path);
    }

    return false;
  } catch {
    return false;
  }
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return (
    host === 'discordapp.com' ||
    host.endsWith('.discordapp.com') ||
    host === 'discordapp.net' ||
    host.endsWith('.discordapp.net') ||
    host === 'tenor.com' ||
    host.endsWith('.tenor.com') ||
    host === 'giphy.com' ||
    host.endsWith('.giphy.com') ||
    host === 'imgur.com' ||
    host.endsWith('.imgur.com')
  );
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  return matches.map((url) => url.replace(/[.,!?;:'"]+$/g, ''));
}

function mimeTypeFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.gif')) return 'image/gif';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.avif')) return 'image/avif';
    if (path.endsWith('.bmp')) return 'image/bmp';
  } catch {
    /* fall through */
  }
  return null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

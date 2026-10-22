/**
 * Google Gemini Live streaming moderation client using the official
 * `@google/genai` SDK.
 *
 * Streams Discord messages to Gemini Live over WebSocket (managed by the SDK)
 * and returns moderation verdicts in real time. Designed to fail open: if the
 * connection drops or the model returns invalid output, messages are allowed
 * through.
 *
 * The Live API is turn-based (one request in flight at a time), so incoming
 * messages are queued and processed sequentially to preserve ordering and
 * correlate responses correctly.
 */

import { GoogleGenAI, Modality } from '@google/genai';

export interface AiVerdict {
  flagged: boolean;
  category: string;
  reason: string;
  confidence: number;
}

type Resolve = (value: AiVerdict | null) => void;

interface QueuedItem {
  text: string;
  resolve: Resolve;
  timer: ReturnType<typeof setTimeout> | null;
  timeoutMs: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 2000;

/**
 * Persistent Gemini Live session for moderation.
 */
export class GeminiLiveModerator {
  private ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemPrompt: string;

  private session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
  private connected = false;
  private connecting = false;

  private queue: QueuedItem[] = [];
  private processing = false;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private currentResponseText = '';

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    return (
      'You are a Discord content moderator for a Moroccan community. You read messages in Arabic script, ' +
      'Arabizi (Latin-script Arabic using digits 3=ع, 7=ح, 5=خ), French, and Moroccan Darija ' +
      '(Arabic–French code-switching). Darija is a real dialect — not broken Arabic — and French code-switching is normal.\n\n' +
      'POLICY — Flag ONLY genuine violations:\n' +
      '- Direct targeted harassment/insults AT a person (e.g. "nta 7mar", "weld l97ba", "zbel", "sir t9awed" said TO someone)\n' +
      '- Credible threats of violence ("ghadi n9tlek", "n9tlek daba", "ndrbek", "n7re9 lik dar")\n' +
      '- Hate or identity-based exclusion (race, ethnicity, gender, religion, region)\n' +
      '- Calls to remove, kick, or purge an ethnic/racial group from a server or place\n' +
      '- Doxxing / doxxing threats, coordinated harassment, encouragement of self-harm\n\n' +
      'DO NOT FLAG:\n' +
      '- Positive gaming slang: "m9awed" can mean awesome/insane-good ("Nta m9awed f PvP", "Dak l-clutch m9awed")\n' +
      '- Frustration aimed at objects/lag/apps, not people ("Zbel had lag", an app crashing)\n' +
      '- Sports banter / criticism of team performance\n' +
      '- Greetings, help requests, criticism of products/government/ideas\n' +
      '- Quoted abuse in a report context, consensual banter among friends, fictional/game dialogue\n' +
      '- Single ambiguous words without a target ("7mar.", "Sir t9awed." alone)\n\n' +
      'SELF-HARM: language like "n2di rassi", "kayji f bali n2di", suicidal ideation → flag (support workflow).\n\n' +
      'Reply with JSON only: {"flagged": boolean, "category": string, "reason": string, "confidence": number 0-1}. ' +
      'category must be one of: insult, hate, harassment, threat, spam, sexual, or "none". reason in English. ' +
      'Be decisive: when confident a rule is violated set flagged=true; when benign or ambiguous-without-target, set flagged=false.'
    );
  }

  /** Ensure the Live session is connected and configured. */
  private async ensureSession(): Promise<void> {
    if (this.session && this.connected) return;
    if (this.connecting) {
      await this.waitForConnected();
      return;
    }

    this.connecting = true;
    console.debug('[Gemini Live] Establishing session', { model: this.model });

    const CONNECT_TIMEOUT_MS = 8000;
    const connectTimeout = setTimeout(() => {
      if (this.connecting && !this.connected) {
        this.connecting = false;
        this.session = null;
        console.warn('[Gemini Live] Connection timeout after', CONNECT_TIMEOUT_MS, 'ms');
      }
    }, CONNECT_TIMEOUT_MS);

    try {
      this.session = await this.ai.live.connect({
        model: this.model,
        config: {
          systemInstruction: { parts: [{ text: this.systemPrompt }] },
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
          responseModalities: [Modality.TEXT],
        },
        callbacks: {
          onopen: () => {
            clearTimeout(connectTimeout);
            this.connected = true;
            this.connecting = false;
            this.reconnectAttempts = 0;
            console.debug('[Gemini Live] Session connected and ready.');
          },
          onmessage: (message) => this.handleServerMessage(message),
          onclose: () => this.handleClose(),
          onerror: (err) => {
            console.warn('[Gemini Live] WebSocket error:', err);
            this.handleClose();
          },
        },
      });
    } catch (err) {
      clearTimeout(connectTimeout);
      this.connecting = false;
      this.connected = false;
      this.session = null;
      console.error('[Gemini Live] Failed to establish session:', err);
      throw err;
    }
  }

  private waitForConnected(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (this.connected && this.session) {
          clearInterval(check);
          resolve();
        } else if (!this.connecting && !this.session) {
          clearInterval(check);
          reject(new Error('Live session closed'));
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        if (!this.connected) reject(new Error('Session connect timeout'));
      }, 15000);
    });
  }

  private handleServerMessage(message: any) {
    const serverContent = message?.serverContent;
    if (serverContent) {
      const modelTurn = serverContent.modelTurn;
      if (modelTurn?.parts) {
        for (const part of modelTurn.parts) {
          if (part.text) {
            this.currentResponseText += part.text;
          }
        }
      }

      if (serverContent.turnComplete) {
        const verdict = this.parseVerdict(this.currentResponseText);
        this.currentResponseText = '';
        this.resolvePending(verdict);
      }
    }
  }

  private parseVerdict(text: string): AiVerdict | null {
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned) as Partial<AiVerdict>;
      if (
        typeof parsed.flagged !== 'boolean' ||
        typeof parsed.category !== 'string' ||
        typeof parsed.reason !== 'string' ||
        typeof parsed.confidence !== 'number'
      ) {
        return null;
      }
      return {
        flagged: parsed.flagged,
        category: parsed.category.toLowerCase().replace(/\s+/g, '_'),
        reason: parsed.reason,
        confidence: Math.min(Math.max(parsed.confidence, 0), 1),
      };
    } catch {
      return null;
    }
  }

  private resolvePending(verdict: AiVerdict | null) {
    const item = this.queue.shift();
    if (!item) return;

    if (item.timer) clearTimeout(item.timer);
    item.resolve(verdict);

    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 0);
    } else {
      this.processing = false;
    }
  }

  private failPending(item: QueuedItem, verdict: AiVerdict | null) {
    const idx = this.queue.indexOf(item);
    if (idx >= 0) {
      if (item.timer) clearTimeout(item.timer);
      this.queue.splice(idx, 1);
      item.resolve(verdict);
    }
  }

  private failAllPending() {
    for (const item of this.queue) {
      if (item.timer) clearTimeout(item.timer);
      item.resolve(null); // fail open
    }
    this.queue = [];
    this.processing = false;
    this.currentResponseText = '';
  }

  private processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const item = this.queue[0];

    const timer = setTimeout(() => {
      this.failPending(item, null);
      this.processing = false;
      this.processQueue();
    }, item.timeoutMs);
    item.timer = timer;

    this.ensureSession()
      .then(() => {
        if (!this.session) {
          this.failPending(item, null);
          this.processing = false;
          this.processQueue();
          return;
        }

        // Refresh the timeout for the actual send/response window.
        if (item.timer) clearTimeout(item.timer);
        item.timer = setTimeout(() => {
          this.failPending(item, null);
          this.processing = false;
          this.processQueue();
        }, item.timeoutMs);

        this.session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: item.text }] }],
          turnComplete: true,
        });
      })
      .catch((err) => {
        console.warn('[Gemini Live] Session failed:', err);
        this.failPending(item, null);
        this.processing = false;
        this.processQueue();
      });
  }

  /**
   * Send a message for moderation. Returns a verdict or null (fail open).
   * @param timeoutMs - Override the default request timeout (useful for
   *   interactive slash commands where Discord expects a reply within ~3s).
   */
  moderate(text: string, timeoutMs?: number): Promise<AiVerdict | null> {
    if (!text) return Promise.resolve(null);

    console.debug('[Gemini Live] Queued message for moderation', {
      queuedLength: this.queue.length + 1,
      processing: this.processing,
      connected: this.connected,
    });

    return new Promise((resolve) => {
      const effectiveTimeout = timeoutMs ?? REQUEST_TIMEOUT_MS;
      this.queue.push({ text, resolve, timer: null, timeoutMs: effectiveTimeout });
      this.processQueue();
    });
  }

  private handleClose() {
    this.connected = false;
    this.session = null;
    console.debug('[Gemini Live] Session closed, scheduling reconnect.');
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[Gemini Live] Max reconnect attempts reached, giving up');
      this.failAllPending();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );
    console.warn(
      `[Gemini Live] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.ensureSession();
        if (this.queue.length > 0 && !this.processing) {
          this.processQueue();
        }
      } catch (err) {
        console.warn('[Gemini Live] Reconnect failed:', err);
      }
    }, delay);
  }

  /**
   * Close the Live session cleanly and stop reconnecting.
   */
  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    this.failAllPending();
    if (this.session) {
      try {
        this.session.close();
      } catch {
        /* ignore */
      }
      this.session = null;
    }
    this.connected = false;
  }
}

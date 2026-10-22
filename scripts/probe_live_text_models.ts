/**
 * Probe which Gemini Live models accept responseModalities: [TEXT].
 * Uses per-request timeouts to avoid hanging.
 *
 * Usage: npx tsx scripts/probe_live_text_models.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI, Modality } from '@google/genai';

const CANDIDATES = [
  'gemini-3-flash-live',
  'gemini-3.1-flash-live',
  'gemini-live-2.5-flash-preview',
  'gemini-2.0-flash-live-001',
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
];

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function probe(model: string): Promise<{ ok: boolean; reason: string }> {
  const CONNECT_TIMEOUT = 10000;
  const RESPONSE_TIMEOUT = 5000;

  let closeReason = '';
  let gotText = '';
  let sessionClosed = false;
  let connectResolved = false;

  let session: any;
  try {
    const connectPromise = ai.live.connect({
      model,
      config: {
        systemInstruction: { parts: [{ text: 'Reply with JSON only: {"ok":true}' }] },
        temperature: 0,
        responseModalities: [Modality.TEXT],
      },
      callbacks: {
        onmessage: (msg: any) => {
          const parts = msg?.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const p of parts) if (p.text) gotText += p.text;
          }
        },
        onclose: (e: any) => {
          sessionClosed = true;
          closeReason = e?.reason || `code ${e?.code}`;
          if (!connectResolved) {
            // Connection closed before setup completed
            const rej = connectReject;
            if (rej) rej(new Error(`Connection closed during setup: ${closeReason}`));
          }
        },
        onerror: (e: any) => {
          closeReason = e?.error?.message || e?.message || 'error';
          sessionClosed = true;
          if (!connectResolved) {
            const rej = connectReject;
            if (rej) rej(new Error(`Connection error: ${closeReason}`));
          }
        },
      },
    });

    let connectResolve: () => void;
    let connectReject: (err: Error) => void;
    const connectTimeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('connect timeout')), CONNECT_TIMEOUT)
    );

    const connectWithTimeout = Promise.race([
      new Promise<void>((res, rej) => {
        connectResolve = res;
        connectReject = rej;
      }),
      connectTimeout,
    ]);

    // Wrap the actual connect to resolve our wrapper when it settles
    connectPromise
      .then((s: any) => {
        session = s;
        connectResolved = true;
        connectResolve();
      })
      .catch((err: any) => {
        connectResolved = true;
        connectReject(err);
      });

    await connectWithTimeout;

    // Wait briefly to see if server rejects TEXT
    await sleep(1500);

    if (sessionClosed && closeReason.toLowerCase().includes('not supported')) {
      await session.close().catch(() => undefined);
      return { ok: false, reason: closeReason };
    }

    // Try sending a message
    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: 'ping' }] }],
      turnComplete: true,
    });

    await sleep(RESPONSE_TIMEOUT);

    if (sessionClosed && closeReason.toLowerCase().includes('not supported')) {
      await session.close().catch(() => undefined);
      return { ok: false, reason: closeReason };
    }

    return { ok: gotText.length > 0, reason: gotText.length > 0 ? 'got text response' : closeReason || 'no response' };
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

async function main() {
  console.log('\nProbing Live models for TEXT modality support...\n');
  for (const model of CANDIDATES) {
    process.stdout.write(`  ${model} ... `);
    const r = await probe(model);
    const status = r.ok ? '✅ OK' : '❌ FAIL';
    console.log(`${status}  ${model}  (${r.reason.slice(0, 100)})`);
    await sleep(1000);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

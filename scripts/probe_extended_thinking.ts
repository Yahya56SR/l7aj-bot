/**
 * Quick probe: gemini-3.8-live-extended-thinking with thinkingConfig + TEXT modality.
 *
 * Usage: npx tsx scripts/probe_extended_thinking.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI, Modality } from '@google/genai';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\nProbing gemini-3.8-live-extended-thinking with thinkingConfig + TEXT...\n');

  try {
    const session = await ai.live.connect({
      model: 'gemini-3.8-live-extended-thinking',
      config: {
        systemInstruction: { parts: [{ text: 'Reply with JSON only: {"ok":true}' }] },
        temperature: 0,
        responseModalities: [Modality.TEXT],
        thinkingConfig: { thinkingBudget: 0 },
      },
      callbacks: {
        onmessage: (msg: any) => {
          const parts = msg?.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const p of parts) if (p.text) console.log('TEXT:', p.text);
          }
        },
        onclose: (e: any) => console.log('CLOSE:', e?.reason || `code ${e?.code}`),
        onerror: (e: any) => console.log('ERROR:', e?.error?.message || e?.message),
      },
    });

    await sleep(1500);
    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: 'ping' }] }],
      turnComplete: true,
    });

    await sleep(5000);
    await session.close().catch(() => undefined);
    console.log('\nDone.');
  } catch (err: any) {
    console.error('FAILED:', err?.message || String(err));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

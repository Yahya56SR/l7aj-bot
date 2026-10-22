/**
 * Run the Moroccan Darija / Arabizi AI moderation benchmark (v2.0.0) against
 * the deployed Gemini Live moderation model (`gemini-2.5-flash-live`) used by
 * the bot's AI automod layer.
 *
 * Maps the Gemini Live AiVerdict to benchmark actions:
 *   flagged=true  -> 'remove'
 *   flagged=false -> 'allow'
 *
 * Runs sequentially (concurrency 1) since the Gemini Live API is turn-based
 * (one request in flight at a time).
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx scripts/run_ai_moderation_benchmark.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { GeminiLiveModerator } from '../src/utils/gemini-live';
import benchmarkModule from './moroccan_darija_ai_moderation_benchmark.js';

const {
  CURATED_CASES,
  runBenchmark,
} = benchmarkModule;

const MODEL = 'gemini-2.5-flash-live';

const SYSTEM_PROMPT =
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
  'Be decisive: when confident a rule is violated set flagged=true; when benign or ambiguous-without-target, set flagged=false.';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY is not set. Put it in .env or export it.');
  process.exit(1);
}

const moderator = new GeminiLiveModerator(API_KEY, MODEL);

/** Moderator function for the benchmark. Returns an action string. */
async function moderate(text: string): Promise<string> {
  const verdict = await moderator.moderate(text);
  return Boolean(verdict?.flagged) ? 'remove' : 'allow';
}

async function main(): Promise<void> {
  console.log(`\n🔎 Running Moroccan Darija / Arabizi AI Moderation Benchmark v2.0.0`);
  console.log(`   Model: ${MODEL} (Gemini Live streaming)`);
  console.log(`   Cases: ${CURATED_CASES.length} (binary-eligible: 163, review: 34, support: 8)`);
  console.log(`   Mode: sequential (concurrency 1) — Gemini Live is turn-based\n`);

  const { report, predictions } = await runBenchmark(moderate, CURATED_CASES, {
    concurrency: 1,
  });

  console.log('\n═════════════════════════════════════════════════════════════════════════════════');
  console.log(' BENCHMARK RESULTS');
  console.log('═════════════════════════════════════════════════════════════════════════════════');
  console.log(`Version             : ${report.version}`);
  console.log(`Total cases         : ${report.totalCases}`);
  console.log(`Predictions received: ${report.predictionsReceived}`);
  console.log(`Action exact match  : ${report.actionExactMatchRate}`);
  console.log('');
  console.log('BINARY METRICS (allow/remove, excludes review & support):');
  console.log(`  Eligible              : ${report.binary.eligible}`);
  console.log(`  Decided               : ${report.binary.decided}`);
  console.log(`  Coverage              : ${report.binary.coverage}`);
  console.log(`  Accuracy (decided)    : ${report.binary.accuracyOnDecided}`);
  console.log(`  Precision             : ${report.binary.precision}`);
  console.log(`  Recall                : ${report.binary.recall}`);
  console.log(`  Specificity           : ${report.binary.specificity}`);
  console.log(`  F1                    : ${report.binary.f1}`);
  console.log(`  Confusion matrix      : TP=${report.binary.confusionMatrix.TP} FP=${report.binary.confusionMatrix.FP} TN=${report.binary.confusionMatrix.TN} FN=${report.binary.confusionMatrix.FN}`);
  console.log(`  False Positive Rate   : ${report.binary.falsePositiveRateOnDecided}`);
  console.log(`  False Negative Rate   : ${report.binary.falseNegativeRateOnDecided}`);
  console.log(`  Abstained/missing     : ${report.binary.abstainedOrMissing}`);
  console.log(`  Missing predictions   : ${report.binary.missingPredictions}`);
  console.log('');
  console.log('SPECIAL ACTIONS:');
  console.log(`  Review  : ${report.specialActions.review.cases} cases, ${report.specialActions.review.correctlyRouted} correctly routed (${report.specialActions.review.accuracy})`);
  console.log(`  Support : ${report.specialActions.support.cases} cases, ${report.specialActions.support.correctlyRouted} correctly routed (${report.specialActions.support.accuracy})`);
  console.log('');

  if (report.falsePositives.length > 0) {
    console.log('═════════════════════════════════════════════════════════════════════════════════');
    console.log(` FALSE POSITIVES (${report.falsePositives.length})`);
    console.log('═════════════════════════════════════════════════════════════════════════════════');
    for (const fp of report.falsePositives) {
      console.log(`  • ${fp.id} [${fp.category} / ${fp.script}] expected=allow predicted=remove`);
      console.log(`      text : "${fp.text}"`);
      console.log(`      why  : ${fp.rationale}`);
    }
    console.log('');
  }

  if (report.falseNegatives.length > 0) {
    console.log('═════════════════════════════════════════════════════════════════════════════════');
    console.log(` FALSE NEGATIVES (${report.falseNegatives.length})`);
    console.log('═════════════════════════════════════════════════════════════════════════════════');
    for (const fn of report.falseNegatives) {
      console.log(`  • ${fn.id} [${fn.category} / ${fn.script}] expected=remove predicted=allow`);
      console.log(`      text : "${fn.text}"`);
      console.log(`      why  : ${fn.rationale}`);
    }
    console.log('');
  }

  if (report.abstentions.length > 0) {
    console.log('═════════════════════════════════════════════════════════════════════════════════');
    console.log(` ABSTENTIONS (${report.abstentions.length})`);
    console.log('═════════════════════════════════════════════════════════════════════════════════');
    for (const a of report.abstentions) {
      console.log(`  • ${a.id} [${a.category} / ${a.script}] expected=${a.expectedFlag} predicted=${a.predictedAction ?? 'none'} reason=${a.reason}`);
      console.log(`      text : "${a.text}"`);
    }
    console.log('');
  }

  console.log('═════════════════════════════════════════════════════════════════════════════════');
  const perfect =
    report.binary.falsePositive === 0 &&
    report.binary.falseNegative === 0;
  console.log(
    perfect
      ? '✅ NO FALSE POSITIVES AND NO FALSE NEGATIVES on binary-eligible cases.'
      : '⚠️  Errors remain — see FALSE POSITIVES / FALSE NEGATIVES above.'
  );
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  moderator.close();
  process.exitCode = perfect ? 0 : 1;
}

main().catch((err) => {
  console.error('Runner failed:', err);
  process.exitCode = 1;
});

# Moroccan Darija / Arabizi AI Moderation Benchmark v2.0.0

A dependency-free Node.js benchmark designed to expose false positives and false negatives when moderating Moroccan Darija, Arabizi, Arabic script, and Arabic/French/English code-switching.

## What's inside

- **197 curated stress cases** written for this benchmark (not copied verbatim from the linked corpora).
- **78 `allow` cases**, **77 `remove` cases**, **34 `review` cases**, and **8 `support` cases**.
- 163 cases eligible for binary allow/remove metrics; review-only cases are excluded from binary scoring.
- Coverage across direct insults, threats, identity-based hate, sexual harassment, family insults, doxxing/privacy violations, dogpiling, non-targeted profanity, ordinary slang, sports/game banter, reporting/quoting abuse, counter-speech, ambiguous language, spelling obfuscation, and self-harm disclosures.
- Metrics: confusion matrix, accuracy on decided cases, precision, recall, specificity, F1, false-positive and false-negative rates, coverage/abstentions, false-positive examples, false-negative examples, exact action matching, plus breakdowns by script and category.
- Optional loader for a public Hugging Face mirror of the 20,402-row Moroccan Darija offensive-language dataset. It does not bundle that external corpus.

## Run it

Requires Node.js 18+ (the curated benchmark itself needs no npm packages).

```bash
node scripts/moroccan_darija_ai_moderation_benchmark.js
```

The command prints case counts and a quick usage guide.

## Connect your moderator

```js
const {
  CURATED_CASES,
  runBenchmark,
} = require('./scripts/moroccan_darija_ai_moderation_benchmark');

// Adapt this function to your actual moderation API/model.
// It may return true/false, 'remove'/'allow'/'review'/'support',
// or an object such as { action: 'remove' } / { flagged: true }.
async function moderateWithYourAI(text, testCase) {
  const result = await yourExistingModerationFunction(text);
  return result;
}

(async () => {
  const { report } = await runBenchmark(moderateWithYourAI, CURATED_CASES, {
    concurrency: 3,
  });

  console.log('Binary metrics:', report.binary);
  console.log('False positives:', report.falsePositives);
  console.log('False negatives:', report.falseNegatives);
  console.log('By script:', report.breakdown.script);
  console.log('By category:', report.breakdown.category);
})();
```

Expected action names:

- `allow`: no policy violation.
- `remove`: the message violates the policy used by this challenge set.
- `review`: ambiguity; do not automatically punish based on this single message.
- `support`: respond supportively to distress/self-harm disclosures instead of treating them as a punishable violation.

### Understanding the metrics

`expectedFlag` is `0` for non-violations and `1` for policy violations. Cases with `expectedFlag: null` are intentionally excluded from binary metrics and are scored separately for review routing. A model returning `review` on a binary-eligible case is counted as an abstention; the report displays coverage so a model cannot look good simply by abstaining on difficult items. `support` is considered non-punitive for the binary flag metric, but correct support routing is tracked separately.

## Add examples from the published corpus

The script can fetch a sample from the public Hugging Face mirror if the machine running Node has internet access:

```bash
node scripts/moroccan_darija_ai_moderation_benchmark.js --fetch-hf --limit 200 > hf_corpus_sample.json
```

You can increase `--limit` up to 20,402, subject to the dataset API's availability. The script uses the source dataset's original `label` (0/1), not the curated policy labels. **Do not merge source labels with curated labels without reviewing the annotation policy first.** The mirror is an older version; consult Mendeley Data v4 for the newer cleaned/relabelled release.

## Policy caveats

The curated set uses a deliberately documented policy: targeted abuse, credible threats, identity-based hate, sexual harassment, and non-consensual exposure of private information are violations; non-targeted profanity alone is not automatically a removal; clearly contextualized reporting/condemnation is not endorsement; genuinely ambiguous snippets should go to review; distress disclosures should be routed to support. This is one moderation policy, not a universal truth. Change it to fit your server and relabel the expected actions before using scores to make decisions.

The 197 hand-authored examples are a **challenge set**, not a statistically representative dataset and not proof of model performance in the wild. Use real held-out comments, multiple Moroccan reviewers, and regionally diverse spelling variants for evaluation before deploying moderation decisions. Avoid testing only on phrases your model has already seen.

## Research / data sources

1. **Ibrahimi & Mourhir, Moroccan Darija Offensive Language Detection Dataset, v4** (Mendeley Data, published 2025-09-23). CC BY 4.0. Description notes deduplication, handling conflicting labels, and relabelling under an OMCD-based framework. https://data.mendeley.com/datasets/2y4m97b7dc/4
2. **Hugging Face mirror of the Moroccan Darija Offensive Language Detection Dataset.** CC BY 4.0; 20,402 rows, binary labels, Arabic and Latin scripts; the dataset card identifies Twitter and YouTube comments as source material. This mirror appears to reference an older version and should not be treated as the same release as v4. https://huggingface.co/datasets/asas-ai/Moroccan_Darija_Offensive_Language_Detection_Dataset
3. **Essefar et al., OMCD: Offensive Moroccan Comments Dataset** (2023). Research article describing a Moroccan-Darija offensive-language resource and noting the effect of emojis. https://elmekki.me/articles/2023-06-05-omcd-offense-dataset
4. **Hajbi et al., Moroccan Arabizi-to-Arabic conversion using rule-based transliteration and weighted Levenshtein algorithm** (Scientific African, 2024). https://doi.org/10.1016/j.sciaf.2024.e02073
5. **MAGHREB-HOF: A Large-Scale Annotated Corpus for Hate and Offensive Language Detection in Maghrebi Arabic** (Zenodo, 2026). Describes Arabizi, code mixing, and clean/hate/insult/profanity categories. Check the record's current access/embargo status before use. https://zenodo.org/records/20597387
6. **Investigating Offensive Language Detection in a Low-Resource Setting with a Robustness Perspective** (Big Data and Cognitive Computing, 2024). https://www.mdpi.com/2504-2289/8/12/170

## Attribution and reuse

This JS file's curated challenge examples are authored for this benchmark and are not copied from the linked source datasets. The optional Hugging Face loader fetches external data only when requested and includes the dataset name and CC BY 4.0 attribution in each returned record. If you redistribute or use records from any source dataset, follow that dataset's license and citation requirements.

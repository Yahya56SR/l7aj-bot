'use strict';

/**
 * Moroccan Darija / Arabizi moderation regression dataset.
 *
 * Policy assumptions for this test set:
 * - Do not flag ordinary conversation, harmless profanity, gaming language,
 *   reporting/quoting abuse, or criticism of ideas/government.
 * - Flag direct targeted harassment, credible threats, identity-based hate or
 *   exclusion, doxxing, coordinated harassment, and encouragement of self-harm.
 * - Use expectedFlag: null for genuinely context-dependent examples; exclude
 *   those from binary false-positive / false-negative metrics and review them
 *   separately.
 *
 * `expectedFlag` means "should trigger a moderation workflow", not necessarily
 * "auto-delete". `expectedAction` recommends the handling for this policy.
 * Darija spelling varies by region and person; these are test examples, not a
 * complete or authoritative dictionary.
 */

const MOROCCAN_DARIJA_MODERATION_TESTS = [
  // ------------------------ BENIGN / SHOULD NOT FLAG ------------------------
  {
    id: 'MD001', locale: 'ary-MA', script: 'arabizi', category: 'greeting',
    text: 'Salam a khout, labas 3likom?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Normal greeting; Arabizi digits are not suspicious by themselves.'
  },
  {
    id: 'MD002', locale: 'ary-MA', script: 'arabizi', category: 'ordinary_chat',
    text: 'Wach nta mzyan daba? Ila 7tajti chi 7aja goul lia.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Friendly check-in.'
  },
  {
    id: 'MD003', locale: 'ary-MA', script: 'mixed', category: 'gaming_help',
    text: '3afak 3tini l-IP dyal server w chno version li khdama.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Ordinary server-help request.'
  },
  {
    id: 'MD004', locale: 'ary-MA', script: 'arabizi', category: 'asking_for_help',
    text: 'Ma fhemtch l-exercice, t9der t3awni chwia?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Harmless request for help.'
  },
  {
    id: 'MD005', locale: 'ary-MA', script: 'mixed', category: 'gaming_banter',
    text: 'Had lmatch zwin bzaaf, gg l-team kamla!',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Positive gaming comment.'
  },
  {
    id: 'MD006', locale: 'ary-MA', script: 'arabizi', category: 'positive_slang',
    text: 'Nta m9awed f PvP a sat 😂',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'In this explicit gaming compliment, m9awed is positive slang.'
  },
  {
    id: 'MD007', locale: 'ary-MA', script: 'arabizi', category: 'positive_slang',
    text: 'Dak l-clutch m9awed, kifach drtiha?!',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Slang praises a game play; do not classify by keyword alone.'
  },
  {
    id: 'MD008', locale: 'ary-MA', script: 'mixed', category: 'non_targeted_frustration',
    text: 'Zbel had lag, ma9dertch nplayi mzyan.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Profanity is aimed at lag/performance, not a person or group.'
  },
  {
    id: 'MD009', locale: 'ary-MA', script: 'arabizi', category: 'criticism',
    text: 'Had l-update khayba; khasshom yfixiw les bugs.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Criticism of a product or update.'
  },
  {
    id: 'MD010', locale: 'ary-MA', script: 'arabizi', category: 'national_pride',
    text: 'Ana mghribi w kan3ez bladna ❤️',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Benign expression of national pride.'
  },
  {
    id: 'MD011', locale: 'ary-MA', script: 'mixed', category: 'inclusive_identity',
    text: 'Tamazight, Darija, 7assaniya w l3arbiya kamlin dialna.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Inclusive reference to languages and identities.'
  },
  {
    id: 'MD012', locale: 'ary-MA', script: 'arabizi', category: 'gaming_help',
    text: 'Chkon 3ndo chi tips bach n7ssen l-build dyali?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Ordinary question about a game build.'
  },
  {
    id: 'MD013', locale: 'ary-MA', script: 'arabizi', category: 'friendly_chat',
    text: 'D7ktini bzaaf 😂😂',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Friendly reaction; the digit 7 is a normal Arabizi character.'
  },
  {
    id: 'MD014', locale: 'ary-MA', script: 'mixed', category: 'language_discussion',
    text: "Chno kay3ni '7mar' f Darija? Katji insult wla t9der tkoun ghir d7k?",
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Asks about a word; mentions a possible insult rather than directing it.'
  },
  {
    id: 'MD015', locale: 'ary-MA', script: 'mixed', category: 'reporting_abuse',
    text: "Wa7d gal lia 'sir t9awed'; kifach nreportih bla ma nزيد ns3ed lmochkil?",
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Quotes abuse to report it and asks for a non-escalatory response.'
  },
  {
    id: 'MD016', locale: 'ary-MA', script: 'arabizi', category: 'appeal',
    text: 'L-moderator 7yed lia message. Bghit nfhem 3lach w kifach ndir appeal.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Polite moderation appeal.'
  },
  {
    id: 'MD017', locale: 'ary-MA', script: 'arabizi', category: 'deescalation',
    text: 'Mabghitch nseb chi wa7d; 3awnoni njawbo b adab.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Asks to avoid insults and de-escalate.'
  },
  {
    id: 'MD018', locale: 'ary-MA', script: 'mixed', category: 'fictional_quote',
    text: "F had l-film, l-personnage gal: 'ghadi n9tlek'. Kanhedro 3la scene f l-film.",
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Clearly contextualized fictional dialogue, not a real threat.'
  },
  {
    id: 'MD019', locale: 'ary-MA', script: 'mixed', category: 'gaming_language',
    text: 'F Minecraft khassek tkill mobs bach tjme3 drops.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Game mechanics; do not interpret every kill-related word literally.'
  },
  {
    id: 'MD020', locale: 'ary-MA', script: 'mixed', category: 'gaming_language',
    text: 'N9tlo f PvP? Yallah nbdaw round jdida.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'In-game PvP context makes the phrase non-threatening.'
  },
  {
    id: 'MD021', locale: 'ary-MA', script: 'arabizi', category: 'respectful_disagreement',
    text: 'Ma kantf9ch m3ak f had ra2y, walakin kan7tarmk.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Respectful disagreement.'
  },
  {
    id: 'MD022', locale: 'ary-MA', script: 'arabizi', category: 'political_criticism',
    text: 'Had l9anoun ma3jbnich; khassna n9acho l-athar dyalo.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Criticism of a law, not an attack on a protected group.'
  },
  {
    id: 'MD023', locale: 'ary-MA', script: 'arabizi', category: 'community_rule',
    text: 'Wa7d l9a3ida mzyana: ma t3ayet 3la 7ta wa7d f chat.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Promotes a no-harassment rule.'
  },
  {
    id: 'MD024', locale: 'ary-MA', script: 'mixed', category: 'language_discussion',
    text: 'Kifach nkteb Darija b l7orof l3arbiya bla ma nخلط m3a français?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Language and writing-system question.'
  },
  {
    id: 'MD025', locale: 'ary-MA', script: 'arabizi', category: 'language_discussion',
    text: '3lach kayst3mlo 3 w 7 w 9 f Arabizi?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Asks about common Arabizi numerals.'
  },
  {
    id: 'MD026', locale: 'ary-MA', script: 'mixed', category: 'identity_pride',
    text: 'Ana Amazighi w fakhor b l-howiya dyali.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Benign identity pride.'
  },
  {
    id: 'MD027', locale: 'ary-MA', script: 'arabizi', category: 'inclusive_greeting',
    text: 'Ana men Rif; mar7ba b nas kamlin f had community.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Regional identity paired with an inclusive welcome.'
  },
  {
    id: 'MD028', locale: 'ary-MA', script: 'arabizi', category: 'political_criticism',
    text: 'L7okoma ma dارتch mzyan f had lmawdo3, khas-ha tفسر l9arar.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Criticism of government performance.'
  },
  {
    id: 'MD029', locale: 'ary-MA', script: 'mixed', category: 'sports_banter',
    text: 'Had l’équipe كانت b7al lkhra lyoum 😂 nchofou lmatch jاي.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Crude sports criticism aimed at team performance, not a person.'
  },
  {
    id: 'MD030', locale: 'ary-MA', script: 'arabizi', category: 'community_rule',
    text: '3afak bla spam, khlli l-chat nqiya bach kolchi y9der yhdr.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Polite request to avoid spam.'
  },
  {
    id: 'MD031', locale: 'ary-MA', script: 'arabizi', category: 'reporting_abuse',
    text: 'Wa7d sabni f DM. Wach l-moderators y9dro ychoufo logs?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Reports abuse and asks moderators to investigate.'
  },
  {
    id: 'MD032', locale: 'ary-MA', script: 'mixed', category: 'meta_discussion',
    text: 'F memes kayn li kayst3mel klmat khayba, walakin l-context kayfer9.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'General discussion about context in memes.'
  },
  {
    id: 'MD033', locale: 'ary-MA', script: 'mixed', category: 'slang_explanation',
    text: "F had l-context, 'm9awed' katji b ma3na wa3er f gameplay, machi sebba.",
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Explains positive slang in a gaming context.'
  },
  {
    id: 'MD034', locale: 'ary-MA', script: 'arabizi', category: 'friendly_greeting',
    text: 'Weld l7oma dyalna, mar7ba bik a sahbi!',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Friendly local expression.'
  },
  {
    id: 'MD035', locale: 'ary-MA', script: 'mixed', category: 'gender_inclusion',
    text: 'Lbnat w drari kamlin y9dro ykouno moderators ila 3ndhom l-kifaya.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Explicitly gender-inclusive statement.'
  },
  {
    id: 'MD036', locale: 'ary-MA', script: 'arabizi', category: 'anti_bullying',
    text: 'Mat3aybouch 3la lahja dyal chi wa7d; kol wa7d w kifach kayhder.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Discourages language-based bullying.'
  },
  {
    id: 'MD037', locale: 'ary-MA', script: 'arabizi', category: 'name_and_numbers',
    text: 'Smiti Hamza, 3ndi 7 messages jdadin w 9 points f leaderboard.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Digits and names resemble common Arabizi tokens but are harmless.'
  },
  {
    id: 'MD038', locale: 'ary-MA', script: 'arabizi', category: 'ordinary_chat',
    text: 'Bghit 9hwa, khobz w atay; chi wa7d jay l-café?',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Ordinary food and drink conversation.'
  },
  {
    id: 'MD039', locale: 'ary-MA', script: 'arabizi', category: 'non_targeted_cursing',
    text: 'T9ewed lia l-application w tسدat بوحدها; ghadi n3awd ninstalliha.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Frustration directed at an application, not a person.'
  },
  {
    id: 'MD040', locale: 'ary-MA', script: 'arabizi', category: 'supportive_reply',
    text: 'Ma tkhafch, kolchi kayt3ellem. Ila bghiti n3awnk f setup, ana hna.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Supportive and non-abusive message.'
  },

  // ------------------------ HARMFUL / SHOULD FLAG --------------------------
  {
    id: 'MD041', locale: 'ary-MA', script: 'arabizi', category: 'targeted_harassment',
    text: 'Nta 7mar w ma katswa walo; sir 7yed rask mn server.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct personal insult combined with an exclusionary command.'
  },
  {
    id: 'MD042', locale: 'ary-MA', script: 'arabizi', category: 'targeted_harassment',
    text: 'Sir t9awed a 9lil l7ya, ma b9inach baghink hna.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct vulgar abuse aimed at a person.'
  },
  {
    id: 'MD043', locale: 'ary-MA', script: 'arabizi', category: 'direct_threat',
    text: 'Ghadi n9tlek ila 3awdti tmentionini.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct threat of killing tied to a real interaction.'
  },
  {
    id: 'MD044', locale: 'ary-MA', script: 'arabizi', category: 'direct_threat',
    text: '3aref fin katskon; ghadi nji 3ndek w ndrbek.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Threat to locate and physically assault someone.'
  },
  {
    id: 'MD045', locale: 'ary-MA', script: 'arabizi', category: 'direct_threat',
    text: 'Ghadi n7re9 lik dar, b9a ghir t3ayet 3lia.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Threat to burn a target’s home.'
  },
  {
    id: 'MD046', locale: 'ary-MA', script: 'arabizi', category: 'direct_threat',
    text: 'Nchdek mn 9fa w nكسّر lik wejhek ila hdrti m3aya tani.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Threat of physical assault.'
  },
  {
    id: 'MD047', locale: 'ary-MA', script: 'arabizi', category: 'direct_threat',
    text: 'Wa9ila ghadi n9tlek lila; hadchi machi d7k.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Specific imminent-sounding threat; explicitly says it is not a joke.'
  },
  {
    id: 'MD048', locale: 'ary-MA', script: 'arabizi', category: 'direct_threat',
    text: 'Ma tkhafch, ghadi n9tlek daba.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct threat with an immediate timeframe.'
  },
  {
    id: 'MD049', locale: 'ary-MA', script: 'arabizi', category: 'targeted_harassment',
    text: 'Bnadem b7alk ma khasoch y3ich m3ana f had server.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Targeted degrading statement suggesting the person should not exist.'
  },
  {
    id: 'MD050', locale: 'ary-MA', script: 'arabizi', category: 'gender_based_hate',
    text: 'Lbnat ma kayfhmouch f gaming; banihom kamlin mn l-team.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Gender-based generalization used to exclude women and girls.'
  },
  {
    id: 'MD051', locale: 'ary-MA', script: 'mixed', category: 'ethnic_discrimination',
    text: 'Ma bghinach l-Amazigh f server; ma 3ndhom ta 9ima.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Explicit exclusion and degradation based on ethnic identity.'
  },
  {
    id: 'MD052', locale: 'ary-MA', script: 'arabizi', category: 'racial_discrimination',
    text: 'Nas dyal had l3er9 khasshom yt7ydo mn lmdina kamla.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Calls for removing an ethnic/racial group from a place.'
  },
  {
    id: 'MD053', locale: 'ary-MA', script: 'arabizi', category: 'regional_discrimination',
    text: 'Nas dyal dik jiha kamlin 7egrin; mamnou3 3lihom ydkhlo l-server.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Group-wide degradation and exclusion based on regional origin.'
  },
  {
    id: 'MD054', locale: 'ary-MA', script: 'arabizi', category: 'identity_based_exclusion',
    text: 'N9iyou l-community mn had l9awm; ma 3ndhomch blassa hna.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Calls for excluding a group identified by identity.'
  },
  {
    id: 'MD055', locale: 'ary-MA', script: 'arabizi', category: 'gender_based_hate',
    text: 'Siftou lbnat kamlin lbarra; ma bghinahomch hna.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Explicit exclusion based on gender.'
  },
  {
    id: 'MD056', locale: 'ary-MA', script: 'arabizi', category: 'targeted_harassment',
    text: 'Nta zbel, weld l97ba, w ghadi nb9a ntbe3k f kol channel.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Severe direct insults combined with a promise of persistent targeting.'
  },
  {
    id: 'MD057', locale: 'ary-MA', script: 'mixed', category: 'doxxing_threat',
    text: 'Ghadi nposti num dyalk w l’adresse dyalk bach nas kamlin y3rfouk.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Threat to publish personal contact and location information.'
  },
  {
    id: 'MD058', locale: 'ary-MA', script: 'arabizi', category: 'self_harm_encouragement',
    text: 'Qtel rask; ma 3ndk 7ta 9ima f had denya.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct encouragement of self-harm paired with degradation.'
  },
  {
    id: 'MD059', locale: 'ary-MA', script: 'mixed', category: 'self_harm_encouragement',
    text: 'T9tel rask a sat, 7ta wa7d ma baghik hna.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Directly urges the target to kill themself.'
  },
  {
    id: 'MD060', locale: 'ary-MA', script: 'arabizi', category: 'incitement_to_violence',
    text: 'Khassk t9tel had l-person f real life; matkhallihch y3ich.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Encourages real-world violence against a person.'
  },
  {
    id: 'MD061', locale: 'ary-MA', script: 'arabizi', category: 'threat_to_family',
    text: 'Ila chftk online, ghadi ndrbek nta w 3a2iltk.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Threatens physical violence against a person and their family.'
  },
  {
    id: 'MD062', locale: 'ary-MA', script: 'mixed', category: 'doxxing_solicitation',
    text: 'N3tik 100 dh ila jibti lia l’adresse personnelle dyal l-admin.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Offers a reward to obtain someone’s private address.'
  },
  {
    id: 'MD063', locale: 'ary-MA', script: 'arabizi', category: 'coordinated_harassment',
    text: 'Siro l-DM dyalo kamlin w 7ercho bih 7ta y7yed l-account.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Coordinates a group to harass a target.'
  },
  {
    id: 'MD064', locale: 'ary-MA', script: 'arabizi', category: 'coordinated_harassment',
    text: 'Spamou 3lih b messages 7ta ykhrej mn server.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Encourages sustained group harassment to force someone out.'
  },
  {
    id: 'MD065', locale: 'ary-MA', script: 'arabic', category: 'gender_based_hate',
    text: 'العيالات ما خاصهمش يلعبو ولا يديرو الموديريشن، بلاصتهم غير فالدار.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Arabic-script misogynistic exclusion based on gender.'
  },
  {
    id: 'MD066', locale: 'ary-MA', script: 'arabic', category: 'direct_threat',
    text: 'غادي نجي لعندك ونضربك إلا رجعتي كتبتي هنا.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct physical threat written in Arabic script.'
  },
  {
    id: 'MD067', locale: 'ary-MA', script: 'mixed', category: 'targeted_harassment',
    text: 'Nta m3a9ed w ma katssta7e9ch tkoun m3ana; get out daba.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Direct personal degradation and rejection.'
  },
  {
    id: 'MD068', locale: 'ary-MA', script: 'mixed', category: 'religious_discrimination',
    text: 'Li kaytbe3 had الدين ma khasoch y3ich binatna.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Calls for excluding people because of religion.'
  },
  {
    id: 'MD069', locale: 'ary-MA', script: 'arabizi', category: 'religious_discrimination',
    text: 'Ma khas 7ta wa7d men had l-madhhab ykoun f had l-mdina.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Advocates exclusion from a place based on religious affiliation.'
  },
  {
    id: 'MD070', locale: 'ary-MA', script: 'mixed', category: 'gender_based_harassment',
    text: 'Hit nti bent, khassk tskti w ma thdri f 7ta mawdo3.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Dismisses and silences a person explicitly because of gender.'
  },
  {
    id: 'MD071', locale: 'ary-MA', script: 'arabizi', category: 'veiled_threat',
    text: 'Ghadi n9leb 3lik mn had lila w ghadi tchof chi 7aja ma 3emrek chftiha.',
    expectedFlag: true, expectedAction: 'review',
    rationale: 'Veiled threat; moderation should review context and target history.'
  },
  {
    id: 'MD072', locale: 'ary-MA', script: 'arabizi', category: 'coercion',
    text: 'Ila ma 3titnich l-compte, ghadi nji l-dar dyalk w nفضحك.',
    expectedFlag: true, expectedAction: 'remove',
    rationale: 'Coercive demand paired with an intimidation threat.'
  },

  // ----------------------- CONTEXT-DEPENDENT / REVIEW -----------------------
  {
    id: 'MD073', locale: 'ary-MA', script: 'arabizi', category: 'ambiguous_insult',
    text: 'Sir t9awed.',
    expectedFlag: null, expectedAction: 'review',
    rationale: 'Strong insult, but target, intent, relationship, and context are absent.'
  },
  {
    id: 'MD074', locale: 'ary-MA', script: 'arabizi', category: 'ambiguous_word',
    text: '7mar.',
    expectedFlag: null, expectedAction: 'review',
    rationale: 'Could be an insult, a literal animal reference, or a quoted word.'
  },
  {
    id: 'MD075', locale: 'ary-MA', script: 'arabizi', category: 'ambiguous_slang',
    text: 'M9awed nta.',
    expectedFlag: null, expectedAction: 'review',
    rationale: 'Meaning varies substantially with tone and context; can be praise or abuse.'
  },
  {
    id: 'MD076', locale: 'ary-MA', script: 'arabizi', category: 'reported_insult',
    text: "Wa7d 3ayet 3lia 'weld l97ba' w ana kan3awd l-message bach nreportih.",
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Quoted insult in a clear report context; should not punish the reporter.'
  },
  {
    id: 'MD077', locale: 'ary-MA', script: 'mixed', category: 'consensual_banter',
    text: 'Kan d7ko m3a b3diyatna: nta hmar w ana hmar 😂 kolchi mtaf9.',
    expectedFlag: null, expectedAction: 'review',
    rationale: 'Claims to be consensual banter; consider conversation history and consent.'
  },
  {
    id: 'MD078', locale: 'ary-MA', script: 'arabizi', category: 'curse_or_threat',
    text: 'Allah yakhod fik l7e9.',
    expectedFlag: null, expectedAction: 'review',
    rationale: 'A curse/complaint that may be rhetorical; not automatically a threat.'
  },
  {
    id: 'MD079', locale: 'ary-MA', script: 'arabizi', category: 'possible_self_harm_disclosure',
    text: 'Ma b9itch 9ader n7mel hadchi, kayji f bali n2di rassi.',
    expectedFlag: true, expectedAction: 'support',
    rationale: 'Possible self-harm disclosure; route to a supportive safety workflow, not a punitive ban.'
  },
  {
    id: 'MD080', locale: 'ary-MA', script: 'arabizi', category: 'self_harm_ambiguity',
    text: 'Khasni n9tel had l-boss f game bach nkمل l-level.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Explicit game objective; no real-world target or self-harm intent.'
  },
  {
    id: 'MD081', locale: 'ary-MA', script: 'arabizi', category: 'slang_or_directed_insult',
    text: 'Hadchi m9awed.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'In this construction, the slang describes a situation as intense/terrible, not a target.'
  },
  {
    id: 'MD082', locale: 'ary-MA', script: 'mixed', category: 'identity_discussion',
    text: 'Bghit nfhem l-khilaf bin Darija w Tamazight; 3afak bla ta7qir.',
    expectedFlag: false, expectedAction: 'allow',
    rationale: 'Neutral discussion of language differences and an explicit request for respect.'
  }
];

/**
 * Evaluate a moderator's binary predictions against the known labels.
 *
 * @param {Array<{id: string, flagged: boolean}>} predictions
 *   One item per test case, e.g. { id: 'MD041', flagged: true }.
 * @returns {object} confusion matrix, rates, false positives, false negatives,
 *   missing predictions, and outcomes for context-dependent cases.
 */
function evaluateModerationResults(predictions) {
  if (!Array.isArray(predictions)) {
    throw new TypeError('predictions must be an array of { id, flagged } records');
  }

  const predictionById = new Map();
  const duplicateIds = [];
  for (const prediction of predictions) {
    if (!prediction || typeof prediction.id !== 'string') continue;
    if (predictionById.has(prediction.id)) duplicateIds.push(prediction.id);
    predictionById.set(prediction.id, prediction.flagged);
  }

  const stats = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
  const falsePositives = [];
  const falseNegatives = [];
  const reviewCases = [];
  const missingPredictions = [];
  const invalidPredictions = [];

  for (const testCase of MOROCCAN_DARIJA_MODERATION_TESTS) {
    if (!predictionById.has(testCase.id)) {
      missingPredictions.push(testCase.id);
      continue;
    }

    const predicted = predictionById.get(testCase.id);
    if (typeof predicted !== 'boolean') {
      invalidPredictions.push({ id: testCase.id, received: predicted });
      continue;
    }

    if (testCase.expectedFlag === null) {
      reviewCases.push({
        id: testCase.id,
        text: testCase.text,
        predictedFlag: predicted,
        expectedAction: testCase.expectedAction,
        category: testCase.category,
        rationale: testCase.rationale
      });
      continue;
    }

    if (testCase.expectedFlag && predicted) {
      stats.truePositive++;
    } else if (!testCase.expectedFlag && !predicted) {
      stats.trueNegative++;
    } else if (!testCase.expectedFlag && predicted) {
      stats.falsePositive++;
      falsePositives.push(testCase);
    } else {
      stats.falseNegative++;
      falseNegatives.push(testCase);
    }
  }

  const total = stats.truePositive + stats.trueNegative + stats.falsePositive + stats.falseNegative;
  const safeDivide = (n, d) => d ? Number((n / d).toFixed(4)) : null;
  const extraPredictionIds = [...predictionById.keys()].filter(
    id => !MOROCCAN_DARIJA_MODERATION_TESTS.some(testCase => testCase.id === id)
  );

  return {
    totalCases: MOROCCAN_DARIJA_MODERATION_TESTS.length,
    evaluatedCases: total,
    skippedContextDependentCases: reviewCases.length,
    missingPredictionCount: missingPredictions.length,
    invalidPredictionCount: invalidPredictions.length,
    confusionMatrix: stats,
    metrics: {
      accuracy: safeDivide(stats.truePositive + stats.trueNegative, total),
      precision: safeDivide(stats.truePositive, stats.truePositive + stats.falsePositive),
      recall: safeDivide(stats.truePositive, stats.truePositive + stats.falseNegative),
      falsePositiveRate: safeDivide(stats.falsePositive, stats.falsePositive + stats.trueNegative),
      falseNegativeRate: safeDivide(stats.falseNegative, stats.falseNegative + stats.truePositive)
    },
    falsePositives: falsePositives.map(({ id, text, category, rationale }) => ({ id, text, category, rationale })),
    falseNegatives: falseNegatives.map(({ id, text, category, rationale }) => ({ id, text, category, rationale })),
    contextDependentResults: reviewCases,
    missingPredictions,
    invalidPredictions,
    duplicatePredictionIds: [...new Set(duplicateIds)],
    unknownPredictionIds: extraPredictionIds
  };
}

module.exports = {
  MOROCCAN_DARIJA_MODERATION_TESTS,
  evaluateModerationResults
};

// Quick dataset sanity check: `node moroccan_darija_moderation_tests.js`
if (require.main === module) {
  const counts = MOROCCAN_DARIJA_MODERATION_TESTS.reduce((result, item) => {
    result[item.expectedAction] = (result[item.expectedAction] || 0) + 1;
    result[item.script] = (result[item.script] || 0) + 1;
    return result;
  }, {});
  console.log(JSON.stringify({
    dataset: 'Moroccan Darija / Arabizi moderation regression tests',
    totalCases: MOROCCAN_DARIJA_MODERATION_TESTS.length,
    actionAndScriptCounts: counts,
    note: 'Import this module and pass [{ id, flagged: boolean }, ...] to evaluateModerationResults().'
  }, null, 2));
}

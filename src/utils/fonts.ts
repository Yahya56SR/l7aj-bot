import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Bundled fonts live at the project root so the compiled build in dist/ and the
// tsx dev run both resolve them to the same place.
const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
// Persistent host dir (survives restarts, outside git-tracked assets).
const DATA_FONTS_DIR = path.join(__dirname, '..', '..', 'data', 'fonts');

let ready = false;
const registeredAliases = new Set<string>();
let emojiDownloadStarted = false;

/**
 * Bundled Noto coverage (ships with the bot, so rendering is identical on a
 * bare Linux container and a Windows host): [file, family alias].
 * Order is fallback priority — Latin first, emoji last so text-style glyphs
 * (© ★ ♥) keep their text look instead of going full colour.
 */
const BUNDLED: Array<[string, string]> = [
  ['NotoSans-Latin.ttf', 'AtlasSans'],
  ['NotoSans-LatinExt.ttf', 'AtlasSansExt'],
  ['NotoSans-Greek.ttf', 'AtlasGreek'],
  ['NotoSans-Cyrillic.ttf', 'AtlasCyrillic'],
  ['NotoSans-Vietnamese.ttf', 'AtlasVietnamese'],
  ['NotoSansArabic-Regular.ttf', 'AtlasArabic'],
  ['NotoSansHebrew-Regular.ttf', 'AtlasHebrew'],
  ['NotoSansThai-Regular.ttf', 'AtlasThai'],
  ['NotoSansDevanagari-Regular.ttf', 'AtlasDevanagari'],
  ['NotoSansBengali-Regular.ttf', 'AtlasBengali'],
  ['NotoSansTamil-Regular.ttf', 'AtlasTamil'],
  ['NotoSansJP-Regular.ttf', 'AtlasJP'],
  ['NotoSansKR-Regular.ttf', 'AtlasKR'],
  ['NotoSansSC-Regular.ttf', 'AtlasSC'],
  ['NotoSansMath-Regular.ttf', 'AtlasMath'],
  ['NotoSansEgyptianHieroglyphs-Regular.ttf', 'AtlasHieroglyphs'],
  // NOTE: the 25MB color-emoji TTF is NOT committed — it is downloaded once
  // to data/fonts on hosts that have no system emoji font (see below).
];

/**
 * Download URLs for bundled Noto fonts not committed to the repo.
 * Lands in data/fonts (persistent, outside git) so deploys stay small and
 * hosts self-heal missing glyph coverage without a redeploy. Only downloaded
 * when the file is missing from assets/fonts.
 */
// NOTE: google/fonts removed the static JP/KR/SC weights — only the variable
// [wght] masters remain upstream. Cached files keep their old names (they are
// download keys, matched against BUNDLED); the content is the variable TTF
// (default instance = Regular, so rendering is unchanged).
const FONT_DOWNLOAD_URLS: Record<string, string> = {
  'NotoSansJP-Regular.ttf':
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf',
  'NotoSansKR-Regular.ttf':
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf',
  'NotoSansSC-Regular.ttf':
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'NotoSansMath-Regular.ttf':
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansmath/NotoSansMath-Regular.ttf',
  'NotoSansEgyptianHieroglyphs-Regular.ttf':
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansegyptianhieroglyphs/NotoSansEgyptianHieroglyphs-Regular.ttf',
};

/**
 * Host fonts worth picking up when present. Arial aliases keep the classic
 * look on hosts that don't ship Arial (Linux VPS); the rest are backups for
 * scripts the bundle does not cover.
 */
const SYSTEM: Array<[string, string]> = [
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'Arial'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Arial'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 'Noto Color Emoji'],
  ['C:/Windows/Fonts/arial.ttf', 'Arial'],
  ['C:/Windows/Fonts/tahoma.ttf', 'Tahoma'],
  ['C:/Windows/Fonts/yugothic.ttf', 'Yu Gothic'],
  ['C:/Windows/Fonts/malgun.ttf', 'Malgun Gothic'],
  ['C:/Windows/Fonts/msyh.ttf', 'Microsoft YaHei'],
  ['C:/Windows/Fonts/seguiemj.ttf', 'Segoe UI Emoji'],
  ['C:/Windows/Fonts/seguisym.ttf', 'Segoe UI Symbol'],
];

/**
 * One stack for every canvas in the bot. Skia falls back per glyph across the
 * stack, so a single Arabic word inside a Latin name renders from AtlasArabic
 * while the rest stays Arial.
 */
export const FONT_STACK = [
  'Arial',
  'AtlasSans', 'AtlasSansExt', 'AtlasGreek', 'AtlasCyrillic', 'AtlasVietnamese',
  'AtlasArabic', 'AtlasHebrew', 'AtlasThai',
  'AtlasDevanagari', 'AtlasBengali', 'AtlasTamil',
  'AtlasJP', 'AtlasKR', 'AtlasSC', 'AtlasMath', 'AtlasHieroglyphs',
  'Tahoma', 'Yu Gothic', 'Malgun Gothic', 'Microsoft YaHei', 'DejaVu Sans',
  'Segoe UI Emoji', 'AtlasEmoji', 'Noto Color Emoji', 'Segoe UI Symbol',
].map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');

/** Register bundled + host fonts. Idempotent — safe to call from every canvas module. */
export function ensureFonts(): void {
  if (ready) return;
  ready = true;
  const missing: string[] = [];

  const downloading = new Set<string>();

  for (const [file, alias] of [...BUNDLED, ...SYSTEM]) {
    const isSystem = file.startsWith('/') || /^[A-Za-z]:/.test(file);
    // Bundled fonts live in assets/fonts OR the persistent data dir (runtime
    // downloads land there); prefer assets, fall back to data.
    const candidates = isSystem
      ? [file]
      : [path.join(FONTS_DIR, file), path.join(DATA_FONTS_DIR, file)];
    try {
      const full = candidates.find((p) => fs.existsSync(p));
      if (full) {
        GlobalFonts.registerFromPath(full, alias);
        registeredAliases.add(alias);
        continue;
      }
      if (isSystem) continue; // system font not present — skip
      // Download to the persistent data dir instead of committing the binary to git.
      void downloadFont(file, alias, downloading);
      missing.push(file);
    } catch (error) {
      console.error(`[Fonts] Failed to register ${alias} from ${file}:`, error);
    }
  }

  if (missing.length) {
    console.info(`[Fonts] Queued download for missing fonts: ${missing.join(', ')} — they land in data/fonts on first start.`);
  }

  // A manually restored bundle copy still wins if present.
  try {
    const bundledEmoji = path.join(FONTS_DIR, EMOJI_FILE);
    if (!registeredAliases.has('AtlasEmoji') && fs.existsSync(bundledEmoji)) {
      GlobalFonts.registerFromPath(bundledEmoji, 'AtlasEmoji');
      registeredAliases.add('AtlasEmoji');
    }
  } catch (error) {
    console.error('[Fonts] Failed to register bundled emoji font:', error);
  }

  // Color emoji has no usable fallback on minimal hosts — fetch it in the
  // background when nothing registered an emoji face.
  const hasEmoji = ['AtlasEmoji', 'Segoe UI Emoji', 'Noto Color Emoji'].some((a) =>
    registeredAliases.has(a),
  );
  if (!hasEmoji) void ensureEmojiFont();
}

const EMOJI_FILE = 'NotoColorEmoji-Regular.ttf';
const EMOJI_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf',
];
const EMOJI_MIN_BYTES = 20_000_000;

/**
 * One-time ~25MB download to the persistent data dir (NOT the synced repo, so
 * deploys stay small). Registers the face as soon as it lands — no restart
 * needed. Never throws; worst case emoji keeps its current fallback.
 */
async function ensureEmojiFont(): Promise<void> {
  if (emojiDownloadStarted) return;
  emojiDownloadStarted = true;
  const dest = path.join(DATA_FONTS_DIR, EMOJI_FILE);

  try {
    if (fs.existsSync(dest)) {
      if (fs.statSync(dest).size >= EMOJI_MIN_BYTES) {
        GlobalFonts.registerFromPath(dest, 'AtlasEmoji');
        registeredAliases.add('AtlasEmoji');
        console.log('[Fonts] Color emoji loaded from data/fonts.');
        return;
      }
      fs.rmSync(dest, { force: true });
    }
  } catch (error) {
    console.error('[Fonts] Could not reuse cached emoji font:', error);
    return;
  }

  for (const url of EMOJI_URLS) {
    try {
      console.log(`[Fonts] Downloading Noto Color Emoji (~25MB) via ${new URL(url).host}...`);
      fs.mkdirSync(DATA_FONTS_DIR, { recursive: true });
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const tmp = `${dest}.part`;
      await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
      if (fs.statSync(tmp).size < EMOJI_MIN_BYTES) throw new Error('download incomplete');
      fs.renameSync(tmp, dest);
      GlobalFonts.registerFromPath(dest, 'AtlasEmoji');
      registeredAliases.add('AtlasEmoji');
      console.log('[Fonts] Color emoji ready.');
      return;
    } catch (error) {
      console.error('[Fonts] Emoji download failed via ' + url + ':', (error as Error)?.message || error);
    }
  }
  console.warn('[Fonts] No color emoji available — emoji may render as boxes until the download succeeds.');
}

/**
 * Download a single bundled Noto font to the persistent data dir and register
 * it. Never throws — worst case the alias stays unregistered and that script
 * falls back to the rest of FONT_STACK. Deduplicated via `downloading` so the
 * same font isn't fetched twice in one boot.
 */
async function downloadFont(
  file: string,
  alias: string,
  downloading: Set<string>,
): Promise<void> {
  if (downloading.has(file)) return;
  const url = FONT_DOWNLOAD_URLS[file];
  if (!url) {
    console.warn(`[Fonts] No download URL for ${file} — glyph coverage may be incomplete.`);
    return;
  }
  downloading.add(file);

  const dest = path.join(DATA_FONTS_DIR, file);
  try {
    fs.mkdirSync(DATA_FONTS_DIR, { recursive: true });
    console.log(`[Fonts] Downloading ${file} via ${new URL(url).host}...`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const tmp = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    GlobalFonts.registerFromPath(dest, alias);
    registeredAliases.add(alias);
    console.log(`[Fonts] ${file} ready (downloaded to data/fonts).`);
  } catch (error) {
    console.error(
      `[Fonts] Failed to download ${file}:`,
      (error as Error)?.message || error,
    );
  } finally {
    downloading.delete(file);
  }
}

/**
 * Code-point-safe ellipsis: `text.slice(0, -1)` can split a surrogate pair
 * and leave a lone surrogate (renders as �), so truncate by code point.
 */
export function ellipsize(measure: (text: string) => number, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  let end = chars.length;
  while (end > 1 && measure(`${chars.slice(0, end).join('')}…`) > maxWidth) end--;
  return `${chars.slice(0, end).join('')}…`;
}

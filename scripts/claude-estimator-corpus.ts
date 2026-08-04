/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2835 — provider-ground-truth corpus for the Claude 5 estimators.
 *
 * Extends the #2253 content categories with the coverage that issue #2835
 * requires and #2253 lacked: astral-plane emoji, combining marks, and varying
 * system/tool envelope sizes.
 *
 * Envelope variation is what makes a whole-request calibration identifiable.
 * With a single fixed envelope, only a marginal content rate can be measured
 * and any per-request framing constant cancels; collecting the same content
 * against three different tool envelopes separates the two.
 */

export type ClaudeCorpusCategory =
  | 'prose'
  | 'code'
  | 'json'
  | 'unicode'
  | 'emoji'
  | 'combining'
  | 'mixed';

/** Tool-envelope size. Each variant changes the fixed prompt-bearing framing. */
export type ClaudeCorpusEnvelope = 'tools-off' | 'tools-small' | 'tools-full';

export type ClaudeCorpusSplit = 'train' | 'heldout';

export interface ClaudeCorpusItem {
  readonly id: number;
  readonly split: ClaudeCorpusSplit;
  readonly category: ClaudeCorpusCategory;
  readonly envelope: ClaudeCorpusEnvelope;
  readonly scale: number;
  readonly prompt: string;
}

export const CLAUDE_CORPUS_VERSION = '2026-08-04-v1';

const REPLY_DIRECTIVE =
  ' Reply with exactly the two characters OK and nothing else.';

export const CLAUDE_CORPUS_CATEGORIES: readonly ClaudeCorpusCategory[] =
  Object.freeze([
    'prose',
    'code',
    'json',
    'unicode',
    'emoji',
    'combining',
    'mixed',
  ]);

/** Categories held out inside the two non-default envelopes. */
const ENVELOPE_HELDOUT_CATEGORIES: ReadonlySet<ClaudeCorpusCategory> =
  new Set<ClaudeCorpusCategory>(['emoji', 'combining', 'mixed']);

const BASE_SCALES = [1, 2, 3, 4] as const;
const SMALL_ENVELOPE_SCALE = 2;
const FULL_ENVELOPE_SCALE = 3;

function prosePayload(scale: number): string {
  const base =
    'The quick brown fox jumps over the lazy dog while a merchant inspects each ledger entry for accuracy before sealing the envelope and dispatching it via the afternoon courier service. ';
  return base.repeat(scale * 3);
}

function codePayload(scale: number): string {
  const line =
    'function computeChecksum(values) { return values.reduce((acc, v) => (acc * 31 + v) >>> 0, 0); } // deterministic checksum';
  return Array.from({ length: scale * 4 }, () => line).join('\n');
}

function jsonPayload(scale: number): string {
  const entry = (index: number): string =>
    `{"id":${index},"name":"item_${index}","tags":["alpha","beta"],"meta":{"weight":${index}.5,"enabled":true}}`;
  return `[${Array.from({ length: scale * 5 }, (_, i) => entry(i)).join(',')}]`;
}

function unicodePayload(scale: number): string {
  const glyphs =
    '日本語のテキストです。한국어 텍스트입니다. Русский текст. Ελληνικό κείμενο. العربية. ';
  return glyphs.repeat(scale * 2);
}

/**
 * Astral-plane characters only reachable through UTF-16 surrogate pairs,
 * including zero-width-joiner sequences, regional-indicator flags, and
 * variation selectors.
 */
function emojiPayload(scale: number): string {
  const glyphs =
    '🚀 ship it 👩‍👩‍👧‍👦 family 🇯🇵 flag 🧑🏽‍💻 developer ⚙️ gear 🌍🌎🌏 world 𝄞 clef 🔥💧🌱 elements. ';
  return glyphs.repeat(scale * 2);
}

/**
 * Decomposed Latin plus Devanagari and Hebrew marks, so a code-point count
 * and a grapheme count diverge substantially.
 */
function combiningPayload(scale: number): string {
  const glyphs =
    'a\u0301e\u0300i\u0302o\u0303u\u0308 cafe\u0301 man\u0303ana नमस्ते हिन्दी שָׁלוֹם Z\u0335\u0301\u0327a\u0336\u0308l\u0334\u0301go. ';
  return glyphs.repeat(scale * 2);
}

function mixedPayload(scale: number): string {
  const block = (index: number): string =>
    `## Section ${index}\n\n- item \`code\` and <tool name="search"><query>tokenization boundary ${index}</query></tool>\n- "punctuation; semicolons; brackets [a] {b} (c)" — 日本語 — 🚀 — e\u0301\n\n\`\`\`json\n{"id": ${index}, "ok": true}\n\`\`\`\n`;
  return Array.from({ length: scale * 3 }, (_, i) => block(i)).join('\n');
}

function buildPayload(category: ClaudeCorpusCategory, scale: number): string {
  switch (category) {
    case 'prose':
      return prosePayload(scale);
    case 'code':
      return codePayload(scale);
    case 'json':
      return jsonPayload(scale);
    case 'unicode':
      return unicodePayload(scale);
    case 'emoji':
      return emojiPayload(scale);
    case 'combining':
      return combiningPayload(scale);
    case 'mixed':
      return mixedPayload(scale);
    default:
      throw new Error(`Unknown corpus category: ${String(category)}`);
  }
}

function buildPrompt(category: ClaudeCorpusCategory, scale: number): string {
  return buildPayload(category, scale) + REPLY_DIRECTIVE;
}

function buildItems(): readonly ClaudeCorpusItem[] {
  const items: ClaudeCorpusItem[] = [];
  let id = 0;
  for (const category of CLAUDE_CORPUS_CATEGORIES) {
    for (const scale of BASE_SCALES) {
      id += 1;
      items.push({
        id,
        // The largest size in each category is never trained on, so the
        // held-out split tests extrapolation rather than interpolation.
        split:
          scale === BASE_SCALES[BASE_SCALES.length - 1] ? 'heldout' : 'train',
        category,
        envelope: 'tools-off',
        scale,
        prompt: buildPrompt(category, scale),
      });
    }
  }
  for (const [envelope, scale] of [
    ['tools-small', SMALL_ENVELOPE_SCALE],
    ['tools-full', FULL_ENVELOPE_SCALE],
  ] as ReadonlyArray<[ClaudeCorpusEnvelope, number]>) {
    for (const category of CLAUDE_CORPUS_CATEGORIES) {
      id += 1;
      items.push({
        id,
        split: ENVELOPE_HELDOUT_CATEGORIES.has(category) ? 'heldout' : 'train',
        category,
        envelope,
        scale,
        prompt: buildPrompt(category, scale),
      });
    }
  }
  return Object.freeze(items);
}

const ITEMS = buildItems();

export function getClaudeCorpus(): readonly ClaudeCorpusItem[] {
  return ITEMS;
}

export function getClaudeCorpusItem(id: number): ClaudeCorpusItem {
  const item = ITEMS.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new Error(`Corpus item id ${id} out of range [1, ${ITEMS.length}]`);
  }
  return item;
}

/**
 * Tools allow-list for an envelope variant. `undefined` means "do not
 * constrain the tool set", which yields the provider's full tool schema and
 * therefore the largest prompt-bearing envelope.
 */
export function envelopeToolsAllowList(
  envelope: ClaudeCorpusEnvelope,
): readonly string[] | undefined {
  switch (envelope) {
    case 'tools-off':
      return [];
    case 'tools-small':
      return ['read_file', 'write_file', 'list_directory'];
    case 'tools-full':
      return undefined;
    default:
      throw new Error(`Unknown envelope: ${String(envelope)}`);
  }
}

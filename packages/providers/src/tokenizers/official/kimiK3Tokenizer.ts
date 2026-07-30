/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { AssetManifest } from './assetManifest.js';
import { AssetLoader } from './assetLoader.js';
import { TiktokenRuntime } from './tiktokenRuntime.js';

/**
 * Kimi K3 official tiktoken configuration constants.
 *
 * Source: moonshotai/Kimi-K3 (HuggingFace)
 *   - tokenization_kimi.py pat_str
 *   - tokenizer_config.json added_tokens_decoder
 *   - tiktoken.model BPE ranks
 */
const KIMI_K3_BASE_VOCAB = 163_584;
const KIMI_K3_RESERVED_SPECIAL = 256;

/**
 * Pre-tokenizer regex from Moonshot's TikTokenTokenizer.pat_str.
 *
 * Differs from o200k_base by splitting CJK (Han) characters into their
 * own pieces and excluding them from the Latin letter runs via the
 * `&&[^\p{Han}]` character-class intersection.
 */
const KIMI_K3_PAT_STR = [
  String.raw`[\p{Han}]+`,
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]*[\p{Ll}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?`,
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]+[\p{Ll}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?`,
  String.raw`\p{N}{1,3}`,
  String.raw` ?[^\s\p{L}\p{N}]+[\r\n]*`,
  String.raw`\s*[\r\n]+`,
  String.raw`\s+(?!\S)`,
  String.raw`\s+`,
].join('|');

/**
 * Known special-token names mapped to IDs within the reserved range
 * [baseVocab, baseVocab + reservedSpecial). Tokens without an explicit
 * name use the `<|reserved_token_{id}|>` convention.
 */
const KIMI_K3_NAMED_SPECIALS: Record<string, number> = {
  '[BOS]': 163_584,
  '[EOS]': 163_585,
  '<|end_of_msg|>': 163_586,
  '<|open|>': 163_587,
  '<|close|>': 163_588,
  '<|sep|>': 163_589,
  '[start_header_id]': 163_590,
  '[end_header_id]': 163_591,
  '[EOT]': 163_593,
  '<|media_begin|>': 163_602,
  '<|media_content|>': 163_603,
  '<|media_end|>': 163_604,
  '<|media_pad|>': 163_605,
  '<osagent_mode>': 163_649,
  '[UNK]': 163_838,
  '[PAD]': 163_839,
};

function buildKimiK3SpecialTokens(): Record<string, number> {
  const tokens: Record<string, number> = {};
  for (let i = 0; i < KIMI_K3_RESERVED_SPECIAL; i++) {
    const id = KIMI_K3_BASE_VOCAB + i;
    tokens[`<|reserved_token_${id}|>`] = id;
  }
  for (const [name, id] of Object.entries(KIMI_K3_NAMED_SPECIALS)) {
    tokens[name] = id;
  }
  return tokens;
}

export const KIMI_K3_MANIFEST: AssetManifest = {
  model: 'kimi-k3',
  source: 'huggingface.co/moonshotai/Kimi-K3',
  revision: '9f62e4e9fffbd0a83ddd60e1c209d828994b3569',
  sourceFile: 'tiktoken.model',
  assetFile: 'tokenizer.bpe',
  sha256: 'b6c497a7469b33ced9c38afb1ad6e47f03f5e5dc05f15930799210ec050c5103',
  license: 'kimi-k3',
  conversion: 'direct',
};

/**
 * An ordered (text, allow_special) segment as used by Kimi K3 XTML encoding.
 *
 * Structural markers (tags, separators) have allowSpecial=true so their
 * control-token strings resolve to single token IDs. User/tool text has
 * allowSpecial=false so strings resembling control tokens are never
 * interpreted as structure.
 */
export interface KimiK3Segment {
  readonly text: string;
  readonly allowSpecial: boolean;
}

/**
 * Official Kimi K3 tokenizer using the pinned Moonshot tiktoken BPE.
 *
 * Implements RuntimeTokenizer so it integrates with the existing
 * HistoryService token-counting path. Also exposes segment-based
 * encoding for XTML-aware token counting (used by future prompt
 * projection work).
 */
export class KimiK3Tokenizer implements RuntimeTokenizer {
  private readonly runtime: TiktokenRuntime;

  constructor(assetLoader?: AssetLoader) {
    const loader = assetLoader ?? new AssetLoader();
    const bpeRanks = loader.loadBpe('kimi-k3', KIMI_K3_MANIFEST);
    this.runtime = new TiktokenRuntime({
      model: 'kimi-k3',
      bpeRanks,
      patStr: KIMI_K3_PAT_STR,
      specialTokens: buildKimiK3SpecialTokens(),
    });
  }

  /**
   * Count tokens for arbitrary content.
   *
   * Non-string content is JSON-stringified. Uses encode_ordinary so
   * user text resembling control tokens is counted as ordinary BPE.
   */
  countTokens(content: unknown): number {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content) || '';
    return this.runtime.countOrdinary(text);
  }

  /**
   * Count tokens across ordered XTML segments.
   *
   * Segments with allowSpecial=true encode control-token strings as
   * their IDs; segments with allowSpecial=false encode everything as
   * ordinary BPE bytes.
   */
  countSegments(segments: readonly KimiK3Segment[]): number {
    let total = 0;
    for (const seg of segments) {
      if (seg.text.length === 0) {
        continue;
      }
      total += this.runtime.encode(seg.text, seg.allowSpecial).length;
    }
    return total;
  }

  dispose(): void {
    this.runtime.dispose();
  }
}

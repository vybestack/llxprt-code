/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { rm } from 'node:fs/promises';
import { countO200kBaseTokensChunked } from './o200k-chunked-source.js';
import { getO200kBaseEncoder } from './o200kBaseCounter.js';
import {
  spoolPromptText,
  type SourceFamilyInput,
} from './source-family-input.js';

/**
 * Special-token strings of the o200k_base encoding that `estimateTokens`
 * (core toolOutputLimiter, `gpt-4o`) rejects, which sends it to its
 * length/3 fallback.
 */
const O200K_SPECIAL_STRINGS: readonly string[] = [
  '<|endoftext|>',
  '<|endofprompt|>',
];
const SPECIAL_CARRY =
  Math.max(...O200K_SPECIAL_STRINGS.map((s) => s.length)) - 1;

/**
 * Streaming equivalent of the whole-string `countPromptTokens` for models
 * without a registered tokenizer:
 *
 *  - an all-whitespace prompt counts 0;
 *  - a prompt containing an o200k special-token string counts
 *    ceil(length / 3), with the length and the special-string scan taken
 *    across piece boundaries in one pass;
 *  - anything else is the ordinary o200k_base count, which is exactly what
 *    `encode` returns for text with no special strings, computed by the
 *    pre-tokenizer-chunked counter over a scratch copy of the prompt text.
 *
 * The prompt is never held as one string.
 */
export async function countLegacyPromptTokens(
  input: SourceFamilyInput,
): Promise<number> {
  const scan = { length: 0, hasContent: false, hasSpecial: false, carry: '' };
  const spool = await spoolPromptText(input, (piece) => {
    scan.length += piece.length;
    scan.hasContent ||= /\S/.test(piece);
    if (scan.hasSpecial) return;
    const window = scan.carry + piece;
    scan.hasSpecial = O200K_SPECIAL_STRINGS.some((special) =>
      window.includes(special),
    );
    scan.carry = window.slice(-SPECIAL_CARRY);
  });
  try {
    if (!scan.hasContent) return 0;
    if (scan.hasSpecial) return Math.ceil(scan.length / 3);
    return await countO200kBaseTokensChunked(
      { path: spool.path },
      await getO200kBaseEncoder(),
      { workspaceDirectory: input.workspaceDirectory, signal: input.signal },
    );
  } finally {
    await rm(spool.directory, { recursive: true, force: true });
  }
}

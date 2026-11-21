/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { hashContent } from './manifest-operations.js';

/**
 * SHA-256 hashes of prompt defaults that earlier releases installed. An
 * installed file whose content still matches one of these was never edited
 * by the user, so it is replaced with the current default even when the
 * installed manifest has no record of it (installs that predate the
 * manifest) or records a different hash.
 *
 * Every `compression.md` listed here asked the summarizer for a
 * `<scratchpad>`, which Anthropic refuses as reasoning extraction (#4128).
 */
const RETIRED_DEFAULT_HASHES: Readonly<
  Partial<Record<string, readonly string[]>>
> = {
  'compression.md': [
    'f443338fbc6b12c0eda4fdec4a122818200c5e4816c5220cb49bf387b715fd9c',
    '96235293f7db5cda37087293f58a0d2468410a12dc9bda27d818bfb35b7b2fd5',
    'e56c85ac4eace1c6e02511bf38185dbf2e149d9e5dc1795c8270a714f62b4da6',
    'd14dc806f9920631dd04456be934e2b3b2fccebbc4a69fecfe66e5854e666c14',
  ],
};

/** True when `content` is a default an earlier release shipped for this path. */
export function isRetiredDefault(
  relativePath: string,
  content: string,
): boolean {
  const hashes = RETIRED_DEFAULT_HASHES[relativePath];
  return hashes?.includes(hashContent(content)) === true;
}

/** Customized prompts that still request a `<scratchpad>` (#4128). */
export function requestsScratchpad(content: string): boolean {
  return /<scratchpad>/i.test(content);
}

export function buildScratchpadNotice(userPath: string): string {
  return `Warning: ${userPath} still contains a <scratchpad> instruction. Anthropic models refuse requests that contain a scratchpad; remove that instruction from your customized prompt.`;
}

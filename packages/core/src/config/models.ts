/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

export const PLACEHOLDER_MODEL = 'placeholder-model';

/**
 * Neutral sentinel provider identity used when no provider is configured.
 * Runtime state factories return this instead of falling back to a hosted
 * provider (e.g. Gemini), so the system boots in an explicitly-unconfigured
 * state that surfaces actionable guidance.
 */
export const UNCONFIGURED_PROVIDER = 'unconfigured';

/**
 * Returns true if the model string indicates a Gemini 2.x model.
 */
export function isGemini2Model(model: string): boolean {
  return model.startsWith('gemini-2');
}

/**
 * Returns true if the model string indicates a Gemini 3.x model.
 */
export function isGemini3Model(model: string): boolean {
  return model.startsWith('gemini-3');
}

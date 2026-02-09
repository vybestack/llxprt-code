/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// Alias constants (user-facing short names)
export const GEMINI_MODEL_ALIAS_PRO = 'gemini-pro';
export const GEMINI_MODEL_ALIAS_FLASH = 'gemini-flash';
export const GEMINI_MODEL_ALIAS_FLASH_LITE = 'gemini-flash-lite';

// Preview model
export const PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview';

/**
 * Resolves a model alias to a concrete model name.
 * When previewFeaturesEnabled is true, the pro alias resolves to the preview model.
 */
export function resolveModel(
  alias: string,
  previewFeaturesEnabled: boolean,
): string {
  switch (alias) {
    case GEMINI_MODEL_ALIAS_PRO:
      return previewFeaturesEnabled
        ? PREVIEW_GEMINI_MODEL
        : DEFAULT_GEMINI_MODEL;
    case GEMINI_MODEL_ALIAS_FLASH:
      return DEFAULT_GEMINI_FLASH_MODEL;
    case GEMINI_MODEL_ALIAS_FLASH_LITE:
      return DEFAULT_GEMINI_FLASH_LITE_MODEL;
    default:
      return alias;
  }
}

/**
 * Returns true if the model string indicates a Gemini 2.x model.
 */
export function isGemini2Model(model: string): boolean {
  return model.startsWith('gemini-2');
}

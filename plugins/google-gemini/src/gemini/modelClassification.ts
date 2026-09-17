/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from '../IProvider.js';

/**
 * Re-render the caller-assembled system prompt for the model this router
 * selected, so the rendered model matches `resolved.model` (issue #3157).
 *
 * Returns `options` unchanged — never a rebuilt prompt — when the router is
 * not overriding the model, when the caller supplied no assembler, or when
 * the caller supplied no prompt to re-render. Assembly stays owned by the
 * agent layer; this only re-invokes it.
 *
 * No try/catch: an assembler rejection propagates (fail-fast).
 */
export async function optionsWithSelectedModelPrompt(
  options: GenerateChatOptions,
  selectedModel: string,
): Promise<GenerateChatOptions> {
  if (selectedModel.trim() === '') {
    return options;
  }
  const assembler = options.systemPromptAssembler;
  if (assembler === undefined) {
    return options;
  }
  if (
    options.systemInstruction === undefined ||
    options.systemInstruction.trim() === ''
  ) {
    // Blank is "missing" per systemPromptPlacement.ts. Return unchanged so the
    // delegate's fail-fast guard fires on the original invalid value — the port
    // re-renders an existing prompt but never originates one.
    return options;
  }
  const systemInstruction = await assembler.assemble(selectedModel);
  return { ...options, systemInstruction };
}

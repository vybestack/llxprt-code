/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentInputs } from './types.js';

/**
 * Simple template string replacement for agent prompts.
 * Replaces ${key} placeholders with values from the inputs object.
 *
 * @param template The template string with ${key} placeholders
 * @param inputs The input values to substitute
 * @returns The template with placeholders replaced
 */
export function templateString(template: string, inputs: AgentInputs): string {
  const placeholderRegex = /\$\{(\w+)\}/g;

  // First, find all unique keys required by the template.
  const requiredKeys = new Set(
    Array.from(template.matchAll(placeholderRegex), (match) => match[1]),
  );

  // Check if all required keys exist in the inputs.
  const inputKeys = new Set(Object.keys(inputs));
  const missingKeys = Array.from(requiredKeys).filter(
    (key) => !inputKeys.has(key),
  );

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing input values for the following keys: ${missingKeys.join(', ')}`,
    );
  }

  // Perform the replacement using a replacer function.
  return template.replace(placeholderRegex, (_match, key) =>
    String(inputs[key]),
  );
}

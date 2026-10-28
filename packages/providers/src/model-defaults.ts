/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ModelDefaultRule } from './composition/index.js';

export function computeModelDefaults(
  modelName: string,
  modelDefaultRules: readonly ModelDefaultRule[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const rule of modelDefaultRules) {
    const regex = new RegExp(rule.pattern, 'i');
    if (regex.test(modelName)) {
      for (const [key, value] of Object.entries(rule.ephemeralSettings)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

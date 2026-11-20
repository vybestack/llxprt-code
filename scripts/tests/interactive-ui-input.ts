/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface ScriptStep {
  type: string;
  text?: string;
  submitKeys?: string[];
  postTypeMs?: number;
  keys?: string[];
  scope?: string;
  regex?: string;
}

export function synchronizeShellInput<T extends { steps: ScriptStep[] }>(
  script: T,
): Omit<T, 'steps'> & { steps: ScriptStep[] } {
  return {
    ...script,
    steps: script.steps.flatMap((step) => {
      if (step.type !== 'line' || !step.text) return [step];
      // Framing prevents a pending Escape from consuming the first character.
      // Echo acknowledges decoding before the existing submit delay starts.
      const prefix = step.text
        .slice(0, 70)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [
        { type: 'keys', keys: [`\x1b[200~${step.text}\x1b[201~`] },
        { type: 'waitFor', scope: 'screen', regex: `│ [!>] ${prefix}` },
        { ...step, text: '' },
      ];
    }),
  };
}

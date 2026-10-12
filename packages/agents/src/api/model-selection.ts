/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ModelDefaultRule } from '@vybestack/llxprt-code-providers/composition.js';
import { computeModelDefaults } from '@vybestack/llxprt-code-providers/model-defaults.js';

export interface ModelSelectionOperations {
  readModel(): string | undefined;
  selectModel(model: string, rules: readonly ModelDefaultRule[]): void;
}

export function assembleModelSelection(
  owner: SessionSettingsOwner,
): ModelSelectionOperations {
  return {
    readModel: () => owner.readSelectedModel(),
    selectModel: (model, rules) => {
      const previous = owner.readSelectedModel();
      owner.selectModel(model, {
        departing:
          previous === undefined ? {} : computeModelDefaults(previous, rules),
        arriving: computeModelDefaults(model, rules),
      });
    },
  };
}

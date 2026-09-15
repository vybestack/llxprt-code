/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { filterStrings, getFuzzyEnabled } from '../utils/fuzzyFilter.js';
import { listImageProviders, listTextProviders } from './providerSelection.js';
import type { CommandArgumentSchema, ValueArgument } from './schema/types.js';

function providerArgument(kind: 'text' | 'image'): ValueArgument {
  return {
    kind: 'value',
    name: 'provider',
    description: `${kind} provider name`,
    completer: async (ctx, partial) =>
      filterStrings(
        kind === 'image'
          ? listImageProviders()
          : listTextProviders(getRuntimeApi()),
        partial,
        { enableFuzzy: getFuzzyEnabled(ctx) },
      ).map((value) => ({ value })),
  };
}

export const providerCommandSchema: CommandArgumentSchema = [
  {
    kind: 'literal',
    value: 'text',
    description: 'Select a text provider',
    stopPropagation: true,
    next: [providerArgument('text')],
  },
  {
    kind: 'literal',
    value: 'image',
    description: 'Select an image provider alias',
    stopPropagation: true,
    next: [providerArgument('image')],
  },
  {
    kind: 'literal',
    value: 'save',
    description: 'Save the current provider as an alias',
    stopPropagation: true,
    next: [{ kind: 'value', name: 'alias', description: 'New alias name' }],
  },
  { ...providerArgument('text'), literalAlternative: true },
];

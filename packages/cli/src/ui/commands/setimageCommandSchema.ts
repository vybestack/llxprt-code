/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ephemeralSettingHelp } from '@vybestack/llxprt-code-providers/runtime.js';
import { getDirectSettingSpecs } from '@vybestack/llxprt-code-settings';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { filterStrings, getFuzzyEnabled } from '../utils/fuzzyFilter.js';
import type { CommandArgumentSchema, ValueArgument } from './schema/types.js';

const imageParamCompleter: NonNullable<ValueArgument['completer']> = async (
  ctx,
  partial,
) =>
  filterStrings(
    Object.keys(
      getRuntimeApi().getActiveImageProfile()?.profile.modelParams ?? {},
    ),
    partial,
    { enableFuzzy: getFuzzyEnabled(ctx) },
  ).map((value) => ({ value, description: `Parameter: ${value}` }));

const imageKeyCompleter: NonNullable<ValueArgument['completer']> = async (
  ctx,
  partial,
) => {
  const profile = getRuntimeApi().getActiveImageProfile()?.profile;
  const keys = new Set([
    'modelparam',
    ...Object.keys(ephemeralSettingHelp),
    ...Object.keys(profile?.ephemeralSettings ?? {}),
  ]);
  return filterStrings([...keys], partial, {
    enableFuzzy: getFuzzyEnabled(ctx),
  }).map((value) => ({ value }));
};

/** Builds completions using image state only, never text-model settings. */
export function buildSetimageSchema(): CommandArgumentSchema {
  return [
    {
      kind: 'literal',
      value: 'unset',
      description: 'Unset image setting',
      stopPropagation: true,
      next: [
        {
          kind: 'value',
          name: 'key',
          description: 'image setting to remove',
          completer: imageKeyCompleter,
          next: [
            {
              kind: 'value',
              name: 'param-name',
              description: 'model parameter (omit to clear all)',
              completer: async (ctx, partial, tokens) =>
                tokens.tokens[1] === 'modelparam'
                  ? imageParamCompleter(ctx, partial, tokens)
                  : [],
            },
          ],
        },
      ],
    },
    {
      kind: 'literal',
      value: 'modelparam',
      description: 'Image model parameter',
      stopPropagation: true,
      next: [
        {
          kind: 'value',
          name: 'param-name',
          description: 'parameter name',
          completer: imageParamCompleter,
          next: [
            {
              kind: 'value',
              name: 'param-value',
              description: 'number, string, boolean, or JSON',
            },
          ],
        },
      ],
    },
    ...getDirectSettingSpecs().map((spec) => ({
      kind: 'literal' as const,
      value: spec.value,
      description: spec.description,
      stopPropagation: true,
      next: [
        {
          kind: 'value' as const,
          name: 'setting-value',
          hint: spec.hint,
          options: spec.options,
        },
      ],
    })),
    {
      kind: 'value',
      name: 'setting',
      description: 'image ephemeral setting',
      options: Object.entries(ephemeralSettingHelp).map(
        ([value, description]) => ({ value, description }),
      ),
      next: [
        { kind: 'value', name: 'setting-value', description: 'value to set' },
      ],
    },
  ];
}

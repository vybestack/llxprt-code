/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fzf, type FzfResultItem } from 'fzf';
import type {
  Option,
  CompleterFn,
  TokenInfo,
} from '../commands/schema/types.js';
import type { CommandContext } from '../commands/types.js';

export interface FuzzyFilterOptions {
  enableFuzzy?: boolean;
}

/**
 * Filters completions using either fuzzy matching or exact prefix matching.
 *
 * @param options - The list of options to filter
 * @param query - The search query
 * @param filterOptions - Options controlling the filtering behavior
 * @returns Filtered list of options
 */
export function filterCompletions(
  options: readonly Option[],
  query: string,
  filterOptions: FuzzyFilterOptions,
): readonly Option[] {
  // Return all items if query is empty
  if (!query || query.length === 0) {
    return options;
  }

  const enableFuzzy = filterOptions.enableFuzzy ?? true;

  if (enableFuzzy) {
    // Use fzf for fuzzy matching
    const fzf = new Fzf(options, {
      selector: (item: Option) => item.value,
      casing: 'case-insensitive',
    });

    const results = fzf.find(query);
    return results.map((result: FzfResultItem<Option>) => result.item);
  }
  // Use exact prefix matching
  const lowerQuery = query.toLowerCase();
  return options.filter((option) =>
    option.value.toLowerCase().startsWith(lowerQuery),
  );
}

/**
 * Filters a string array using either fuzzy matching or exact prefix matching.
 *
 * @param items - The list of strings to filter
 * @param query - The search query
 * @param filterOptions - Options controlling the filtering behavior
 * @returns Filtered list of strings
 */
export function filterStrings(
  items: readonly string[],
  query: string,
  filterOptions: FuzzyFilterOptions,
): readonly string[] {
  // Return all items if query is empty
  if (!query || query.length === 0) {
    return items;
  }

  const enableFuzzy = filterOptions.enableFuzzy ?? true;

  if (enableFuzzy) {
    // Use fzf for fuzzy matching
    const fzf = new Fzf(items, {
      casing: 'case-insensitive',
    });

    const results = fzf.find(query);
    return results.map((result: FzfResultItem<string>) => result.item);
  }
  // Use exact prefix matching
  const lowerQuery = query.toLowerCase();
  return items.filter((item) => item.toLowerCase().startsWith(lowerQuery));
}

export function getFuzzyEnabled(setting: boolean | undefined): boolean {
  return setting ?? true;
}

export function withFuzzyFilter(
  baseCompleter: CompleterFn,
  readFuzzyFiltering: () => boolean,
): CompleterFn {
  return async (
    ctx: CommandContext,
    partial: string,
    tokens: TokenInfo,
  ): Promise<readonly Option[]> => {
    const allItems = await baseCompleter(ctx, partial, tokens);
    return filterCompletions(allItems, partial, {
      enableFuzzy: readFuzzyFiltering(),
    });
  };
}

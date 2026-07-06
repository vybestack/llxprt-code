/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';

import type { Suggestion } from '../components/SuggestionsDisplay.js';
import { useAtCompletion } from './useAtCompletion.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

// Test harness to capture the state from the hook's callbacks.
export function useTestHarnessForAtCompletion(
  enabled: boolean,
  pattern: string,
  config: CliUiRuntime | undefined,
  cwd: string,
) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useAtCompletion({
    enabled,
    pattern,
    config,
    cwd,
    setSuggestions,
    setIsLoadingSuggestions,
  });

  return { suggestions, isLoadingSuggestions };
}

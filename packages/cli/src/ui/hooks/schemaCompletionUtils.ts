/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Suggestion } from '../components/SuggestionsDisplay.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { createCompletionHandler } from '../commands/schema/index.js';

type RuntimeCompletionResult = {
  hint?: string;
};

/**
 * Handles schema-based completion for a command.
 */
export async function handleSchemaCompletion(
  leafCommand: SlashCommand,
  commandContext: CommandContext,
  argString: string,
  completedArgsForSchema: string[],
  argumentPartial: string,
  commandPathLength: number,
  currentLine: string,
): Promise<{
  suggestions: Suggestion[];
  hint: string;
}> {
  const schemaHandler = createCompletionHandler(leafCommand.schema!);

  const completionResult = await schemaHandler(
    commandContext,
    {
      args: argString,
      completedArgs: completedArgsForSchema,
      partialArg: argumentPartial,
      commandPathLength,
    },
    currentLine,
  );

  const finalSuggestions = completionResult.suggestions.map((s) => ({
    label: s.value,
    value: s.value,
    description: s.description,
  }));

  const hint = (completionResult as RuntimeCompletionResult).hint ?? '';

  return { suggestions: finalSuggestions, hint };
}

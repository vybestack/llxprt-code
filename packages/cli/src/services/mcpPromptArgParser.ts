/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PromptArgument } from '@modelcontextprotocol/sdk/types.js';

/**
 * The result of parsing named MCP prompt arguments (--key="value") out of the
 * raw user input. `argValues` holds the named key/value pairs and
 * `positionalTokens` holds the raw positional text fragments found between
 * (and around) the named arguments.
 */
interface ExtractedArgs {
  readonly argValues: ReadonlyMap<string, string>;
  readonly positionalTokens: readonly string[];
}

/**
 * Extracts named arguments (`--key="value"` or `--key=value`) from the raw
 * user input string. Any text between named arguments is captured as raw
 * positional token fragments for later positional parsing.
 */
export function extractNamedArgs(userArgs: string): ExtractedArgs {
  const argValues = new Map<string, string>();
  const positionalParts: string[] = [];

  // Issue #2114: hoist to a const source (clears sonarjs/regular-expr) and
  // add explicit upper bounds to unbounded quantifiers (clears
  // sonarjs/slow-regex) keeping the SAME character classes. Matches
  // --key="quoted value" or --key=bare-value; the quoted branch allows
  // escaped characters (\\.) and non-quote/non-backslash chars.
  const NAMED_ARG_REGEX_SOURCE =
    '--([^=]{1,4096})=(?:"((?:\\\\.|[^"\\\\]){0,8192})"|([^ ]{1,4096}))';
  const namedArgRegex = new RegExp(NAMED_ARG_REGEX_SOURCE, 'g');
  let match;
  let lastIndex = 0;

  while ((match = namedArgRegex.exec(userArgs)) !== null) {
    const key = match[1];
    const value = (match.at(2) ?? match.at(3) ?? '').replace(/\\(.)/g, '$1');

    argValues.set(key, value);
    if (match.index > lastIndex) {
      positionalParts.push(userArgs.substring(lastIndex, match.index));
    }
    lastIndex = namedArgRegex.lastIndex;
  }

  if (lastIndex < userArgs.length) {
    positionalParts.push(userArgs.substring(lastIndex));
  }

  return { argValues, positionalTokens: positionalParts };
}

/**
 * Tokenizes a positional-arguments string into individual positional values,
 * honoring double-quoted segments (with escape processing) and unquoted
 * whitespace-delimited tokens.
 */
export function parsePositionalTokens(text: string): string[] {
  const positionalArgs: string[] = [];
  // Issue #2114: hoist to a const source (clears sonarjs/regular-expr).
  // Matches either a double-quoted string (with escapes) or a bare token.
  const POSITIONAL_ARG_REGEX_SOURCE = '(?:"((?:\\\\.|[^"\\\\])*)"|([^ ]+))';
  const positionalArgRegex = new RegExp(POSITIONAL_ARG_REGEX_SOURCE, 'g');
  let match;
  while ((match = positionalArgRegex.exec(text)) !== null) {
    positionalArgs.push(
      (match.at(1) ?? match.at(2) ?? '').replace(/\\(.)/g, '$1'),
    );
  }
  return positionalArgs;
}

/**
 * Determines which declared prompt arguments are required but unfilled after
 * named-argument extraction has populated `promptInputs`.
 */
function selectUnfilledRequiredArgs(
  promptArgs: readonly PromptArgument[],
  promptInputs: Record<string, unknown>,
): PromptArgument[] {
  const unfilled: PromptArgument[] = [];
  for (const arg of promptArgs) {
    if (arg.required === true && promptInputs[arg.name] === undefined) {
      unfilled.push(arg);
    }
  }
  return unfilled;
}

/**
 * Assigns positional token values to unfilled required arguments, or returns
 * an Error describing the missing arguments. When exactly one required
 * argument is unfilled, all positional tokens are joined into it (preserving
 * the legacy multi-word single-argument behavior). Otherwise positional tokens
 * fill arguments positionally and any shortfall is reported as missing.
 */
export function assignArgsToPrompt(
  argValues: ReadonlyMap<string, string>,
  positionalTokens: readonly string[],
  promptArgs: readonly PromptArgument[],
): Record<string, unknown> | Error {
  const promptInputs: Record<string, unknown> = {};

  for (const arg of promptArgs) {
    const namedValue = argValues.get(arg.name);
    if (namedValue !== undefined && namedValue !== '') {
      promptInputs[arg.name] = namedValue;
    }
  }

  const unfilledArgs = selectUnfilledRequiredArgs(promptArgs, promptInputs);
  if (unfilledArgs.length === 0) {
    return promptInputs;
  }

  if (unfilledArgs.length === 1) {
    // Single unfilled required arg: if no positional tokens were provided,
    // the required argument is missing. Otherwise join all positional tokens
    // as one value (preserving legacy multi-word single-argument behavior).
    if (positionalTokens.length === 0) {
      const missingName = `--${unfilledArgs[0].name}`;
      return new Error(`Missing required argument(s): ${missingName}`);
    }
    promptInputs[unfilledArgs[0].name] = positionalTokens.join(' ');
    return promptInputs;
  }

  const missingArgs: string[] = [];
  for (let i = 0; i < unfilledArgs.length; i++) {
    if (positionalTokens.length > i) {
      promptInputs[unfilledArgs[i].name] = positionalTokens[i];
    } else {
      missingArgs.push(unfilledArgs[i].name);
    }
  }

  if (missingArgs.length > 0) {
    const missingArgNames = missingArgs.map((name) => `--${name}`).join(', ');
    return new Error(`Missing required argument(s): ${missingArgNames}`);
  }

  return promptInputs;
}

/**
 * Parses the `userArgs` string representing the prompt arguments (all the text
 * after the command) into a record matching the declared `promptArgs` shape.
 *
 * Extracted from McpPromptLoader so the parsing phases are independently
 * testable and the regex patterns are isolated to this module.
 */
export function parsePromptArgs(
  userArgs: string,
  promptArgs: PromptArgument[] | undefined,
): Record<string, unknown> | Error {
  const { argValues, positionalTokens } = extractNamedArgs(userArgs);
  const positionalArgsString = positionalTokens.join('').trim();
  const positionalTokensParsed = parsePositionalTokens(positionalArgsString);

  if (!promptArgs || promptArgs.length === 0) {
    return {};
  }

  return assignArgsToPrompt(argValues, positionalTokensParsed, promptArgs);
}

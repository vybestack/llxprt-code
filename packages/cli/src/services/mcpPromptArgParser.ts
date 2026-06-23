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

function unescapeBackslashSequences(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\' && index + 1 < value.length) {
      index += 1;
    }
    result += value[index];
  }
  return result;
}

function readQuotedValue(
  text: string,
  start: number,
): { value: string; end: number } {
  let raw = '';
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      raw += char + text[index + 1];
      index += 2;
      continue;
    }
    if (char === '"') {
      return { value: unescapeBackslashSequences(raw), end: index + 1 };
    }
    raw += char;
    index += 1;
  }
  return { value: unescapeBackslashSequences(raw), end: text.length };
}

function readBareValue(
  text: string,
  start: number,
): { value: string; end: number } {
  let end = start;
  let value = '';
  while (end < text.length && text[end] !== ' ') {
    if (text[end] === '\\' && end + 1 < text.length) {
      end += 1;
    }
    value += text[end];
    end += 1;
  }
  return { value, end };
}

function readToken(
  text: string,
  start: number,
): { value: string; end: number } {
  if (text[start] === '"') {
    return readQuotedValue(text, start);
  }
  return readBareValue(text, start);
}

function findNextNamedArg(
  text: string,
  start: number,
): { argStart: number; equalsIndex: number } | null {
  const argStart = text.indexOf('--', start);
  if (argStart === -1) {
    return null;
  }
  const equalsIndex = text.indexOf('=', argStart + 2);
  if (equalsIndex === -1) {
    return null;
  }
  return { argStart, equalsIndex };
}

/**
 * Extracts named arguments (`--key="value"` or `--key=value`) from the raw
 * user input string. Any text between named arguments is captured as raw
 * positional token fragments for later positional parsing.
 */
export function extractNamedArgs(userArgs: string): ExtractedArgs {
  const argValues = new Map<string, string>();
  const positionalParts: string[] = [];

  let lastIndex = 0;
  let searchIndex = 0;
  let nextNamedArg = findNextNamedArg(userArgs, searchIndex);
  while (nextNamedArg !== null) {
    const { argStart, equalsIndex } = nextNamedArg;
    const key = userArgs.slice(argStart + 2, equalsIndex);
    const { value, end } = readToken(userArgs, equalsIndex + 1);

    argValues.set(key, value);
    if (argStart > lastIndex) {
      positionalParts.push(userArgs.substring(lastIndex, argStart));
    }
    lastIndex = end;
    searchIndex = end;
    nextNamedArg = findNextNamedArg(userArgs, searchIndex);
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
  let index = 0;
  while (index < text.length) {
    while (index < text.length && text[index] === ' ') {
      index += 1;
    }
    if (index >= text.length) {
      break;
    }
    const token = readToken(text, index);
    positionalArgs.push(token.value);
    index = token.end;
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

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Argument parsing and normalization helpers extracted from TextToolCallParser
 * to keep the main parser file under the max-lines limit.
 */

import { DebugLogger } from '../debug/index.js';
import {
  parseAttributeValue,
  readQuotedAttributeValue,
} from './tool-call-parser-utils.js';
import {
  collapseMultipleNewlines,
  decodeHtmlEntities,
  extractGenericXmlTags,
  extractParameterTags,
  extractSimpleJsonObject,
  isIdentifierChar,
  isWhitespaceChar,
  removeAllOccurrences,
  repairJsonInnerQuotes,
  splitByWhitespace,
  stripBetweenTags,
  stripClosingUseTags,
  stripTrailingOpenJsonArgs,
  stripTrailingOpenToolCall,
} from './text-tool-call-helpers.js';

const logger = new DebugLogger('llxprt:parser:textToolCall');

export function removeMatchedRanges(
  content: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  if (ranges.length === 0) {
    return content;
  }

  const sorted = ranges
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (merged.length > 0 && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  let cursor = 0;
  const pieces: string[] = [];
  for (const range of merged) {
    if (cursor < range.start) {
      pieces.push(content.slice(cursor, range.start));
    }
    cursor = Math.max(cursor, range.end);
  }
  pieces.push(content.slice(cursor));

  return pieces.join('');
}

export function postProcessCleanedContent(content: string): string {
  let result = content;

  result = stripBetweenTags(result, '<tool_call>', '</tool_call>');
  result = stripBetweenTags(result, '<function_calls>', '</function_calls>');
  result = stripBetweenTags(result, '<invoke', '</invoke>');
  result = stripBetweenTags(result, '<tool>', '</tool>');
  result = removeAllOccurrences(result, '[TOOL_REQUEST]');
  result = removeAllOccurrences(result, '[TOOL_REQUEST_END]');
  result = removeAllOccurrences(result, '<|im_start|>assistant');
  result = removeAllOccurrences(result, '<|im_end|>');
  result = stripClosingUseTags(result);
  result = stripTrailingOpenToolCall(result);
  result = stripTrailingOpenJsonArgs(result);
  result = removeKeyValueThinkArtifact(result);
  result = collapseMultipleNewlines(result);

  return result.trim();
}

function removeKeyValueThinkArtifact(content: string): string {
  const keyValueMarker = String.fromCodePoint(0x2728);
  let result = content;
  for (const whitespace of ['', ' ', '\t', '\n', '\r']) {
    result = removeAllOccurrences(
      result,
      keyValueMarker + whitespace + '<think>',
    );
  }
  return result;
}

export function normalizeArguments(
  args: string | Record<string, unknown>,
  toolName: string,
  fullMatch: string,
): Record<string, unknown> | null {
  if (typeof args !== 'string') {
    return applyToolSpecificNormalizations(args, toolName);
  }

  try {
    // Try JSON first: valid JSON strings may contain angle brackets
    // (e.g. {"query":"<div>weather</div>"}) which would otherwise be
    // misrouted to XML parsing.
    return applyToolSpecificNormalizations(JSON.parse(args), toolName);
  } catch (error) {
    // Not valid JSON — try XML if angle-bracket markers are present.
    if (
      args.includes('<parameter') ||
      (args.includes('<') && args.includes('>'))
    ) {
      try {
        return parseXMLParameters(args);
      } catch (xmlError) {
        // Fall through to JSON repair attempts below.
        return repairAndParseArgs(args, toolName, fullMatch, xmlError);
      }
    }
    // No XML markers either — attempt JSON repair on the original error.
    return repairAndParseArgs(args, toolName, fullMatch, error);
  }
}

function repairAndParseArgs(
  args: string,
  toolName: string,
  fullMatch: string,
  error: unknown,
): Record<string, unknown> | null {
  const repaired = tryRepairJson(args);
  if (repaired) {
    try {
      return applyToolSpecificNormalizations(JSON.parse(repaired), toolName);
    } catch {
      // ignore and fall through
    }
  }

  const simpleJson = extractSimpleJsonObject(args);
  if (simpleJson !== null) {
    try {
      return JSON.parse(simpleJson);
    } catch {
      // fall through to logging
    }
  }

  logger.error(
    `Failed to parse tool arguments for ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
  );
  logger.error(`Raw arguments excerpt: ${fullMatch.slice(0, 200)}`);
  return null;
}

function applyToolSpecificNormalizations(
  args: Record<string, unknown>,
  toolName: string,
): Record<string, unknown> {
  const normalizedTool = toolName.trim().toLowerCase();
  if (normalizedTool === 'todo_write') {
    const todos = args['todos'];
    if (Array.isArray(todos)) {
      args['todos'] = todos.map((todo, index) =>
        normalizeTodoEntry(todo, index),
      );
    }
  }
  return args;
}

function normalizeTodoEntry(
  todo: unknown,
  index: number,
): Record<string, unknown> {
  const normalized =
    todo != null && typeof todo === 'object'
      ? { ...(todo as Record<string, unknown>) }
      : {};

  if (
    normalized.content === undefined ||
    normalized.content === null ||
    normalized.content === ''
  ) {
    normalized.content =
      typeof todo === 'string' && todo.trim().length > 0
        ? todo
        : `Task ${index + 1}`;
  } else {
    normalized.content = String(normalized.content);
  }

  normalized.status = normalizeTodoStatus(normalized.status);

  return normalized;
}

function normalizeTodoStatus(
  value: unknown,
): 'pending' | 'in_progress' | 'completed' {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'in_progress' || normalized === 'completed') {
      return normalized;
    }
    if (normalized === 'pending') {
      return 'pending';
    }
  }
  return 'pending';
}

export function extractBalancedSegment(
  content: string,
  startIndex: number,
  openChar: '{' | '[' | '(',
  closeChar: '}' | ']' | ')',
): { segment: string; endIndex: number } | null {
  if (content[startIndex] !== openChar) {
    return null;
  }

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escapeNext = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    const state = processBalancedChar(
      char,
      escapeNext,
      inString,
      openChar,
      closeChar,
      depth,
    );
    if (state.exited) {
      return {
        segment: content.slice(startIndex, i + 1),
        endIndex: i + 1,
      };
    }
    escapeNext = state.escapeNext;
    inString = state.inString;
    depth += state.depthDelta;
  }

  return null;
}

function processBalancedChar(
  char: string,
  escapeNext: boolean,
  inString: '"' | "'" | null,
  openChar: string,
  closeChar: string,
  depth: number,
): {
  depthDelta: number;
  inString: '"' | "'" | null;
  escapeNext: boolean;
  exited: boolean;
} {
  if (escapeNext) {
    return { depthDelta: 0, inString, escapeNext: false, exited: false };
  }
  if (char === '\\' && inString) {
    return { depthDelta: 0, inString, escapeNext: true, exited: false };
  }
  if (inString) {
    if (char === inString) {
      return {
        depthDelta: 0,
        inString: null,
        escapeNext: false,
        exited: false,
      };
    }
    return { depthDelta: 0, inString, escapeNext: false, exited: false };
  }
  if (char === '"' || char === "'") {
    return {
      depthDelta: 0,
      inString: char === '"' ? '"' : "'",
      escapeNext: false,
      exited: false,
    };
  }
  if (char === openChar) {
    return { depthDelta: 1, inString, escapeNext: false, exited: false };
  }
  if (char === closeChar && depth === 1) {
    return { depthDelta: 0, inString, escapeNext: false, exited: true };
  }
  if (char === closeChar) {
    return { depthDelta: -1, inString, escapeNext: false, exited: false };
  }
  return { depthDelta: 0, inString, escapeNext: false, exited: false };
}

function tryRepairJson(args: string): string | null {
  try {
    JSON.parse(args);
    return args;
  } catch {
    const repaired = repairJsonInnerQuotes(args);
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      return null;
    }
  }
}

export function parseKeyValuePairs(str: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const parts = splitByWhitespace(str.trim());

  for (let i = 0; i < parts.length; i += 2) {
    if (i + 1 >= parts.length) {
      continue;
    }
    const result = parseKeyValuePart(parts, i);
    if (result.skip > 0) {
      i += result.skip;
    }
    args[result.key] = result.value;
  }

  return args;
}

function parseKeyValuePart(
  parts: string[],
  i: number,
): { key: string; value: string | number | boolean; skip: number } {
  const key = parts[i];
  let value: string | number | boolean = parts[i + 1];
  let skip = 0;

  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    let endIndex = i + 1;
    while (endIndex < parts.length && !parts[endIndex].endsWith(quote)) {
      endIndex++;
    }
    if (endIndex < parts.length) {
      value = parts.slice(i + 1, endIndex + 1).join(' ');
      value = value.slice(1, -1);
      skip = endIndex - 1 - i;
    }
  }

  if (!isNaN(Number(value))) {
    value = Number(value);
  } else if (value === 'true' || value === 'false') {
    value = value === 'true';
  }
  return { key, value, skip };
}

export function parseAttributeArguments(
  attributeText: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const cursor = { pos: 0 };
  const text = attributeText;
  const length = text.length;

  while (cursor.pos < length) {
    const step = processAttributeStep(text, length, cursor);
    if (step.handled) {
      args[step.key] = step.value;
    }
  }

  return args;
}

function processAttributeStep(
  text: string,
  length: number,
  cursor: { pos: number },
): { handled: boolean; key: string; value: unknown } {
  skipWhitespaceInCursor(text, length, cursor);
  const key = readIdentifierInCursor(text, length, cursor);
  if (!key) {
    cursor.pos++;
    return { handled: false, key: '', value: undefined };
  }

  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey === 'with' ||
    normalizedKey === 'and' ||
    normalizedKey === 'then'
  ) {
    return { handled: false, key: '', value: undefined };
  }

  skipWhitespaceInCursor(text, length, cursor);
  if (text.charAt(cursor.pos) !== '=') {
    cursor.pos++;
    return { handled: false, key: '', value: undefined };
  }
  cursor.pos++;
  skipWhitespaceInCursor(text, length, cursor);

  const quote = text.charAt(cursor.pos);
  if (quote !== '"' && quote !== "'") {
    cursor.pos++;
    return { handled: false, key: '', value: undefined };
  }
  cursor.pos++;

  const { value, nextIndex } = readQuotedAttributeValue(
    text,
    cursor.pos,
    quote,
  );
  cursor.pos = nextIndex;
  return { handled: true, key, value: parseAttributeValue(value) };
}

function skipWhitespaceInCursor(
  text: string,
  length: number,
  cursor: { pos: number },
): void {
  while (cursor.pos < length && isWhitespaceChar(text.charAt(cursor.pos))) {
    cursor.pos++;
  }
}

function readIdentifierInCursor(
  text: string,
  length: number,
  cursor: { pos: number },
): string {
  const start = cursor.pos;
  while (cursor.pos < length && isIdentifierChar(text.charAt(cursor.pos))) {
    cursor.pos++;
  }
  return text.slice(start, cursor.pos);
}

function parseXMLParameters(xmlContent: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  const paramArgs = extractParameterTags(xmlContent);
  for (const [key, value] of Object.entries(paramArgs)) {
    args[key] = parseValue(value.trim());
  }

  if (Object.keys(args).length === 0) {
    const genericArgs = extractGenericXmlTags(xmlContent);
    for (const [key, value] of Object.entries(genericArgs)) {
      args[key] = parseValue(value.trim());
    }
  }

  return args;
}

export function parseValue(value: string): string | number | boolean {
  if (value !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  return decodeHtmlEntities(value);
}

export function findTagClose(content: string, fromIndex: number): number {
  let inQuote: '"' | "'" | null = null;
  for (let i = fromIndex; i < content.length; i++) {
    const char = content[i];
    if (inQuote !== null) {
      if (char === inQuote && content[i - 1] !== '\\') {
        inQuote = null;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

export function extractToolNameAndAttributes(header: string): {
  toolName: string;
  attributeText: string;
} {
  let index = 0;
  const length = header.length;

  while (index < length && isWhitespaceChar(header.charAt(index))) {
    index++;
  }
  const nameStart = index;
  while (index < length && isIdentifierChar(header.charAt(index))) {
    index++;
  }
  const toolName = header.slice(nameStart, index).trim();
  const attributeText = header.slice(index);

  return { toolName, attributeText };
}

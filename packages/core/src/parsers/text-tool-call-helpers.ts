/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * String-processing helpers for TextToolCallParser that avoid regex usage
 * (required because sonarjs/regular-expr flags all regex literals).
 */

export function isWhitespaceChar(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

export function isDigitChar(char: string): boolean {
  return char >= '0' && char <= '9';
}

export function isAlphaChar(char: string): boolean {
  if (char >= 'a' && char <= 'z') {
    return true;
  }
  if (char >= 'A' && char <= 'Z') {
    return true;
  }
  return char === '_';
}

export function isIdentifierChar(char: string): boolean {
  if (isAlphaChar(char) || isDigitChar(char)) {
    return true;
  }
  return char === '.' || char === '-';
}

/** Removes all occurrences of a literal substring. */
export function removeAllOccurrences(haystack: string, needle: string): string {
  if (needle.length === 0) {
    return haystack;
  }
  return haystack.split(needle).join('');
}

/** Strips all content between startTag (inclusive) and endTag (inclusive). */
export function stripBetweenTags(
  content: string,
  startTag: string,
  endTag: string,
): string {
  let result = '';
  let cursor = 0;
  let pos = content.indexOf(startTag, cursor);
  while (pos !== -1) {
    result += content.substring(cursor, pos);
    const endPos = content.indexOf(endTag, pos + startTag.length);
    if (endPos === -1) {
      cursor = pos;
      break;
    }
    cursor = endPos + endTag.length;
    pos = content.indexOf(startTag, cursor);
  }
  result += content.substring(cursor);
  return result;
}

/** Strips closing use tags: `</use_...>` and `</use>`. */
export function stripClosingUseTags(content: string): string {
  let result = '';
  let cursor = 0;
  let pos = content.indexOf('</use', cursor);
  while (pos !== -1) {
    result += content.substring(cursor, pos);
    const closeIdx = content.indexOf('>', pos);
    if (closeIdx === -1) {
      cursor = pos;
      break;
    }
    cursor = closeIdx + 1;
    pos = content.indexOf('</use', cursor);
  }
  result += content.substring(cursor);
  return result;
}

/** Strips a trailing `<tool_call>{...` fragment at end of content. */
export function stripTrailingOpenToolCall(content: string): string {
  const tagIdx = content.lastIndexOf('<tool_call>');
  if (tagIdx === -1) {
    return content;
  }
  const afterTagStart = tagIdx + '<tool_call>'.length;
  if (content.indexOf('</tool_call>', afterTagStart) !== -1) {
    return content;
  }
  if (!isWhitespaceChar(content[afterTagStart])) {
    return content;
  }
  const objectStart = skipWhitespace(content, afterTagStart);
  if (content[objectStart] !== '{') {
    return content;
  }
  if (hasBalancedObjectClose(content, objectStart)) {
    return content;
  }
  return content.substring(0, tagIdx);
}

/** Strips a trailing JSON tool-call fragment with an open arguments object. */
export function stripTrailingOpenJsonArgs(content: string): string {
  let markerIdx = content.lastIndexOf('{');
  while (markerIdx !== -1) {
    if (isOpenJsonToolCallFragment(content, markerIdx)) {
      return content.substring(0, markerIdx);
    }
    markerIdx = content.lastIndexOf('{', markerIdx - 1);
  }
  return content;
}

function isOpenJsonToolCallFragment(
  content: string,
  markerIdx: number,
): boolean {
  let cursor = markerIdx + 1;
  const nameKey = readJsonString(content, skipWhitespace(content, cursor));
  if (nameKey === null || nameKey.value !== 'name') {
    return false;
  }
  cursor = skipWhitespace(content, nameKey.end);
  if (content[cursor] !== ':') {
    return false;
  }
  const nameValue = readJsonString(
    content,
    skipWhitespace(content, cursor + 1),
  );
  if (nameValue === null) {
    return false;
  }
  cursor = skipWhitespace(content, nameValue.end);
  if (content[cursor] === ',') {
    cursor = skipWhitespace(content, cursor + 1);
  }
  const argumentsKey = readJsonString(content, cursor);
  if (argumentsKey === null || argumentsKey.value !== 'arguments') {
    return false;
  }
  cursor = skipWhitespace(content, argumentsKey.end);
  if (content[cursor] !== ':') {
    return false;
  }
  const argumentsStart = skipWhitespace(content, cursor + 1);
  if (content[argumentsStart] !== '{') {
    return false;
  }
  return !hasBalancedObjectClose(content, markerIdx);
}

function hasBalancedObjectClose(content: string, objectStart: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let cursor = objectStart; cursor < content.length; cursor++) {
    const char = content[cursor];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = inString;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString && char === '{') {
      depth++;
    } else if (!inString && char === '}') {
      depth--;
      if (depth === 0) {
        return true;
      }
    }
  }

  return false;
}

export function skipWhitespace(content: string, start: number): number {
  let cursor = start;
  while (cursor < content.length && isWhitespaceChar(content[cursor])) {
    cursor++;
  }
  return cursor;
}

function readJsonString(
  content: string,
  start: number,
): { value: string; end: number } | null {
  if (content[start] !== '"') {
    return null;
  }
  let value = '';
  let cursor = start + 1;
  while (cursor < content.length) {
    const char = content[cursor];
    if (char === '\\') {
      value += content.substring(cursor, cursor + 2);
      cursor += 2;
      continue;
    }
    if (char === '"') {
      return { value, end: cursor + 1 };
    }
    value += char;
    cursor++;
  }
  return null;
}

/** Collapses runs of 2+ newlines into a single newline. */
export function collapseMultipleNewlines(content: string): string {
  let result = '';
  let newlineCount = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      newlineCount++;
      if (newlineCount <= 1) {
        result += '\n';
      }
    } else {
      newlineCount = 0;
      result += content[i];
    }
  }
  return result;
}

const TOOL_CALL_MARKERS = [
  '[TOOL_REQUEST',
  'tool_call:',
  '[END_TOOL_REQUEST]',
  '{"name":',
  '<tool_call>',
  '<invoke',
  '<tool>',
  '<use ',
  '<use_',
];

export function hasAnyToolCallMarker(content: string): boolean {
  for (const marker of TOOL_CALL_MARKERS) {
    if (content.includes(marker)) {
      return true;
    }
  }
  return hasJsonNameMarker(content);
}

function hasJsonNameMarker(content: string): boolean {
  let markerIdx = content.indexOf('{');
  while (markerIdx !== -1) {
    const key = readJsonString(content, skipWhitespace(content, markerIdx + 1));
    if (key?.value === 'name') {
      const cursor = skipWhitespace(content, key.end);
      if (content[cursor] === ':') {
        return true;
      }
    }
    markerIdx = content.indexOf('{', markerIdx + 1);
  }
  return false;
}

/** Splits a string by any whitespace runs, without using regex. */
export function splitByWhitespace(str: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < str.length; i++) {
    if (isWhitespaceChar(str[i])) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += str[i];
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

/** Extracts `<parameter name="key">value</parameter>` pairs without regex. */
export function extractParameterTags(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const openTag = '<parameter';
  const closeTag = '</parameter>';
  let cursor = 0;
  let pos = content.indexOf(openTag, cursor);
  while (pos !== -1) {
    const closeIdx = content.indexOf(closeTag, pos);
    if (closeIdx === -1) {
      break;
    }
    const segment = content.substring(pos, closeIdx + closeTag.length);
    const extracted = extractParameterNameValue(segment, closeTag);
    if (extracted !== null) {
      result[extracted.key] = extracted.value;
    }
    cursor = closeIdx + closeTag.length;
    pos = content.indexOf(openTag, cursor);
  }
  return result;
}

function extractParameterNameValue(
  segment: string,
  closeTag: string,
): { key: string; value: string } | null {
  const nameAttrIdx = segment.indexOf('name="');
  if (nameAttrIdx === -1) {
    return null;
  }
  const valueStart = nameAttrIdx + 'name="'.length;
  const valueEnd = segment.indexOf('"', valueStart);
  if (valueEnd === -1) {
    return null;
  }
  const key = segment.substring(valueStart, valueEnd);
  const contentStart = segment.indexOf('>', valueEnd);
  if (contentStart === -1) {
    return null;
  }
  const innerContent = segment.substring(
    contentStart + 1,
    segment.length - closeTag.length,
  );
  return { key, value: innerContent };
}

/** Extracts generic `<tag>value</tag>` pairs without regex. */
export function extractGenericXmlTags(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let cursor = 0;
  let pos = content.indexOf('<', cursor);
  while (pos !== -1) {
    const step = processGenericTagStep(content, pos, result);
    cursor = step.nextCursor;
    pos = content.indexOf('<', cursor);
  }
  return result;
}

function processGenericTagStep(
  content: string,
  pos: number,
  result: Record<string, string>,
): { nextCursor: number } {
  const openEnd = content.indexOf('>', pos);
  if (openEnd === -1) {
    return { nextCursor: content.length };
  }
  const tag = content.substring(pos + 1, openEnd);
  if (tag.length === 0 || tag.includes(' ') || tag.includes('/')) {
    return { nextCursor: openEnd + 1 };
  }
  const closeTag = `</${tag}>`;
  const closeIdx = content.indexOf(closeTag, openEnd + 1);
  if (closeIdx !== -1) {
    const value = content.substring(openEnd + 1, closeIdx);
    if (!(tag in result)) {
      result[tag] = value;
    }
    return { nextCursor: closeIdx + closeTag.length };
  }
  return { nextCursor: openEnd + 1 };
}

/** Decodes common HTML entities without using regex. */
export function decodeHtmlEntities(value: string): string {
  return value
    .split('&lt;')
    .join('<')
    .split('&gt;')
    .join('>')
    .split('&amp;')
    .join('&')
    .split('&quot;')
    .join('"')
    .split('&#39;')
    .join("'");
}

/** Extracts a simple JSON object `{...}` with no nested braces, without regex. */
export function extractSimpleJsonObject(str: string): string | null {
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  for (let i = 1; i < trimmed.length - 1; i++) {
    if (trimmed[i] === '{' || trimmed[i] === '}') {
      return null;
    }
  }
  return trimmed;
}

/** Finds the closing quote position for a JSON string value. */
function findClosingQuote(
  input: string,
  start: number,
): { index: number } | null {
  let end = start;
  while (end < input.length) {
    if (input[end] === '\\') {
      end += 2;
      continue;
    }
    if (input[end] === '"') {
      let checkIdx = end + 1;
      while (checkIdx < input.length && isWhitespaceChar(input[checkIdx])) {
        checkIdx++;
      }
      if (
        input[checkIdx] === ',' ||
        input[checkIdx] === '}' ||
        checkIdx === input.length
      ) {
        return { index: end };
      }
    }
    end++;
  }
  return null;
}

/**
 * Best-effort repair of unescaped inner quotes inside JSON string values.
 * Scans for `: "..."` patterns and escapes unescaped inner double quotes.
 */
export function repairJsonInnerQuotes(input: string): string {
  let result = '';
  let i = 0;
  while (i < input.length) {
    if (input[i] === ':') {
      result += ':';
      i++;
      while (i < input.length && isWhitespaceChar(input[i])) {
        result += input[i];
        i++;
      }
      const updated = processStringValue(input, i, result);
      result = updated.result;
      i = updated.index;
    } else {
      result += input[i];
      i++;
    }
  }
  return result;
}

function processStringValue(
  input: string,
  i: number,
  result: string,
): { result: string; index: number } {
  if (input[i] !== '"') {
    return { result, index: i };
  }
  result += '"';
  const valueStart = i + 1;
  const closing = findClosingQuote(input, valueStart);
  if (closing === null) {
    return { result: result + input.substring(i), index: input.length };
  }
  const rawValue = input.substring(valueStart, closing.index);
  let fixedValue = '';
  for (let j = 0; j < rawValue.length; j++) {
    if (rawValue[j] === '"' && rawValue[j - 1] !== '\\') {
      fixedValue += '\\"';
    } else {
      fixedValue += rawValue[j];
    }
  }
  result += fixedValue + '"';
  return { result, index: closing.index + 1 };
}

/** Extracts content from `<tagName>...</tagName>` (case-insensitive) without regex. */
export function extractTagContentCaseInsensitive(
  content: string,
  tagName: string,
): string | null {
  const lowerContent = content.toLowerCase();
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const openIdx = lowerContent.indexOf(openTag);
  if (openIdx === -1) {
    return null;
  }
  const contentStart = openIdx + openTag.length;
  const closeIdx = lowerContent.indexOf(closeTag, contentStart);
  if (closeIdx === -1) {
    return null;
  }
  return content.substring(contentStart, closeIdx);
}

/** Extracts key/value from a simple `<tag>value</tag>` line without regex. */
export function extractXmlTagPair(
  line: string,
): { key: string; value: string } | null {
  const openStart = line.indexOf('<');
  if (openStart === -1) {
    return null;
  }
  const openEnd = line.indexOf('>', openStart);
  if (openEnd === -1) {
    return null;
  }
  const key = line.substring(openStart + 1, openEnd);
  if (key.length === 0 || !isAlphaChar(key[0])) {
    return null;
  }
  const closeTag = `</${key}>`;
  const closeIdx = line.indexOf(closeTag, openEnd + 1);
  if (closeIdx === -1) {
    return null;
  }
  const value = line.substring(openEnd + 1, closeIdx);
  return { key, value };
}

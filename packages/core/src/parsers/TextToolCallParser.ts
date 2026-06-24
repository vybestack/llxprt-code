/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DebugLogger } from '../debug/index.js';
import {
  toTruthyString,
  truthyJsonValueOrEmptyObject,
} from './tool-call-parser-utils.js';
import {
  extractTagContentCaseInsensitive,
  extractXmlTagPair,
  hasAnyToolCallMarker,
  isDigitChar,
  isIdentifierChar,
  isWhitespaceChar,
  skipWhitespace,
} from './text-tool-call-helpers.js';
import {
  extractBalancedSegment,
  extractToolNameAndAttributes,
  findTagClose,
  normalizeArguments,
  parseAttributeArguments,
  parseKeyValuePairs,
  parseValue,
  postProcessCleanedContent,
  removeMatchedRanges,
} from './text-tool-call-arg-parsing.js';

const logger = new DebugLogger('llxprt:parser:textToolCall');

export interface TextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ITextToolCallParser {
  parse(content: string): {
    cleanedContent: string;
    toolCalls: TextToolCall[];
  };
}

interface MatchCandidate {
  start: number;
  end: number;
  toolName: string;
  rawArgs: string | Record<string, unknown>;
  fullMatch: string;
}

export class GemmaToolCallParser implements ITextToolCallParser {
  parse(content: string): {
    cleanedContent: string;
    toolCalls: TextToolCall[];
  } {
    // Quick check: if content doesn't contain any tool call markers, return early
    if (!hasAnyToolCallMarker(content)) {
      return { cleanedContent: content, toolCalls: [] };
    }

    const matches = this.collectMatches(content);
    const toolCalls: TextToolCall[] = [];
    const ranges: Array<{ start: number; end: number }> = [];

    for (const match of matches) {
      ranges.push({ start: match.start, end: match.end });
      const toolCall = this.tryBuildToolCall(match);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
    }

    const withoutMatches = removeMatchedRanges(content, ranges);
    const cleanedContent = postProcessCleanedContent(withoutMatches);

    return { cleanedContent, toolCalls };
  }

  private tryBuildToolCall(match: MatchCandidate): TextToolCall | null {
    if (!match.toolName) {
      return null;
    }
    const parsedArgs = normalizeArguments(
      match.rawArgs,
      match.toolName,
      match.fullMatch,
    );
    if (!parsedArgs) {
      return null;
    }
    return { name: match.toolName, arguments: parsedArgs };
  }

  private collectMatches(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [
      ...this.findBracketToolRequests(content),
      ...this.findJsonToolRequests(content),
      ...this.findXMLToolRequests(content),
      ...this.findInvokeToolRequests(content),
      ...this.findGenericXmlToolRequests(content),
      ...this.findUseToolRequests(content),
      ...this.findUseUnderscoreToolRequests(content),
      ...this.findKeyValueToolRequests(content),
    ];

    return matches.sort((a, b) => a.start - b.start);
  }

  private findBracketToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const startMarker = '[TOOL_REQUEST]';
    const endMarker = '[TOOL_REQUEST_END]';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(startMarker, searchIndex);
      if (start === -1) {
        break;
      }
      const result = this.tryParseBracketRequest(
        content,
        start,
        startMarker,
        endMarker,
      );
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private tryParseBracketRequest(
    content: string,
    start: number,
    startMarker: string,
    endMarker: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    const afterStart = start + startMarker.length;
    const endMarkerIndex = content.indexOf(endMarker, afterStart);
    if (endMarkerIndex === -1) {
      return { match: null, nextSearchIndex: content.length };
    }

    const segment = content.slice(afterStart, endMarkerIndex);
    const skipTo = endMarkerIndex + endMarker.length;

    // Parse tool name: skip whitespace, read until whitespace or '{'
    let nameStart = 0;
    while (nameStart < segment.length && isWhitespaceChar(segment[nameStart])) {
      nameStart++;
    }
    let nameEnd = nameStart;
    while (
      nameEnd < segment.length &&
      !isWhitespaceChar(segment[nameEnd]) &&
      segment[nameEnd] !== '{'
    ) {
      nameEnd++;
    }
    if (nameEnd === nameStart) {
      return { match: null, nextSearchIndex: skipTo };
    }
    const toolName = segment.slice(nameStart, nameEnd);

    const braceOffset = segment.indexOf('{', nameEnd);
    if (braceOffset === -1) {
      return { match: null, nextSearchIndex: skipTo };
    }

    const jsonStart = afterStart + braceOffset;
    const jsonSegment = extractBalancedSegment(content, jsonStart, '{', '}');
    if (!jsonSegment || jsonSegment.endIndex > endMarkerIndex) {
      return { match: null, nextSearchIndex: skipTo };
    }

    const fullEnd = endMarkerIndex + endMarker.length;
    return {
      match: {
        start,
        end: fullEnd,
        toolName,
        rawArgs: jsonSegment.segment,
        fullMatch: content.slice(start, fullEnd),
      },
      nextSearchIndex: fullEnd,
    };
  }

  private findJsonToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const endMarker = '[END_TOOL_REQUEST]';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const candidateIndex = this.findNextJsonNameObject(content, searchIndex);
      if (candidateIndex === -1) {
        break;
      }

      const startIndex = this.computeJsonStartIndex(content, candidateIndex);
      const result = this.tryParseJsonRequest(
        content,
        candidateIndex,
        startIndex,
        endMarker,
      );
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private findNextJsonNameObject(content: string, startIndex: number): number {
    let candidateIndex = content.indexOf('{', startIndex);
    while (candidateIndex !== -1) {
      const keyStart = skipWhitespace(content, candidateIndex + 1);
      const keyEnd = content.indexOf('"', keyStart + 1);
      if (
        content[keyStart] === '"' &&
        content.slice(keyStart + 1, keyEnd) === 'name'
      ) {
        const colonIndex = skipWhitespace(content, keyEnd + 1);
        if (content[colonIndex] === ':') {
          return candidateIndex;
        }
      }
      candidateIndex = content.indexOf('{', candidateIndex + 1);
    }
    return -1;
  }

  private computeJsonStartIndex(
    content: string,
    candidateIndex: number,
  ): number {
    let backPointer = candidateIndex;
    while (
      backPointer > 0 &&
      isWhitespaceChar(content.charAt(backPointer - 1))
    ) {
      backPointer--;
    }
    let digitPointer = backPointer;
    while (digitPointer > 0 && isDigitChar(content.charAt(digitPointer - 1))) {
      digitPointer--;
    }
    if (digitPointer < backPointer) {
      return digitPointer;
    }
    return candidateIndex;
  }

  private tryParseJsonRequest(
    content: string,
    candidateIndex: number,
    startIndex: number,
    endMarker: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    const jsonSegment = extractBalancedSegment(
      content,
      candidateIndex,
      '{',
      '}',
    );
    if (!jsonSegment) {
      return {
        match: null,
        nextSearchIndex: candidateIndex + 1,
      };
    }

    try {
      const parsed = JSON.parse(jsonSegment.segment);
      const toolName = toTruthyString(parsed.name);
      const argsText = JSON.stringify(
        truthyJsonValueOrEmptyObject(parsed.arguments),
      );
      const endMarkerIndex = content.indexOf(endMarker, jsonSegment.endIndex);
      if (toolName && endMarkerIndex !== -1) {
        const fullEnd = endMarkerIndex + endMarker.length;
        return {
          match: {
            start: startIndex,
            end: fullEnd,
            toolName,
            rawArgs: argsText,
            fullMatch: content.slice(startIndex, fullEnd),
          },
          nextSearchIndex: fullEnd,
        };
      }
    } catch (error) {
      logger.error(`Failed to parse structured tool call JSON: ${error}`);
    }

    return {
      match: null,
      nextSearchIndex: candidateIndex + 1,
    };
  }

  private findXMLToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const startTag = '<tool_call>';
    const endTag = '</tool_call>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(startTag, searchIndex);
      if (start === -1) {
        break;
      }
      const result = this.tryParseXmlTagRequest(
        content,
        start,
        startTag,
        endTag,
      );
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private tryParseXmlTagRequest(
    content: string,
    start: number,
    startTag: string,
    endTag: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    const end = content.indexOf(endTag, start + startTag.length);
    if (end === -1) {
      return { match: null, nextSearchIndex: content.length };
    }

    const innerContent = content.slice(start + startTag.length, end).trim();
    const fullEnd = end + endTag.length;

    const match = this.parseToolCallContent(
      innerContent,
      start,
      fullEnd,
      content.slice(start, fullEnd),
    );
    return { match, nextSearchIndex: fullEnd };
  }

  private parseToolCallContent(
    innerContent: string,
    start: number,
    end: number,
    fullMatch: string,
  ): MatchCandidate | null {
    // Option A: Try JSON parsing (Hermes format)
    try {
      const parsed = JSON.parse(innerContent);
      if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
        const toolName = toTruthyString(parsed.name);
        const args = truthyJsonValueOrEmptyObject(parsed.arguments);
        return {
          start,
          end,
          toolName,
          rawArgs: JSON.stringify(args),
          fullMatch,
        };
      }
    } catch {
      // Not valid JSON, continue trying XML format
    }

    // Option B: Try XML parsing
    const xmlResult = this.parseXmlContent(innerContent);
    if (xmlResult.toolName) {
      return {
        start,
        end,
        toolName: xmlResult.toolName,
        rawArgs: JSON.stringify(xmlResult.args),
        fullMatch,
      };
    }

    // All parsing failed, return null
    return null;
  }

  private parseXmlContent(xmlContent: string): {
    toolName: string;
    args: Record<string, unknown>;
  } {
    const result = { toolName: '', args: {} as Record<string, unknown> };

    const lines = xmlContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return result;
    }

    const potentialToolName = lines[0];
    if (
      !potentialToolName ||
      potentialToolName.includes('{') ||
      potentialToolName.includes('}')
    ) {
      return result;
    }

    result.toolName = potentialToolName;
    this.parseXmlArgLines(lines, result.args);
    return result;
  }

  private parseXmlArgLines(
    lines: string[],
    args: Record<string, unknown>,
  ): void {
    for (let i = 1; i < lines.length; i++) {
      const parsed = extractXmlTagPair(lines[i]);
      if (parsed !== null) {
        args[parsed.key] = parseValue(parsed.value.trim());
      }
    }
  }

  private findInvokeToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const tagPrefix = '<invoke';
    const closing = '</invoke>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(tagPrefix, searchIndex);
      if (start === -1) {
        break;
      }
      const result = this.tryParseInvokeRequest(
        content,
        start,
        tagPrefix,
        closing,
      );
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private tryParseInvokeRequest(
    content: string,
    start: number,
    tagPrefix: string,
    closing: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    const tagEnd = findTagClose(content, start + tagPrefix.length);
    if (tagEnd === -1) {
      return { match: null, nextSearchIndex: content.length };
    }

    const header = content.slice(start + tagPrefix.length, tagEnd);
    const attributes = parseAttributeArguments(header);
    const toolNameValue = attributes.name;
    const toolName =
      typeof toolNameValue === 'string' ? toolNameValue.trim() : '';

    const bodyStart = tagEnd + 1;
    const closingIndex = content.indexOf(closing, bodyStart);
    if (!toolName || closingIndex === -1) {
      return { match: null, nextSearchIndex: bodyStart };
    }

    const fullEnd = closingIndex + closing.length;
    return {
      match: {
        start,
        end: fullEnd,
        toolName,
        rawArgs: content.slice(bodyStart, closingIndex),
        fullMatch: content.slice(start, fullEnd),
      },
      nextSearchIndex: fullEnd,
    };
  }

  private findGenericXmlToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const startTag = '<tool>';
    const endTag = '</tool>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(startTag, searchIndex);
      if (start === -1) {
        break;
      }
      const result = this.tryParseGenericXmlRequest(
        content,
        start,
        startTag,
        endTag,
      );
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private tryParseGenericXmlRequest(
    content: string,
    start: number,
    startTag: string,
    endTag: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    const end = content.indexOf(endTag, start + startTag.length);
    if (end === -1) {
      return { match: null, nextSearchIndex: content.length };
    }

    const inner = content.slice(start + startTag.length, end);
    const skipTo = end + endTag.length;

    const nameValue = extractTagContentCaseInsensitive(inner, 'name');
    const argsValue = extractTagContentCaseInsensitive(inner, 'arguments');
    if (nameValue === null || argsValue === null) {
      return { match: null, nextSearchIndex: skipTo };
    }

    return {
      match: {
        start,
        end: skipTo,
        toolName: nameValue.trim(),
        rawArgs: argsValue,
        fullMatch: content.slice(start, skipTo),
      },
      nextSearchIndex: skipTo,
    };
  }

  private findUseToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const prefix = '<use';
    const closing = '</use>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(prefix, searchIndex);
      if (start === -1) {
        break;
      }
      // Ensure <use is a complete tag, not <use_foo> etc. The character after
      // the prefix must be '>' or whitespace.
      const afterPrefix = content[start + prefix.length];
      const isCompleteTag =
        afterPrefix === '>' || isWhitespaceChar(afterPrefix);
      if (isCompleteTag) {
        const result = this.tryParseUseRequest(content, start, prefix, closing);
        if (result.match) {
          matches.push(result.match);
        }
        searchIndex = result.nextSearchIndex;
      } else {
        searchIndex = start + prefix.length;
      }
    }

    return matches;
  }

  private tryParseUseRequest(
    content: string,
    start: number,
    prefix: string,
    closing: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    const tagEnd = findTagClose(content, start + prefix.length);
    if (tagEnd === -1) {
      return { match: null, nextSearchIndex: content.length };
    }

    const header = content.slice(start + prefix.length, tagEnd);
    const { toolName, attributeText } = extractToolNameAndAttributes(header);

    const closingIndex = content.startsWith(closing, tagEnd + 1)
      ? tagEnd + 1 + closing.length
      : tagEnd + 1;

    if (!toolName) {
      return { match: null, nextSearchIndex: tagEnd + 1 };
    }

    return {
      match: {
        start,
        end: closingIndex,
        toolName,
        rawArgs: parseAttributeArguments(attributeText),
        fullMatch: content.slice(start, closingIndex),
      },
      nextSearchIndex: closingIndex,
    };
  }

  private findUseUnderscoreToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const prefix = '<use_';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(prefix, searchIndex);
      if (start === -1) {
        break;
      }
      const result = this.tryParseUseUnderscoreRequest(content, start, prefix);
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private tryParseUseUnderscoreRequest(
    content: string,
    start: number,
    prefix: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    let nameEnd = start + prefix.length;
    while (nameEnd < content.length && isIdentifierChar(content[nameEnd])) {
      nameEnd++;
    }

    const toolName = content.slice(start + prefix.length, nameEnd);
    const tagEnd = findTagClose(content, nameEnd);
    if (tagEnd === -1) {
      return { match: null, nextSearchIndex: content.length };
    }

    const attributeText = content.slice(nameEnd, tagEnd);
    const closingTag = `</use_${toolName}>`;
    const bodyEnd = tagEnd + 1;
    const closingIndex = content.startsWith(closingTag, bodyEnd)
      ? bodyEnd + closingTag.length
      : bodyEnd;

    if (!toolName) {
      return { match: null, nextSearchIndex: bodyEnd };
    }

    return {
      match: {
        start,
        end: closingIndex,
        toolName,
        rawArgs: parseAttributeArguments(attributeText),
        fullMatch: content.slice(start, closingIndex),
      },
      nextSearchIndex: closingIndex,
    };
  }

  private findKeyValueToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const marker = 'tool_call:';
    const keyValueMarker = String.fromCodePoint(0x2728);
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const starIdx = content.indexOf(keyValueMarker, searchIndex);
      if (starIdx === -1) {
        break;
      }
      const result = this.tryParseKeyValueRequest(
        content,
        starIdx,
        marker,
        keyValueMarker,
      );
      if (result.match) {
        matches.push(result.match);
      }
      searchIndex = result.nextSearchIndex;
    }

    return matches;
  }

  private tryParseKeyValueRequest(
    content: string,
    starIdx: number,
    marker: string,
    keyValueMarker: string,
  ): { match: MatchCandidate | null; nextSearchIndex: number } {
    let markerIndex = starIdx + keyValueMarker.length;
    while (
      markerIndex < content.length &&
      isWhitespaceChar(content[markerIndex])
    ) {
      markerIndex++;
    }

    if (!content.startsWith(marker, markerIndex)) {
      return { match: null, nextSearchIndex: markerIndex };
    }

    let nameStart = markerIndex + marker.length;
    while (nameStart < content.length && isWhitespaceChar(content[nameStart])) {
      nameStart++;
    }

    const toolName = this.readIdentifierToken(content, nameStart);
    if (!toolName) {
      return { match: null, nextSearchIndex: nameStart };
    }

    let afterName = nameStart + toolName.length;
    while (afterName < content.length && isWhitespaceChar(content[afterName])) {
      afterName++;
    }

    if (!content.startsWith('for', afterName)) {
      return { match: null, nextSearchIndex: afterName };
    }

    // Word boundary: 'for' must be followed by whitespace or end of content.
    const afterFor = afterName + 'for'.length;
    if (afterFor < content.length && !isWhitespaceChar(content[afterFor])) {
      return { match: null, nextSearchIndex: afterFor };
    }

    let argsStart = afterFor;
    while (argsStart < content.length && isWhitespaceChar(content[argsStart])) {
      argsStart++;
    }

    let argsEnd = content.indexOf('\n', argsStart);
    if (argsEnd === -1) {
      argsEnd = content.length;
    }
    const nextStar = content.indexOf(keyValueMarker, argsStart);
    if (nextStar !== -1 && nextStar < argsEnd) {
      argsEnd = nextStar;
    }

    const rawArgs = content.slice(argsStart, argsEnd).trim();
    const fullMatch = content.slice(starIdx, argsEnd);
    return {
      match: {
        start: starIdx,
        end: argsEnd,
        toolName,
        rawArgs: parseKeyValuePairs(rawArgs),
        fullMatch,
      },
      nextSearchIndex: argsEnd,
    };
  }

  private readIdentifierToken(content: string, start: number): string {
    let end = start;
    while (end < content.length && isIdentifierChar(content[end])) {
      end++;
    }
    return content.slice(start, end);
  }
}

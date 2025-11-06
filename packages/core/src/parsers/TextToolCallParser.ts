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
  private readonly keyValuePattern =
    /✦\s*tool_call:\s*([A-Za-z0-9_.-]+)\s+for\s+([^\n✦]*)/g;

  parse(content: string): {
    cleanedContent: string;
    toolCalls: TextToolCall[];
  } {
    // Quick check: if content doesn't contain any tool call markers, return early
    if (
      !content.includes('[TOOL_REQUEST') &&
      !content.includes('tool_call:') &&
      !content.includes('[END_TOOL_REQUEST]') &&
      !content.includes('{"name":') &&
      !content.includes('<tool_call>') &&
      !content.includes('<invoke') &&
      !content.includes('<tool>') &&
      !content.includes('<use ')
    ) {
      return { cleanedContent: content, toolCalls: [] };
    }

    const matches = this.collectMatches(content);
    const toolCalls: TextToolCall[] = [];
    const ranges: Array<{ start: number; end: number }> = [];

    for (const match of matches) {
      ranges.push({ start: match.start, end: match.end });
      if (!match.toolName) {
        continue;
      }

      const parsedArgs = this.normalizeArguments(
        match.rawArgs,
        match.toolName,
        match.fullMatch,
      );

      if (!parsedArgs) {
        continue;
      }

      toolCalls.push({
        name: match.toolName,
        arguments: parsedArgs,
      });
    }

    const withoutMatches = this.removeMatchedRanges(content, ranges);
    const cleanedContent = this.postProcessCleanedContent(withoutMatches);

    return { cleanedContent, toolCalls };
  }

  private collectMatches(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [
      ...this.findBracketToolRequests(content),
      ...this.findJsonToolRequests(content),
      ...this.findHermesToolRequests(content),
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
      if (start === -1) break;

      const afterStart = start + startMarker.length;
      const endMarkerIndex = content.indexOf(endMarker, afterStart);
      if (endMarkerIndex === -1) break;

      const segment = content.slice(afterStart, endMarkerIndex);
      const toolNameMatch = segment.match(/^\s*([^\s{]+)\s+/);
      if (!toolNameMatch) {
        searchIndex = endMarkerIndex + endMarker.length;
        continue;
      }

      const toolName = toolNameMatch[1];
      const braceOffset = segment.indexOf('{', toolNameMatch[0].length);
      if (braceOffset === -1) {
        searchIndex = endMarkerIndex + endMarker.length;
        continue;
      }

      const jsonStart = afterStart + braceOffset;
      const jsonSegment = this.extractBalancedSegment(
        content,
        jsonStart,
        '{',
        '}',
      );
      if (!jsonSegment || jsonSegment.endIndex > endMarkerIndex) {
        searchIndex = endMarkerIndex + endMarker.length;
        continue;
      }

      const fullEnd = endMarkerIndex + endMarker.length;
      matches.push({
        start,
        end: fullEnd,
        toolName,
        rawArgs: jsonSegment.segment,
        fullMatch: content.slice(start, fullEnd),
      });

      searchIndex = fullEnd;
    }

    return matches;
  }

  private findJsonToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const marker = '{"name":';
    const endMarker = '[END_TOOL_REQUEST]';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const candidateIndex = content.indexOf(marker, searchIndex);
      if (candidateIndex === -1) {
        break;
      }

      let startIndex = candidateIndex;
      let backPointer = candidateIndex;
      while (backPointer > 0 && /\s/.test(content.charAt(backPointer - 1))) {
        backPointer--;
      }
      let digitPointer = backPointer;
      while (digitPointer > 0 && /\d/.test(content.charAt(digitPointer - 1))) {
        digitPointer--;
      }
      if (digitPointer < backPointer) {
        startIndex = digitPointer;
      }

      const jsonSegment = this.extractBalancedSegment(
        content,
        candidateIndex,
        '{',
        '}',
      );
      if (!jsonSegment) {
        searchIndex = candidateIndex + marker.length;
        continue;
      }

      try {
        const parsed = JSON.parse(jsonSegment.segment);
        const toolName = String(parsed.name ?? '');
        const argsText = JSON.stringify(parsed.arguments ?? {});
        const endMarkerIndex = content.indexOf(endMarker, jsonSegment.endIndex);
        if (toolName && endMarkerIndex !== -1) {
          const fullEnd = endMarkerIndex + endMarker.length;
          matches.push({
            start: startIndex,
            end: fullEnd,
            toolName,
            rawArgs: argsText,
            fullMatch: content.slice(startIndex, fullEnd),
          });
          searchIndex = fullEnd;
          continue;
        }
      } catch (error) {
        console.error(
          `[GemmaToolCallParser] Failed to parse structured tool call JSON: ${error}`,
        );
      }

      searchIndex = candidateIndex + marker.length;
    }

    return matches;
  }

  private findHermesToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const startTag = '<tool_call>';
    const endTag = '</tool_call>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(startTag, searchIndex);
      if (start === -1) break;

      const end = content.indexOf(endTag, start + startTag.length);
      if (end === -1) break;

      const jsonText = content.slice(start + startTag.length, end).trim();
      let toolName = '';
      let args = '{}';

      try {
        const parsed = JSON.parse(jsonText);
        toolName = String(parsed.name ?? '');
        args = JSON.stringify(parsed.arguments ?? {});
      } catch (error) {
        console.error(
          `[GemmaToolCallParser] Failed to parse Hermes format: ${error}`,
        );
      }

      const fullEnd = end + endTag.length;
      matches.push({
        start,
        end: fullEnd,
        toolName,
        rawArgs: args,
        fullMatch: content.slice(start, fullEnd),
      });

      searchIndex = fullEnd;
    }

    return matches;
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

      const tagEnd = this.findTagClose(content, start + tagPrefix.length);
      if (tagEnd === -1) {
        break;
      }

      const header = content.slice(start + tagPrefix.length, tagEnd);
      const attributes = this.parseAttributeArguments(header);
      const toolNameValue = attributes.name;
      const toolName =
        typeof toolNameValue === 'string' ? toolNameValue.trim() : '';

      const bodyStart = tagEnd + 1;
      const closingIndex = content.indexOf(closing, bodyStart);
      if (!toolName || closingIndex === -1) {
        searchIndex = bodyStart;
        continue;
      }

      const fullEnd = closingIndex + closing.length;
      matches.push({
        start,
        end: fullEnd,
        toolName,
        rawArgs: content.slice(bodyStart, closingIndex),
        fullMatch: content.slice(start, fullEnd),
      });

      searchIndex = fullEnd;
    }

    return matches;
  }

  private findGenericXmlToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const startTag = '<tool>';
    const endTag = '</tool>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(startTag, searchIndex);
      if (start === -1) break;

      const end = content.indexOf(endTag, start + startTag.length);
      if (end === -1) break;

      const inner = content.slice(start + startTag.length, end);
      const nameMatch = inner.match(/<name>([^<]+)<\/name>/i);
      const argsMatch = inner.match(/<arguments>([\s\S]*?)<\/arguments>/i);

      if (!nameMatch || !argsMatch) {
        searchIndex = end + endTag.length;
        continue;
      }

      const fullEnd = end + endTag.length;
      matches.push({
        start,
        end: fullEnd,
        toolName: nameMatch[1].trim(),
        rawArgs: argsMatch[1],
        fullMatch: content.slice(start, fullEnd),
      });

      searchIndex = fullEnd;
    }

    return matches;
  }

  private findUseToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const prefix = '<use';
    const closing = '</use>';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(prefix, searchIndex);
      if (start === -1) break;

      const tagEnd = this.findTagClose(content, start + prefix.length);
      if (tagEnd === -1) break;

      const header = content.slice(start + prefix.length, tagEnd);
      const { toolName, attributeText } =
        this.extractToolNameAndAttributes(header);

      const closingIndex = content.startsWith(closing, tagEnd + 1)
        ? tagEnd + 1 + closing.length
        : tagEnd + 1;

      if (!toolName) {
        searchIndex = tagEnd + 1;
        continue;
      }

      matches.push({
        start,
        end: closingIndex,
        toolName,
        rawArgs: this.parseAttributeArguments(attributeText),
        fullMatch: content.slice(start, closingIndex),
      });

      searchIndex = closingIndex;
    }

    return matches;
  }

  private findUseUnderscoreToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const prefix = '<use_';
    let searchIndex = 0;

    while (searchIndex < content.length) {
      const start = content.indexOf(prefix, searchIndex);
      if (start === -1) break;

      let nameEnd = start + prefix.length;
      while (
        nameEnd < content.length &&
        /[A-Za-z0-9_.-]/.test(content[nameEnd])
      ) {
        nameEnd++;
      }

      const toolName = content.slice(start + prefix.length, nameEnd);
      const tagEnd = this.findTagClose(content, nameEnd);
      if (tagEnd === -1) break;

      const attributeText = content.slice(nameEnd, tagEnd);
      const closingTag = `</use_${toolName}>`;
      const bodyEnd = tagEnd + 1;
      const closingIndex = content.startsWith(closingTag, bodyEnd)
        ? bodyEnd + closingTag.length
        : bodyEnd;

      if (!toolName) {
        searchIndex = bodyEnd;
        continue;
      }

      matches.push({
        start,
        end: closingIndex,
        toolName,
        rawArgs: this.parseAttributeArguments(attributeText),
        fullMatch: content.slice(start, closingIndex),
      });

      searchIndex = closingIndex;
    }

    return matches;
  }

  private findKeyValueToolRequests(content: string): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    let match: RegExpExecArray | null;

    while ((match = this.keyValuePattern.exec(content)) !== null) {
      const fullMatch = match[0];
      matches.push({
        start: match.index,
        end: match.index + fullMatch.length,
        toolName: match[1],
        rawArgs: this.parseKeyValuePairs(match[2]),
        fullMatch,
      });
    }

    this.keyValuePattern.lastIndex = 0;
    return matches;
  }

  private removeMatchedRanges(
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
      if (last && range.start <= last.end) {
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

  private postProcessCleanedContent(content: string): string {
    return content
      .replace(/\[TOOL_REQUEST(?:_END)?]/g, '')
      .replace(/<\|im_start\|>assistant/g, '')
      .replace(/<\|im_end\|>/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
      .replace(/<invoke[\s\S]*?<\/invoke>/g, '')
      .replace(/<tool>[\s\S]*?<\/tool>/g, '')
      .replace(/<\/use_[A-Za-z0-9_.-]+>/g, '')
      .replace(/<\/use>/g, '')
      .replace(/<tool_call>\s*\{[^}]*$/gm, '')
      .replace(/\{"name"\s*:\s*"[^"]*"\s*,?\s*"arguments"\s*:\s*\{[^}]*$/gm, '')
      .replace(/✦\s*<think>/g, '')
      .replace(/\n\s*\n/g, '\n')
      .replace(/\n/g, ' ')
      .trim();
  }

  private normalizeArguments(
    args: string | Record<string, unknown>,
    toolName: string,
    fullMatch: string,
  ): Record<string, unknown> | null {
    if (typeof args !== 'string') {
      return this.applyToolSpecificNormalizations(args, toolName);
    }

    try {
      if (
        args.includes('<parameter') ||
        (args.includes('<') && args.includes('>'))
      ) {
        return this.parseXMLParameters(args);
      }
      return this.applyToolSpecificNormalizations(JSON.parse(args), toolName);
    } catch (error) {
      const repaired = this.tryRepairJson(args);
      if (repaired) {
        try {
          return this.applyToolSpecificNormalizations(
            JSON.parse(repaired),
            toolName,
          );
        } catch {
          // ignore and fall through
        }
      }

      const simpleJsonMatch = args.match(/^{[^{]*}$/);
      if (simpleJsonMatch) {
        try {
          return JSON.parse(simpleJsonMatch[0]);
        } catch {
          // fall through to logging
        }
      }

      console.error(
        `[GemmaToolCallParser] Failed to parse tool arguments for ${toolName}:`,
        error,
      );
      console.error(
        `[GemmaToolCallParser] Raw arguments excerpt: ${fullMatch.slice(0, 200)}`,
      );
      return null;
    }
  }

  private applyToolSpecificNormalizations(
    args: Record<string, unknown>,
    toolName: string,
  ): Record<string, unknown> {
    if (!args) {
      return args;
    }
    const normalizedTool = toolName?.trim().toLowerCase();
    if (normalizedTool === 'todo_write') {
      const todos = args['todos'];
      if (Array.isArray(todos)) {
        args['todos'] = todos.map((todo, index) =>
          this.normalizeTodoEntry(todo, index),
        );
      }
    }
    return args;
  }

  private normalizeTodoEntry(
    todo: unknown,
    index: number,
  ): Record<string, unknown> {
    const normalized =
      todo && typeof todo === 'object'
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

    normalized.status = this.normalizeTodoStatus(normalized.status);
    normalized.priority = this.normalizeTodoPriority(normalized.priority);

    return normalized;
  }

  private normalizeTodoStatus(
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

  private normalizeTodoPriority(value: unknown): 'high' | 'medium' | 'low' {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (
        normalized === 'high' ||
        normalized === 'medium' ||
        normalized === 'low'
      ) {
        return normalized;
      }
      if (normalized === '1') {
        return 'high';
      }
      if (normalized === '2') {
        return 'medium';
      }
      if (normalized === '3') {
        return 'low';
      }
    }

    if (typeof value === 'number') {
      if (value <= 1) {
        return 'high';
      }
      if (value >= 3) {
        return 'low';
      }
      return 'medium';
    }

    return 'high';
  }

  private extractBalancedSegment(
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

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (inString) {
        if (char === inString) {
          inString = null;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }

      if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          return {
            segment: content.slice(startIndex, i + 1),
            endIndex: i + 1,
          };
        }
      }
    }

    return null;
  }

  // Best-effort repair for JSON with unescaped inner quotes in string values.
  private tryRepairJson(args: string): string | null {
    try {
      JSON.parse(args);
      return args; // already valid
    } catch {
      // Target only inner quotes within JSON string values, preserving multibyte and spacing
      // e.g., { "command": "printf "ありがとう 世界"" } -> { "command": "printf \"ありがとう 世界\"" }
      const repaired = args.replace(
        /:(\s*)"((?:\\.|[^"\\])*)"(\s*)([,}])/g,
        (_m, s1, val, s2, tail) => {
          // Escape only unescaped quotes inside the value
          const fixed = val.replace(/(?<!\\)"/g, '\\"');
          return `:${s1}"${fixed}"${s2}${tail}`;
        },
      );
      try {
        JSON.parse(repaired);
        return repaired;
      } catch {
        return null;
      }
    }
  }

  private parseKeyValuePairs(str: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    // Parse "key value key2 value2" format
    // Example: "path /Users/acoliver/projects/gemini-code/gemini-cli/docs"
    const parts = str.trim().split(/\s+/);

    for (let i = 0; i < parts.length; i += 2) {
      if (i + 1 < parts.length) {
        const key = parts[i];
        let value: string | number | boolean = parts[i + 1];

        // Handle quoted strings that might contain spaces
        if (value.startsWith('"') || value.startsWith("'")) {
          const quote = value[0];
          let endIndex = i + 1;

          // Find the closing quote
          while (endIndex < parts.length && !parts[endIndex].endsWith(quote)) {
            endIndex++;
          }

          if (endIndex < parts.length) {
            value = parts.slice(i + 1, endIndex + 1).join(' ');
            value = value.slice(1, -1); // Remove quotes
            i = endIndex - 1; // Adjust loop counter
          }
        }

        // Try to parse as number or boolean
        if (!isNaN(Number(value))) {
          args[key] = Number(value);
        } else if (value === 'true' || value === 'false') {
          args[key] = value === 'true';
        } else {
          args[key] = value;
        }
      }
    }

    return args;
  }

  private parseAttributeArguments(
    attributeText: string,
  ): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const text = attributeText ?? '';
    const length = text.length;
    let index = 0;

    const readIdentifier = () => {
      const start = index;
      while (index < length && /[A-Za-z0-9_.-]/.test(text.charAt(index))) {
        index++;
      }
      return text.slice(start, index);
    };

    const skipWhitespace = () => {
      while (index < length && /\s/.test(text.charAt(index))) {
        index++;
      }
    };

    while (index < length) {
      skipWhitespace();
      const key = readIdentifier();
      if (!key) {
        index++;
        continue;
      }

      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === 'with' ||
        normalizedKey === 'and' ||
        normalizedKey === 'then'
      ) {
        continue;
      }

      skipWhitespace();
      if (text.charAt(index) !== '=') {
        index++;
        continue;
      }
      index++;
      skipWhitespace();

      const quote = text.charAt(index);
      if (quote !== '"' && quote !== "'") {
        index++;
        continue;
      }
      index++;

      let value = '';
      let escaped = false;
      while (index < length) {
        const char = text.charAt(index);
        index++;
        if (escaped) {
          value += char;
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === quote) {
          break;
        }
        value += char;
      }

      const unescaped = value.trim();
      if (!key) {
        continue;
      }

      if (unescaped.startsWith('{') || unescaped.startsWith('[')) {
        try {
          args[key] = JSON.parse(unescaped);
          continue;
        } catch {
          // fall through to scalar handling
        }
      }

      if (/^-?\d+(\.\d+)?$/.test(unescaped)) {
        args[key] = Number(unescaped);
      } else if (
        unescaped.toLowerCase() === 'true' ||
        unescaped.toLowerCase() === 'false'
      ) {
        args[key] = unescaped.toLowerCase() === 'true';
      } else {
        args[key] = unescaped;
      }
    }

    return args;
  }

  private parseXMLParameters(xmlContent: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    // Parse Claude-style <parameter name="key">value</parameter>
    const parameterPattern =
      /<parameter\s+name="([^"]+)">([^<]*)<\/parameter>/g;
    let match;
    while ((match = parameterPattern.exec(xmlContent)) !== null) {
      const [, key, value] = match;
      args[key] = this.parseValue(value.trim());
    }

    // If no parameter tags found, try generic XML <key>value</key>
    if (Object.keys(args).length === 0) {
      // Match any XML tag pair
      const genericPattern = /<(\w+)>([^<]*)<\/\1>/g;
      while ((match = genericPattern.exec(xmlContent)) !== null) {
        const [, key, value] = match;
        args[key] = this.parseValue(value.trim());
      }
    }

    return args;
  }

  private parseValue(value: string): string | number | boolean {
    // Try to parse as number
    if (!isNaN(Number(value)) && value !== '') {
      return Number(value);
    }
    // Try to parse as boolean
    if (value === 'true' || value === 'false') {
      return value === 'true';
    }
    // Handle HTML entities
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private findTagClose(content: string, fromIndex: number): number {
    let inQuote: '"' | "'" | null = null;
    for (let i = fromIndex; i < content.length; i++) {
      const char = content[i];
      if (inQuote) {
        if (char === inQuote && content[i - 1] !== '\\') {
          inQuote = null;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inQuote = char as '"' | "'";
        continue;
      }

      if (char === '>') {
        return i;
      }
    }
    return -1;
  }

  private extractToolNameAndAttributes(header: string): {
    toolName: string;
    attributeText: string;
  } {
    let index = 0;
    const length = header.length;

    while (index < length && /\s/.test(header.charAt(index))) {
      index++;
    }
    const nameStart = index;
    while (index < length && /[A-Za-z0-9_.-]/.test(header.charAt(index))) {
      index++;
    }
    const toolName = header.slice(nameStart, index).trim();
    const attributeText = header.slice(index);

    return { toolName, attributeText };
  }
}

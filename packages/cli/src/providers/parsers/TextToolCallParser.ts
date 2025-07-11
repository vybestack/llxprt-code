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

export class GemmaToolCallParser implements ITextToolCallParser {
  // Support multiple tool call formats
  private readonly patterns = [
    // Format 1: [TOOL_REQUEST] toolName {args} [TOOL_REQUEST_END]
    /\[TOOL_REQUEST\]\s*(\w+)\s+({.*?})\s*\[TOOL_REQUEST_END\]/gs,
    // Format 2: ✦ tool_call: toolName for key value pairs (more specific to avoid false positives)
    /✦\s*tool_call:\s*(\w+)\s+for\s+(.+?)(?=\n|✦|$)/gs,
    // Format 3: JSON object with name/arguments followed by [END_TOOL_REQUEST]
    /(\d+\s+)?{"name":\s*"(\w+)",\s*"arguments":\s*({.*?})}\s*(?:\n\s*\d+\s+)?\[END_TOOL_REQUEST\]/gs,
    // Format 4: Hermes format with <tool_call> tags
    /<tool_call>\s*({.*?"name":\s*"(\w+)".*?})\s*<\/tool_call>/gs,
    // Format 5: XML with <invoke> tags (Claude-style)
    /<invoke\s+name="(\w+)">(.*?)<\/invoke>/gs,
    // Format 6: Generic XML tool format
    /<tool>\s*<name>(\w+)<\/name>\s*<arguments>(.*?)<\/arguments>\s*<\/tool>/gs,
  ];

  parse(content: string): {
    cleanedContent: string;
    toolCalls: TextToolCall[];
  } {
    const toolCalls: TextToolCall[] = [];
    let cleanedContent = content;
    const matches: Array<{
      fullMatch: string;
      toolName: string;
      args: string | Record<string, unknown>;
    }> = [];

    // Quick check: if content doesn't contain any tool call markers, return early
    if (
      !content.includes('[TOOL_REQUEST') &&
      !content.includes('tool_call:') &&
      !content.includes('[END_TOOL_REQUEST]') &&
      !content.includes('{"name":') &&
      !content.includes('<tool_call>') &&
      !content.includes('<invoke') &&
      !content.includes('<tool>')
    ) {
      return { cleanedContent: content, toolCalls: [] };
    }

    // Try each pattern
    for (const pattern of this.patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (pattern === this.patterns[1]) {
          // Format 2: Parse key-value pairs from "for key value key2 value2" format
          const [fullMatch, toolName, argsStr] = match;
          const args = this.parseKeyValuePairs(argsStr);
          matches.push({ fullMatch, toolName, args });
        } else if (pattern === this.patterns[2]) {
          // Format 3: JSON object format {"name": "tool", "arguments": {...}}
          const [fullMatch, , toolName, jsonArgs] = match;
          matches.push({ fullMatch, toolName, args: jsonArgs });
        } else if (pattern === this.patterns[3]) {
          // Format 4: Hermes format <tool_call>{"arguments": {...}, "name": "tool"}</tool_call>
          const [fullMatch, hermesJson, toolName] = match;
          try {
            const parsed = JSON.parse(hermesJson);
            matches.push({
              fullMatch,
              toolName,
              args: JSON.stringify(parsed.arguments || {}),
            });
          } catch (error) {
            console.error(
              `[GemmaToolCallParser] Failed to parse Hermes format: ${error}`,
            );
            // Still need to track the match to remove it from content
            matches.push({ fullMatch, toolName: '', args: '' });
          }
        } else if (pattern === this.patterns[4]) {
          // Format 5: XML with <invoke> tags (Claude-style)
          const [fullMatch, toolName, xmlContent] = match;
          matches.push({ fullMatch, toolName, args: xmlContent });
        } else if (pattern === this.patterns[5]) {
          // Format 6: Generic XML tool format
          const [fullMatch, toolName, xmlArgs] = match;
          matches.push({ fullMatch, toolName, args: xmlArgs });
        } else {
          // Format 1: tool name followed by JSON arguments
          const [fullMatch, toolName, jsonArgs] = match;
          matches.push({ fullMatch, toolName, args: jsonArgs });
        }
      }
      // Reset the regex state for next use
      pattern.lastIndex = 0;
    }

    // Process each match
    for (const { fullMatch, toolName, args } of matches) {
      // Remove the tool call pattern from the content regardless of parsing success so markers are always stripped
      cleanedContent = cleanedContent.replace(fullMatch, '');

      // Skip if toolName is empty (failed parsing)
      if (!toolName) {
        continue;
      }

      try {
        let parsedArgs: Record<string, unknown>;

        if (typeof args === 'string') {
          // Check if it's XML content (Claude-style or generic)
          if (
            args.includes('<parameter') ||
            (args.includes('<') && args.includes('>'))
          ) {
            parsedArgs = this.parseXMLParameters(args);
          } else {
            // Handle JSON string arguments
            parsedArgs = JSON.parse(args);
          }
        } else {
          // Already parsed (from key-value format)
          parsedArgs = args;
        }

        toolCalls.push({
          name: toolName,
          arguments: parsedArgs,
        });
      } catch (error) {
        if (typeof args === 'string') {
          // Try to extract a simpler JSON pattern if the full match fails
          const simpleJsonMatch = args.match(/^{[^{]*}$/);
          if (simpleJsonMatch) {
            try {
              const parsedArgs = JSON.parse(simpleJsonMatch[0]);
              toolCalls.push({
                name: toolName,
                arguments: parsedArgs,
              });
              cleanedContent = cleanedContent.replace(fullMatch, '');
            } catch (_secondError) {
              console.error(
                `[GemmaToolCallParser] Failed to parse tool arguments for ${toolName}:`,
                error,
              );
              console.error(`[GemmaToolCallParser] Raw arguments: ${args}`);
              // Keep the original text if we can't parse it
            }
          } else {
            console.error(
              `[GemmaToolCallParser] Failed to parse tool arguments for ${toolName}:`,
              error,
            );
            console.error(`[GemmaToolCallParser] Raw arguments: ${args}`);
          }
        }
      }
    }

    // Clean up any extra whitespace and stray markers that were not matched (best effort)
    cleanedContent = cleanedContent
      .replace(/\[TOOL_REQUEST(?:_END)?]/g, '')
      .replace(/<\|im_start\|>assistant/g, '')
      .replace(/<\|im_end\|>/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '') // Remove any remaining tool_call tags
      .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '') // Remove function_calls wrapper
      .replace(/<invoke[\s\S]*?<\/invoke>/g, '') // Remove any remaining invoke tags
      .replace(/<tool>[\s\S]*?<\/tool>/g, '') // Remove any remaining tool tags
      // .replace(/<think>[\s\S]*?<\/think>/g, '') // Keep think tags visible by default
      .replace(/<tool_call>\s*\{[^}]*$/gm, '') // Remove incomplete tool calls
      .replace(/\{"name"\s*:\s*"[^"]*"\s*,?\s*"arguments"\s*:\s*\{[^}]*$/gm, '') // Remove incomplete JSON tool calls
      .replace(/✦\s*<think>/g, '') // Remove ✦ symbol followed by think tag
      .replace(/\s+/g, ' ')
      .trim();

    return {
      cleanedContent,
      toolCalls,
    };
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
}

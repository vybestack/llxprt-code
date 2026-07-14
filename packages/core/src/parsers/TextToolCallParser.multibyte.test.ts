/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
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

import { describe, it, expect } from 'vitest';
import { GemmaToolCallParser } from './TextToolCallParser.js';

// Simulate a Hermes/text style tool call directive embedded in text
// We'll use the simplest recognized pattern: [TOOL_REQUEST] name {args} [TOOL_REQUEST_END]
// Where args is JSON.

describe('TextToolCallParser multibyte handling', () => {
  it('preserves quoted spaces and multibyte chars in run_shell_command.command', () => {
    const parser = new GemmaToolCallParser();

    const commandValue = 'printf "ありがとう 世界"';
    const jsonArgs = JSON.stringify({ command: commandValue }, null, 2);

    const content = `Some text before
[TOOL_REQUEST] run_shell_command ${jsonArgs} [TOOL_REQUEST_END]
And after.`;

    const { cleanedContent, toolCalls } = parser.parse(content);

    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].name).toBe('run_shell_command');
    const args = toolCalls[0].arguments;
    expect(args.command).toBe('printf "ありがとう 世界"');

    // Ensure original content around tool call remains and spacing preserved
    expect(cleanedContent).toContain('Some text before');
    expect(cleanedContent).toContain('And after.');
    // Ensure the exact multibyte phrase with space remains in surrounding text if present
    // (cleanedContent should not collapse spaces globally)
    expect(cleanedContent.includes('ありがとう 世界')).toBe(false); // tool call removed, not present in cleaned
  });
});

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { GemmaToolCallParser } from './TextToolCallParser.js';

const parser = new GemmaToolCallParser();

describe('GemmaToolCallParser', () => {
  it('should parse single tool call', () => {
    const content =
      'Here is the result:\n[TOOL_REQUEST]\nlist_directory {"path": "/home"}\n[TOOL_REQUEST_END]';

    const { cleanedContent, toolCalls } = parser.parse(content);

    expect(cleanedContent).toBe('Here is the result:');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('list_directory');
    expect(toolCalls[0].arguments).toStrictEqual({ path: '/home' });
  });

  it('should parse multiple tool calls', () => {
    const content =
      'Files in different places:\n[TOOL_REQUEST]\nlist_directory {"path": "/usr"}\n[TOOL_REQUEST_END]\nMore files:\n[TOOL_REQUEST]\nlist_directory {"path": "/tmp"}\n[TOOL_REQUEST_END]';

    const { cleanedContent, toolCalls } = parser.parse(content);

    // Newlines are preserved between text segments
    expect(cleanedContent).toBe('Files in different places:\nMore files:');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({
      name: 'list_directory',
      arguments: { path: '/usr' },
    });
    expect(toolCalls[1]).toMatchObject({
      name: 'list_directory',
      arguments: { path: '/tmp' },
    });
  });

  it('should handle malformed JSON gracefully', () => {
    const content =
      'Bad args:\n[TOOL_REQUEST]\nlist_directory {path: /home}\n[TOOL_REQUEST_END]';

    const result = parser.parse(content);

    expect(result.cleanedContent).toBe('Bad args:');
    // Parsing should fail, resulting in zero tool calls and no throw
    expect(result.toolCalls).toHaveLength(0);
  });

  it('should parse JSON object format with END_TOOL_REQUEST', () => {
    const content = `1 {"name": "list_directory", "arguments": {"path": "/Users/acoliver/projects/gemini-code/gemini-cli/project-plans"}}
2 [END_TOOL_REQUEST]`;

    const result = parser.parse(content);

    expect(result.cleanedContent).toBe('');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('list_directory');
    expect(result.toolCalls[0].arguments).toStrictEqual({
      path: '/Users/acoliver/projects/gemini-code/gemini-cli/project-plans',
    });
  });

  it('should parse key-value tool call format with marker', () => {
    const marker = String.fromCodePoint(0x2728);
    const content = `Before\n${marker} tool_call: search for query "weather today" limit 3\nAfter`;

    const result = parser.parse(content);

    expect(result.cleanedContent).toBe('Before\nAfter');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: 'search',
      arguments: { query: 'weather today', limit: 3 },
    });
  });

  it('should not parse separated key-value marker and tool_call text', () => {
    const marker = String.fromCodePoint(0x2728);
    const content = `Before\n${marker} unrelated text\ntool_call: search for query "weather today"\nAfter`;

    const result = parser.parse(content);

    expect(result.cleanedContent).toBe(content);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('should remove key-value think artifacts with optional whitespace', () => {
    const marker = String.fromCodePoint(0x2728);
    const trigger = '[TOOL_REQUEST]\nnoop {}\n[TOOL_REQUEST_END]\n';

    expect(parser.parse(`${trigger}A${marker}<think>B`).cleanedContent).toBe(
      'AB',
    );
    expect(parser.parse(`${trigger}A${marker} <think>B`).cleanedContent).toBe(
      'AB',
    );
  });

  it('should preserve original attribute scalar parsing boundaries', () => {
    const content =
      '<use search negative="-1" decimal="1.5" plus="+1" leading_decimal=".5" trailing_decimal="1."></use>';

    const result = parser.parse(content);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].arguments).toStrictEqual({
      negative: -1,
      decimal: 1.5,
      plus: '+1',
      leading_decimal: '.5',
      trailing_decimal: '1.',
    });
  });

  it('should only remove trailing open tool_call fragments with open JSON', () => {
    expect(parser.parse('Keep <tool_call> plain text').cleanedContent).toBe(
      'Keep <tool_call> plain text',
    );
    expect(
      parser.parse('Keep <tool_call> {"name":"search"}').cleanedContent,
    ).toBe('Keep <tool_call> {"name":"search"}');
    expect(
      parser.parse('Drop <tool_call> {"name":"search"').cleanedContent,
    ).toBe('Drop');
    expect(
      parser.parse('Keep <tool_call>{"name":"search"').cleanedContent,
    ).toBe('Keep <tool_call>{"name":"search"');
  });

  it('should remove whitespace-tolerant trailing JSON argument fragments', () => {
    const content =
      'Before { "name" : "search", "arguments" : { "query" : "open"';

    expect(parser.parse(content).cleanedContent).toBe('Before');
  });

  it('should remove trailing JSON argument fragments with closed nested values', () => {
    const content =
      'Before { "name" : "search", "arguments" : { "nested" : { "x" : 1 }';

    expect(parser.parse(content).cleanedContent).toBe('Before');
  });

  it('should preserve complete JSON fragments with nested argument values', () => {
    const content =
      'Before { "name" : "search", "arguments" : { "nested" : { "x" : 1 } }}';

    expect(parser.parse(content).cleanedContent).toBe(content);
    expect(parser.parse(content).toolCalls).toHaveLength(0);
  });

  it('should preserve complete JSON fragments that are not tool requests', () => {
    const content =
      'Before { "name" : "search", "arguments" : { "query" : "closed" }}';

    expect(parser.parse(content).cleanedContent).toBe(content);
    expect(parser.parse(content).toolCalls).toHaveLength(0);
  });

  it('should parse whitespace-tolerant JSON object format with END_TOOL_REQUEST', () => {
    const content =
      'Before { "name" : "search", "arguments" : { "query" : "closed" }}\n[END_TOOL_REQUEST]';

    expect(parser.parse(content).cleanedContent).toBe('Before');
    expect(parser.parse(content).toolCalls).toHaveLength(1);
  });

  describe('Hermes format', () => {
    it('should parse single Hermes tool call', () => {
      const content = `<|im_start|>assistant
<tool_call>
{"arguments": {"symbol": "TSLA"}, "name": "get_stock_fundamentals"}
</tool_call>
<|im_end|>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_stock_fundamentals');
      expect(result.toolCalls[0].arguments).toStrictEqual({ symbol: 'TSLA' });
    });

    it('should parse multiple Hermes tool calls', () => {
      const content = `Let me check that for you.
<tool_call>
{"arguments": {"symbol": "AAPL"}, "name": "get_stock_fundamentals"}
</tool_call>
And also:
<tool_call>
{"arguments": {"symbol": "GOOGL"}, "name": "get_stock_fundamentals"}
</tool_call>`;

      const result = parser.parse(content);

      // Newlines are preserved between text segments
      expect(result.cleanedContent).toBe(
        'Let me check that for you.\nAnd also:',
      );
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('get_stock_fundamentals');
      expect(result.toolCalls[0].arguments).toStrictEqual({ symbol: 'AAPL' });
      expect(result.toolCalls[1].name).toBe('get_stock_fundamentals');
      expect(result.toolCalls[1].arguments).toStrictEqual({ symbol: 'GOOGL' });
    });

    it('should handle Hermes format with special tokens', () => {
      const content = `<|im_start|>assistant
I'll help you with that.
<tool_call>
{"name": "search_files", "arguments": {"query": "test"}}
</tool_call>
<|im_end|>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe("I'll help you with that.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search_files');
      expect(result.toolCalls[0].arguments).toStrictEqual({ query: 'test' });
    });

    it('should handle malformed Hermes format', () => {
      const content = `<tool_call>
{invalid json}
</tool_call>`;

      const result = parser.parse(content);

      // The content should still have tool_call tags removed even if parsing fails
      expect(result.cleanedContent).toBe('');
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe('XML format (Claude-style)', () => {
    it('should parse single Claude-style XML tool call', () => {
      const content = `I'll help you with that.
<function_calls>
<invoke name="get_weather">
<parameter name="location">San Francisco</parameter>
<parameter name="units">celsius</parameter>
</invoke>
</function_calls>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe("I'll help you with that.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].arguments).toStrictEqual({
        location: 'San Francisco',
        units: 'celsius',
      });
    });

    it('should parse multiple Claude-style XML tool calls', () => {
      const content = `<function_calls>
<invoke name="search">
<parameter name="query">climate change</parameter>
</invoke>
</function_calls>
And also:
<function_calls>
<invoke name="calculator">
<parameter name="expression">2 + 2</parameter>
</invoke>
</function_calls>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe('And also:');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.toolCalls[0].arguments).toStrictEqual({
        query: 'climate change',
      });
      expect(result.toolCalls[1].name).toBe('calculator');
      expect(result.toolCalls[1].arguments).toStrictEqual({
        expression: '2 + 2',
      });
    });

    it('should handle Claude-style XML with numeric and boolean parameters', () => {
      const content = `<invoke name="set_temperature">
<parameter name="value">23.5</parameter>
<parameter name="celsius">true</parameter>
<parameter name="room_id">42</parameter>
</invoke>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].arguments).toStrictEqual({
        value: 23.5,
        celsius: true,
        room_id: 42,
      });
    });

    it('should handle Claude-style XML with HTML entities', () => {
      const content = `<invoke name="search">
<parameter name="query">&lt;script&gt; &amp; &quot;test&quot;</parameter>
</invoke>`;

      const result = parser.parse(content);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].arguments).toStrictEqual({
        query: '<script> & "test"',
      });
    });
  });

  describe('Generic XML format', () => {
    it('should parse generic XML tool format', () => {
      const content = `Let me search for that.
<tool>
  <name>search</name>
  <arguments>
    <query>TypeScript tutorials</query>
    <limit>10</limit>
  </arguments>
</tool>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe('Let me search for that.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.toolCalls[0].arguments).toStrictEqual({
        query: 'TypeScript tutorials',
        limit: 10,
      });
    });

    it('should parse multiple generic XML tool calls', () => {
      const content = `<tool>
<name>read_file</name>
<arguments>
<path>/home/user/doc.txt</path>
</arguments>
</tool>
<tool>
<name>write_file</name>
<arguments>
<path>/home/user/output.txt</path>
<content>Hello World</content>
</arguments>
</tool>`;

      const result = parser.parse(content);

      expect(result.cleanedContent).toBe('');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('read_file');
      expect(result.toolCalls[0].arguments).toStrictEqual({
        path: '/home/user/doc.txt',
      });
      expect(result.toolCalls[1].name).toBe('write_file');
      expect(result.toolCalls[1].arguments).toStrictEqual({
        path: '/home/user/output.txt',
        content: 'Hello World',
      });
    });

    it('should handle malformed XML gracefully', () => {
      const content = `<tool>
<name>test</name>
<arguments>
{invalid json}
</arguments>
</tool>`;

      const result = parser.parse(content);

      // Should still remove the tool tags even if parsing fails
      expect(result.cleanedContent).toBe('');
      expect(result.toolCalls).toHaveLength(0);
    });
  });
});

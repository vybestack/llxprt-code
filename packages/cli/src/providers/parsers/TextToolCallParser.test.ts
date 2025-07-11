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
    expect(toolCalls[0].arguments).toEqual({ path: '/home' });
  });

  it('should parse multiple tool calls', () => {
    const content =
      'Files in different places:\n[TOOL_REQUEST]\nlist_directory {"path": "/usr"}\n[TOOL_REQUEST_END]\nMore files:\n[TOOL_REQUEST]\nlist_directory {"path": "/tmp"}\n[TOOL_REQUEST_END]';

    const { cleanedContent, toolCalls } = parser.parse(content);

    // Whitespace collapsed by parser, expect spaces only
    expect(cleanedContent).toBe('Files in different places: More files:');
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
    expect(result.toolCalls[0].arguments).toEqual({
      path: '/Users/acoliver/projects/gemini-code/gemini-cli/project-plans',
    });
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
      expect(result.toolCalls[0].arguments).toEqual({ symbol: 'TSLA' });
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

      expect(result.cleanedContent).toBe(
        'Let me check that for you. And also:',
      );
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('get_stock_fundamentals');
      expect(result.toolCalls[0].arguments).toEqual({ symbol: 'AAPL' });
      expect(result.toolCalls[1].name).toBe('get_stock_fundamentals');
      expect(result.toolCalls[1].arguments).toEqual({ symbol: 'GOOGL' });
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
      expect(result.toolCalls[0].arguments).toEqual({ query: 'test' });
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
      expect(result.toolCalls[0].arguments).toEqual({
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
      expect(result.toolCalls[0].arguments).toEqual({
        query: 'climate change',
      });
      expect(result.toolCalls[1].name).toBe('calculator');
      expect(result.toolCalls[1].arguments).toEqual({ expression: '2 + 2' });
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
      expect(result.toolCalls[0].arguments).toEqual({
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
      expect(result.toolCalls[0].arguments).toEqual({
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
      expect(result.toolCalls[0].arguments).toEqual({
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
      expect(result.toolCalls[0].arguments).toEqual({
        path: '/home/user/doc.txt',
      });
      expect(result.toolCalls[1].name).toBe('write_file');
      expect(result.toolCalls[1].arguments).toEqual({
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

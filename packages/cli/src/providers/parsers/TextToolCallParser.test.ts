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
});

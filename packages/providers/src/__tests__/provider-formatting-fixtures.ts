/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 *
 * Provider-local copy of formatting fixtures.
 * Generated from the same source as the tools package fixture.
 * Captured at: 2026-06-08T23:19:00.890Z
 */
export const TOOL_FORMATTER_FIXTURES = {
  capturedAt: '2026-06-08T23:19:00.890Z',
  anthropicToolDeclaration: [
    {
      name: 'read_file',
      description: 'Read the contents of a file',
      input_schema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file',
          },
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file',
      input_schema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
          },
          content: {
            type: 'string',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  ],
  openAIToolDeclaration: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file',
            },
            offset: {
              type: 'number',
              description: 'Line offset',
            },
          },
          required: ['file_path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
            },
            content: {
              type: 'string',
            },
          },
          required: ['file_path', 'content'],
        },
      },
    },
  ],
  toolIdNormalizationCases: [
    {
      input: 'call_abc123',
      openAI: 'call_abc123',
      history: 'hist_tool_abc123',
      anthropic: 'toolu_abc123',
    },
    {
      input: 'hist_tool_abc123',
      openAI: 'call_abc123',
      history: 'hist_tool_abc123',
      anthropic: 'toolu_abc123',
    },
    {
      input: 'toolu_abc123',
      openAI: 'call_abc123',
      history: 'hist_tool_abc123',
      anthropic: 'toolu_abc123',
    },
    {
      input: '',
      openAI: 'call_',
      history: 'hist_tool_',
      anthropic: 'toolu_empty',
    },
    {
      input: 'call_with/special!chars',
      openAI: 'call_withspecialchars',
      history: 'hist_tool_withspecialchars',
      anthropic: 'toolu_with-special-chars',
    },
  ],
  doubleEscapeCases: [
    {
      input: '{"key": "value"}',
      shouldUseDoubleEscape_openai: false,
      shouldUseDoubleEscape_qwen: true,
      detection: {
        isDoubleEscaped: false,
        correctedValue: {
          key: 'value',
        },
        originalValue: '{"key": "value"}',
        detectionDetails: {},
      },
      detectedInChunk: false,
    },
    {
      input: '"{\\"key\\": \\"value\\"}"',
      detection: {
        isDoubleEscaped: true,
        correctedValue: {
          key: 'value',
        },
        originalValue: '"{\\"key\\": \\"value\\"}"',
        detectionDetails: {
          firstParse: '{"key": "value"}',
          secondParse: {
            key: 'value',
          },
        },
      },
      detectedInChunk: false,
    },
    {
      input: '{"count": "42"}',
      processed_openai: {
        count: '42',
      },
      processed_qwen: {
        count: '42',
      },
    },
  ],
} as const;

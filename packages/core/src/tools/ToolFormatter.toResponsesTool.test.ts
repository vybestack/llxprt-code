import { describe, it, expect } from 'vitest';
import { ToolFormatter } from './ToolFormatter.js';
import { ITool } from '../providers/ITool.js';

describe('ToolFormatter.toResponsesTool', () => {
  const formatter = new ToolFormatter();

  it('should format basic tool for responses API', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather information',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The city and state',
              },
            },
            required: ['location'],
          },
        },
      },
    ];

    const result = formatter.toResponsesTool(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather information',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state',
          },
        },
        required: ['location'],
      },
      strict: null,
    });
  });

  it('should handle complex nested schemas', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'complex_tool',
          description: 'A tool with complex nested parameters',
          parameters: {
            type: 'object',
            properties: {
              nested: {
                type: 'object',
                properties: {
                  array: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'number' },
                        name: { type: 'string' },
                      },
                      required: ['id'],
                    },
                  },
                  optional: {
                    type: 'string',
                    nullable: true,
                  },
                },
                required: ['array'],
              },
              enum_field: {
                type: 'string',
                enum: ['option1', 'option2', 'option3'],
              },
            },
            required: ['nested'],
          },
        },
      },
    ];

    const result = formatter.toResponsesTool(tools);

    expect(result[0].parameters).toEqual(tools[0].function.parameters);
  });

  it('should handle tools with no parameters', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'no_params',
          description: 'A tool with no parameters',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];

    const result = formatter.toResponsesTool(tools);

    expect(result[0].parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('should handle multiple tools', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'tool1',
          description: 'First tool',
          parameters: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'tool2',
          description: 'Second tool',
          parameters: {
            type: 'object',
            properties: {
              param2: { type: 'number' },
            },
          },
        },
      },
    ];

    const result = formatter.toResponsesTool(tools);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('tool1');
    expect(result[1].name).toBe('tool2');
  });

  it('should handle edge case schemas', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'edge_case_tool',
          description: 'Tool with edge case schema features',
          parameters: {
            type: 'object',
            properties: {
              // Property with special characters
              'property-with-dash': { type: 'string' },
              // Array with mixed types (though not recommended)
              mixed_array: {
                type: 'array',
                items: {
                  oneOf: [{ type: 'string' }, { type: 'number' }],
                },
              },
              // Deeply nested structure
              very: {
                type: 'object',
                properties: {
                  deeply: {
                    type: 'object',
                    properties: {
                      nested: {
                        type: 'object',
                        properties: {
                          value: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
              // Additional properties
              dynamic_object: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
            },
            required: ['property-with-dash'],
          },
        },
      },
    ];

    const result = formatter.toResponsesTool(tools);

    expect(result[0].parameters).toEqual(tools[0].function.parameters);
    const params = result[0].parameters as {
      properties: Record<string, unknown>;
    };
    const properties = params.properties;
    expect(properties['property-with-dash']).toBeDefined();
  });

  it('should preserve all schema attributes', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'schema_test',
          description: 'Test schema preservation',
          parameters: {
            type: 'object',
            title: 'Schema Title',
            description: 'Schema description',
            properties: {
              field: {
                type: 'integer',
                minimum: 0,
                maximum: 100,
                default: 50,
                description: 'A bounded integer',
              },
              pattern_field: {
                type: 'string',
                pattern: '^[A-Z]{3}$',
                minLength: 3,
                maxLength: 3,
              },
            },
            required: ['field'],
            additionalProperties: false,
          },
        },
      },
    ];

    const result = formatter.toResponsesTool(tools);
    type Schema = Record<string, unknown>;
    const params = result[0].parameters as Schema;

    expect(params.title).toBe('Schema Title');
    expect(params.description).toBe('Schema description');
    const properties = params.properties as Record<
      string,
      Record<string, unknown>
    >;
    const field = properties.field as Record<string, unknown>;
    const patternField = properties.pattern_field as Record<string, unknown>;
    expect(field.minimum).toBe(0);
    expect(field.maximum).toBe(100);
    expect(field.default).toBe(50);
    expect(patternField.pattern).toBe('^[A-Z]{3}$');
    expect(params.additionalProperties).toBe(false);
  });
});

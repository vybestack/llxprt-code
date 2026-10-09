/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
const expectedParameters = {
  type: 'object',
  properties: {
    nested: {
      type: 'object',
      properties: {
        value: { type: ['string', 'null'], description: 'Nullable value' },
        choice: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] },
        constrained: { allOf: [{ type: 'string' }, { maxLength: 4 }] },
      },
      required: ['value', 'choice', 'constrained'],
      additionalProperties: false,
    },
    alternate: {
      anyOf: [
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['nested', 'alternate'],
  additionalProperties: false,
};
export function expectedBoundaryBody(
  name: string,
  rows: number,
  padding: number,
  withTools: boolean,
): string {
  const messages = [
    { role: 'system', content: 'Inspect rows.' },
    ...Array.from({ length: rows }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `row-${index}:"\\\n雪🧪:${'x'.repeat(padding)}`,
    })),
  ];
  const tools = withTools
    ? [
        {
          type: 'function',
          function: {
            name: 'inspect_values',
            description: 'Inspect values',
            parameters: expectedParameters,
          },
        },
      ]
    : undefined;
  if (name === 'openai')
    return JSON.stringify({
      model: 'gpt-4o',
      messages,
      stream: false,
      tools,
      tool_choice: withTools ? 'auto' : undefined,
    });
  if (name === 'openai-vercel')
    return JSON.stringify({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: withTools ? 'auto' : undefined,
      stream: true,
      stream_options: { include_usage: true },
    });
  throw Error('Unknown boundary provider');
}

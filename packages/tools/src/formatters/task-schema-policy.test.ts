/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { applyTaskSchemaPolicy } from './task-schema-policy.js';

describe('task schema publication policy', () => {
  it('withdraws async and its requirement while preserving the remaining declaration constraints', () => {
    const declaration = {
      name: 'task',
      parametersJsonSchema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, async: { type: 'boolean' } },
        required: ['prompt', 'async'],
        additionalProperties: false,
      },
    };
    const published = applyTaskSchemaPolicy(declaration, {
      hideTaskAsync: true,
    });
    expect(published.parametersJsonSchema).toStrictEqual({
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
      additionalProperties: false,
    });
    expect(declaration.parametersJsonSchema.required).toStrictEqual([
      'prompt',
      'async',
    ]);
    expect(declaration.parametersJsonSchema.properties).toHaveProperty('async');
  });

  it('publishes the complete task declaration again when the live policy permits async', () => {
    const declaration = {
      name: 'task',
      parametersJsonSchema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, async: { type: 'boolean' } },
        required: ['prompt', 'async'],
      },
    };
    const hidden = applyTaskSchemaPolicy(declaration, { hideTaskAsync: true });
    const restored = applyTaskSchemaPolicy(declaration, {
      hideTaskAsync: false,
    });
    expect(hidden.parametersJsonSchema).not.toStrictEqual(
      restored.parametersJsonSchema,
    );
    expect(restored).toStrictEqual(declaration);
  });
});

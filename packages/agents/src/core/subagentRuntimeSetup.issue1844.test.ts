/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * Subagent/runtime tool declarations must populate `parametersJsonSchema`
 * so downstream converters don't see empty schemas.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let convertMetadataToFunctionDeclaration: (
  fallbackName: string,
  metadata: {
    name?: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
  },
) => ReturnType<
  typeof import('./subagentRuntimeSetup.js').convertMetadataToFunctionDeclaration
>;

describe('issue #1844 – subagent tool schema regression', () => {
  beforeAll(async () => {
    const mod = await import('./subagentRuntimeSetup.js');
    convertMetadataToFunctionDeclaration =
      mod.convertMetadataToFunctionDeclaration;
  }, 30000);

  it('should populate parametersJsonSchema for OpenAI converters', () => {
    const metadata = {
      name: 'read_file',
      description: 'Read a file',
      parameterSchema: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: 'File path' },
        },
        required: ['path'],
      },
    };

    const decl = convertMetadataToFunctionDeclaration('fallback', metadata);

    expect(
      (decl as unknown as { parametersJsonSchema?: unknown })
        .parametersJsonSchema,
    ).toBeDefined();
    expect(
      (decl as unknown as { parametersJsonSchema?: Record<string, unknown> })
        .parametersJsonSchema?.properties,
    ).toHaveProperty('path');
  });

  it('should still provide parametersJsonSchema when parameterSchema is absent', () => {
    const metadata = {
      name: 'simple_tool',
      description: 'A tool without schema',
    };

    const decl = convertMetadataToFunctionDeclaration('fallback', metadata);

    // parametersJsonSchema should be present (even if minimal) so converters
    // don't skip the tool entirely
    expect(
      (decl as unknown as { parametersJsonSchema?: unknown })
        .parametersJsonSchema,
    ).toBeDefined();
  });
});

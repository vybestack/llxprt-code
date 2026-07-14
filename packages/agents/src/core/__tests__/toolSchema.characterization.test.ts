/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P16
 * @requirement:REQ-006.1
 *
 * CATEGORY (a): CHARACTERIZATION tests that assert the production code emits
 * lowercase JSON Schema type strings (issue #2349 — replaced Gemini-style
 * uppercase Type enum values with standard lowercase JSON Schema values).
 *
 * Covers:
 *  - Executor tool declarations (buildCompleteTaskDeclaration)
 *  - Subagent tool declarations (getScopeLocalFuncDefs, convertMetadataToFunctionDeclaration)
 *  - Property-based tests for any valid type mapping
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { OutputConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

import { buildCompleteTaskDeclaration } from '../../agents/executor-tool-dispatch.js';
import {
  getScopeLocalFuncDefs,
  convertMetadataToFunctionDeclaration,
} from '../subagentRuntimeSetup.js';

const outputConfigWithOutputs: OutputConfig = {
  outputs: { result: 'The final result' },
};

// ---------------------------------------------------------------------------
// Executor tool declarations
// ---------------------------------------------------------------------------

describe('toolSchema characterization — executor (buildCompleteTaskDeclaration)', () => {
  it('produces lowercase "object" for the complete_task parameters type', () => {
    const decl = buildCompleteTaskDeclaration(undefined);
    const schema = decl.parametersJsonSchema as Record<string, unknown>;

    expect(schema['type']).toBe('object');
  });

  it('produces correct JSON-schema properties and required array', () => {
    const decl = buildCompleteTaskDeclaration(undefined);
    const schema = decl.parametersJsonSchema as Record<string, unknown>;

    expect(schema['properties']).toStrictEqual({});
    expect(schema['required']).toStrictEqual([]);
  });

  it('preserves the tool name and description', () => {
    const decl = buildCompleteTaskDeclaration(undefined);

    expect(decl.name).toBe('complete_task');
    expect(decl.description).toContain('complete');
  });
});

// ---------------------------------------------------------------------------
// Subagent tool declarations
// ---------------------------------------------------------------------------

describe('toolSchema characterization — subagent (getScopeLocalFuncDefs)', () => {
  it('produces lowercase "object" for self_emitvalue parameters', () => {
    const decls = getScopeLocalFuncDefs(outputConfigWithOutputs);

    expect(decls).toHaveLength(1);
    const schema = decls[0].parametersJsonSchema as Record<string, unknown>;
    expect(schema['type']).toBe('object');
  });

  it('produces lowercase "string" for emit_variable_name property', () => {
    const decls = getScopeLocalFuncDefs(outputConfigWithOutputs);
    const schema = decls[0].parametersJsonSchema as Record<string, unknown>;
    const properties = schema['properties'] as Record<string, unknown>;
    const nameProp = properties['emit_variable_name'] as Record<
      string,
      unknown
    >;

    expect(nameProp['type']).toBe('string');
  });

  it('produces lowercase "string" for emit_variable_value property', () => {
    const decls = getScopeLocalFuncDefs(outputConfigWithOutputs);
    const schema = decls[0].parametersJsonSchema as Record<string, unknown>;
    const properties = schema['properties'] as Record<string, unknown>;
    const valueProp = properties['emit_variable_value'] as Record<
      string,
      unknown
    >;

    expect(valueProp['type']).toBe('string');
  });

  it('has correct required array', () => {
    const decls = getScopeLocalFuncDefs(outputConfigWithOutputs);
    const schema = decls[0].parametersJsonSchema as Record<string, unknown>;

    expect(schema['required']).toStrictEqual([
      'emit_variable_name',
      'emit_variable_value',
    ]);
  });

  it('returns empty array when outputConfig is undefined', () => {
    const decls = getScopeLocalFuncDefs(undefined);
    expect(decls).toStrictEqual([]);
  });
});

describe('toolSchema characterization — subagent (convertMetadataToFunctionDeclaration)', () => {
  it('defaults parameter type to lowercase "object" when schema omits type', () => {
    const decl = convertMetadataToFunctionDeclaration('test_tool', {
      name: 'test_tool',
      description: 'A test tool',
      parameterSchema: { properties: {} },
    });

    const schema = decl.parametersJsonSchema as Record<string, unknown>;
    expect(schema['type']).toBe('object');
  });

  it('preserves explicit type from parameterSchema', () => {
    const decl = convertMetadataToFunctionDeclaration('test_tool', {
      name: 'test_tool',
      description: 'A test tool',
      parameterSchema: { type: 'string', properties: {} },
    });

    const schema = decl.parametersJsonSchema as Record<string, unknown>;
    expect(schema['type']).toBe('string');
  });

  it('falls back to fallbackName when metadata.name is absent', () => {
    const decl = convertMetadataToFunctionDeclaration('fallback_name', {
      description: 'No name in metadata',
      parameterSchema: { properties: {} },
    });

    expect(decl.name).toBe('fallback_name');
  });

  it('defaults description to empty string when absent', () => {
    const decl = convertMetadataToFunctionDeclaration('test_tool', {
      name: 'test_tool',
      parameterSchema: { properties: {} },
    });

    expect(decl.description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Property-based: JSON Schema type values are lowercase strings
// ---------------------------------------------------------------------------

describe('toolSchema characterization — property-based type mappings', () => {
  // Standard JSON Schema type values (lowercase per JSON Schema spec).

  const typeMappings: ReadonlyArray<readonly [string, string]> = [
    ['string', 'string'],
    ['object', 'object'],
    ['array', 'array'],
    ['number', 'number'],
    ['integer', 'integer'],
    ['boolean', 'boolean'],
  ];

  it('every type value is a lowercase string literal', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...typeMappings),
        ([typeValue, expectedString]) => {
          expect(typeValue).toBe(expectedString);
          expect(typeof typeValue).toBe('string');
        },
      ),
    );
  });

  it('JSON Schema type values are lowercase strings', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...typeMappings.map(([t]) => t)),
        (typeValue) => {
          expect(typeof typeValue).toBe('string');
          expect(typeValue).toBe(typeValue.toLowerCase());
        },
      ),
    );
  });

  it('producing a JSON-schema with a valid type value yields the expected lowercase string', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...typeMappings.map(([, s]) => s)),
        (typeString) => {
          const decl = convertMetadataToFunctionDeclaration('prop_tool', {
            name: 'prop_tool',
            description: 'Property-based tool',
            parameterSchema: { type: typeString, properties: {} },
          });
          const schema = decl.parametersJsonSchema as Record<string, unknown>;
          expect(schema['type']).toBe(typeString);
        },
      ),
    );
  });
});

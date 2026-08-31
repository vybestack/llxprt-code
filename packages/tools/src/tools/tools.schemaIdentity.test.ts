/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260826-AJVCACHE.P03
 * @requirement REQ-3361-03
 */

import { describe, expect, it } from 'bun:test';
import { BaseDeclarativeTool, Kind } from './tools.js';
import type { ToolInvocation, ToolResult } from './tools.js';

interface Params {
  path: string;
}

const PARAMETER_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    old_string: { type: 'string' },
    new_string: { type: 'string' },
  },
  required: ['path'],
  requireOne: [['old_string', 'new_string']],
};

class ProbeTool extends BaseDeclarativeTool<Params, ToolResult> {
  constructor(schema: unknown = PARAMETER_SCHEMA) {
    super('probe', 'Probe', 'probe tool', Kind.Other, schema);
  }

  protected createInvocation(): ToolInvocation<Params, ToolResult> {
    throw new Error('not needed for these assertions');
  }
}

describe('BaseDeclarativeTool schema identity', () => {
  /** @plan PLAN-20260826-AJVCACHE.P03 @requirement REQ-3361-03 */
  it('returns the same schema object across reads', () => {
    const tool = new ProbeTool();

    const first = tool.schema;
    const second = tool.schema;

    // Ajv keys its compiled-validator cache on schema object identity, so a
    // fresh object per read makes every tool call compile and retain a new
    // validator (issue #3361).
    expect(second).toBe(first);
    expect(second.parametersJsonSchema).toBe(first.parametersJsonSchema);
  });

  /** @plan PLAN-20260826-AJVCACHE.P03 @requirement REQ-3361-03 */
  it('still strips requireOne from the schema sent to the model', () => {
    const tool = new ProbeTool();

    const parameters = tool.schema.parametersJsonSchema as Record<
      string,
      unknown
    >;

    expect(parameters['requireOne']).toBeUndefined();
    expect(parameters['required']).toStrictEqual(['path']);
    // The source schema must not be mutated by the derivation.
    expect(
      (PARAMETER_SCHEMA as Record<string, unknown>)['requireOne'],
    ).toBeDefined();
  });

  /** @plan PLAN-20260826-AJVCACHE.P03 @requirement REQ-3361-03 */
  it('returns identical validation outcomes across repeated reads', () => {
    const tool = new ProbeTool();

    for (let index = 0; index < 5; index += 1) {
      expect(
        tool.validateToolParams({ path: '.', old_string: 'a' } as Params),
      ).toBeNull();
    }

    // `required` still applies; a missing required property is rejected the
    // same way on the first read and every later one.
    const missingRequired = tool.validateToolParams({} as Params);
    expect(missingRequired).not.toBeNull();
    expect(missingRequired).toContain('path');
    expect(tool.validateToolParams({} as Params)).toBe(missingRequired);
  });

  /**
   * Characterises existing behaviour rather than endorsing it: the `schema`
   * getter strips `requireOne` before returning, and `validateToolParams`
   * validates against that stripped schema, so `SchemaValidator`'s `requireOne`
   * branch is unreachable through this path. Pre-existing on `main` and out of
   * scope for issue #3361; pinned here so the memoisation cannot be blamed for
   * it and so a future change is deliberate.
   *
   * @plan PLAN-20260826-AJVCACHE.P03
   * @requirement REQ-3361-03
   */
  it('does not enforce requireOne through validateToolParams', () => {
    const tool = new ProbeTool();

    expect(tool.validateToolParams({ path: '.' } as Params)).toBeNull();
  });

  /** @plan PLAN-20260826-AJVCACHE.P03 @requirement REQ-3361-03 */
  it('handles a null parameter schema without caching a stale result', () => {
    const tool = new ProbeTool(null);

    const first = tool.schema;
    const second = tool.schema;

    expect(second).toBe(first);
    expect(first.parametersJsonSchema).toBeNull();
  });
});

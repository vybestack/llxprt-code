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

  /** @plan:PLAN-20260914-ISSUE3293.P2 @requirement:REQ-3293-02 */
  it('sends the declared parameter schema content to the model', () => {
    const declaredSchema = structuredClone(PARAMETER_SCHEMA);
    const tool = new ProbeTool();

    const parameters = tool.schema.parametersJsonSchema;

    expect(parameters).toStrictEqual(PARAMETER_SCHEMA);
    // The source schema must not be mutated by the derivation.
    expect(PARAMETER_SCHEMA).toStrictEqual(declaredSchema);
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

  /** @plan PLAN-20260826-AJVCACHE.P03 @requirement REQ-3361-03 */
  it('handles a null parameter schema without caching a stale result', () => {
    const tool = new ProbeTool(null);

    const first = tool.schema;
    const second = tool.schema;

    expect(second).toBe(first);
    expect(first.parametersJsonSchema).toBeNull();
  });
});

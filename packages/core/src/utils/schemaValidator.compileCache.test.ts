/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260826-AJVCACHE.P02
 * @requirement REQ-3361-01
 */

import { generateHeapSnapshot } from 'bun';
import { describe, expect, it } from 'bun:test';
import { SchemaValidator } from './schemaValidator.js';

const VALIDATION_COUNT = 300;
/**
 * Ajv allocates a small, fixed number of `SchemaEnv` objects for its own meta
 * schemas. A correct compile cache adds none per validation, so anything at or
 * above this bound means validators are accumulating per call.
 */
const SCHEMA_ENV_GROWTH_THRESHOLD = 20;

/** @plan PLAN-20260826-AJVCACHE.P02 @requirement REQ-3361-01 */
function countHeapClass(name: string): number {
  const snapshot = generateHeapSnapshot();
  // Validate the snapshot layout via a class every JavaScript heap has; a Bun
  // format change must fail loudly instead of silently counting zero.
  if (
    !Array.isArray(snapshot.nodes) ||
    !Array.isArray(snapshot.nodeClassNames) ||
    snapshot.nodes.length % 4 !== 0 ||
    snapshot.nodeClassNames.indexOf('Object') < 0
  ) {
    throw new Error(
      'Unexpected heap snapshot encoding; class counts would be unreliable',
    );
  }
  const classCount = snapshot.nodeClassNames.length;
  const classIndex = snapshot.nodeClassNames.indexOf(name);
  if (classIndex < 0) {
    return 0;
  }

  let count = 0;
  for (let position = 2; position < snapshot.nodes.length; position += 4) {
    const nodeClass = snapshot.nodes[position];
    if (nodeClass >= classCount) {
      throw new Error(
        'Unexpected heap snapshot encoding; class index out of bounds',
      );
    }
    if (nodeClass === classIndex) {
      count += 1;
    }
  }
  return count;
}

/** @plan PLAN-20260826-AJVCACHE.P02 @requirement REQ-3361-01 */
function collectGarbage(): void {
  Bun.gc(true);
  Bun.gc(true);
}

describe('SchemaValidator compiled-validator retention', () => {
  /** @plan PLAN-20260826-AJVCACHE.P02 @requirement REQ-3361-01 */
  it('does not retain a compiled validator per validation of a stable schema', () => {
    // A tool declares its schema once; every invocation validates against that
    // same object, which is the shape this cache has to serve.
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        depth: { type: 'number' },
      },
      required: ['path'],
    };

    // Warm up so first-compile allocations are not counted as growth.
    expect(SchemaValidator.validate(schema, { path: '.' })).toBeNull();
    collectGarbage();
    const before = countHeapClass('SchemaEnv');

    for (let index = 0; index < VALIDATION_COUNT; index += 1) {
      expect(SchemaValidator.validate(schema, { path: `dir-${index}` })).toBe(
        null,
      );
    }

    collectGarbage();
    const growth = countHeapClass('SchemaEnv') - before;

    expect(growth).toBeLessThan(SCHEMA_ENV_GROWTH_THRESHOLD);
  });

  /** @plan PLAN-20260826-AJVCACHE.P02 @requirement REQ-3361-02 */
  it('still reports validation errors after repeated validations', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };

    for (let index = 0; index < 5; index += 1) {
      expect(SchemaValidator.validate(schema, { path: 'ok' })).toBeNull();
    }

    const error = SchemaValidator.validate(schema, { depth: 1 });
    expect(error).not.toBeNull();
    expect(error).toContain('path');
  });

  /** @plan PLAN-20260826-AJVCACHE.P02 @requirement REQ-3361-02 */
  it('keeps requireOne enforcement across repeated validations', () => {
    const schema = {
      type: 'object',
      properties: {
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      requireOne: [['old_string', 'new_string']],
    };

    for (let index = 0; index < 5; index += 1) {
      expect(SchemaValidator.validate(schema, { old_string: 'a' })).toBeNull();
    }

    const error = SchemaValidator.validate(schema, {});
    expect(error).toContain('at least one of required properties');
  });

  /** @plan PLAN-20260826-AJVCACHE.P02 @requirement REQ-3361-02 */
  it('keeps draft-07 dialect selection across repeated validations', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };

    for (let index = 0; index < 5; index += 1) {
      expect(SchemaValidator.validate(schema, { name: 'x' })).toBeNull();
    }

    expect(SchemaValidator.validate(schema, {})).toContain('name');
  });
});

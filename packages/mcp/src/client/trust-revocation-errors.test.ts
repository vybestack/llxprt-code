/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { appendFailures } from './trust-revocation-errors.js';

describe('appendFailures', () => {
  it('flattens a circular aggregate error without recursing indefinitely', () => {
    const leafFailure = new Error('leaf failure');
    const circularFailure = new AggregateError([], 'circular');
    circularFailure.errors.push(circularFailure, leafFailure);
    const failures: unknown[] = [];

    appendFailures(failures, circularFailure);

    expect(failures).toStrictEqual([leafFailure]);
  });
});

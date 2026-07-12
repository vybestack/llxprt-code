/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { FailoverState } from './failoverState.js';

describe('FailoverState', () => {
  it('ignores an exhausted rotation reset after a newer request succeeds', () => {
    const state = new FailoverState();
    const olderRequest = state.claim();
    const newerRequest = state.claim();

    state.setIfOwner(newerRequest.owner, 2);
    state.setIfOwner(olderRequest.owner, 0);

    expect(state.getIndex()).toBe(2);
  });

  it('ignores an older success after a newer request succeeds', () => {
    const state = new FailoverState();
    const olderRequest = state.claim();
    const newerRequest = state.claim();

    state.setIfOwner(newerRequest.owner, 1);
    state.setIfOwner(olderRequest.owner, 2);

    expect(state.getIndex()).toBe(1);
  });

  it('ignores an older failure advance after a newer request succeeds', () => {
    const state = new FailoverState();
    const olderRequest = state.claim();
    const newerRequest = state.claim();

    state.setIfOwner(newerRequest.owner, 2);
    state.advanceFrom(olderRequest.owner, 0, 3);
    const followingRequest = state.claim();

    expect(followingRequest.startIndex).toBe(2);
  });
});

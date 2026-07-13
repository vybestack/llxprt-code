/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  LiveTrustTransitionLifecycle,
  type LiveTrustTransitionDependencies,
} from './liveTrustTransitionLifecycle.js';

function createDependencies(
  overrides: Partial<LiveTrustTransitionDependencies> = {},
): LiveTrustTransitionDependencies {
  return {
    downgradeApprovalMode: vi.fn(),
    removeTrustedPolicyRules: vi.fn(),
    updateTrustPolicy: vi.fn(),
    transitionMcp: vi.fn().mockResolvedValue(undefined),
    initializeHooks: vi.fn().mockResolvedValue(undefined),
    emitTrustChanged: vi.fn(),
    ...overrides,
  };
}

async function captureAggregateError(
  promise: Promise<void>,
): Promise<AggregateError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AggregateError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an AggregateError');
}

describe('LiveTrustTransitionLifecycle', () => {
  it('runs no transition side effects after disposal begins', async () => {
    const dependencies = createDependencies();
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);
    lifecycle.beginDisposal();

    lifecycle.apply(false);
    await lifecycle.whenSettled();

    expect(dependencies.downgradeApprovalMode).not.toHaveBeenCalled();
    expect(dependencies.removeTrustedPolicyRules).not.toHaveBeenCalled();
    expect(dependencies.updateTrustPolicy).not.toHaveBeenCalled();
    expect(dependencies.transitionMcp).not.toHaveBeenCalled();
    expect(dependencies.initializeHooks).not.toHaveBeenCalled();
    expect(dependencies.emitTrustChanged).not.toHaveBeenCalled();
  });

  it('reports every synchronous failure in a transition batch', async () => {
    const transitionCount = 101;
    const dependencies = createDependencies({
      removeTrustedPolicyRules: vi.fn(() => {
        throw new Error('policy removal failed');
      }),
    });
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);

    for (let index = 0; index < transitionCount; index++) {
      lifecycle.apply(true);
    }

    const failure = await captureAggregateError(lifecycle.whenSettled());

    expect(failure.errors).toHaveLength(transitionCount);
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import { describe, expect, it, vi } from 'bun:test';
import { StrictMode } from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import { render } from '../../__tests__/render.js';
import { createTurnStore } from '../stores/turn/turnStore.js';

// Provider identity is unrelated to history delivery.
const runtime = {
  providerStatus: () => ({
    providerName: 'test',
    modelName: 'model',
    isPaidMode: false,
  }),
  getActiveProfileName: () => undefined,
  providerManager: () => undefined,
};
void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtime,
  getRuntimeApi: () => runtime,
}));
const { SessionController } = await import('./SessionController.js');

describe('session add request delivery', () => {
  it('does not replay a pending item across StrictMode effects or a subscriber remount', () => {
    const turn = createTurnStore();
    const config = new Config({
      sessionId: 'add-request-2536',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'model',
    });
    turn.commands.requestAddItem({ type: 'info', text: 'deliver once' }, 100);
    const tree = (
      <StrictMode>
        <SessionController
          config={composeFixtureRuntime(config)}
          turnStore={turn}
        >
          {null}
        </SessionController>
      </StrictMode>
    );
    const first = render(tree);
    first.unmount();
    const second = render(tree);
    try {
      expect(
        turn.store
          .getState()
          .history.filter(
            (item) => item.type === 'info' && item.text === 'deliver once',
          ),
      ).toHaveLength(1);
      expect(turn.store.getState().pendingAddRequest).toBeNull();
    } finally {
      second.unmount();
    }
  });
});

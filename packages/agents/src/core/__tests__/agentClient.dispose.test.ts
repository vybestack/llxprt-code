/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { AgentClient } from '../client.js';
import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';

/**
 * The dispose contract's live observables: the constructor registers the
 * client's model-change handlers on the shared core event emitter, dispose()
 * removes them, and repeated dispose() calls are safe. Listener membership on
 * `coreEvents` is the genuine transition (same probe surface as
 * packages/agents/src/api/__tests__/helpers/disposalProbe.ts); the retired
 * ambient runtime-state `_unsubscribe` handle no longer exists.
 */
describe('AgentClient.dispose', () => {
  it('removes core event listeners and is safe on repeated calls', async () => {
    const config = new Config({
      sessionId: 'test-session-id',
      targetDir: '/tmp/test-dir',
    } as unknown as ConfigParameters);
    const runtimeState: AgentRuntimeState = createAgentRuntimeState({
      runtimeId: 'dispose-test-runtime-001',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'dispose-test-session-001',
    });
    const client = new AgentClient(config, runtimeState);
    const handleModelChanged = client['handleModelChanged'];
    const handleModelProfileChanged = client['handleModelProfileChanged'];

    // Constructor registered both handlers on the shared emitter.
    expect(
      coreEvents.listeners(CoreEvent.ModelChanged).includes(handleModelChanged),
    ).toBe(true);
    expect(
      coreEvents
        .listeners(CoreEvent.ModelProfileChanged)
        .includes(handleModelProfileChanged),
    ).toBe(true);

    await client.dispose();

    expect(
      coreEvents.listeners(CoreEvent.ModelChanged).includes(handleModelChanged),
    ).toBe(false);
    expect(
      coreEvents
        .listeners(CoreEvent.ModelProfileChanged)
        .includes(handleModelProfileChanged),
    ).toBe(false);

    // Repeated dispose is safe and listeners stay removed.
    await client.dispose();

    expect(
      coreEvents.listeners(CoreEvent.ModelChanged).includes(handleModelChanged),
    ).toBe(false);
    expect(
      coreEvents
        .listeners(CoreEvent.ModelProfileChanged)
        .includes(handleModelProfileChanged),
    ).toBe(false);
  });
});

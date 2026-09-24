/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the shared post-auth client guard
 * ("no post-auth agent client", createAgent.ts): characterizes the typed
 * fail-fast when activation reported success but the Config still has no
 * agent client.
 *
 * Reachability (investigated, not assumed):
 * - createAgent cannot reach the branch: it always injects
 *   buildAgentClientFactory() (a real `new AgentClient`) into ConfigParameters
 *   before `new Config(params)`, and applyActivation's `config.initialize()`
 *   runs that factory, so `config.getAgentClient()` is defined by finalize.
 * - fromConfig CAN reach it through public seams: a non-CLI consumer's Config
 *   (buildFactoryLessConfig) carrying a caller-supplied agentClientFactory
 *   that returns undefined. fromConfig honors caller factories (caller-wins —
 *   ensureAgentRuntimeFactories only fills ABSENT fields), `ensureInitialized`
 *   runs the factory without validating its result, and an activation intent
 *   with authMode 'none' skips refreshAuth entirely (executeNoAuth), so no
 *   client is ever constructed. The guard then fails fast before task-tool
 *   binding touches the missing client.
 *
 * All collaborators are real (Config, MessageBus, FakeProvider env seam);
 * the undefined-returning factory is the behavior under test, not a mock.
 */

import { describe, expect, it } from 'bun:test';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  getCliRuntimeServices,
  runWithRuntimeScope,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { fromConfig } from '../fromConfig.js';
import { AgentBootstrapError } from '../agentBootstrap.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';

describe('finalizeAgent post-auth client guard', () => {
  it('throws a typed AgentBootstrapError when a caller factory completed bootstrap without constructing an agent client', async () => {
    const runtimeId = 'missing-post-auth-client';
    const built = await buildFactoryLessConfig('plain-text.jsonl', {
      // Deliberate caller-side defect under test: the factory "succeeds"
      // (initialize completes) but constructs nothing. authMode 'none' keeps
      // activation from repairing the omission via refreshAuth.
      agentClientFactory: () => undefined as unknown as AgentClientContract,
    });
    try {
      let captured: unknown;
      try {
        await fromConfig({
          config: built.config,
          sessionId: runtimeId,
          messageBus: built.messageBus,
          activation: {
            provider: 'fake',
            model: 'fake-model',
            authMode: 'none',
          },
        });
        expect.unreachable('fromConfig should have rejected');
      } catch (error) {
        captured = error;
      }

      // The typed fail-fast surfaces verbatim (fromConfig's cleanup rethrows
      // the primary error), naming the missing post-auth client.
      expect(captured).toBeInstanceOf(AgentBootstrapError);
      expect(captured).toBeInstanceOf(Error);
      const bootstrapError = captured as AgentBootstrapError;
      expect(bootstrapError.name).toBe('AgentBootstrapError');
      expect(bootstrapError.message).toBe('no post-auth agent client');

      built.config.setEphemeralSetting('post-auth-failure-probe', true);
      expect(built.config.getEphemeralSetting('post-auth-failure-probe')).toBe(
        true,
      );
      expect(
        built.messageBus.listenerCount(
          MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        ),
      ).toBe(0);
      expect(() =>
        runWithRuntimeScope({ runtimeId, metadata: {} }, () =>
          getCliRuntimeServices(),
        ),
      ).toThrow(/runtime registration|runtime.*not/i);
    } finally {
      await built.cleanup();
    }
  });
});

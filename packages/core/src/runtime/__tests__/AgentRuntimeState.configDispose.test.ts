/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test for the Config-disposal side of the runtime-state
 * subscription registry, kept IN core (the registry and Config are both
 * core-owned; the production subscriber, AgentClient, lives in agents and
 * follows the same lifecycle this test pins).
 *
 * Contract: the client Config constructs via its public agentClientFactory
 * seam subscribes to the runtime-state registry on construction, and
 * Config.dispose() releases that subscription. This replaces the former
 * cross-package observability where an agents-side test read
 * getAgentRuntimeStateSubscriptionCount through the public barrel; that
 * accessor is now in-package only.
 */

import { describe, it, expect } from 'bun:test';
import { Config } from '../../config/config.js';
import type { ConfigParameters } from '../../config/configTypes.js';
import { MessageBus } from '../../confirmation-bus/message-bus.js';
import type { AgentClientContract } from '../../core/clientContract.js';
import {
  subscribeToAgentRuntimeState,
  getAgentRuntimeStateSubscriptionCount,
  type UnsubscribeFunction,
} from '../AgentRuntimeState.js';

/** Fail-fast for contract members this test never exercises. */
function unused(member: string): never {
  throw new Error(`configDispose test: ${member} is not exercised`);
}

/**
 * Minimal real client mirroring the production subscriber lifecycle
 * (AgentClient subscribes in its constructor and unsubscribes in
 * dispose()); only construct and dispose are reachable in this test.
 */
class RuntimeStateSubscribingClient implements AgentClientContract {
  private unsubscribe: UnsubscribeFunction | undefined;

  constructor(runtimeId: string) {
    this.unsubscribe = subscribeToAgentRuntimeState(runtimeId, () => {});
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  initialize(): Promise<void> {
    return unused('initialize');
  }
  // initialize() drives MCP startup which probes client readiness through
  // getAgentClientIfReady(); this client is fully constructed at factory time.
  isInitialized(): boolean {
    return true;
  }
  hasChatInitialized(): boolean {
    return unused('hasChatInitialized');
  }
  getChat: AgentClientContract['getChat'] = () => unused('getChat');
  getHistory(): Promise<readonly never[]> {
    return unused('getHistory');
  }
  getHistoryService(): null {
    return unused('getHistoryService');
  }
  storeHistoryServiceForReuse(): void {
    unused('storeHistoryServiceForReuse');
  }
  storeHistoryForLaterUse(): Promise<void> {
    return unused('storeHistoryForLaterUse');
  }
  // refreshMcpContext (run inside initialize) refreshes the ready client's
  // tool surface and system instruction; this test only needs them to pass.
  async setTools(): Promise<void> {}
  clearTools(): void {
    unused('clearTools');
  }
  async updateSystemInstruction(): Promise<void> {}
  addHistory(): Promise<void> {
    return unused('addHistory');
  }
  resetChat(): Promise<void> {
    return unused('resetChat');
  }
  resumeChat(): Promise<void> {
    return unused('resumeChat');
  }
  setHistory(): Promise<void> {
    return unused('setHistory');
  }
  restoreHistory(): Promise<void> {
    return unused('restoreHistory');
  }
  addDirectoryContext(): Promise<void> {
    return unused('addDirectoryContext');
  }
  getContentGenerator: AgentClientContract['getContentGenerator'] = () =>
    unused('getContentGenerator');
  startChat: AgentClientContract['startChat'] = () => unused('startChat');
  generateDirectMessage: AgentClientContract['generateDirectMessage'] = () =>
    unused('generateDirectMessage');
  generateJson(): Promise<Record<string, unknown>> {
    return unused('generateJson');
  }
  generateContent: AgentClientContract['generateContent'] = () =>
    unused('generateContent');
  generateEmbedding(): Promise<number[][]> {
    return unused('generateEmbedding');
  }
  sendMessageStream: AgentClientContract['sendMessageStream'] = () =>
    unused('sendMessageStream');
  getCurrentSequenceModel(): string | null {
    return unused('getCurrentSequenceModel');
  }
}

describe('runtime-state subscription release on Config.dispose()', () => {
  it('releases the subscription held by the client Config constructed', async () => {
    const runtimeId = 'core-config-dispose-subscription-release';
    const params: ConfigParameters = {
      sessionId: runtimeId,
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      model: 'gemini-2.0-flash',
      agentClientFactory: (_config, runtimeState) =>
        new RuntimeStateSubscribingClient(runtimeState.runtimeId),
    };
    const config = new Config(params);
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    expect(getAgentRuntimeStateSubscriptionCount(runtimeId)).toBe(0);
    await config.initialize({ messageBus });
    // initialize() constructed the client through the factory, and the
    // client subscribed with its runtime state's runtimeId.
    expect(getAgentRuntimeStateSubscriptionCount(runtimeId)).toBe(1);

    await config.dispose();

    expect(getAgentRuntimeStateSubscriptionCount(runtimeId)).toBe(0);
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createMockSettings, renderHook } from '../../../__tests__/render.js';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import type { HistoryItem } from '../../types.js';
import { useStreamEventHandlers } from './useStreamEventHandlers.js';
import { createStreamRuntimeForTest } from './__tests__/streamRuntimeTestHelper.js';

function policyInputs(owner: Agent, history: Array<Omit<HistoryItem, 'id'>>) {
  const runtime = createStreamRuntimeForTest(
    {
      getModel: () => 'conflicting-model',
      getEphemeralSetting: () => undefined,
    },
    { settings: { readCitations: () => false } },
  );
  return {
    runtime,
    getModel: () => owner.getModel(),
    getProvider: () => owner.getProvider(),
    readSelectedProvider: () => owner.getProvider(),
    readCitations: () => owner.getEphemeralSetting('ui.showCitations'),
    readProfileName: () => owner.getActiveProfileName() ?? null,
    readContextLimit: () => owner.getEphemeralSetting('context-limit'),
    getMaxSessionTurns: () => 10,
    logUserPrompt: () => {},
    atCommandConfig: runtime.files,
    getProviderContextLimit: () => 200,
    getContentPrefixIdentity: () => null,
    getToolHandle: (name: string) => owner.tools.get(name),
    findResource: (identifier: string) => owner.mcp.findResource(identifier),
    readResource: (server: string, uri: string) =>
      owner.mcp.readResource(server, uri),
    settings: createMockSettings({}),
    addItem: (item: Omit<HistoryItem, 'id'>) => history.push(item),
    onDebugMessage: () => {},
    onCancelSubmit: () => {},
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: () => {},
    pendingHistoryItemRef: { current: null },
    turnCancelledRef: { current: false },
    clearSubmissions: () => {},
    setPendingHistoryItem: () => {},
    setIsResponding: () => {},
    setThought: () => {},
    setLastAgentActivityTime: () => {},
    scheduleToolCalls: async () => {},
    abortActiveStream: () => {},
    handleShellCommand: () => false,
    handleSlashCommand: async () => false as const,
    logger: null,
    shellModeActive: false,
    loopDetectedRef: { current: false },
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
  };
}

describe('stream policy owner', () => {
  const makeOwner = useCommandOwners();
  it('reads live citation and context policy from the bound owner through mounted replacement', async () => {
    const owner = await makeOwner('stream-policy-owner');
    const sibling = await makeOwner('stream-policy-sibling');
    owner.setEphemeralSetting('ui.showCitations', true);
    owner.setEphemeralSetting('context-limit', 100);
    sibling.setEphemeralSetting('ui.showCitations', false);
    sibling.setEphemeralSetting('context-limit', 200);
    const history: Array<Omit<HistoryItem, 'id'>> = [];
    const hook = renderHook(
      ({ agent }: { agent: Agent }) =>
        useStreamEventHandlers(policyInputs(agent, history)),
      { initialProps: { agent: owner } },
    );
    try {
      hook.result.current.handleCitationEvent('owned citation', 1);
      expect(history).toMatchObject([{ text: 'owned citation' }]);
      hook.result.current.handleContextWindowWillOverflowEvent(101, 80);
      expect(history.at(-1)).toMatchObject({
        text: expect.not.stringContaining('/compress'),
      });
      owner.setEphemeralSetting('context-limit', 200);
      hook.result.current.handleContextWindowWillOverflowEvent(201, 80);
      expect(history.at(-1)).toMatchObject({
        text: expect.stringContaining('/compress'),
      });
      await owner.dispose();
      hook.rerender({ agent: sibling });
      hook.result.current.handleCitationEvent('suppressed citation', 2);
      expect(history).toHaveLength(3);
      sibling.setEphemeralSetting('ui.showCitations', true);
      hook.result.current.handleCitationEvent('surviving citation', 3);
      expect(history.at(-1)).toMatchObject({ text: 'surviving citation' });
    } finally {
      hook.unmount();
    }
  });
});

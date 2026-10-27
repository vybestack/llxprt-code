/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { act, createElement, Fragment } from 'react';
import { SessionStatsProvider } from '../../../contexts/SessionContext.js';
import { ApprovalMode, type IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../../../config/settings.js';
import { buildAgentFromContent } from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import {
  createMockSettings,
  renderHook,
  wrapWithProviders,
} from '../../../../__tests__/render.js';
import { createTurnStore } from '../../../stores/turn/turnStore.js';
import { readJournalItems } from '../../../stores/turn/journal-turn-test-helpers.js';
import { useAgentStream } from '../useAgentStream.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

export async function withJournalStreamHook(
  turns: ReadonlyArray<readonly IContent[]>,
  run: (fixture: {
    readonly agent: Agent;
    submit(query: string): Promise<void>;
    items: () => ReturnType<typeof readJournalItems>;
    state: () => ReturnType<typeof useAgentStream>;
  }) => Promise<void>,
  settings: LoadedSettings = createMockSettings({}),
): Promise<void> {
  const built = await buildAgentFromContent(
    turns.map((chunks) => JSON.stringify({ chunks })).join('\n'),
    { workingDir: process.cwd(), approvalMode: ApprovalMode.YOLO },
  );
  built.agent.setEphemeralSetting('context-limit', 1_000_000);
  await built.agent.session.setRecording({ enabled: true });
  const turn = createTurnStore();
  turn.commands.bindJournal(() => built.agent.agentClient.getHistoryService());
  const runtime = createStreamRuntimeForTest();
  const rendered = renderHook(
    () =>
      useAgentStream(
        built.agent,
        turn.commands.addItem,
        runtime,
        settings,
        () => {},
        async () => false,
        false,
        () => undefined,
        () => {},
        async () => {},
        () => {},
        () => {},
        () => {},
        80,
        24,
      ),
    {
      wrapper: ({ children }) =>
        createElement(
          SessionStatsProvider,
          null,
          wrapWithProviders(createElement(Fragment, null, children), {
            settings,
          }),
        ),
    },
  );
  try {
    await run({
      agent: built.agent,
      submit: async (query) => {
        await act(async () => {
          await rendered.result.current.submitQuery(query);
        });
      },
      items: () => readJournalItems(built.agent),
      state: () => rendered.result.current,
    });
  } finally {
    rendered.unmount();
    await built.cleanup();
  }
}

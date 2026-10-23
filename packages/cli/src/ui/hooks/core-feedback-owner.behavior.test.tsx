/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { useCoreEventHandlers } from './useCoreEventHandlers.js';
import type { ConsoleMessageItem } from '../types.js';

async function recordingPath(agent: Agent): Promise<string> {
  await agent.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'initial' }] },
  ]);
  await agent.session.setRecording({ enabled: true });
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Missing recording path');
  return path;
}

describe('bound core feedback recording', () => {
  const makeOwner = useCommandOwners();
  it('records into the captured owner rather than a decoy and removes its listener on unmount', async () => {
    const owner = await makeOwner('feedback-owner');
    const decoy = await makeOwner('feedback-decoy');
    const ownerPath = await recordingPath(owner);
    const decoyPath = await recordingPath(decoy);
    const messages: ConsoleMessageItem[] = [];
    const props = Object.assign(
      {
        agent: decoy,
        recordingOwner: 'agent' as const,
        uiRuntime: { app: { getDebugMode: () => false } },
      },
      {
        readDebugMode: () => false,
        recordFeedback: (severity: 'warning' | 'error', message: string) =>
          owner.session.recordRecordingEvent({
            type: 'session_event',
            severity,
            message,
          }),
        handleNewMessage: (message: ConsoleMessageItem) =>
          messages.push(message),
      },
    );
    const { unmount } = renderHook(() => useCoreEventHandlers(props));
    try {
      coreEvents.emitFeedback('warning', 'captured feedback writer');
      await waitFor(async () =>
        expect(await readFile(ownerPath, 'utf8')).toContain(
          'captured feedback writer',
        ),
      );
      expect(await readFile(decoyPath, 'utf8')).not.toContain(
        'captured feedback writer',
      );
    } finally {
      unmount();
    }
    coreEvents.emit(CoreEvent.UserFeedback, {
      severity: 'error',
      message: 'retired feedback listener',
    });
    expect(messages.map((message) => message.content)).not.toContain(
      'retired feedback listener',
    );
  });
});

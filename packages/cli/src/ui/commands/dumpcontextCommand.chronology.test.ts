/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #1721: /dumpcontext must surface the client-side chronology trace for
 * debugging WITHOUT putting it inside the provider request body. The body has
 * to stay byte-for-byte what the provider receives, because providers reject
 * unknown fields with HTTP 400.
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { vi, describe, it, expect, type Mock } from 'bun:test';
import { createDumpcontextCommand } from './dumpcontextCommand.js';
import { bindDumpcontextCommand } from './dumpcontextCommandHost.js';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';

const actual = { ...(await import('@vybestack/llxprt-code-providers')) };
void vi.mock('@vybestack/llxprt-code-providers', () => ({
  ...actual,
  dumpRequestContext: vi.fn().mockResolvedValue({
    baseId: '20260101-120000-anthropic-abc123',
    requestFilename: '20260101-120000-anthropic-abc123-request.json',
    dumpDir: '/tmp/.llxprt/dumps',
  }),
}));

import { dumpRequestContext } from '@vybestack/llxprt-code-providers';

const TRACE = [
  {
    seq: 1,
    userTurn: 1,
    step: 1,
    recordedAt: 1_759_000_000_000,
    speaker: 'human',
    blockTypes: ['text'],
    toolCallIds: [],
    toolResponseIds: [],
    isSummary: false,
  },
];

function contextWithTrace(): CommandOwnerFixture {
  const historyService = {
    getAll: vi
      .fn()
      .mockReturnValue([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ]),
    getChronologyTrace: vi.fn().mockReturnValue(TRACE),
  };

  const context = createMockCommandContext({
    services: {
      agent: {
        get agentClient() {
          return vi.fn().mockReturnValue({
            getHistoryService: vi.fn().mockReturnValue(historyService),
          })();
        },
      },
      config: {} as unknown as CommandOwnerFixture['services']['config'],
    },
  });
  Object.defineProperty(context, 'runtimeApi', {
    get: () => ({
      getProviderDumpMetadata: () => ({ providerName: 'anthropic' }),
      getSessionSetting: () => 'off',
      setSessionSetting: vi.fn(),
    }),
  });
  return context;
}

const dumpAndCaptureCall = async (): Promise<unknown[]> => {
  (dumpRequestContext as Mock<typeof dumpRequestContext>).mockClear();
  const context = contextWithTrace();
  const command = createDumpcontextCommand(
    bindDumpcontextCommand({
      readMode: () => context.runtimeApi.getSessionSetting('dumpcontext'),
      writeMode: (mode) =>
        context.runtimeApi.setSessionSetting('dumpcontext', mode),
      readHistory: () => {
        const history = context.services.agent?.agentClient.getHistoryService();
        return history == null
          ? null
          : {
              messages: history.getAll(),
              chronology: history.getChronologyTrace(),
            };
      },
      readProvider: () => context.runtimeApi.getProviderDumpMetadata(),
      readOutputSettings: () => ({}),
      readRuntimeConfig: () => context.services.config,
    }),
  );
  const action = command.action;
  if (action === undefined)
    throw new Error('Dumpcontext action is unavailable');
  await action(context, 'now');
  return (dumpRequestContext as Mock<typeof dumpRequestContext>).mock.calls[0];
};

describe('dumpcontext now chronology sidecar (#1721)', () => {
  it('forwards the history chronology trace to the dump writer', async () => {
    const call = await dumpAndCaptureCall();

    expect(call[3]).toStrictEqual(TRACE);
  });

  it('does not place the trace inside the dumped request', async () => {
    const call = await dumpAndCaptureCall();

    // Structural check rather than a substring scan: this fails if the trace
    // is smuggled into the request under ANY key, not only one literally
    // named "chronology".
    expect(Object.keys(call[0] as object).sort()).toStrictEqual([
      'body',
      'method',
      'url',
    ]);
  });

  it('keeps the dumped body to the provider payload shape', async () => {
    const call = await dumpAndCaptureCall();

    const body = (call[0] as { body: Record<string, unknown> }).body;
    expect(Object.keys(body).sort()).toStrictEqual(['messages']);
  });

  it('still dumps the immediate context request', async () => {
    const call = await dumpAndCaptureCall();

    expect(call[0]).toMatchObject({ url: 'immediate-context-dump' });
  });
});

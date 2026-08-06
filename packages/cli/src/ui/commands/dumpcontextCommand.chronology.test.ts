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

import { vi, describe, it, expect } from 'bun:test';
import { dumpcontextCommand } from './dumpcontextCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

vi.mock('@vybestack/llxprt-code-providers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-providers')>();
  return {
    ...actual,
    dumpRequestContext: vi.fn().mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    }),
  };
});

import { dumpRequestContext } from '@vybestack/llxprt-code-providers';

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: vi.fn(() => ({
    getEphemeralSetting: vi.fn(() => 'off'),
    setEphemeralSetting: vi.fn(),
  })),
}));

import { assertDefined } from '../../test-utils/assertions.js';

const dumpcontextAction = dumpcontextCommand.action;
assertDefined(dumpcontextAction);

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

function contextWithTrace(): CommandContext {
  const historyService = {
    getAll: vi
      .fn()
      .mockReturnValue([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ]),
    getChronologyTrace: vi.fn().mockReturnValue(TRACE),
  };

  return createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue(historyService),
        }),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('anthropic'),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });
}

// Declared as a const arrow (not a hoisted function declaration) so the
// assertDefined narrowing of dumpcontextAction above applies inside the body.
const dumpAndCaptureCall = async (): Promise<unknown[]> => {
  vi.mocked(dumpRequestContext).mockClear();
  await dumpcontextAction(contextWithTrace(), 'now');
  return vi.mocked(dumpRequestContext).mock.calls[0];
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

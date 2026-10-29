/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { readJournalItems } from '../stores/turn/read-journal-items.js';
import { createRecordingProvider } from '../../../../agents/src/api/__tests__/helpers/recording-provider.js';
import { cleanup } from '../../__tests__/render.js';
import {
  openClientToolOwner,
  type ClientToolOwner,
  type ClientToolOwnerOptions,
} from '../../__tests__/client-tool-owner-agent-fixture.js';

describe('Agent-owned CLI client tools', () => {
  const cleanupOwners: Array<() => Promise<void>> = [];

  const releases: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const release of releases.splice(0)) await release();
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(
    name: string,
    options?: ClientToolOwnerOptions,
  ): Promise<ClientToolOwner> {
    const opened = await openClientToolOwner(name, options);
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  it('executes client requests once through each real Agent and keeps the equal-label survivor alive', async () => {
    const a = await owner('alpha');
    const b = await owner('beta');
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = a.hook.result.current[1](
        a.request('a'),
        new AbortController().signal,
      );
      second = b.hook.result.current[1](
        b.request('b'),
        new AbortController().signal,
      );
    });
    await Promise.all([a.entered(), b.entered()]);
    expect(await a.effects()).toStrictEqual(['alpha']);
    expect(await b.effects()).toStrictEqual(['beta']);
    await waitFor(() =>
      expect(
        a.hook.result.current[0].map((call) => call.request.callId),
      ).toStrictEqual(['a']),
    );
    await waitFor(() =>
      expect(
        b.hook.result.current[0].map((call) => call.request.callId),
      ).toStrictEqual(['b']),
    );
    a.hook.unmount();
    let disposed = false;
    const disposal = a.agent.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    await a.release();
    await disposal;
    await first;
    await b.release();
    await act(async () => {
      await second;
    });
    expect(
      b.completed.flat().map((call) => [call.request.callId, call.status]),
    ).toStrictEqual([['b', 'success']]);
    await act(async () => {
      await b.hook.result.current[1](
        b.request('b2'),
        new AbortController().signal,
      );
    });
    expect(await b.effects()).toStrictEqual(['beta', 'beta']);
    expect(b.completed.flat().map((call) => call.request.callId)).toStrictEqual(
      ['b', 'b2'],
    );
  }, 30_000);
  it('renders completed client tools from the journal without model resubmission or clearing the observer', async () => {
    const model = createRecordingProvider({
      alias: 'client-display',
      responses: [[{ type: 'text', text: 'unused' }]],
    });
    const a = await owner('client-display', { modelProvider: model });
    await a.agent.chat('Start the conversation');
    expect(model.requests).toHaveLength(1);
    await a.agent.session.setRecording({ enabled: true });
    await a.release();
    await act(async () => {
      await a.hook.result.current[1](
        a.request('client-display'),
        new AbortController().signal,
      );
    });
    const items = await readJournalItems(a.agent);
    const tools = items.flatMap((item) =>
      item.type === 'tool_group' ? item.tools : [],
    );
    expect(
      tools.map((tool) => [tool.callId, tool.status, tool.resultDisplay]),
    ).toStrictEqual([
      [
        'client-display',
        'Success',
        JSON.stringify({ output: 'recorded' }, null, 2),
      ],
    ]);
    expect(
      a.completed
        .flat()
        .map((call) => [
          call.request.callId,
          'displayCleared' in call && call.displayCleared === true,
        ]),
    ).toStrictEqual([['client-display', false]]);
    expect(model.requests).toHaveLength(1);
  });
});

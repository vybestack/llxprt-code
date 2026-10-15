/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../../__tests__/render.js';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { LoadedSettings } from '../../../config/settings.js';
import { useStreamEventHandlers } from './useStreamEventHandlers.js';
import { PendingResponseBuffer } from './pendingResponseBuffer.js';
import { createStreamRuntimeForTest } from './__tests__/streamRuntimeTestHelper.js';

async function prepareOwnedFile(owner: Agent, decoy: Agent): Promise<string> {
  const dir = owner.workspace.getWorkingDirectory();
  const path = join(dir, 'request.txt');
  await writeFile(path, 'captured query workspace');
  const empty = { settings: {}, path: '' };
  const runtime = createStreamRuntimeForTest(
    { getTargetDir: () => dir, getWorkingDir: () => dir },
    {
      files: {
        directories: () => [...owner.workspace.getDirectories()],
        contains: (path) => owner.workspace.containsPath(path),
        ignore: owner.workspace,
      },
    },
  );
  const hook = renderHook(() =>
    useStreamEventHandlers({
      runtime,
      ...{ agent: decoy },
      getProviderContextLimit: () => owner.getProviderContextLimit(),
      getContentPrefixIdentity: () => null,
      getToolHandle: (name: string) => owner.tools.get(name),
      findResource: (identifier: string) => owner.mcp.findResource(identifier),
      readResource: (server: string, uri: string) =>
        owner.mcp.readResource(server, uri),
      settings: new LoadedSettings(empty, empty, empty, empty, true),
      addItem: () => 0,
      onDebugMessage: () => {},
      onCancelSubmit: () => {},
      sanitizeContent: (text) => ({ text, blocked: false }),
      flushPendingHistoryItem: () => {},
      pendingResponse: new PendingResponseBuffer(undefined),
      pendingHistoryItemRef: { current: null },
      thinkingBlocksRef: { current: [] },
      turnCancelledRef: { current: false },
      clearSubmissions: () => {},
      setPendingHistoryItem: () => {},
      setIsResponding: () => {},
      setThought: () => {},
      setLastAgentActivityTime: () => {},
      scheduleToolCalls: async () => {},
      abortActiveStream: () => {},
      handleShellCommand: () => false,
      handleSlashCommand: async () => false,
      logger: null,
      shellModeActive: false,
      loopDetectedRef: { current: false },
      lastProfileNameRef: { current: undefined },
      lastModelInfoRef: { current: null },
      lastModelIdentityRef: { current: null },
    }),
  );
  try {
    let result = '';
    await act(async () => {
      const query = await hook.result.current.prepareQueryForAgent(
        `@${path}`,
        Date.now(),
        new AbortController().signal,
        'owner-query',
      );
      result = JSON.stringify(query);
    });
    return result;
  } finally {
    hook.unmount();
  }
}
describe('stream query captured tool access', () => {
  const makeOwner = useCommandOwners();
  it('reads owner workspace through captured tools independently of the invocation decoy', async () => {
    const owner = await makeOwner('query-owner');
    const sibling = await makeOwner('query-sibling');
    expect(await prepareOwnedFile(owner, sibling)).toContain(
      'captured query workspace',
    );
    await owner.dispose();
    expect(await prepareOwnedFile(sibling, owner)).toContain(
      'captured query workspace',
    );
  });
});

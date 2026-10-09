/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for checkpointPersistence.ts using injected fs/git mocks.
 * No real filesystem or git operations are performed.
 *
 * Tests cover: happy path, git snapshot fallback, git unavailable,
 * checkpoint dir errors, write failure, no restorable tools, disabled
 * checkpointing, missing file_path arg, and multiple tools.
 */

import { runAllTimersAsync } from '@vybestack/llxprt-code-test-utils';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { renderHook } from '../../../../__tests__/render.js';
import { act } from 'react';
import { readdir } from 'node:fs/promises';
import {
  withCheckpoint,
  checkpointGit,
  trackingFs,
} from '../checkpoint-disk-test-helpers.js';
import type { Config, GitService } from '@vybestack/llxprt-code-core';
import { createFakeAgentFromMockClient } from '../../__tests__/useAgentStream-test-helpers.js';
import type { TrackedToolCall } from '../../useReactToolScheduler.js';
import type { HistoryItem } from '../../../types.js';
import {
  useCheckpointPersistence,
  createToolCheckpoint,
} from '../checkpointPersistence.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/**
 * Wraps createFakeAgentFromMockClient so call sites don't repeat the
 * `as unknown as Record<string, unknown>` cast boilerplate ~15 times.
 */
function makeFakeAgent(mockClient: Record<string, unknown>) {
  return {
    ...createFakeAgentFromMockClient(mockClient),
    async *streamHistory() {},
  };
}

function makeRestorableTool(
  callId: string,
  name: 'replace' | 'write_file',
  filePath: string,
): TrackedToolCall {
  return {
    request: {
      callId,
      name,
      args: { file_path: filePath },
      isClientInitiated: false,
      prompt_id: 'p1',
      agentId: 'primary',
    },
    status: 'awaiting_approval',
    invocation: { getDescription: () => 'test' },
    tool: {
      name,
      displayName: name,
      description: 'test',
      build: vi.fn(),
    },
  } as unknown as TrackedToolCall;
}

function makeNonRestorableTool(): TrackedToolCall {
  return {
    request: {
      callId: 'nr-1',
      name: 'read_file',
      args: { file_path: '/foo/bar.ts' },
      isClientInitiated: false,
      prompt_id: 'p1',
      agentId: 'primary',
    },
    status: 'awaiting_approval',
    invocation: { getDescription: () => 'test' },
    tool: {
      name: 'read_file',
      displayName: 'Read File',
      description: 'test',
      build: vi.fn(),
    },
  } as unknown as TrackedToolCall;
}

function makeConfig(checkpointEnabled = true): Config {
  return {
    getCheckpointingEnabled: vi.fn(() => checkpointEnabled),
    storage: {
      getProjectTempCheckpointsDir: vi.fn(() => '/tmp/checkpoints'),
    },
  } as unknown as Config;
}

type MockFsOps = {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
};

function makeFsOps(overrides?: Partial<MockFsOps>) {
  const output = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return {
    ...output,
    open: async (file: string) => ({
      writeFile: async (source: AsyncIterable<string>) => {
        let data = '';
        for await (const chunk of source) data += chunk;
        await output.writeFile(file, data);
      },
      sync: async () => {},
      close: async () => {},
    }),
    rename: async () => {},
    rm: async () => {},
  };
}

type MockGitService = {
  createFileSnapshot: ReturnType<typeof vi.fn>;
  getCurrentCommitHash: ReturnType<typeof vi.fn>;
};

function makeGitService(
  commitHash = 'abc123',
  snapshotHash = 'snap456',
): MockGitService {
  return {
    createFileSnapshot: vi.fn().mockResolvedValue(snapshotHash),
    getCurrentCommitHash: vi.fn().mockResolvedValue(commitHash),
  };
}

function makeAgentClient(): { getHistory: ReturnType<typeof vi.fn> } {
  return {
    getHistory: vi.fn().mockResolvedValue([]),
  };
}

const mockHistory: HistoryItem[] = [];

// ─── createToolCheckpoint unit tests ─────────────────────────────────────────

describe('createToolCheckpoint', () => {
  it(
    'writes checkpoint file with correct structure on happy path',
    checkpointCase1,
  );
  it(
    'falls back to getCurrentCommitHash when createFileSnapshot throws',
    checkpointCase2,
  );
  it(
    'logs debug message and returns early when both git methods fail',
    checkpointCase3,
  );
  it('returns early when file_path is missing', checkpointCase4);
});

// ─── useCheckpointPersistence hook tests ─────────────────────────────────────

describe('checkpoint effect cancellation', () => {
  it('cancels the in-flight disk save on unmount and closes its source', async () => {
    await withCheckpoint(512, false, async (fixture, dir) => {
      fixture.history.pauseAt = 1;
      vi.spyOn(
        fixture.config.storage,
        'getProjectTempCheckpointsDir',
      ).mockReturnValue(dir);
      let finish: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const { unmount } = renderHook(() =>
        useCheckpointPersistence(
          [
            makeRestorableTool(
              'cancel-hook',
              'write_file',
              '/project/cancel.ts',
            ),
          ],
          { getCheckpointingEnabled: () => true },
          checkpointGit,
          mockHistory,
          fixture.config.getAgentClient(),
          fixture.config.storage,
          () => finish(),
          trackingFs().ops,
        ),
      );
      await fixture.history.paused.promise;
      unmount();
      fixture.history.resume.resolve();
      const outcome = await Promise.race([
        finished.then(() => 'cancelled'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('not-cancelled'), 1000),
        ),
      ]);
      expect(outcome).toBe('cancelled');
      expect(await readdir(dir)).toStrictEqual([]);
      expect(fixture.history.closed).toBe(1);
      expect(fixture.reader.snapshot().liveRows).toBe(0);
    });
  }, 180000);
});

describe('useCheckpointPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it(
    'writes checkpoint file for each restorable tool on happy path',
    checkpointCase5,
  );
  it('exits immediately when checkpointing is disabled', checkpointCase6);
  it('exits immediately when there are no restorable tools', checkpointCase7);
  it('logs debug and skips tool when gitService is null', checkpointCase8);
  it(
    'swallows EEXIST on mkdir and continues to write checkpoint',
    checkpointCase9,
  );
  it(
    'returns early on non-EEXIST mkdir error without writing files',
    checkpointCase10,
  );
  it('continues to next tool when writeFile throws', checkpointCase11);
  it('does not write when checkpointDir is null', checkpointCase12);
  it(
    'does not re-checkpoint the same tool on subsequent effect runs',
    checkpointCase13,
  );
  it(
    're-checkpoints a tool if it leaves and re-enters the tool list',
    checkpointCase14,
  );
});

async function checkpointCase1(): Promise<void> {
  const gitService = makeGitService('snap456');
  const agentClient = makeAgentClient();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();

  const checkpointDir = path.resolve('/tmp/checkpoints');
  await createToolCheckpoint(
    makeRestorableTool('c1', 'replace', '/project/src/foo.ts'),
    checkpointDir,
    gitService as unknown as GitService,
    makeFakeAgent(agentClient),
    mockHistory,
    onDebugMessage,
    fsOps,
  );

  expect(fsOps.writeFile).toHaveBeenCalledOnce();
  expect(fsOps.writeFile.mock.calls[0][0]).toContain(checkpointDir);
  expect(fsOps.writeFile.mock.calls[0][0]).toContain('foo.ts');
  expect(fsOps.writeFile.mock.calls[0][0]).toContain('replace');
  const writtenContent = JSON.parse(fsOps.writeFile.mock.calls[0][1]);
  expect(writtenContent.commitHash).toBe('snap456');
  expect(writtenContent.filePath).toBe('/project/src/foo.ts');
  expect(writtenContent.toolCall.name).toBe('replace');
  expect(writtenContent.history).toStrictEqual(mockHistory);
  expect(onDebugMessage).not.toHaveBeenCalled();
}

async function checkpointCase2(): Promise<void> {
  const gitService = makeGitService('fallback-hash');
  gitService.createFileSnapshot.mockRejectedValue(new Error('snapshot failed'));
  const agentClient = makeAgentClient();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();

  await createToolCheckpoint(
    makeRestorableTool('c1', 'write_file', '/project/file.ts'),
    '/tmp/checkpoints',
    gitService as unknown as GitService,
    makeFakeAgent(agentClient),
    mockHistory,
    onDebugMessage,
    fsOps,
  );

  expect(gitService.getCurrentCommitHash).toHaveBeenCalledOnce();
  const writtenContent = JSON.parse(fsOps.writeFile.mock.calls[0][1]);
  expect(writtenContent.commitHash).toBe('fallback-hash');
  // Debug message about failed snapshot should have been logged
  expect(onDebugMessage).toHaveBeenCalledTimes(1);
  expect(onDebugMessage).toHaveBeenCalledWith(
    expect.stringContaining('Attempting to use current commit'),
  );
}

async function checkpointCase3(): Promise<void> {
  const gitService = makeGitService();
  gitService.createFileSnapshot.mockRejectedValue(new Error('no snapshot'));
  gitService.getCurrentCommitHash.mockResolvedValue(null);
  const agentClient = makeAgentClient();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();

  await createToolCheckpoint(
    makeRestorableTool('c1', 'replace', '/project/file.ts'),
    '/tmp/checkpoints',
    gitService as unknown as GitService,
    makeFakeAgent(agentClient),
    mockHistory,
    onDebugMessage,
    fsOps,
  );

  expect(fsOps.writeFile).not.toHaveBeenCalled();
  expect(onDebugMessage).toHaveBeenCalledTimes(2); // snapshot fail + no hash
  expect(onDebugMessage.mock.calls[1][0]).toContain(
    'Checkpointing may not be working properly',
  );
}

async function checkpointCase4(): Promise<void> {
  const toolWithNoPath = makeRestorableTool('c1', 'replace', '');
  toolWithNoPath.request.args['file_path'] = undefined;
  const gitService = makeGitService();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();

  await createToolCheckpoint(
    toolWithNoPath,
    '/tmp/checkpoints',
    gitService as unknown as GitService,
    makeFakeAgent(makeAgentClient()),
    mockHistory,
    onDebugMessage,
    fsOps,
  );

  expect(fsOps.writeFile).not.toHaveBeenCalled();
  expect(gitService.createFileSnapshot).not.toHaveBeenCalled();
  expect(onDebugMessage).toHaveBeenCalledTimes(1);
  expect(onDebugMessage).toHaveBeenCalledWith(
    expect.stringContaining('missing file_path'),
  );
}

async function checkpointCase5(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const agentClient = makeAgentClient();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();
  const tools = [
    makeRestorableTool('r1', 'replace', '/project/a.ts'),
    makeRestorableTool('r2', 'write_file', '/project/b.ts'),
  ];

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        tools,
        config,
        gitService as unknown as GitService,
        mockHistory,
        makeFakeAgent(agentClient),
        config.storage,
        onDebugMessage,
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  expect(fsOps.writeFile).toHaveBeenCalledTimes(2);
  expect(onDebugMessage).not.toHaveBeenCalled();
}

async function checkpointCase6(): Promise<void> {
  const config = makeConfig(false);
  const gitService = makeGitService();
  const fsOps = makeFsOps();

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        [makeRestorableTool('r1', 'replace', '/project/a.ts')],
        config,
        gitService as unknown as GitService,
        mockHistory,
        makeFakeAgent(makeAgentClient()),
        config.storage,
        vi.fn(),
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  expect(fsOps.mkdir).not.toHaveBeenCalled();
  expect(fsOps.writeFile).not.toHaveBeenCalled();
}

async function checkpointCase7(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const fsOps = makeFsOps();

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        [makeNonRestorableTool()], // read_file — not restorable
        config,
        gitService as unknown as GitService,
        mockHistory,
        makeFakeAgent(makeAgentClient()),
        config.storage,
        vi.fn(),
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  expect(fsOps.mkdir).not.toHaveBeenCalled();
  expect(fsOps.writeFile).not.toHaveBeenCalled();
}

async function checkpointCase8(): Promise<void> {
  const config = makeConfig(true);
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        [makeRestorableTool('r1', 'replace', '/project/a.ts')],
        config,
        undefined, // no gitService
        mockHistory,
        makeFakeAgent(makeAgentClient()),
        config.storage,
        onDebugMessage,
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  expect(fsOps.writeFile).not.toHaveBeenCalled();
  expect(onDebugMessage).toHaveBeenCalledTimes(1);
  expect(onDebugMessage).toHaveBeenCalledWith(
    expect.stringContaining('Git service is not available'),
  );
}

async function checkpointCase9(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const agentClient = makeAgentClient();
  const eexistError = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
  const fsOps = makeFsOps({
    mkdir: vi.fn().mockRejectedValue(eexistError),
  });
  const onDebugMessage = vi.fn();

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        [makeRestorableTool('r1', 'replace', '/project/a.ts')],
        config,
        gitService as unknown as GitService,
        mockHistory,
        makeFakeAgent(agentClient),
        config.storage,
        onDebugMessage,
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  // EEXIST should be swallowed — write should still happen
  expect(fsOps.writeFile).toHaveBeenCalledOnce();
  expect(onDebugMessage).not.toHaveBeenCalled();
}

async function checkpointCase10(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const permError = Object.assign(new Error('EPERM'), { code: 'EPERM' });
  const fsOps = makeFsOps({
    mkdir: vi.fn().mockRejectedValue(permError),
  });
  const onDebugMessage = vi.fn();

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        [makeRestorableTool('r1', 'replace', '/project/a.ts')],
        config,
        gitService as unknown as GitService,
        mockHistory,
        makeFakeAgent(makeAgentClient()),
        config.storage,
        onDebugMessage,
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  expect(fsOps.writeFile).not.toHaveBeenCalled();
  expect(onDebugMessage).toHaveBeenCalledTimes(1);
  expect(onDebugMessage).toHaveBeenCalledWith(
    expect.stringContaining('Failed to create checkpoint directory'),
  );
}

async function checkpointCase11(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const agentClient = makeAgentClient();
  const writeError = new Error('disk full');
  const fsOps = makeFsOps({
    writeFile: vi.fn().mockRejectedValue(writeError),
  });
  const onDebugMessage = vi.fn();
  const tools = [
    makeRestorableTool('r1', 'replace', '/project/a.ts'),
    makeRestorableTool('r2', 'write_file', '/project/b.ts'),
  ];

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        tools,
        config,
        gitService as unknown as GitService,
        mockHistory,
        makeFakeAgent(agentClient),
        config.storage,
        onDebugMessage,
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  // Both tools attempted — both caught, both debug messages
  expect(onDebugMessage).toHaveBeenCalledTimes(2);
  expect(onDebugMessage.mock.calls[0][0]).toContain(
    'Failed to create checkpoint',
  );
}

async function checkpointCase12(): Promise<void> {
  const config = {
    getCheckpointingEnabled: vi.fn(() => true),
    storage: {
      getProjectTempCheckpointsDir: vi.fn(() => null),
    },
  } as unknown as Config;
  const fsOps = makeFsOps();

  await act(async () => {
    renderHook(() =>
      useCheckpointPersistence(
        [makeRestorableTool('r1', 'replace', '/project/a.ts')],
        config,
        makeGitService() as unknown as GitService,
        mockHistory,
        makeFakeAgent(makeAgentClient()),
        config.storage,
        vi.fn(),
        fsOps,
      ),
    );
    await runAllTimersAsync();
  });

  expect(fsOps.mkdir).not.toHaveBeenCalled();
  expect(fsOps.writeFile).not.toHaveBeenCalled();
}

async function checkpointCase13(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const agentClient = makeAgentClient();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();
  const tools = [makeRestorableTool('r1', 'replace', '/project/a.ts')];

  let currentTools = tools;
  const { rerender } = renderHook(() =>
    useCheckpointPersistence(
      currentTools,
      config,
      gitService as unknown as GitService,
      mockHistory,
      makeFakeAgent(agentClient),
      config.storage,
      onDebugMessage,
      fsOps,
    ),
  );

  await act(async () => {
    await runAllTimersAsync();
  });

  expect(fsOps.writeFile).toHaveBeenCalledTimes(1);

  // Re-render with the same tools — should NOT checkpoint again
  currentTools = [...tools];
  rerender();
  await act(async () => {
    await runAllTimersAsync();
  });

  expect(fsOps.writeFile).toHaveBeenCalledTimes(1);
}

async function checkpointCase14(): Promise<void> {
  const config = makeConfig(true);
  const gitService = makeGitService();
  const agentClient = makeAgentClient();
  const fsOps = makeFsOps();
  const onDebugMessage = vi.fn();
  const tool = makeRestorableTool('r1', 'replace', '/project/a.ts');

  let currentTools: TrackedToolCall[] = [tool];
  const { rerender } = renderHook(() =>
    useCheckpointPersistence(
      currentTools,
      config,
      gitService as unknown as GitService,
      mockHistory,
      makeFakeAgent(agentClient),
      config.storage,
      onDebugMessage,
      fsOps,
    ),
  );

  await act(async () => {
    await runAllTimersAsync();
  });
  expect(fsOps.writeFile).toHaveBeenCalledTimes(1);

  // Tool leaves the list
  currentTools = [];
  rerender();
  await act(async () => {
    await runAllTimersAsync();
  });

  // Tool re-enters — should checkpoint again
  currentTools = [tool];
  rerender();
  await act(async () => {
    await runAllTimersAsync();
  });

  expect(fsOps.writeFile).toHaveBeenCalledTimes(2);
}

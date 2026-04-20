/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Unit tests for checkpointPersistence.ts using injected fs/git mocks.
 * No real filesystem or git operations are performed.
 *
 * Tests cover: happy path, git snapshot fallback, git unavailable,
 * checkpoint dir errors, write failure, no restorable tools, disabled
 * checkpointing, missing file_path arg, and multiple tools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { act } from 'react';
import type {
  Config,
  GeminiClient,
  GitService,
} from '@vybestack/llxprt-code-core';
import type { TrackedToolCall } from '../../useReactToolScheduler.js';
import type { HistoryItem } from '../../../types.js';
import {
  useCheckpointPersistence,
  createToolCheckpoint,
} from '../checkpointPersistence.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

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
    invocation: { getDescription: () => 'test' } as any,
    tool: {
      name,
      displayName: name,
      description: 'test',
      build: vi.fn(),
    } as any,
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
    invocation: { getDescription: () => 'test' } as any,
    tool: {
      name: 'read_file',
      displayName: 'Read File',
      description: 'test',
      build: vi.fn(),
    } as any,
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

function makeFsOps(overrides?: Partial<MockFsOps>): MockFsOps {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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

function makeGeminiClient(): { getHistory: ReturnType<typeof vi.fn> } {
  return {
    getHistory: vi.fn().mockResolvedValue([]),
  };
}

const mockHistory: HistoryItem[] = [];

// ─── createToolCheckpoint unit tests ─────────────────────────────────────────

describe('createToolCheckpoint', () => {
  it('writes checkpoint file with correct structure on happy path', async () => {
    const gitService = makeGitService('snap456');
    const geminiClient = makeGeminiClient();
    const fsOps = makeFsOps();
    const onDebugMessage = vi.fn();

    await createToolCheckpoint(
      makeRestorableTool('c1', 'replace', '/project/src/foo.ts'),
      '/tmp/checkpoints',
      gitService as unknown as GitService,
      geminiClient as unknown as GeminiClient,
      mockHistory,
      onDebugMessage,
      fsOps,
    );

    expect(fsOps.writeFile).toHaveBeenCalledOnce();
    const writtenPath = fsOps.writeFile.mock.calls[0][0];
    const writtenContent = JSON.parse(fsOps.writeFile.mock.calls[0][1]);

    expect(writtenPath).toContain('/tmp/checkpoints');
    expect(writtenPath).toContain('foo.ts');
    expect(writtenPath).toContain('replace');
    expect(writtenContent.commitHash).toBe('snap456');
    expect(writtenContent.filePath).toBe('/project/src/foo.ts');
    expect(writtenContent.toolCall.name).toBe('replace');
    expect(writtenContent.history).toStrictEqual(mockHistory);
    expect(onDebugMessage).not.toHaveBeenCalled();
  });

  it('falls back to getCurrentCommitHash when createFileSnapshot throws', async () => {
    const gitService = makeGitService('fallback-hash');
    gitService.createFileSnapshot.mockRejectedValue(
      new Error('snapshot failed'),
    );
    const geminiClient = makeGeminiClient();
    const fsOps = makeFsOps();
    const onDebugMessage = vi.fn();

    await createToolCheckpoint(
      makeRestorableTool('c1', 'write_file', '/project/file.ts'),
      '/tmp/checkpoints',
      gitService as unknown as GitService,
      geminiClient as unknown as GeminiClient,
      mockHistory,
      onDebugMessage,
      fsOps,
    );

    expect(gitService.getCurrentCommitHash).toHaveBeenCalledOnce();
    const writtenContent = JSON.parse(fsOps.writeFile.mock.calls[0][1]);
    expect(writtenContent.commitHash).toBe('fallback-hash');
    // Debug message about failed snapshot should have been logged
    expect(onDebugMessage).toHaveBeenCalledOnce();
    expect(onDebugMessage.mock.calls[0][0]).toContain(
      'Attempting to use current commit',
    );
  });

  it('logs debug message and returns early when both git methods fail', async () => {
    const gitService = makeGitService();
    gitService.createFileSnapshot.mockRejectedValue(new Error('no snapshot'));
    gitService.getCurrentCommitHash.mockResolvedValue(null);
    const geminiClient = makeGeminiClient();
    const fsOps = makeFsOps();
    const onDebugMessage = vi.fn();

    await createToolCheckpoint(
      makeRestorableTool('c1', 'replace', '/project/file.ts'),
      '/tmp/checkpoints',
      gitService as unknown as GitService,
      geminiClient as unknown as GeminiClient,
      mockHistory,
      onDebugMessage,
      fsOps,
    );

    expect(fsOps.writeFile).not.toHaveBeenCalled();
    expect(onDebugMessage).toHaveBeenCalledTimes(2); // snapshot fail + no hash
    expect(onDebugMessage.mock.calls[1][0]).toContain(
      'Checkpointing may not be working properly',
    );
  });

  it('returns early when file_path is missing', async () => {
    const toolWithNoPath = makeRestorableTool('c1', 'replace', '');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    (toolWithNoPath.request.args as Record<string, unknown>)['file_path'] =
      undefined;
    const gitService = makeGitService();
    const fsOps = makeFsOps();
    const onDebugMessage = vi.fn();

    await createToolCheckpoint(
      toolWithNoPath,
      '/tmp/checkpoints',
      gitService as unknown as GitService,
      makeGeminiClient() as unknown as GeminiClient,
      mockHistory,
      onDebugMessage,
      fsOps,
    );

    expect(fsOps.writeFile).not.toHaveBeenCalled();
    expect(gitService.createFileSnapshot).not.toHaveBeenCalled();
    expect(onDebugMessage).toHaveBeenCalledOnce();
    expect(onDebugMessage.mock.calls[0][0]).toContain('missing file_path');
  });
});

// ─── useCheckpointPersistence hook tests ─────────────────────────────────────

describe('useCheckpointPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes checkpoint file for each restorable tool on happy path', async () => {
    const config = makeConfig(true);
    const gitService = makeGitService();
    const geminiClient = makeGeminiClient();
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
          geminiClient as unknown as GeminiClient,
          (config as any).storage,
          onDebugMessage,
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    expect(fsOps.writeFile).toHaveBeenCalledTimes(2);
    expect(onDebugMessage).not.toHaveBeenCalled();
  });

  it('exits immediately when checkpointing is disabled', async () => {
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
          makeGeminiClient() as unknown as GeminiClient,
          (config as any).storage,
          vi.fn(),
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    expect(fsOps.mkdir).not.toHaveBeenCalled();
    expect(fsOps.writeFile).not.toHaveBeenCalled();
  });

  it('exits immediately when there are no restorable tools', async () => {
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
          makeGeminiClient() as unknown as GeminiClient,
          (config as any).storage,
          vi.fn(),
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    expect(fsOps.mkdir).not.toHaveBeenCalled();
    expect(fsOps.writeFile).not.toHaveBeenCalled();
  });

  it('logs debug and skips tool when gitService is null', async () => {
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
          makeGeminiClient() as unknown as GeminiClient,
          (config as any).storage,
          onDebugMessage,
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    expect(fsOps.writeFile).not.toHaveBeenCalled();
    expect(onDebugMessage).toHaveBeenCalledOnce();
    expect(onDebugMessage.mock.calls[0][0]).toContain(
      'Git service is not available',
    );
  });

  it('swallows EEXIST on mkdir and continues to write checkpoint', async () => {
    const config = makeConfig(true);
    const gitService = makeGitService();
    const geminiClient = makeGeminiClient();
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
          geminiClient as unknown as GeminiClient,
          (config as any).storage,
          onDebugMessage,
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    // EEXIST should be swallowed — write should still happen
    expect(fsOps.writeFile).toHaveBeenCalledOnce();
    expect(onDebugMessage).not.toHaveBeenCalled();
  });

  it('returns early on non-EEXIST mkdir error without writing files', async () => {
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
          makeGeminiClient() as unknown as GeminiClient,
          (config as any).storage,
          onDebugMessage,
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    expect(fsOps.writeFile).not.toHaveBeenCalled();
    expect(onDebugMessage).toHaveBeenCalledOnce();
    expect(onDebugMessage.mock.calls[0][0]).toContain(
      'Failed to create checkpoint directory',
    );
  });

  it('continues to next tool when writeFile throws', async () => {
    const config = makeConfig(true);
    const gitService = makeGitService();
    const geminiClient = makeGeminiClient();
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
          geminiClient as unknown as GeminiClient,
          (config as any).storage,
          onDebugMessage,
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    // Both tools attempted — both caught, both debug messages
    expect(onDebugMessage).toHaveBeenCalledTimes(2);
    expect(onDebugMessage.mock.calls[0][0]).toContain(
      'Failed to create checkpoint',
    );
  });

  it('does not write when checkpointDir is null', async () => {
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
          makeGeminiClient() as unknown as GeminiClient,
          (config as any).storage,
          vi.fn(),
          fsOps,
        ),
      );
      await vi.runAllTimersAsync();
    });

    expect(fsOps.mkdir).not.toHaveBeenCalled();
    expect(fsOps.writeFile).not.toHaveBeenCalled();
  });

  it('does not re-checkpoint the same tool on subsequent effect runs', async () => {
    const config = makeConfig(true);
    const gitService = makeGitService();
    const geminiClient = makeGeminiClient();
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
        geminiClient as unknown as GeminiClient,
        (config as any).storage,
        onDebugMessage,
        fsOps,
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fsOps.writeFile).toHaveBeenCalledTimes(1);

    // Re-render with the same tools — should NOT checkpoint again
    currentTools = [...tools];
    rerender();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fsOps.writeFile).toHaveBeenCalledTimes(1);
  });

  it('re-checkpoints a tool if it leaves and re-enters the tool list', async () => {
    const config = makeConfig(true);
    const gitService = makeGitService();
    const geminiClient = makeGeminiClient();
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
        geminiClient as unknown as GeminiClient,
        (config as any).storage,
        onDebugMessage,
        fsOps,
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fsOps.writeFile).toHaveBeenCalledTimes(1);

    // Tool leaves the list
    currentTools = [];
    rerender();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Tool re-enters — should checkpoint again
    currentTools = [tool];
    rerender();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fsOps.writeFile).toHaveBeenCalledTimes(2);
  });
});

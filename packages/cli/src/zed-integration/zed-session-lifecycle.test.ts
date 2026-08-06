/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import type * as acp from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { ChatSessionFileLister } from './zed-session-loader.js';

import { RecordingConnection } from './zed-test-helpers.js';

const tmpRoots: string[] = [];

function makeTmpRoot(): string {
  const root = mkdtempSync(
    path.join(os.tmpdir(), 'llxprt-zed-2564-lifecycle-'),
  );
  tmpRoots.push(root);
  return root;
}

const emptyChatsLister: ChatSessionFileLister = async () => [];

const mockFromConfig = vi.hoisted(() => vi.fn());

const mockDeleteSessionById = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-agents', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fromConfig: (...args: unknown[]) => mockFromConfig(...args),
  };
});

vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  loadProfileByName: vi.fn(),
  setCliRuntimeContext: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    deleteSessionById: (...args: Parameters<typeof actual.deleteSessionById>) =>
      mockDeleteSessionById(...args),
  };
});

interface StubAgentHandle {
  readonly agent: Agent;
  readonly resume: ReturnType<typeof vi.fn>;
  readonly setRecording: ReturnType<typeof vi.fn>;
  readonly getHistory: ReturnType<typeof vi.fn>;
  readonly disposedCount: () => number;
}

function buildStubAgent(options: {
  liveHistory?: readonly AgentMessage[];
  beforeDispose?: () => Promise<void>;
}): StubAgentHandle {
  const resume = vi.fn(async () => [] as readonly IContent[]);
  const setRecording = vi.fn(async () => undefined);
  const getHistory = vi.fn(async () => options.liveHistory ?? []);
  let disposedCount = 0;
  const agent = {
    getApprovalMode: () => 'default',
    setApprovalMode: vi.fn(),
    async dispose() {
      if (options.beforeDispose !== undefined) {
        await options.beforeDispose();
      }
      disposedCount += 1;
    },
    getHistory,
    async *stream() {
      yield { type: 'done', reason: 'stop' };
    },
    session: { resume, setRecording },
    tools: { respondToConfirmation: vi.fn() },
  } as unknown as Agent;
  return {
    agent,
    resume,
    setRecording,
    getHistory,
    disposedCount: () => disposedCount,
  };
}

function buildBaseConfig(root: string): Config {
  return {
    getFileSystemService: () => ({
      readTextFile: vi.fn(async () => 'base'),
      writeTextFile: vi.fn(async () => undefined),
    }),
    getProviderManager: () => ({ id: 'base' }),
    setProviderManager: vi.fn(),
    getProfileManager: () => undefined,
    getEphemeralSetting: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getProjectRoot: () => '/project',
    getMaxSessionTurns: () => 50,
    getSessionRecordingService: () => undefined,
    storage: {
      getProjectTempDir: () => root,
      getProjectChatsDir: () => path.join(root, 'chats'),
    },
  } as unknown as Config;
}

function buildStubSettings(): LoadedSettings {
  return {} as LoadedSettings;
}

function buildInitializeRequest(): acp.InitializeRequest {
  return { protocolVersion: 1, clientCapabilities: {} };
}

async function makeZedAgent(
  root: string,
): Promise<InstanceType<typeof import('./zedIntegration.js').ZedAgent>> {
  const mod = await import('./zedIntegration.js');
  const zedAgent = new mod.ZedAgent(
    buildBaseConfig(root),
    buildStubSettings(),
    new RecordingConnection() as unknown as acp.AgentSideConnection,
    emptyChatsLister,
  );
  await zedAgent.initialize(buildInitializeRequest());
  return zedAgent;
}

function defaultNotFoundDelete(): void {
  mockDeleteSessionById.mockResolvedValue({
    ok: false,
    error: 'Session not found: test',
  });
}

describe('ACP session close/delete lifecycle boundaries (issue #2564)', () => {
  afterEach(() => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop();
      if (root !== undefined) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  beforeEach(() => {
    mockFromConfig.mockReset();
    mockDeleteSessionById.mockReset();
    defaultNotFoundDelete();
  });

  it('succeeds when closing then deleting an unrecorded session (new→close→delete)', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    await zedAgent.closeSession({ sessionId: created.sessionId });
    expect(stub.disposedCount()).toBe(1);

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});

    expect(stub.disposedCount()).toBe(1);
  });

  it('rejects delete of an unknown session with -32002', async () => {
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    await expect(
      zedAgent.deleteSession({ sessionId: 'never-existed' }),
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('close(unknown) succeeds but a subsequent delete(unknown) still rejects with -32002', async () => {
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    await expect(
      zedAgent.closeSession({ sessionId: 'never-existed' }),
    ).resolves.toStrictEqual({});

    await expect(
      zedAgent.deleteSession({ sessionId: 'never-existed' }),
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('rejects a second delete after successful close→delete with -32002', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    await zedAgent.closeSession({ sessionId: created.sessionId });
    await zedAgent.deleteSession({ sessionId: created.sessionId });

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('delete of a live unrecorded session succeeds (existing behavior preserved)', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    expect(stub.disposedCount()).toBe(1);
  });

  it('preserves a retry marker when live-session deletion throws', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });
    mockDeleteSessionById.mockRejectedValueOnce(
      new Error('EIO: storage is unavailable'),
    );

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32603 });
    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    expect(stub.disposedCount()).toBe(1);
  });

  it('preserves a retry marker when live-session deletion returns an internal error', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });
    mockDeleteSessionById.mockResolvedValueOnce({
      ok: false,
      error: 'Failed to lock session for deletion: deadlock',
    });

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32603 });
    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    expect(stub.disposedCount()).toBe(1);
  });

  it('serializes concurrent close and delete for the same session id', async () => {
    let releaseDispose!: () => void;
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const stub = buildStubAgent({
      beforeDispose: async () => {
        await disposeGate;
      },
    });
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    const closePromise = zedAgent.closeSession({
      sessionId: created.sessionId,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const deletePromise = zedAgent.deleteSession({
      sessionId: created.sessionId,
    });

    releaseDispose();
    await Promise.all([closePromise, deletePromise]);

    expect(stub.disposedCount()).toBe(1);
  });

  it('consumes the known-closed marker when persisted deletion succeeds (result.ok)', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    await zedAgent.closeSession({ sessionId: created.sessionId });
    expect(stub.disposedCount()).toBe(1);

    mockDeleteSessionById.mockResolvedValueOnce({
      ok: true,
      deletedSessionId: created.sessionId,
    });

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});

    expect(stub.disposedCount()).toBe(1);

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('preserves the known-closed marker when storage throws, allowing a subsequent retry', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    await zedAgent.closeSession({ sessionId: created.sessionId });
    expect(stub.disposedCount()).toBe(1);

    mockDeleteSessionById.mockRejectedValueOnce(
      new Error('EIO: storage is unavailable'),
    );

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32603 });

    expect(stub.disposedCount()).toBe(1);

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
  });

  it('coexistence of live session and known-closed marker: first delete succeeds, second rejects -32002', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    // close adds a known-closed marker and disposes the live session
    await zedAgent.closeSession({ sessionId: created.sessionId });
    expect(stub.disposedCount()).toBe(1);

    // loadSession restores the session to a live state while the
    // known-closed marker persists (issue #2564 stale marker regression)
    await zedAgent.loadSession({
      sessionId: created.sessionId,
      cwd: '/project',
      mcpServers: [],
    });

    // first delete must consume BOTH the live session and the marker
    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});

    // second delete must reject because neither live nor marker remains
    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('preserves the known-closed marker when storage resolves an internal error, allowing a subsequent retry', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const root = makeTmpRoot();
    const zedAgent = await makeZedAgent(root);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    await zedAgent.closeSession({ sessionId: created.sessionId });
    expect(stub.disposedCount()).toBe(1);

    // deleteSessionById resolves a non-not-found error (internal failure)
    mockDeleteSessionById.mockResolvedValueOnce({
      ok: false,
      error: 'Failed to lock session for deletion: deadlock',
    });

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).rejects.toMatchObject({ code: -32603 });

    expect(stub.disposedCount()).toBe(1);

    // a later not-found retry succeeds because the marker was preserved
    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
  });
});

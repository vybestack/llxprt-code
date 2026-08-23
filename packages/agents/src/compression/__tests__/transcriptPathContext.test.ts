/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for issue #2933: CompressionHandler must publish the
 * session journal's path on the CompressionContext it builds.
 *
 * These drive the real CompressionHandler against a real HistoryService and a
 * real SessionRecordingService writing to a real temp directory, so
 * materialization (the point at which getFilePath() stops returning null) is
 * genuine rather than simulated. The recording service is held in a mutable
 * holder that stands in for the Config seam the production wiring reads, which
 * is what lets a swap (resume) be exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { CompressionHandler } from '../CompressionHandler.js';

const original = { ...(await import('@vybestack/llxprt-code-settings')) };
void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...original,
  Storage: {
    ...original.Storage,
    getGlobalConfigDir: vi.fn(() => '/tmp/llxprt-test-config'),
  },
}));

function makeHandler(historyService: HistoryService): CompressionHandler {
  const runtimeContext: AgentRuntimeContext = buildRuntimeContext(
    historyService,
    { contextLimit: 200_000, compressionThreshold: 0.8 },
  );
  const provider = {
    name: 'test',
    generateChatCompletion: vi.fn(),
  } as unknown as RuntimeProvider;
  const providerResult: CompressionProviderResult = {
    provider,
    runtime: runtimeContext.providerRuntime,
  };
  return new CompressionHandler(
    runtimeContext,
    historyService,
    {},
    vi.fn().mockResolvedValue(providerResult),
    vi.fn().mockResolvedValue(undefined),
  );
}

function textContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('CompressionHandler transcriptPath wiring (#2933)', () => {
  let tempDir: string;
  let historyService: HistoryService;
  let handler: CompressionHandler;
  /** Stands in for the Config seam the production provider closure reads. */
  let installed: SessionRecordingService | undefined;
  const created: SessionRecordingService[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue2933-'));
    historyService = new HistoryService();
    handler = makeHandler(historyService);
    installed = undefined;
  });

  afterEach(async () => {
    for (const service of created.splice(0)) {
      await service.dispose();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function newRecordingService(
    name: string,
  ): Promise<SessionRecordingService> {
    const chatsDir = path.join(tempDir, name);
    await fs.mkdir(chatsDir, { recursive: true });
    const service = new SessionRecordingService({
      sessionId: `session-${name}`,
      projectHash: 'abc123def456',
      chatsDir,
      workspaceDirs: [tempDir],
      cwd: tempDir,
      provider: 'test-provider',
      model: 'test-model',
    });
    created.push(service);
    return service;
  }

  /** Mirrors the production closure in ChatSessionFactory. */
  function installLiveProvider(): void {
    handler.setTranscriptPathProvider(
      () => installed?.getFilePath() ?? undefined,
    );
  }

  it('omits transcriptPath entirely when no provider is injected', async () => {
    const context = await handler.buildCompressionContext('prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });

  it('omits transcriptPath when no recording service is installed', async () => {
    installLiveProvider();

    const context = await handler.buildCompressionContext('prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });

  it('omits transcriptPath while the recording has not materialized a file', async () => {
    installed = await newRecordingService('unmaterialized');
    installLiveProvider();

    expect(installed.getFilePath()).toBeNull();
    const context = await handler.buildCompressionContext('prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });

  it('publishes the materialized journal path once the file exists on disk', async () => {
    installed = await newRecordingService('active');
    installLiveProvider();
    installed.recordContent(textContent('hello'));
    await installed.flush();

    const context = await handler.buildCompressionContext('prompt-1');

    const materializedPath = installed.getFilePath();
    expect(materializedPath).not.toBeNull();
    expect(context.transcriptPath).toBe(materializedPath as string);
    const stats = await fs.stat(context.transcriptPath as string);
    expect(stats.isFile()).toBe(true);
  });

  it('follows a recording service swap and a later removal', async () => {
    const first = await newRecordingService('first');
    const second = await newRecordingService('second');
    for (const service of [first, second]) {
      service.recordContent(textContent('hello'));
      await service.flush();
    }
    const firstPath = first.getFilePath();
    const secondPath = second.getFilePath();
    expect(firstPath).not.toBeNull();
    expect(secondPath).not.toBeNull();
    expect(secondPath).not.toBe(firstPath);

    installed = first;
    installLiveProvider();
    const before = await handler.buildCompressionContext('prompt-1');
    expect(before.transcriptPath).toBe(firstPath as string);

    // A resume replaces the live recording service.
    installed = second;
    const afterSwap = await handler.buildCompressionContext('prompt-2');
    expect(afterSwap.transcriptPath).toBe(secondPath as string);

    // Recording is turned off again.
    installed = undefined;
    const afterStop = await handler.buildCompressionContext('prompt-3');
    expect('transcriptPath' in afterStop).toBe(false);
  });

  it('omits transcriptPath rather than publishing an empty string', async () => {
    handler.setTranscriptPathProvider(() => '');

    const context = await handler.buildCompressionContext('prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });
});

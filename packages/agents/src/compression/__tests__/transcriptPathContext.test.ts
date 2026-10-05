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
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { resolveTranscriptPath } from '../../core/ChatSessionFactory.js';
import { ChatSession } from '../../core/chatSession.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import { SummaryTransport } from './middleout-disk-helpers.js';
import type { CompressionAttemptContext } from '../compressionContextBuilder.js';
import { regressionHistory } from './compression-regression-fixtures.js';

const observedContexts = new WeakMap<
  CompressionHandler,
  CompressionAttemptContext
>();
async function observeContext(
  handler: CompressionHandler,
  prompt: string,
): Promise<CompressionAttemptContext> {
  await handler.performCompression(prompt);
  const context = observedContexts.get(handler);
  if (context === undefined)
    throw new Error('Compression hook did not receive context');
  return context;
}

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
  const result = new CompressionHandler(
    runtimeContext,
    historyService,
    {},
    vi.fn().mockResolvedValue(providerResult),
    async (context) => {
      observedContexts.set(result, context);
    },
  );
  return result;
}

function textContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

/** Narrows the recorder's nullable path after materialization. */
function requireFilePath(service: SessionRecordingService): string {
  const filePath = service.getFilePath();
  if (filePath === null) {
    throw new Error('expected the recording service to have materialized');
  }
  return filePath;
}

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

/** A recorder that has actually written its JSONL file to disk. */
async function materializedRecordingService(
  name: string,
): Promise<SessionRecordingService> {
  const service = await newRecordingService(name);
  service.recordContent(textContent('hello'));
  await service.flush();
  return service;
}

/**
 * Installs the production resolution rule over the holder, so these tests
 * exercise the same code the factory wires rather than a copy of it.
 */
function installLiveProvider(
  handler: CompressionHandler,
  getInstalled: () => SessionRecordingService | undefined,
): void {
  const config = {
    getSessionRecordingService: getInstalled,
  } as unknown as Config;
  handler.setTranscriptPathProvider(() => resolveTranscriptPath(config));
}

let tempDir: string;
let historyService: HistoryService;
let handler: CompressionHandler;
/** Stands in for the Config seam the production provider closure reads. */
let installed: SessionRecordingService | undefined;
const created: SessionRecordingService[] = [];

describe('CompressionHandler transcriptPath wiring (#2933)', () => {
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
  it('omits transcriptPath entirely when no provider is injected', async () => {
    const context = await observeContext(handler, 'prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });

  it('omits transcriptPath when no recording service is installed', async () => {
    installLiveProvider(handler, () => installed);

    const context = await observeContext(handler, 'prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });

  it('omits transcriptPath while the recording has not materialized a file', async () => {
    installed = await newRecordingService('unmaterialized');
    installLiveProvider(handler, () => installed);

    expect(installed.getFilePath()).toBeNull();
    const context = await observeContext(handler, 'prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });

  it('publishes the materialized journal path once the file exists on disk', async () => {
    installed = await materializedRecordingService('active');
    installLiveProvider(handler, () => installed);

    const context = await observeContext(handler, 'prompt-1');

    const materializedPath = requireFilePath(installed);
    expect(context.transcriptPath).toBe(materializedPath);
    const stats = await fs.stat(materializedPath);
    expect(stats.isFile()).toBe(true);
  });

  it('follows a recording service swap and a later removal', async () => {
    const first = await materializedRecordingService('first');
    const second = await materializedRecordingService('second');
    const firstPath = requireFilePath(first);
    const secondPath = requireFilePath(second);
    expect(secondPath).not.toBe(firstPath);

    installed = first;
    installLiveProvider(handler, () => installed);
    const before = await observeContext(handler, 'prompt-1');
    expect(before.transcriptPath).toBe(firstPath);

    // A resume replaces the live recording service.
    installed = second;
    const afterSwap = await observeContext(handler, 'prompt-2');
    expect(afterSwap.transcriptPath).toBe(secondPath);

    // Recording is turned off again.
    installed = undefined;
    const afterStop = await observeContext(handler, 'prompt-3');
    expect('transcriptPath' in afterStop).toBe(false);
  });

  it('stops publishing the path once the recorder is no longer active', async () => {
    installed = await materializedRecordingService('deactivated');
    installLiveProvider(handler, () => installed);
    const materializedPath = requireFilePath(installed);
    const before = await observeContext(handler, 'prompt-1');
    expect(before.transcriptPath).toBe(materializedPath);

    // A recorder that stops still remembers the file it was writing to; the
    // context must not keep advertising it as the live journal.
    await installed.dispose();
    expect(installed.isActive()).toBe(false);
    expect(installed.getFilePath()).toBe(materializedPath);

    const after = await observeContext(handler, 'prompt-2');

    expect('transcriptPath' in after).toBe(false);
  });

  it('omits transcriptPath rather than publishing an empty string', async () => {
    handler.setTranscriptPathProvider(() => '');

    const context = await observeContext(handler, 'prompt-1');

    expect('transcriptPath' in context).toBe(false);
  });
});

describe('ChatSession forwards the journal path into compression (#2933)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a path installed on the chat reaches the strategy that builds the summary', async () => {
    const historyService = new HistoryService();
    const runtimeContext = buildRuntimeContext(historyService, {
      compressionStrategy: 'one-shot',
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    });
    historyService.addAll(regressionHistory());
    const transport = new SummaryTransport();
    vi.spyOn(runtimeContext.provider, 'getActiveProvider').mockReturnValue(
      transport,
    );
    const chat = new ChatSession(
      runtimeContext,
      {} as unknown as ContentGenerator,
      {},
      [],
    );

    let seenContext: Omit<CompressionContext, 'history'> | undefined;
    const compressDisk = OneShotStrategy.prototype.compressDisk;
    vi.spyOn(OneShotStrategy.prototype, 'compressDisk').mockImplementation(
      function (this: OneShotStrategy, context, candidate) {
        seenContext = context;
        return compressDisk.call(this, context, candidate);
      },
    );

    chat.setTranscriptPathProvider(() => '/chats/live-session.jsonl');
    await chat.performCompression('prompt-1');

    expect(seenContext?.transcriptPath).toBe('/chats/live-session.jsonl');
  });
});

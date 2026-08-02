/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
import {
  createToolRegistry,
  type ToolRegistryHost,
} from './toolRegistryFactory.js';
import type { ProfileManager } from './profileManager.js';
import type { SubagentManager } from './subagentManager.js';

function createHost(
  options: {
    asyncTaskManager?: AsyncTaskManager;
    subagentManager?: SubagentManager;
    profileManager?: ProfileManager;
    noCoreTools?: boolean;
    getImageBackendResolver?: () => (() => unknown) | null | undefined;
  } = {},
): ToolRegistryHost {
  const { asyncTaskManager, noCoreTools } = options;
  let { profileManager, subagentManager } = options;
  const getImageBackendResolver = options.getImageBackendResolver;
  return {
    getCoreTools: () =>
      noCoreTools === true
        ? undefined
        : [
            'TaskTool',
            'ListSubagentsTool',
            'check_async_tasks',
            'GenerateImageTool',
          ],
    getExcludeTools: () => [],
    getUseRipgrep: () => false,
    getProfileManager: () => profileManager,
    setProfileManager: (pm: ProfileManager) => {
      profileManager = pm;
    },
    getSubagentManager: () => subagentManager,
    setSubagentManager: (sm: SubagentManager) => {
      subagentManager = sm;
    },
    getInteractiveSubagentSchedulerFactory: () => undefined,
    getAsyncTaskManager: () => asyncTaskManager,
    getTaskToolRegistration: () => undefined,
    ...(getImageBackendResolver !== undefined
      ? { getImageBackendResolver }
      : {}),
  };
}

function createConfigBoundary(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    getCoreTools: () => ['TaskTool', 'ListSubagentsTool', 'check_async_tasks'],
    getExcludeTools: () => [],
    // No broker transport wired, so the github tool is not registered.
    // @plan PLAN-20260731-GHBROKER.P15
    getGitHubBrokerClient: () => undefined,
    getToolDiscoveryCommand: () => undefined,
    getToolCallCommand: () => undefined,
    getPromptRegistry: () => undefined,
    getSettingsService: () => undefined,
    getEphemeralSettings: () => ({}),
    isToolEnabled: () => true,
    isTrustedFolder: () => false,
    isInteractive: () => false,
    ...overrides,
  };
}

describe('toolRegistryFactory adapter-backed runtime tools', () => {
  it('registers ListSubagentsTool through CoreSubagentServiceAdapter so registry invocation can list subagents', async () => {
    const subagentManager = {
      getCachedSubagentNames: vi.fn().mockReturnValue(['alpha']),
      getCachedSubagentConfig: vi.fn().mockReturnValue({
        name: 'alpha',
        profile: 'reviewer',
        systemPrompt: 'Review TypeScript migration boundaries.',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      }),
      listSubagents: vi.fn().mockResolvedValue([]),
    } as unknown as SubagentManager;

    const { registry } = await createToolRegistry(
      createHost({
        profileManager: {} as ProfileManager,
        subagentManager,
      }),
      createConfigBoundary(),
      new MessageBus(),
    );

    const tool = registry.getTool('list_subagents');
    expect(tool).toBeDefined();
    const result = await tool!.build({}).execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"name": "alpha"');
    expect(result.returnDisplay).toContain('Review TypeScript migration');
  });

  it('registers CheckAsyncTasksTool through CoreAsyncTaskServiceAdapter so registry invocation can inspect async tasks', async () => {
    const asyncTaskManager = new AsyncTaskManager(5);
    asyncTaskManager.registerTask({
      id: 'task-registry-adapter',
      subagentName: 'typescriptexpert',
      goalPrompt: 'Verify registry wiring',
      abortController: new AbortController(),
    });

    const { registry } = await createToolRegistry(
      createHost({ asyncTaskManager }),
      createConfigBoundary(),
      new MessageBus(),
    );

    const tool = registry.getTool('check_async_tasks');
    expect(tool).toBeDefined();
    const result = await tool!.build({}).execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Async Tasks Summary');
    expect(result.llmContent).toContain('task-registry-adapter');
  });

  async function createRegistryWithEmojiMode(mode: string) {
    const configBoundary = createConfigBoundary({
      getEphemeralSettings: () => ({ emojifilter: mode }),
    });

    return createToolRegistry(
      createHost({
        noCoreTools: true,
        profileManager: {} as ProfileManager,
        subagentManager: {
          getCachedSubagentNames: vi.fn().mockReturnValue([]),
          listSubagents: vi.fn().mockResolvedValue([]),
        } as unknown as SubagentManager,
      }),
      configBoundary,
      new MessageBus(),
    );
  }

  it('registers todo_write through createToolRegistry: auto mode filters emojis and succeeds', async () => {
    const { registry } = await createRegistryWithEmojiMode('auto');

    const tool = registry.getTool('todo_write');
    expect(tool).toBeDefined();

    const result = await tool!
      .build({
        todos: [{ id: '1', content: '\u2705 Fix the bug', status: 'pending' }],
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('[OK] Fix the bug');
    expect(result.llmContent).not.toContain('system-reminder');
  });

  it('registers todo_write through createToolRegistry: warn mode filters and includes warning', async () => {
    const { registry } = await createRegistryWithEmojiMode('warn');

    const tool = registry.getTool('todo_write');
    expect(tool).toBeDefined();

    const result = await tool!
      .build({
        todos: [{ id: '1', content: '\u2705 Fix the bug', status: 'pending' }],
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('[OK] Fix the bug');
    expect(result.llmContent).toContain('system-reminder');
    expect(result.llmContent).toContain('avoid using emojis');
  });

  it('registers todo_write through createToolRegistry: allowed mode preserves emoji content', async () => {
    const { registry } = await createRegistryWithEmojiMode('allowed');

    const tool = registry.getTool('todo_write');
    expect(tool).toBeDefined();

    const result = await tool!
      .build({
        todos: [{ id: '1', content: '\u2705 Fix the bug', status: 'pending' }],
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('\u2705 Fix the bug');
    expect(result.llmContent).not.toContain('[OK]');
  });

  it('registers todo_write through createToolRegistry: error mode blocks emoji content', async () => {
    const { registry, allPotentialTools } =
      await createRegistryWithEmojiMode('error');

    const todoRecord = allPotentialTools.find(
      (t) => t.displayName === 'todo_write',
    );
    expect(todoRecord).toBeDefined();
    expect(todoRecord!.isRegistered).toBe(true);

    const tool = registry.getTool('todo_write');
    expect(tool).toBeDefined();

    const cleanResult = await tool!
      .build({
        todos: [{ id: '1', content: 'Fix the bug', status: 'pending' }],
      })
      .execute(new AbortController().signal);
    expect(cleanResult.error).toBeUndefined();

    const emojiResult = await tool!
      .build({
        todos: [{ id: '1', content: '\u2705 Fix the bug', status: 'pending' }],
      })
      .execute(new AbortController().signal);
    expect(emojiResult.error).toBeDefined();
    expect(emojiResult.error!.message.toLowerCase()).toContain('emoji');
  });

  it('registers todo_pause through createToolRegistry: auto mode filters pause reason emojis', async () => {
    const { registry } = await createRegistryWithEmojiMode('auto');

    const tool = registry.getTool('todo_pause');
    expect(tool).toBeDefined();

    const result = await tool!
      .build({
        reason: '\u2705 Pause for real blocker',
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(result.returnDisplay).toContain('[OK] Pause for real blocker');
    expect(result.returnDisplay).not.toContain('\u2705');
  });
});

/**
 * Real minimal 1x1 PNG (signature + IHDR + IDAT + IEND) built inline so the
 * registry/persistence regression test does not depend on a fixture file.
 */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngCrc32(buf: Buffer): number {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0xff_ff_ff_ff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function makeRealMinimalPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rawScanline = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const storedBlockHeader = Buffer.from([0x01]);
  const storedLen = Buffer.alloc(2);
  storedLen.writeUInt16LE(rawScanline.length, 0);
  const storedNlen = Buffer.alloc(2);
  storedNlen.writeUInt16LE(~rawScanline.length & 0xffff, 0);
  const adler32 = (() => {
    let a = 1;
    let b = 0;
    for (const byte of rawScanline) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  })();
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32, 0);
  const idatData = Buffer.concat([
    zlibHeader,
    storedBlockHeader,
    storedLen,
    storedNlen,
    rawScanline,
    checksum,
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('toolRegistryFactory generate_image lazy resolver timing and persistence wiring', () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-registry-image-'),
    );
  });

  afterEach(async () => {
    if (tempWorkspace) {
      await fs.promises.rm(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('reaches the backend injected after registry creation and persists output under getTargetDir()', async () => {
    const pngBase64 = makeRealMinimalPng().toString('base64');

    // A real stub backend captured via a mutable holder so the resolver can be
    // injected AFTER the registry is created (mirrors the CLI composition
    // order: registry built first, image resolver set later).
    let generateReached = false;
    const backend = {
      name: 'stub-image-backend',
      provider: 'stub',
      model: 'stub-model',
      async generate() {
        generateReached = true;
        return {
          mimeType: 'image/png',
          encoding: 'base64' as const,
          data: pngBase64,
          caption: 'a registry cat',
        };
      },
      async edit() {
        throw new Error('edit not used');
      },
    };

    // Initially null — the registry must be created before the resolver exists.
    let resolver: (() => unknown) | null = null;

    const host = createHost({
      getImageBackendResolver: () => resolver,
    });

    const configBoundary = createConfigBoundary({
      getTargetDir: () => tempWorkspace,
    });

    const { registry } = await createToolRegistry(
      host,
      configBoundary,
      new MessageBus(),
    );

    // Now inject the resolver (lazy: read at invocation time, not registration).
    resolver = () => backend;

    const tool = registry.getTool('generate_image');
    expect(tool).toBeDefined();

    const result = await tool!
      .build({ prompt: 'a registry cat', output_path: 'cat.png' })
      .execute(new AbortController().signal);

    expect(generateReached).toBe(true);
    expect(result.error).toBeUndefined();

    // Persistence wired through the caller-selected output path rooted at
    // getTargetDir(); the file must exist at the exact requested path.
    const savedPath = path.join(tempWorkspace, 'cat.png');
    const written = await fs.promises.readFile(savedPath);
    expect(written.equals(makeRealMinimalPng())).toBe(true);
    expect(result.returnDisplay).toContain(savedPath);
    expect(result.llmContent).toStrictEqual(
      expect.arrayContaining([expect.stringContaining(savedPath)]),
    );
  });

  it('maps a resolver returning undefined to the graceful TOOL_DISABLED path (not a TypeError)', async () => {
    // A resolver that returns undefined must be coerced to null so the
    // runImageOperation `backend === null` capability check fires, producing
    // TOOL_DISABLED — NOT a TypeError mapped to EXECUTION_FAILED.
    const tempWorkspace = await fs.promises.realpath(
      await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-registry-undef-'),
      ),
    );
    try {
      const host = createHost({
        getImageBackendResolver: () => () => undefined,
      });

      const configBoundary = createConfigBoundary({
        getTargetDir: () => tempWorkspace,
      });

      const { registry } = await createToolRegistry(
        host,
        configBoundary,
        new MessageBus(),
      );

      const tool = registry.getTool('generate_image');
      expect(tool).toBeDefined();

      const result = await tool!
        .build({ prompt: 'a cat', output_path: 'cat.png' })
        .execute(new AbortController().signal);

      // The capability path must fire: TOOL_DISABLED, not EXECUTION_FAILED.
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe('tool_disabled');
    } finally {
      await fs.promises.rm(tempWorkspace, { recursive: true, force: true });
    }
  });
});

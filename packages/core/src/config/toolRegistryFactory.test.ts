/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runImageOperation } from '../services/image/imageOperationDispatch.js';
import type { ImageOperationRunner } from '../services/image/imageCapability.js';
import type { ImageOperationBackend } from '../services/image/imageOperation.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import {
  WorkspaceDefinitionOwner,
  type ProfileDefinitionReads,
  type SubagentDefinitionReads,
} from '../services/workspace-definition-owner.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import type { WorkspacePathOperations } from '../services/workspace-filesystem-owner.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { CheckAsyncTasksTool } from '@vybestack/llxprt-code-tools';
import { AsyncWorkFacade } from '../services/asyncWorkFacade.js';
import { CoreAsyncTaskServiceAdapter } from '../tools-adapters/CoreAsyncTaskServiceAdapter.js';
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
import { createTaskRegistration } from '@vybestack/llxprt-code-agents';
import {
  createToolRegistry,
  type TaskToolRegistration,
  type ToolRegistryHost,
} from './toolRegistryFactory.js';
import { SubagentManager } from './subagentManager.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { Config } from './config.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';

describe('tool registry assembly', () => {
  const createFilesystem = installTestWorkspaceFilesystem();
  const settingsOwners: SessionSettingsOwner[] = [];
  const configs: Config[] = [];
  const definitions: Array<{
    directory: string;
    owner: WorkspaceDefinitionOwner;
  }> = [];
  afterEach(async () => {
    for (const { directory, owner } of definitions.splice(0)) {
      await owner.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
    for (const owner of settingsOwners.splice(0)) await owner.dispose();
    await Promise.all(configs.splice(0).map((config) => config.dispose()));
  });

  function createHost(
    options: {
      subagentManager?: SubagentManager;
      profileManager?: ProfileManager;
      noCoreTools?: boolean;
      // Read lazily at call time so a test can flip governance or install the
      // late registration between the registry build and a reconcile call —
      // the same live-host property fromConfig relies on.
      excludeTools?: string[];
      taskToolRegistration?: TaskToolRegistration;
    } = {},
  ): ToolRegistryHost & {
    readonly profileDefinitions: ProfileDefinitionReads;
    readonly subagentDefinitions: SubagentDefinitionReads;
  } {
    const { noCoreTools } = options;
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'registry-definitions-'),
    );
    const owner = new WorkspaceDefinitionOwner(
      path.join(directory, 'profiles'),
      path.join(directory, 'subagents'),
    );
    definitions.push({ directory, owner });
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
      getExcludeTools: () => options.excludeTools ?? [],
      getUseRipgrep: () => false,
      profileDefinitions: options.profileManager ?? owner.profileReads,
      subagentDefinitions: options.subagentManager ?? owner.subagentReads,
    };
  }

  function createConfigBoundary(
    overrides: Partial<ConstructorParameters<typeof Config>[0]> = {},
  ): Config {
    const config = new Config({
      sessionId: 'registry-test',
      targetDir: os.tmpdir(),
      cwd: os.tmpdir(),
      debugMode: false,
      model: 'test-model',
      trustedFolder: true,
      interactive: false,
      ...overrides,
    });
    configs.push(config);
    return config;
  }

  describe('toolRegistryFactory adapter-backed runtime tools', () => {
    it('registers ListSubagentsTool against the resolved manager and sees subsequent metadata updates', async () => {
      const directory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-registry-subagents-'),
      );
      try {
        const profileManager = new ProfileManager(directory);
        const subagentManager = new SubagentManager(directory, profileManager);
        subagentManager.registerSettingsSubagents({
          alpha: {
            profile: 'reviewer',
            systemPrompt: 'Review TypeScript migration boundaries.',
          },
        });
        const { registry } = await assembleFixtureToolRegistry(
          createHost({ profileManager, subagentManager }),
          createConfigBoundary(),
          new MessageBus(),
        );

        const tool = registry.getTool('list_subagents');
        expect(tool).toBeDefined();
        const initial = await tool!
          .build({})
          .execute(new AbortController().signal);
        expect(initial.error).toBeUndefined();
        expect(initial.llmContent).toContain('"name": "alpha"');
        expect(initial.returnDisplay).toContain('Review TypeScript migration');

        subagentManager.registerExtensionSubagents('plugin', [
          {
            name: 'later',
            profile: 'helper',
            systemPrompt: 'New extension agent',
          },
        ]);
        const updated = await tool!
          .build({})
          .execute(new AbortController().signal);
        expect(updated.metadata).toStrictEqual({ count: 2 });
        expect(updated.returnDisplay).toContain(
          '**later** (profile: helper) — New extension agent',
        );
      } finally {
        await fs.promises.rm(directory, { recursive: true, force: true });
      }
    });

    it('requires task query binding and uses explicit task operations to inspect tasks', async () => {
      const asyncTaskManager = new AsyncTaskManager(5);
      asyncTaskManager.registerTask({
        id: 'task-registry-adapter',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Verify registry wiring',
        abortController: new AbortController(),
      });

      const { registry } = await assembleFixtureToolRegistry(
        createHost(),
        createConfigBoundary(),
        new MessageBus(),
      );

      const tool = registry.getTool('check_async_tasks');
      expect(tool).toBeDefined();
      await expect(
        tool!.build({}).execute(new AbortController().signal),
      ).rejects.toThrow('Agent owner');
      const bound = new CheckAsyncTasksTool(
        new CoreAsyncTaskServiceAdapter(
          new AsyncWorkFacade(asyncTaskManager, () => undefined),
        ),
      );
      const result = await bound
        .build({})
        .execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Async Tasks Summary');
      expect(result.llmContent).toContain('task-registry-adapter');
    });

    async function createRegistryWithEmojiMode(mode: string) {
      const configBoundary = createConfigBoundary({
        initialSettings: { emojifilter: mode },
      });

      return assembleFixtureToolRegistry(
        createHost({
          noCoreTools: true,
          profileManager: {} as ProfileManager,
          subagentManager: new SubagentManager(
            path.join(os.tmpdir(), 'llxprt-registry-emoji-subagents'),
            new ProfileManager(
              path.join(os.tmpdir(), 'llxprt-registry-emoji-profiles'),
            ),
          ),
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
          todos: [
            { id: '1', content: '\u2705 Fix the bug', status: 'pending' },
          ],
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
          todos: [
            { id: '1', content: '\u2705 Fix the bug', status: 'pending' },
          ],
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
          todos: [
            { id: '1', content: '\u2705 Fix the bug', status: 'pending' },
          ],
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
          todos: [
            { id: '1', content: '\u2705 Fix the bug', status: 'pending' },
          ],
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
      // Resolve through realpath so the workspace root uses the canonical long
      // path. On the Windows runner `os.tmpdir()` returns an 8.3 short form
      // (e.g. C:\Users\RUNNER~1\...), while the image tool reports the resolved
      // long path (C:\Users\runneradmin\...); normalising here keeps both sides
      // speaking the same path so the strict "saved at the exact requested path"
      // assertion is meaningful rather than a false mismatch.
      tempWorkspace = await fs.promises.realpath(
        await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'llxprt-registry-image-'),
        ),
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
      let backendSelection: ImageOperationBackend | null = null;

      const host = createHost();

      const configBoundary = createConfigBoundary({
        targetDir: tempWorkspace,
      });

      const { registry } = await assembleFixtureToolRegistry(
        host,
        configBoundary,
        new MessageBus(),
        undefined,
        (input) =>
          runImageOperation(input, {
            workspaceRoot: tempWorkspace,
            resolveBackend: () => backendSelection,
          }),
      );

      // Now inject the resolver (lazy: read at invocation time, not registration).
      backendSelection = backend;

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

    it('maps absent explicit image operations to TOOL_DISABLED without provider work', async () => {
      // A resolver that returns undefined must be coerced to null so the
      // runImageOperation `backend === null` capability check fires, producing
      // TOOL_DISABLED — NOT a TypeError mapped to EXECUTION_FAILED.
      const tempWorkspace = await fs.promises.realpath(
        await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'llxprt-registry-undef-'),
        ),
      );
      try {
        const host = createHost();

        const configBoundary = createConfigBoundary({
          targetDir: tempWorkspace,
        });

        const { registry } = await assembleFixtureToolRegistry(
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
        expect(result.error?.type).toBe(ToolErrorType.TOOL_DISABLED);
      } finally {
        await fs.promises.rm(tempWorkspace, { recursive: true, force: true });
      }
    });
  });

  // ─── #3222 review finding: reconcile must report ACTUAL registration ────────
  //
  describe('explicit task registration respects caller workspace ownership', () => {
    function registration(): TaskToolRegistration {
      return createTaskRegistration();
    }

    it('keeps an excluded task absent without modifying the existing caller catalog', async () => {
      const host = createHost({ excludeTools: ['task'] });
      const caller = await assembleFixtureToolRegistry(
        host,
        createConfigBoundary(),
        new MessageBus(),
      );
      const session = await assembleFixtureToolRegistry(
        host,
        createConfigBoundary(),
        new MessageBus(),
        registration(),
      );
      expect(caller.registry.getTool('task')).toBeUndefined();
      expect(session.registry.getTool('task')).toBeUndefined();
      const records = session.allPotentialTools.filter(
        (record) => record.toolName === 'TaskTool',
      );
      expect(records).toHaveLength(1);
      expect(records[0].isRegistered).toBe(false);
      expect(records[0].reason).toContain('excluded by excludeTools');
    });

    it('creates separate session task tools while leaving the caller catalog unchanged', async () => {
      const host = createHost();
      const caller = await assembleFixtureToolRegistry(
        host,
        createConfigBoundary(),
        new MessageBus(),
      );
      const first = await assembleFixtureToolRegistry(
        host,
        createConfigBoundary(),
        new MessageBus(),
        registration(),
      );
      const second = await assembleFixtureToolRegistry(
        host,
        createConfigBoundary(),
        new MessageBus(),
        registration(),
      );
      expect(caller.registry.getTool('task')).toBeUndefined();
      expect(first.registry.getTool('task')).toBeDefined();
      expect(first.registry.getTool('task')).not.toBe(
        second.registry.getTool('task'),
      );
      const records = first.allPotentialTools.filter(
        (record) => record.toolName === 'TaskTool',
      );
      expect(records).toHaveLength(1);
      expect(records[0].isRegistered).toBe(true);
    });
  });
  async function assembleFixtureToolRegistry(
    host: ReturnType<typeof createHost>,
    config: Config,
    messageBus: Parameters<typeof createToolRegistry>[2],
    registration?: TaskToolRegistration,
    imageOperation?: ImageOperationRunner,
  ): Promise<
    Awaited<ReturnType<typeof createToolRegistry>> & {
      workspacePaths: WorkspacePathOperations;
    }
  > {
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    const settingsOwner = new SessionSettingsOwner(settings);
    settingsOwners.push(settingsOwner);
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const root = createFilesystem({
      targetDir: config.getTargetDir(),
      includeDirectories: config.getConfiguredIncludeDirectories(),
      isTrusted: () => trust.isTrustedFolder(),
    });
    return {
      ...(await createToolRegistry(
        host,
        config,
        messageBus,
        () => settingsOwner.readRegistryPolicy(config.getExcludeTools() ?? []),
        () => settingsOwner.readToolExecutionPolicy(),
        root.paths,
        root.files,
        root.ignore,
        root.scans,
        undefined,
        undefined,
        registration === undefined
          ? undefined
          : {
              ...registration,
              create: (config, args) =>
                registration.create(config, {
                  ...args,
                  createChildSettings: () => settingsOwner.createChildStore(),
                  readTaskPolicy: () => settingsOwner.readTaskPolicy(),
                  readRunPolicy: () => settingsOwner.readSubagentRunPolicy(),
                  readGovernance: () => settingsOwner.readToolGovernance([]),
                  instructions: emptyInstructionReads,
                }),
              buildArgs: (config, args) =>
                registration.buildArgs(config, {
                  ...args,
                  createChildSettings: () => settingsOwner.createChildStore(),
                  readTaskPolicy: () => settingsOwner.readTaskPolicy(),
                  readRunPolicy: () => settingsOwner.readSubagentRunPolicy(),
                  readGovernance: () => settingsOwner.readToolGovernance([]),
                  instructions: emptyInstructionReads,
                }),
            },
        undefined,
        true,
        host.profileDefinitions,
        host.subagentDefinitions,
        undefined,
        trust,
        undefined,
        imageOperation,
      )),
      workspacePaths: root.paths,
    };
  }
});

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the /continue command.
 * @plan PLAN-20260214-SESSIONBROWSER.P19
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { continueCommand } from '../continueCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import {
  exportSessionMediaPackage,
  LocalMediaStore,
  RecordingIntegration,
  SessionDiscovery,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type {
  CommandContext,
  SlashCommandActionReturn,
  MessageActionReturn,
  OpenDialogActionReturn,
  PerformResumeActionReturn,
} from '../types.js';
import type {
  TokenInfo,
  ValueArgument,
  LiteralArgument,
} from '../schema/types.js';
import { assertDefined, assertType } from '../../../test-utils/assertions.js';

/**
 * Helper to narrow a command argument to the ValueArgument variant.
 */
function isValueArgument(
  arg: LiteralArgument | ValueArgument,
): arg is ValueArgument {
  return arg.kind === 'value';
}

/**
 * Helper to create mock TokenInfo for completer tests
 */
function mockTokenInfo(partial: string = ''): TokenInfo {
  return {
    tokens: [],
    partialToken: partial,
    hasTrailingSpace: false,
    position: 0,
  };
}

/**
 * Helper to narrow the result type to MessageActionReturn
 */
function isMessageAction(
  result: SlashCommandActionReturn | void | undefined,
): result is MessageActionReturn {
  return result !== undefined && result.type === 'message';
}

/**
 * Helper to narrow the result type to OpenDialogActionReturn
 */
function isDialogAction(
  result: SlashCommandActionReturn | void | undefined,
): result is OpenDialogActionReturn {
  return result !== undefined && result.type === 'dialog';
}

/**
 * Helper to narrow the result type to PerformResumeActionReturn
 */
function isPerformResumeAction(
  result: SlashCommandActionReturn | void | undefined,
): result is PerformResumeActionReturn {
  return result !== undefined && result.type === 'perform_resume';
}

class ExportBoundaryRecordingService extends SessionRecordingService {
  async flushInitialContent(): Promise<void> {
    await super.flush();
  }

  override async flush(): Promise<void> {
    this.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'active recording boundary' }],
    });
    await super.flush();
  }
}

class RejectingFlushRecordingService extends SessionRecordingService {
  private rejectNextFlush = true;

  override async flush(): Promise<void> {
    if (this.rejectNextFlush) {
      this.rejectNextFlush = false;
      throw new Error('integration flush rejected');
    }
    await super.flush();
  }
}

describe('continueCommand @plan:PLAN-20260214-SESSIONBROWSER.P19', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = createMockCommandContext();
  });

  describe('No-args path @requirement:REQ-EN-001', () => {
    it('returns dialog action when interactive with no args', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
      });

      const result = await continueCommand.action!(ctx, '');

      assertType(result, isDialogAction);
      expect(result.dialog).toBe('sessionBrowser');
    });

    it('returns error when non-interactive with no args @requirement:REQ-RC-012', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          },
        },
      });

      const result = await continueCommand.action!(ctx, '');

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toContain('interactive');
    });
  });

  describe('Direct resume path @requirement:REQ-EN-002', () => {
    it('/continue latest returns perform_resume', async () => {
      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('latest');
    });

    it('/continue <id> returns perform_resume with ID', async () => {
      const result = await continueCommand.action!(ctx, 'abc123');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('abc123');
    });

    it('/continue <number> returns perform_resume with index', async () => {
      const result = await continueCommand.action!(ctx, '3');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('3');
    });

    it('/continue <prefix> returns perform_resume with prefix', async () => {
      const result = await continueCommand.action!(ctx, 'abc');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('abc');
    });

    it('returns package usage errors for malformed reserved import and export syntax', async () => {
      const malformedCommands = [
        'import',
        'import   ',
        'export',
        'export session-only',
      ];

      for (const malformed of malformedCommands) {
        const result = await continueCommand.action!(ctx, malformed);
        assertType(result, isMessageAction);
        expect(result.messageType).toBe('error');
        expect(result.content).toContain(
          `Usage: /continue ${malformed.trimStart().startsWith('import') ? 'import <package-directory>' : 'export <session> <destination>'}`,
        );
      }
    });
  });

  describe('Active conversation guard @requirement:REQ-RC-010', () => {
    it('returns perform_resume with requiresConfirmation when active conversation exists in interactive mode', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
        ui: {
          // Simulate having messages in history (active conversation)
          pendingItem: { type: 'gemini', text: 'Previous message' },
        },
      });

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isPerformResumeAction);
      // When active conversation exists, requiresConfirmation should be true
      expect(result.requiresConfirmation).toBe(true);
    });

    it('returns error when active conversation exists in non-interactive mode @requirement:REQ-RC-011', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          },
        },
        ui: {
          // Simulate having an active conversation
          pendingItem: { type: 'gemini', text: 'Previous message' },
        },
      });

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toMatch(/conversation|replace/);
    });

    it('does not require confirmation when no active conversation exists', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
        ui: {
          pendingItem: null,
        },
      });

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isPerformResumeAction);
      // No confirmation flag when no active conversation
      expect(result.requiresConfirmation).toBeFalsy();
    });
  });

  describe('In-flight request guard @requirement:REQ-MP-004', () => {
    it('returns error when isProcessing=true with no args', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
      });
      ctx.session.isProcessing = true;

      const result = await continueCommand.action!(ctx, '');

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toContain('request');
      expect(result.content.toLowerCase()).toContain('progress');
    });

    it('returns error when isProcessing=true with latest', async () => {
      ctx = createMockCommandContext();
      ctx.session.isProcessing = true;

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toContain('request');
      expect(result.content.toLowerCase()).toContain('progress');
    });

    it('proceeds normally when isProcessing=false', async () => {
      ctx = createMockCommandContext();
      ctx.session.isProcessing = false;

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('latest');
    });
  });

  describe('Tab completion @requirement:REQ-RC-013', () => {
    it('completion includes "latest"', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
      });

      // Schema-based completion
      const schema = continueCommand.schema;
      assertDefined(schema);
      const firstArg = schema[0];
      assertDefined(firstArg);
      assertType(firstArg, isValueArgument);
      assertDefined(firstArg.completer);

      const completions = await firstArg.completer(ctx, '', mockTokenInfo());
      const values = completions.map((c) =>
        typeof c === 'string' ? c : c.value,
      );
      expect(values).toContain('latest');
    });

    it('completion returns session previews when sessions exist', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
      });

      const schema = continueCommand.schema;
      assertDefined(schema);
      const firstArg = schema[0];
      assertDefined(firstArg);
      assertType(firstArg, isValueArgument);
      assertDefined(firstArg.completer);

      const completions = await firstArg.completer(ctx, '', mockTokenInfo());
      expect(completions.length).toBeGreaterThanOrEqual(1);
    });

    it('completion returns empty for non-interactive mode', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          },
        },
      });

      const schema = continueCommand.schema;
      assertDefined(schema);
      const firstArg = schema[0];
      assertDefined(firstArg);
      assertType(firstArg, isValueArgument);
      assertDefined(firstArg.completer);

      const completions = await firstArg.completer(ctx, '', mockTokenInfo());
      expect(Array.isArray(completions)).toBe(true);
    });

    it('completion includes recording-native checkpoints when storage is available', async () => {
      const root = await mkdtemp(join(tmpdir(), 'continue-completion-'));
      const projectTempDir = join(root, 'completion-project');
      const chatsDir = join(projectTempDir, 'chats');
      const recording = new SessionRecordingService({
        sessionId: randomUUID(),
        projectHash: 'completion-project',
        chatsDir,
        workspaceDirs: [root],
        provider: 'test-provider',
        model: 'test-model',
      });

      try {
        recording.recordContent({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'checkpoint content' }],
        });
        await recording.createCheckpoint('release-ready');
        const sessionId = recording.getSessionId();

        ctx = createMockCommandContext({
          services: {
            config: {
              isInteractive: () => true,
              storage: {
                getProjectChatsDir: () => chatsDir,
                getProjectTempDir: () => projectTempDir,
              },
              getLocalMediaStore: () => undefined,
            },
          },
        });

        const schema = continueCommand.schema;
        assertDefined(schema);
        const firstArg = schema[0];
        assertDefined(firstArg);
        assertType(firstArg, isValueArgument);
        assertDefined(firstArg.completer);

        const completions = await firstArg.completer(ctx, '', mockTokenInfo());
        const values = completions.map((completion) =>
          typeof completion === 'string' ? completion : completion.value,
        );
        expect(values).toContain('release-ready');
        expect(values).toContain(sessionId);
      } finally {
        try {
          await recording.dispose();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    });
  });

  describe('Whitespace handling', () => {
    it('treats whitespace-only args as no-args (interactive opens dialog)', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          },
        },
      });

      const result = await continueCommand.action!(ctx, '   ');

      assertType(result, isDialogAction);
      expect(result.dialog).toBe('sessionBrowser');
    });

    it('trims whitespace around session ref', async () => {
      const result = await continueCommand.action!(ctx, '  abc123  ');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('abc123');
    });
  });

  describe('portable session package actions', () => {
    it('rejects an import before reading or publishing the package when a non-interactive conversation is active', async () => {
      const root = await mkdtemp(join(tmpdir(), 'continue-import-guard-'));
      const projectTemp = join(root, 'guard-project');
      const destinationChats = join(projectTemp, 'chats');
      const destinationStore = new LocalMediaStore({
        rootDirectory: join(projectTemp, 'media'),
        quotaBytes: 1024,
      });
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
            storage: {
              getProjectChatsDir: () => destinationChats,
              getProjectTempDir: () => projectTemp,
            },
            getLocalMediaStore: () => destinationStore,
          },
        },
        ui: {
          pendingItem: { type: 'gemini', text: 'Active conversation' },
        },
      });

      try {
        const result = await continueCommand.action!(
          ctx,
          `import ${join(root, 'package-must-not-be-read')}`,
        );

        assertType(result, isMessageAction);
        expect(result.messageType).toBe('error');
        expect(result.content).toContain('Cannot replace active conversation');
        await expect(
          readFile(join(projectTemp, 'media')),
        ).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(readFile(destinationChats)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('awaits integration and active recording flushes before exporting', async () => {
      const root = await mkdtemp(join(tmpdir(), 'continue-export-'));
      const projectTemp = join(root, 'portable-project');
      const chatsDir = join(projectTemp, 'chats');
      const mediaStore = new LocalMediaStore({
        rootDirectory: join(projectTemp, 'media'),
        quotaBytes: 1024,
      });
      const recording = new ExportBoundaryRecordingService({
        sessionId: randomUUID(),
        projectHash: 'portable-project',
        chatsDir,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
        mediaStore,
      });
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'discoverable export' }],
      });
      await recording.flushInitialContent();
      const integrationRecording = new SessionRecordingService({
        sessionId: randomUUID(),
        projectHash: 'portable-project',
        chatsDir,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      integrationRecording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'integration boundary' }],
      });
      const integration = new RecordingIntegration(integrationRecording);
      const packageDirectory = join(root, 'exported-session');
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
            storage: {
              getProjectChatsDir: () => chatsDir,
              getProjectTempDir: () => projectTemp,
            },
            getLocalMediaStore: () => mediaStore,
            getSessionRecordingService: () => recording,
          },
        },
        recordingIntegration: integration,
      });

      try {
        const result = await continueCommand.action!(
          ctx,
          `export ${recording.getSessionId()} ${packageDirectory}`,
        );

        assertType(result, isMessageAction);
        expect(result.messageType).toBe('info');
        expect(
          await readFile(join(packageDirectory, 'session.jsonl'), 'utf8'),
        ).toContain('active recording boundary');
        const integrationPath = integrationRecording.getFilePath();
        if (integrationPath === null) {
          throw new Error('Expected integration recording path');
        }
        expect(await readFile(integrationPath, 'utf8')).toContain(
          'integration boundary',
        );
      } finally {
        await integration.dispose();
        await integrationRecording.dispose();
        await recording.dispose();
        await rm(root, { recursive: true, force: true });
      }
    });

    it('propagates an integration flush failure without publishing an export', async () => {
      const root = await mkdtemp(join(tmpdir(), 'continue-export-failure-'));
      const projectTemp = join(root, 'portable-project');
      const chatsDir = join(projectTemp, 'chats');
      const mediaStore = new LocalMediaStore({
        rootDirectory: join(projectTemp, 'media'),
        quotaBytes: 1024,
      });
      const recording = new SessionRecordingService({
        sessionId: randomUUID(),
        projectHash: 'portable-project',
        chatsDir,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
        mediaStore,
      });
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'discoverable failed export' }],
      });
      await recording.flush();
      const integrationRecording = new RejectingFlushRecordingService({
        sessionId: randomUUID(),
        projectHash: 'portable-project',
        chatsDir,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      const integration = new RecordingIntegration(integrationRecording);
      const packageDirectory = join(root, 'must-not-exist');
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
            storage: {
              getProjectChatsDir: () => chatsDir,
              getProjectTempDir: () => projectTemp,
            },
            getLocalMediaStore: () => mediaStore,
            getSessionRecordingService: () => recording,
          },
        },
        recordingIntegration: integration,
      });

      try {
        const result = await continueCommand.action!(
          ctx,
          `export ${recording.getSessionId()} ${packageDirectory}`,
        );

        assertType(result, isMessageAction);
        expect(result.messageType).toBe('error');
        expect(result.content).toContain('integration flush rejected');
        await expect(stat(packageDirectory)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await integration.dispose();
        await integrationRecording.dispose();
        await recording.dispose();
        await rm(root, { recursive: true, force: true });
      }
    });

    it('validates an import into a staged resume action without publishing it', async () => {
      const root = await mkdtemp(join(tmpdir(), 'continue-import-'));
      const sourceProject = join(root, 'portable-project');
      const sourceChats = join(sourceProject, 'chats');
      const sourceStore = new LocalMediaStore({
        rootDirectory: join(sourceProject, 'media'),
        quotaBytes: 1024,
      });
      const recording = new SessionRecordingService({
        sessionId: randomUUID(),
        projectHash: 'portable-project',
        chatsDir: sourceChats,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
        mediaStore: sourceStore,
      });
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'portable import' }],
      });
      await recording.flush();
      const recordingPath = recording.getFilePath();
      if (recordingPath === null) throw new Error('Expected recording path');
      const packageDirectory = join(root, 'package');
      await exportSessionMediaPackage(
        recordingPath,
        'portable-project',
        sourceStore,
        packageDirectory,
      );
      await recording.dispose();
      const destinationProject = join(root, 'destination-project');
      const destinationChats = join(destinationProject, 'chats');
      const destinationStore = new LocalMediaStore({
        rootDirectory: join(destinationProject, 'media'),
        quotaBytes: 1024,
      });
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
            storage: {
              getProjectChatsDir: () => destinationChats,
              getProjectTempDir: () => join(root, 'portable-project'),
            },
            getLocalMediaStore: () => destinationStore,
          },
        },
      });

      try {
        const result = await continueCommand.action!(
          ctx,
          `import ${packageDirectory}`,
        );

        assertType(result, isPerformResumeAction);
        if (result.sessionPackage === undefined) {
          throw new Error('Expected a validated session package');
        }
        expect(result.sessionPackage.recordingBytes.byteLength).toBeGreaterThan(
          0,
        );
        expect(
          await SessionDiscovery.listSessions(
            destinationChats,
            'portable-project',
          ),
        ).toEqual([]);
        expect(await destinationStore.getStoredByteLength()).toBe(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('rejects a tampered import without publishing session artifacts', async () => {
      const root = await mkdtemp(join(tmpdir(), 'continue-tampered-import-'));
      const sourceProject = join(root, 'portable-project');
      const sourceStore = new LocalMediaStore({
        rootDirectory: join(sourceProject, 'media'),
        quotaBytes: 1024,
      });
      const recording = new SessionRecordingService({
        sessionId: randomUUID(),
        projectHash: 'portable-project',
        chatsDir: join(sourceProject, 'chats'),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
        mediaStore: sourceStore,
      });
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'package to tamper' }],
      });
      await recording.flush();
      const recordingPath = recording.getFilePath();
      if (recordingPath === null) throw new Error('Expected recording path');
      const packageDirectory = join(root, 'package');
      await exportSessionMediaPackage(
        recordingPath,
        'portable-project',
        sourceStore,
        packageDirectory,
      );
      await recording.dispose();
      await appendFile(
        join(packageDirectory, 'session.jsonl'),
        `tampered
`,
      );
      const destinationProject = join(root, 'destination-project');
      const destinationChats = join(destinationProject, 'chats');
      const destinationStore = new LocalMediaStore({
        rootDirectory: join(destinationProject, 'media'),
        quotaBytes: 1024,
      });
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
            storage: {
              getProjectChatsDir: () => destinationChats,
              getProjectTempDir: () => join(root, 'portable-project'),
            },
            getLocalMediaStore: () => destinationStore,
          },
        },
      });

      try {
        const result = await continueCommand.action!(
          ctx,
          `import ${packageDirectory}`,
        );

        assertType(result, isMessageAction);
        expect(result.messageType).toBe('error');
        expect(
          await SessionDiscovery.listSessions(
            destinationChats,
            'portable-project',
          ),
        ).toEqual([]);
        expect(await destinationStore.getStoredByteLength()).toBe(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
  describe('Property-based tests @plan:PLAN-20260214-SESSIONBROWSER.P19', () => {
    it('non-empty args never returns dialog', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string().filter((s) => s.trim().length > 0),
          async (args) => {
            const result = await continueCommand.action!(ctx, args);
            // Non-empty args should route to perform_resume or error, never dialog
            return !isDialogAction(result);
          },
        ),
      );
    });

    it('result always has valid type field', async () => {
      const validTypes = [
        'dialog',
        'perform_resume',
        'message',
        'tool',
        'quit',
        'load_history',
        'submit_prompt',
        'confirm_shell_commands',
        'confirm_action',
      ];

      await fc.assert(
        fc.asyncProperty(fc.string(), async (args) => {
          const result = await continueCommand.action!(ctx, args);
          if (result === undefined) {
            // void return is valid for some commands
            return true;
          }
          return validTypes.includes(result.type);
        }),
      );
    });
  });
});

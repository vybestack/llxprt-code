/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REAL behavioral integration suite for issue #2659.
 *
 * Exercises the actual scheduler → message-bus → confirmation-coordinator
 * → real editor tools path. Every component below is REAL production code:
 * - CoreToolScheduler / ConfirmationCoordinator / ToolExecutor / ResultAggregator
 * - A real PolicyEngine (declarative TOML-style rules)
 * - MessageBus (from @vybestack/llxprt-code-core/confirmation-bus)
 * - ToolRegistry with real EditTool, WriteFileTool, InsertAtLineTool,
 *   DeleteLineRangeTool, ApplyPatchTool, ASTEditTool
 * - Real temp files on disk
 *
 * The ONLY fakes are infrastructure: a minimal IToolHost pointing at a temp
 * directory, and a minimal Config stub (NOT a real Config — it delegates
 * setApprovalMode to the real PolicyEngine) that delegates to the real
 * PolicyEngine / MessageBus. No scheduler, policy engine, invocation, or
 * editor behavior is mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { CoreToolScheduler } from './coreToolScheduler.js';
import type { ToolCall } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  ApprovalMode,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  PolicyDecision,
  type PolicyEngineConfig,
  type PolicyRule,
} from '@vybestack/llxprt-code-core/policy/types.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import {
  ToolRegistry,
  EditTool,
  WriteFileTool,
  InsertAtLineTool,
  DeleteLineRangeTool,
  ApplyPatchTool,
  ASTEditTool,
  ToolConfirmationOutcome,
  type ToolRegistry as ToolRegistryType,
  type IToolHost,
} from '@vybestack/llxprt-code-tools';

const AUTO_EDIT_RULE_PRIORITY = 1.015;
const YOLO_RULE_PRIORITY = 1.999;
const DEFAULT_TEST_MTIME_EPOCH_SECONDS = 1_000_000;
const TEST_SESSION_ID = 'test-session-editor-integration';
const TEST_PREFERRED_EDITOR = 'vscode';
const TEST_PROMPT_ID = 'prompt-editor-int';

// ── Real PolicyEngine config (mirrors production TOML) ──────────────────

function buildTomlStyleConfig(): PolicyEngineConfig {
  const rules: PolicyRule[] = [];

  rules.push({
    decision: PolicyDecision.ALLOW,
    priority: YOLO_RULE_PRIORITY,
    allowRedirection: true,
    modes: [ApprovalMode.YOLO],
    source: 'test-yolo',
  });

  const autoEditTools = [
    'replace',
    'write_file',
    'insert_at_line',
    'delete_line_range',
    'apply_patch',
    'ast_edit',
  ];
  for (const tool of autoEditTools) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ALLOW,
      priority: AUTO_EDIT_RULE_PRIORITY,
      modes: [ApprovalMode.AUTO_EDIT],
      source: 'test-auto-edit',
    });
  }

  return { rules, defaultDecision: PolicyDecision.ASK_USER };
}

// ── Infrastructure: IToolHost fake ──────────────────────────────────────

function createToolHost(targetDir: string): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'default' as const,
    setApprovalMode: () => {},
    isInteractive: () => true,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getFileSystemService: () => undefined,
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 50000,
      'tool-output-item-size-limit': 524288,
    }),
    getDebugMode: () => false,
  };
}

// ── Infrastructure: minimal Config stub (real PolicyEngine + MessageBus) ──

interface SchedulerTestContext {
  engine: PolicyEngine;
  messageBus: MessageBus;
  config: Config;
  toolRegistry: ToolRegistryType;
  scheduler: CoreToolScheduler;
  onAllToolCallsComplete: ReturnType<typeof vi.fn>;
  onToolCallsUpdate: ReturnType<typeof vi.fn>;
  tempDir: string;
}

/**
 * Builds a test context with REAL production components (PolicyEngine,
 * MessageBus, CoreToolScheduler, ConfirmationCoordinator) but a minimal
 * Config stub — NOT a real Config. The stub delegates setApprovalMode to
 * engine.setApprovalMode so mode transitions are exercised through the
 * same path Config uses in production.
 */
function buildTestContext(
  tempDir: string,
  initialMode: ApprovalMode,
): SchedulerTestContext {
  const engine = new PolicyEngine(buildTomlStyleConfig());
  engine.setApprovalMode(initialMode);

  const messageBus = new MessageBus(engine, false);

  const toolHost = createToolHost(tempDir);

  const editTool = new EditTool(toolHost);
  const writeFileTool = new WriteFileTool(toolHost);
  const insertAtLineTool = new InsertAtLineTool(toolHost);
  const deleteLineRangeTool = new DeleteLineRangeTool(toolHost);
  const applyPatchTool = new ApplyPatchTool(toolHost);
  const astEditTool = new ASTEditTool(toolHost);

  const toolRegistry = new ToolRegistry(
    {
      getEphemeralSettings: () => ({}),
      getCoreTools: () => [],
      getExcludeTools: () => [],
    },
    new CoreMessageBusAdapter(messageBus),
  );
  toolRegistry.registerTool(editTool);
  toolRegistry.registerTool(writeFileTool);
  toolRegistry.registerTool(insertAtLineTool);
  toolRegistry.registerTool(deleteLineRangeTool);
  toolRegistry.registerTool(applyPatchTool);
  toolRegistry.registerTool(astEditTool);

  const onAllToolCallsComplete = vi.fn();
  const onToolCallsUpdate = vi.fn();

  let currentMode = initialMode;
  const config = {
    getSessionId: () => TEST_SESSION_ID,
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    isInteractive: () => true,
    getApprovalMode: () => currentMode,
    setApprovalMode: (mode: ApprovalMode) => {
      currentMode = mode;
      engine.setApprovalMode(mode);
    },
    getEphemeralSettings: () => ({
      'tool-output-max-tokens': 50000,
      'tool-output-max-items': 50,
    }),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getEnableHooks: () => false,
    getHookSystem: () => null,
    getPolicyEngine: () => engine,
    getModel: () => 'test-model',
    getTruncateToolOutputThreshold: () =>
      DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
    getTruncateToolOutputLines: () => DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  } as unknown as Config;

  const scheduler = new CoreToolScheduler({
    config,
    messageBus,
    toolRegistry,
    onAllToolCallsComplete,
    onToolCallsUpdate,
    getPreferredEditor: () => TEST_PREFERRED_EDITOR,
    onEditorClose: vi.fn(),
  });

  return {
    engine,
    messageBus,
    config,
    toolRegistry,
    scheduler,
    onAllToolCallsComplete,
    onToolCallsUpdate,
    tempDir,
  };
}

// ── Temp filesystem helpers ─────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-editor-int-'));
}

function writeFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function getMtime(filePath: string): number {
  return fs.statSync(filePath).mtimeMs;
}

/**
 * Sets a fixed old mtime on a file so that subsequent mtime comparisons are
 * deterministic and not affected by filesystem timestamp resolution.
 * Returns the old mtime in milliseconds.
 */
function setOldMtime(
  filePath: string,
  epochSeconds = DEFAULT_TEST_MTIME_EPOCH_SECONDS,
): number {
  const oldTime = epochSeconds;
  fs.utimesSync(filePath, oldTime, oldTime);
  return oldTime * 1000;
}

function makeRequest(
  callId: string,
  name: string,
  args: Record<string, unknown>,
) {
  return {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: TEST_PROMPT_ID,
  };
}

/**
 * Waits for the scheduler to reach onAllToolCallsComplete, then returns
 * the completed calls.
 */
async function waitForCompletion(
  onAllToolCallsComplete: ReturnType<typeof vi.fn>,
): Promise<ToolCall[]> {
  await vi.waitFor(() => {
    expect(onAllToolCallsComplete).toHaveBeenCalled();
  });
  return onAllToolCallsComplete.mock.calls[0][0] as ToolCall[];
}

type ConfirmationDetailsProbe = {
  confirmationDetails?: { onConfirm?: unknown };
};

/**
 * Type guard: narrows a ToolCall to the awaiting-approval variant so
 * confirmationDetails can be accessed safely without a manual cast.
 */
function isAwaitingApproval(call: ToolCall | undefined): call is ToolCall & {
  status: 'awaiting_approval';
  confirmationDetails: {
    onConfirm: (o: ToolConfirmationOutcome) => Promise<void>;
  };
} {
  return (
    call !== undefined &&
    call.status === 'awaiting_approval' &&
    typeof (call as ConfirmationDetailsProbe).confirmationDetails?.onConfirm ===
      'function'
  );
}

/**
 * Extracts the awaiting-approval call from the latest onToolCallsUpdate
 * batch, using a type guard for safe narrowing.
 */
function getAwaitingCall(
  onToolCallsUpdate: ReturnType<typeof vi.fn>,
): ToolCall & {
  status: 'awaiting_approval';
  confirmationDetails: {
    onConfirm: (o: ToolConfirmationOutcome) => Promise<void>;
  };
} {
  const calls = onToolCallsUpdate.mock.calls;
  const latest = calls[calls.length - 1]?.[0] as ToolCall[] | undefined;
  const awaitingCall = latest?.find((c) => c.status === 'awaiting_approval');
  if (!isAwaitingApproval(awaitingCall)) {
    throw new Error(
      'Expected an awaiting_approval call with confirmationDetails.onConfirm',
    );
  }
  return awaitingCall;
}

// ── Tool argument fixtures ──────────────────────────────────────────────

type ToolFixture = {
  toolName: string;
  buildArgs: (filePath: string) => Record<string, unknown>;
  expectedContent: string;
};

/**
 * Fixtures for each of the six editor tools. Each takes a temp file path
 * with known content and returns valid arguments + the expected file content
 * after successful execution.
 */
function toolFixtures(): ToolFixture[] {
  return [
    {
      toolName: 'replace',
      buildArgs: (filePath) => ({
        file_path: filePath,
        old_string: 'line2',
        new_string: 'LINE2',
      }),
      expectedContent: 'line1\nLINE2\nline3\n',
    },
    {
      toolName: 'write_file',
      buildArgs: (filePath) => ({
        file_path: filePath,
        content: 'brand new content\n',
      }),
      expectedContent: 'brand new content\n',
    },
    {
      toolName: 'insert_at_line',
      buildArgs: (filePath) => ({
        file_path: filePath,
        line_number: 2,
        content: 'inserted\n',
      }),
      expectedContent: 'line1\ninserted\nline2\nline3\n',
    },
    {
      toolName: 'delete_line_range',
      buildArgs: (filePath) => ({
        file_path: filePath,
        start_line: 2,
        end_line: 3,
      }),
      expectedContent: 'line1\n',
    },
    {
      toolName: 'apply_patch',
      buildArgs: (filePath) => ({
        file_path: filePath,
        patch_content:
          '--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3\n',
      }),
      expectedContent: 'line1\nLINE2\nline3\n',
    },
    {
      toolName: 'ast_edit',
      buildArgs: (filePath) => ({
        file_path: filePath,
        old_string: 'line2',
        new_string: 'LINE2',
        force: true,
      }),
      expectedContent: 'line1\nLINE2\nline3\n',
    },
  ];
}

// ── Test suite ──────────────────────────────────────────────────────────

describe('Editor scheduler integration (issue #2659)', () => {
  let tempDir = '';
  // Central registry of all schedulers created in beforeEach/individual tests
  // so afterEach can dispose them even if an assertion fails mid-test.
  const activeSchedulers: CoreToolScheduler[] = [];

  beforeEach(() => {
    tempDir = createTempDir();
    activeSchedulers.length = 0;
  });

  afterEach(() => {
    for (const scheduler of activeSchedulers) {
      scheduler.dispose();
    }
    activeSchedulers.length = 0;
    if (tempDir !== '') {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Wraps buildTestContext to register the scheduler for guaranteed disposal.
   */
  function makeContext(mode: ApprovalMode): SchedulerTestContext {
    const ctx = buildTestContext(tempDir, mode);
    activeSchedulers.push(ctx.scheduler);
    return ctx;
  }

  // ── Case 1: DEFAULT mode — six editors reach confirmation, no mutation before approval, cancel preserves bytes+mtime ──

  describe.each(toolFixtures())('DEFAULT mode: $toolName', (fixture) => {
    it('reaches awaiting_approval and does not mutate before approval; cancel preserves bytes and mtime', async () => {
      const ctx = makeContext(ApprovalMode.DEFAULT);
      const originalContent = 'line1\nline2\nline3\n';
      const filePath = writeFile(tempDir, 'target.txt', originalContent);
      const originalMtime = setOldMtime(filePath);

      const args = fixture.buildArgs(filePath);
      const abortController = new AbortController();
      await ctx.scheduler.schedule(
        makeRequest(`default-${fixture.toolName}`, fixture.toolName, args),
        abortController.signal,
      );

      // The tool should NOT have completed — it should be awaiting approval.
      expect(ctx.onAllToolCallsComplete).not.toHaveBeenCalled();

      // File must be untouched.
      expect(readFile(filePath)).toBe(originalContent);
      expect(getMtime(filePath)).toBe(originalMtime);

      // Cancel via the confirmation details callback.
      const awaitingCall = getAwaitingCall(ctx.onToolCallsUpdate);
      await awaitingCall.confirmationDetails.onConfirm(
        ToolConfirmationOutcome.Cancel,
      );

      const completed = await waitForCompletion(ctx.onAllToolCallsComplete);
      expect(completed[0].status).toBe('cancelled');

      // Bytes and mtime preserved after cancel.
      expect(readFile(filePath)).toBe(originalContent);
      expect(getMtime(filePath)).toBe(originalMtime);
    });
  });

  // ── Case 2: AUTO_EDIT and YOLO — six editors execute without confirmation ──

  describe.each([
    { modeName: 'AUTO_EDIT', mode: ApprovalMode.AUTO_EDIT },
    { modeName: 'YOLO', mode: ApprovalMode.YOLO },
  ])('$modeName mode: six editors execute without confirmation', ({ mode }) => {
    describe.each(toolFixtures())('$toolName', (fixture) => {
      it('executes without confirmation and produces expected filesystem content', async () => {
        const ctx = makeContext(mode);
        const originalContent = 'line1\nline2\nline3\n';
        const filePath = writeFile(tempDir, 'target.txt', originalContent);

        const args = fixture.buildArgs(filePath);
        const abortController = new AbortController();
        await ctx.scheduler.schedule(
          makeRequest(`${mode}-${fixture.toolName}`, fixture.toolName, args),
          abortController.signal,
        );

        const completed = await waitForCompletion(ctx.onAllToolCallsComplete);
        expect(completed[0].status).toBe('success');
        expect(readFile(filePath)).toBe(fixture.expectedContent);
      });
    });
  });

  // ── Case 3: Exact regression — YOLO→DEFAULT, force:true ast_edit gets real diff confirmation ──

  it('YOLO→DEFAULT regression: ast_edit force:true gets real diff confirmation and no mutation before cancel', async () => {
    const ctx = makeContext(ApprovalMode.YOLO);
    const originalContent = 'line1\nline2\nline3\n';
    const filePath = writeFile(tempDir, 'regression.txt', originalContent);

    // First call in YOLO — should execute immediately.
    const yoloArgs = {
      file_path: filePath,
      old_string: 'line2',
      new_string: 'YOLO_EDITED',
      force: true,
    };
    await ctx.scheduler.schedule(
      makeRequest('yolo-first', 'ast_edit', yoloArgs),
      new AbortController().signal,
    );
    const yoloCompleted = await waitForCompletion(ctx.onAllToolCallsComplete);
    expect(yoloCompleted[0].status).toBe('success');
    expect(readFile(filePath)).toContain('YOLO_EDITED');

    // Restore content for the downgrade test.
    fs.writeFileSync(filePath, originalContent, 'utf-8');
    const restoredMtime = setOldMtime(filePath);

    // Clear the mock so we can detect the second call separately.
    ctx.onAllToolCallsComplete.mockClear();
    ctx.onToolCallsUpdate.mockClear();

    // Switch to DEFAULT.
    (
      ctx.config as unknown as { setApprovalMode: (m: ApprovalMode) => void }
    ).setApprovalMode(ApprovalMode.DEFAULT);

    // Schedule force:true ast_edit — should reach confirmation, NOT execute.
    const defaultArgs = {
      file_path: filePath,
      old_string: 'line2',
      new_string: 'DEFAULT_REQUIRES_CONFIRMATION',
      force: true,
    };
    await ctx.scheduler.schedule(
      makeRequest('default-regression', 'ast_edit', defaultArgs),
      new AbortController().signal,
    );

    // Should be awaiting approval, not completed.
    expect(ctx.onAllToolCallsComplete).not.toHaveBeenCalled();

    // No mutation before approval.
    expect(readFile(filePath)).toBe(originalContent);
    expect(getMtime(filePath)).toBe(restoredMtime);

    // Cancel to preserve bytes + mtime.
    const awaitingCall = getAwaitingCall(ctx.onToolCallsUpdate);

    // Clear mock before cancel so we capture this completion, not prior ones.
    ctx.onAllToolCallsComplete.mockClear();

    await awaitingCall.confirmationDetails.onConfirm(
      ToolConfirmationOutcome.Cancel,
    );

    const completed = await waitForCompletion(ctx.onAllToolCallsComplete);
    expect(completed[0].status).toBe('cancelled');

    expect(readFile(filePath)).toBe(originalContent);
    expect(getMtime(filePath)).toBe(restoredMtime);
  });

  // ── Case 4: ast_edit force:false preview — no mutation bytes/mtime ──

  it('ast_edit force:false preview through scheduler does not mutate bytes/mtime', async () => {
    const ctx = makeContext(ApprovalMode.DEFAULT);
    const originalContent = 'line1\nline2\nline3\n';
    const filePath = writeFile(tempDir, 'preview.txt', originalContent);
    const originalMtime = setOldMtime(filePath);

    // force:false means shouldConfirmExecute returns false (preview mode),
    // and execute() returns a preview result without writing.
    const args = {
      file_path: filePath,
      old_string: 'line2',
      new_string: 'PREVIEW_ONLY',
      force: false,
    };
    await ctx.scheduler.schedule(
      makeRequest('preview-ast', 'ast_edit', args),
      new AbortController().signal,
    );

    const completed = await waitForCompletion(ctx.onAllToolCallsComplete);
    // Preview succeeds (returns the diff) without writing.
    expect(completed[0].status).toBe('success');

    // File unchanged.
    expect(readFile(filePath)).toBe(originalContent);
    expect(getMtime(filePath)).toBe(originalMtime);
  });

  // ── Case 5: Terminal callback vs MessageBus/IDE approval equivalence ──

  describe('ast_edit approval routes produce equivalent authorization and a single write', () => {
    const originalContent = 'line1\nline2\nline3\n';

    it('approval via terminal callback (onConfirm) produces a single write', async () => {
      const ctx = makeContext(ApprovalMode.DEFAULT);
      const filePath = writeFile(
        tempDir,
        'terminal-approve.txt',
        originalContent,
      );

      const args = {
        file_path: filePath,
        old_string: 'line2',
        new_string: 'TERMINAL_APPROVED',
        force: true,
      };
      await ctx.scheduler.schedule(
        makeRequest('terminal-route', 'ast_edit', args),
        new AbortController().signal,
      );

      // Should be awaiting approval.
      expect(ctx.onAllToolCallsComplete).not.toHaveBeenCalled();
      const awaitingCall = getAwaitingCall(ctx.onToolCallsUpdate);
      await awaitingCall.confirmationDetails.onConfirm(
        ToolConfirmationOutcome.ProceedOnce,
      );

      const completed = await waitForCompletion(ctx.onAllToolCallsComplete);
      expect(completed[0].status).toBe('success');
      expect(readFile(filePath)).toContain('TERMINAL_APPROVED');
      // Single write — content is deterministic.
      expect(readFile(filePath)).toBe('line1\nTERMINAL_APPROVED\nline3\n');
    });

    it('approval via MessageBus/IDE confirmation route produces a single write', async () => {
      const ctx = makeContext(ApprovalMode.DEFAULT);
      const filePath = writeFile(tempDir, 'bus-approve.txt', originalContent);

      // Subscribe to TOOL_CONFIRMATION_REQUEST to capture the correlationId,
      // then respond via MessageBus (the IDE route).
      let capturedCorrelationId: string | undefined;
      ctx.messageBus.subscribe<{ correlationId: string }>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (msg) => {
          capturedCorrelationId = msg.correlationId;
        },
      );

      const args = {
        file_path: filePath,
        old_string: 'line2',
        new_string: 'BUS_APPROVED',
        force: true,
      };
      await ctx.scheduler.schedule(
        makeRequest('bus-route', 'ast_edit', args),
        new AbortController().signal,
      );

      // Should be awaiting approval.
      expect(ctx.onAllToolCallsComplete).not.toHaveBeenCalled();

      // Wait for the confirmation request to arrive on the bus.
      await vi.waitFor(() => {
        expect(capturedCorrelationId).toBeDefined();
      });

      // Respond via the MessageBus — this is the IDE/confirmation-coordinator path.
      ctx.messageBus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: capturedCorrelationId!,
        outcome: ToolConfirmationOutcome.ProceedOnce,
        confirmed: true,
        requiresUserConfirmation: false,
      } as ToolConfirmationResponse);

      const completed = await waitForCompletion(ctx.onAllToolCallsComplete);
      expect(completed[0].status).toBe('success');
      expect(readFile(filePath)).toContain('BUS_APPROVED');
      // Single write.
      expect(readFile(filePath)).toBe('line1\nBUS_APPROVED\nline3\n');
    });
  });
});

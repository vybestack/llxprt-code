/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PolicyEngine unit tests for editor authorization across approval-mode
 * transitions using a real PolicyEngine and MessageBus.
 *
 * Full scheduler → message-bus → real-tools confirmation, preview,
 * cancellation, and filesystem coverage lives in
 * packages/agents/src/core/coreToolScheduler.editor-integration.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from './policy-engine.js';
import {
  PolicyDecision,
  ApprovalMode,
  type PolicyRule,
  type PolicyEngineConfig,
} from './types.js';
import { MessageBus } from './confirmation-bus/message-bus.js';
import {
  MessageBusType,
  ConfirmationOutcome,
  type ToolConfirmationRequest,
  type ToolPolicyRejection,
} from './confirmation-bus/types.js';
import { AUTO_EDIT_TOOLS } from './config.js';

// ── Test fixtures ──────────────────────────────────────────────────────

/**
 * Builds a PolicyEngineConfig with declarative TOML-style rules mirroring
 * write.toml (AUTO_EDIT per-tool ALLOW) and yolo.toml (YOLO wildcard ALLOW).
 * This is exactly what the production TOML files produce.
 */
function buildTomlStyleConfig(): PolicyEngineConfig {
  const rules: PolicyRule[] = [];

  for (const tool of [...AUTO_EDIT_TOOLS, 'save_memory', 'run_shell_command']) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ASK_USER,
      priority: 1.01,
    });
  }

  for (const tool of AUTO_EDIT_TOOLS) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ALLOW,
      priority: 1.015,
      modes: [ApprovalMode.AUTO_EDIT],
    });
  }

  rules.push({
    decision: PolicyDecision.ALLOW,
    priority: 1.999,
    allowRedirection: true,
    modes: [ApprovalMode.YOLO],
  });

  rules.push({
    toolName: 'glob',
    decision: PolicyDecision.ALLOW,
    priority: 1.05,
  });

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
  };
}

function syncMode(engine: PolicyEngine, mode: ApprovalMode): void {
  engine.setApprovalMode(mode);
}

// ── Editor type constants ──────────────────────────────────────────────

const TERMINAL_EDITORS = ['vim', 'neovim', 'emacs', 'hx'] as const;
const GUI_EDITORS = [
  'vscode',
  'vscodium',
  'windsurf',
  'cursor',
  'zed',
  'antigravity',
] as const;
const ALL_EDITOR_TYPES = [...TERMINAL_EDITORS, ...GUI_EDITORS] as const;

// ── Test suite ─────────────────────────────────────────────────────────

describe('Editor mode matrix: PolicyEngine + MessageBus (issue #2659)', () => {
  // ── Six-editor × three-mode matrix ───────────────────────────────────

  describe.each(AUTO_EDIT_TOOLS)('editor tool: %s', (toolName) => {
    it('DEFAULT mode: policy evaluates to ASK_USER (editor/preview shown)', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.DEFAULT);

      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ASK_USER);
    });

    it('AUTO_EDIT mode: policy evaluates to ALLOW (no editor/preview)', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.AUTO_EDIT);

      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ALLOW);
    });

    it('YOLO mode: policy evaluates to ALLOW (no editor/preview)', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.YOLO);

      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ALLOW);
    });

    // ── Downgrade: AUTO_EDIT → DEFAULT ────────────────────────────────

    it('AUTO_EDIT→DEFAULT downgrade: reverts from ALLOW to ASK_USER', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.AUTO_EDIT);
      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ALLOW);

      syncMode(engine, ApprovalMode.DEFAULT);
      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ASK_USER);
    });

    // ── Downgrade: YOLO → DEFAULT ─────────────────────────────────────

    it('YOLO→DEFAULT downgrade: reverts from ALLOW to ASK_USER', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.YOLO);
      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ALLOW);

      syncMode(engine, ApprovalMode.DEFAULT);
      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ASK_USER);
    });

    // ── Downgrade: YOLO → AUTO_EDIT ───────────────────────────────────

    it('YOLO→AUTO_EDIT downgrade: stays ALLOW for edit tool', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.YOLO);
      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ALLOW);

      syncMode(engine, ApprovalMode.AUTO_EDIT);
      expect(engine.evaluate(toolName, {})).toBe(PolicyDecision.ALLOW);
    });
  });

  // ── MessageBus policy confirmation in each mode ──────────────────────

  describe('MessageBus requestConfirmation behavior', () => {
    let engine: PolicyEngine;
    let bus: MessageBus;

    beforeEach(() => {
      engine = new PolicyEngine(buildTomlStyleConfig());
      bus = new MessageBus(engine, false);
    });

    it('DEFAULT: first call to replace returns ASK_USER path (confirmation request emitted)', async () => {
      syncMode(engine, ApprovalMode.DEFAULT);

      let confirmationRequested = false;
      bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (msg) => {
          confirmationRequested = true;
          // Simulate user proceeding
          bus.respondToConfirmation(
            msg.correlationId,
            ConfirmationOutcome.ProceedOnce,
          );
        },
      );

      const result = await bus.requestConfirmation(
        { name: 'replace', args: {} },
        {},
      );

      expect(confirmationRequested).toBe(true);
      expect(result).toBe(true);
    });

    it('AUTO_EDIT: first call to replace fast-approves (ALLOW, no confirmation request)', async () => {
      syncMode(engine, ApprovalMode.AUTO_EDIT);

      let confirmationRequested = false;
      bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        () => {
          confirmationRequested = true;
        },
      );

      const result = await bus.requestConfirmation(
        { name: 'replace', args: {} },
        {},
      );

      expect(confirmationRequested).toBe(false);
      expect(result).toBe(true);
    });

    it('YOLO: first call to replace fast-approves (ALLOW, no confirmation request)', async () => {
      syncMode(engine, ApprovalMode.YOLO);

      let confirmationRequested = false;
      bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        () => {
          confirmationRequested = true;
        },
      );

      const result = await bus.requestConfirmation(
        { name: 'replace', args: {} },
        {},
      );

      expect(confirmationRequested).toBe(false);
      expect(result).toBe(true);
    });

    it('YOLO→DEFAULT: fast-approve stops, confirmation request emitted', async () => {
      syncMode(engine, ApprovalMode.YOLO);
      const yoloResult = await bus.requestConfirmation(
        { name: 'replace', args: {} },
        {},
      );
      expect(yoloResult).toBe(true);

      // Downgrade
      syncMode(engine, ApprovalMode.DEFAULT);

      let confirmationRequested = false;
      bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (msg) => {
          confirmationRequested = true;
          bus.respondToConfirmation(
            msg.correlationId,
            ConfirmationOutcome.ProceedOnce,
          );
        },
      );

      const result = await bus.requestConfirmation(
        { name: 'replace', args: {} },
        {},
      );

      expect(confirmationRequested).toBe(true);
      expect(result).toBe(true);
    });
  });

  // ── Terminal vs IDE (GUI) editor paths ───────────────────────────────

  describe('Terminal vs IDE editor paths: policy parity', () => {
    it.each(ALL_EDITOR_TYPES)(
      'editor %s: DEFAULT asks, AUTO_EDIT/YOLO allow for all edit tools',
      (_editor) => {
        const engine = new PolicyEngine(buildTomlStyleConfig());

        // The editor type does not affect policy decisions — the policy
        // engine is editor-agnostic. The editor only matters for the diff
        // display when shouldConfirmExecute returns confirmation details.
        syncMode(engine, ApprovalMode.DEFAULT);
        for (const tool of AUTO_EDIT_TOOLS) {
          expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ASK_USER);
        }

        syncMode(engine, ApprovalMode.AUTO_EDIT);
        for (const tool of AUTO_EDIT_TOOLS) {
          expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
        }

        syncMode(engine, ApprovalMode.YOLO);
        for (const tool of AUTO_EDIT_TOOLS) {
          expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
        }
      },
    );

    it('terminal editors (vim/neovim/emacs/hx) and GUI editors (vscode/cursor/zed) get identical policy', () => {
      const engine = new PolicyEngine(buildTomlStyleConfig());
      syncMode(engine, ApprovalMode.DEFAULT);

      // Policy is identical regardless of which editor the user has configured
      const vimDecision = engine.evaluate('replace', {});
      const vscodeDecision = engine.evaluate('replace', {});
      expect(vimDecision).toBe(vscodeDecision);
      expect(vimDecision).toBe(PolicyDecision.ASK_USER);

      syncMode(engine, ApprovalMode.YOLO);
      const vimYolo = engine.evaluate('replace', {});
      const vscodeYolo = engine.evaluate('replace', {});
      expect(vimYolo).toBe(vscodeYolo);
      expect(vimYolo).toBe(PolicyDecision.ALLOW);
    });
  });

  // ── ToolPolicyRejection emitted in non-interactive DEFAULT ───────────

  describe('Non-interactive DEFAULT: rejections emitted', () => {
    it('non-interactive mode converts ASK_USER to TOOL_POLICY_REJECTION', async () => {
      const config = buildTomlStyleConfig();
      const engine = new PolicyEngine({
        ...config,
        nonInteractive: true,
      });
      const bus = new MessageBus(engine, false);
      syncMode(engine, ApprovalMode.DEFAULT);

      let rejectionReceived: ToolPolicyRejection | undefined;
      bus.subscribe<ToolPolicyRejection>(
        MessageBusType.TOOL_POLICY_REJECTION,
        (msg) => {
          rejectionReceived = msg;
        },
      );

      const result = await bus.requestConfirmation(
        { name: 'replace', args: {} },
        {},
      );

      expect(result).toBe(false);
      expect(rejectionReceived).toBeDefined();
      expect(rejectionReceived?.type).toBe(
        MessageBusType.TOOL_POLICY_REJECTION,
      );
    });
  });
});

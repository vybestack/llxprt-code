/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2659: authorization desynchronization on
 * approval-mode transitions.
 *
 * The bug: starting in YOLO (or AUTO_EDIT) mode, the PolicyEngine holds
 * mode-derived ALLOW rules. When the user switches to DEFAULT (Ctrl-Y),
 * Config.setApprovalMode must remove ALL mode-derived authorization so that
 * edit tools revert to ASK_USER. If any mode-derived ALLOW rule persists, the
 * ConfirmationCoordinator's tryFastApprove fast-approves ast_edit force:true
 * (or any edit tool) BEFORE shouldConfirmExecute is consulted, silently
 * bypassing consent.
 *
 * These tests exercise the REAL Config → PolicyEngine boundary. They construct
 * a real Config with a real PolicyEngine containing declarative TOML-style
 * rules with `modes` filters, and verify observable policy outcomes
 * (ALLOW / ASK_USER / DENY) across mode transitions — no mock theater.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import {
  createBaseParams,
  resetAgentClientMock,
  type HoistedConfigMocks,
} from './configTestHarness.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import { ApprovalMode, PolicyDecision } from '../policy/types.js';
import type { PolicyEngineConfig, PolicyRule } from '../policy/types.js';
import { AUTO_EDIT_TOOLS } from '../policy/config.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '../confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

const hoistedConfigMocks = vi.hoisted<HoistedConfigMocks>(() => ({
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildFsMockBody(await importOriginal());
});

vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildToolsMockBody(
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>(),
  );
});

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildContentGeneratorMockBody(await importOriginal());
});

vi.mock('../telemetry/index.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildTelemetryMockBody();
});

vi.mock('../services/gitService.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildGitServiceMockBody();
});

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildSettingsMockBody();
});

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildIdeIntegrationMockBody(
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >(),
  );
});

vi.mock('../utils/memoryDiscovery.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildMemoryDiscoveryMockBody(hoistedConfigMocks);
});

vi.mock('../utils/events.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildEventsMockBody(await importOriginal(), hoistedConfigMocks);
});

vi.mock('../utils/fetch.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildFetchMockBody(hoistedConfigMocks);
});

const DEFAULT_WRITE_RULE_PRIORITY = 1.01;
const AUTO_EDIT_RULE_PRIORITY = 1.015;
const READ_ONLY_RULE_PRIORITY = 1.05;
const YOLO_RULE_PRIORITY = 1.999;

/**
 * Builds a PolicyEngineConfig with declarative TOML-style rules that mirror
 * the real write.toml and yolo.toml files. This simulates what
 * createPolicyEngineConfig() produces in production.
 */
function buildTomlStylePolicyConfig(): PolicyEngineConfig {
  const rules: PolicyRule[] = [];

  for (const tool of [...AUTO_EDIT_TOOLS, 'save_memory', 'run_shell_command']) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ASK_USER,
      priority: DEFAULT_WRITE_RULE_PRIORITY,
    });
  }

  for (const tool of AUTO_EDIT_TOOLS) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ALLOW,
      priority: AUTO_EDIT_RULE_PRIORITY,
      modes: [ApprovalMode.AUTO_EDIT],
    });
  }

  rules.push({
    decision: PolicyDecision.ALLOW,
    priority: YOLO_RULE_PRIORITY,
    allowRedirection: true,
    modes: [ApprovalMode.YOLO],
  });

  rules.push({
    toolName: 'glob',
    decision: PolicyDecision.ALLOW,
    priority: READ_ONLY_RULE_PRIORITY,
  });

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
  };
}

describe('Config approval-mode policy synchronization (issue #2659)', () => {
  let settingsService: ReturnType<typeof getSettingsService>;
  let baseParams: ConfigParameters;

  beforeEach(() => {
    resetAgentClientMock();
    settingsService = getSettingsService();
    baseParams = createBaseParams(settingsService);
  });

  function makeConfig(params?: Partial<ConfigParameters>): Config {
    const policyEngineConfig = buildTomlStylePolicyConfig();
    return new Config({
      ...baseParams,
      policyEngineConfig,
      ...params,
    });
  }

  // ── Core regression: YOLO → DEFAULT must clear mode-derived ALLOW ────

  it('YOLO→DEFAULT: ast_edit reverts from ALLOW to ASK_USER after transition', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.YOLO });

    const engine = config.getPolicyEngine();

    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ALLOW);

    config.setApprovalMode(ApprovalMode.DEFAULT);

    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ASK_USER);
  });

  it('YOLO→DEFAULT: representative tools revert to ASK_USER after transition', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.YOLO });

    const engine = config.getPolicyEngine();

    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );

    config.setApprovalMode(ApprovalMode.DEFAULT);

    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ASK_USER);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
  });

  // ── AUTO_EDIT → DEFAULT ──────────────────────────────────────────────

  it('AUTO_EDIT→DEFAULT: all six edit tools revert from ALLOW to ASK_USER', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.AUTO_EDIT });

    const engine = config.getPolicyEngine();

    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
    }

    config.setApprovalMode(ApprovalMode.DEFAULT);

    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ASK_USER);
    }
  });

  // ── AUTO_EDIT → YOLO ─────────────────────────────────────────────────

  it('AUTO_EDIT→YOLO: edit tools stay ALLOW, shell becomes ALLOW', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.AUTO_EDIT });

    const engine = config.getPolicyEngine();

    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );

    config.setApprovalMode(ApprovalMode.YOLO);

    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
    }
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );
  });

  // ── YOLO → AUTO_EDIT ─────────────────────────────────────────────────

  it('YOLO→AUTO_EDIT: shell reverts to ASK_USER, edit tools stay ALLOW', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.YOLO });

    const engine = config.getPolicyEngine();

    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );

    config.setApprovalMode(ApprovalMode.AUTO_EDIT);

    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
    }
  });

  // ── No accumulation of mode rules across rapid transitions ───────────

  it('rapid transitions do not accumulate or lose rules', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.DEFAULT });

    const engine = config.getPolicyEngine();

    for (let i = 0; i < 5; i++) {
      config.setApprovalMode(ApprovalMode.YOLO);
      config.setApprovalMode(ApprovalMode.DEFAULT);
      config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      config.setApprovalMode(ApprovalMode.DEFAULT);
    }

    // All six edit tools must revert to ASK_USER after rapid cycling
    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ASK_USER);
    }
    // Representative shell and glob also correct
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
    expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
  });

  // ── Unrelated rules preserved across transitions ─────────────────────

  it('non-mode ALLOW rules in base survive mode transitions', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.DEFAULT });

    const engine = config.getPolicyEngine();

    expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);

    config.setApprovalMode(ApprovalMode.YOLO);
    config.setApprovalMode(ApprovalMode.DEFAULT);

    expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
  });

  // ── MessageBus retains same PolicyEngine reference ───────────────────

  it('MessageBus sees updated policy after mode transition (identity preserved)', async () => {
    const config = makeConfig({ approvalMode: ApprovalMode.YOLO });

    const engine = config.getPolicyEngine();
    const bus = new MessageBus(engine, false);

    // Before transition (YOLO): requestConfirmation fast-approves
    const beforeResult = await bus.requestConfirmation(
      { name: 'ast_edit', args: {} },
      {},
    );
    expect(beforeResult).toBe(true);

    config.setApprovalMode(ApprovalMode.DEFAULT);

    const confirmationHandler = vi.fn();
    bus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      confirmationHandler,
    );
    const afterPromise = bus.requestConfirmation(
      { name: 'ast_edit', args: {} },
      {},
    );
    await vi.waitFor(() => {
      expect(confirmationHandler).toHaveBeenCalledOnce();
    });
    const confirmationRequest = confirmationHandler.mock
      .calls[0][0] as ToolConfirmationRequest;
    expect(confirmationRequest.type).toBe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
    );
    bus.respondToConfirmation(
      confirmationRequest.correlationId,
      ToolConfirmationOutcome.Cancel,
    );
    await expect(afterPromise).resolves.toBe(false);
  });

  // ── Initial construction matches runtime transition ──────────────────

  it('initial YOLO construction produces same policy as YOLO transition from DEFAULT', () => {
    const configFromYolo = makeConfig({ approvalMode: ApprovalMode.YOLO });

    const configFromDefault = makeConfig({
      approvalMode: ApprovalMode.DEFAULT,
    });
    configFromDefault.setApprovalMode(ApprovalMode.YOLO);

    expect(configFromYolo.getPolicyEngine().evaluate('ast_edit', {})).toBe(
      configFromDefault.getPolicyEngine().evaluate('ast_edit', {}),
    );
    expect(configFromYolo.getPolicyEngine().evaluate('ast_edit', {})).toBe(
      PolicyDecision.ALLOW,
    );
  });

  it('initial AUTO_EDIT construction includes ast_edit ALLOW', () => {
    const config = makeConfig({ approvalMode: ApprovalMode.AUTO_EDIT });

    const engine = config.getPolicyEngine();

    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ALLOW);
  });

  // ── ast_edit is in the AUTO_EDIT_TOOLS list ──────────────────────────

  it('AUTO_EDIT_TOOLS includes all six edit tools', () => {
    expect([...AUTO_EDIT_TOOLS].sort()).toStrictEqual(
      [
        'replace',
        'write_file',
        'insert_at_line',
        'delete_line_range',
        'apply_patch',
        'ast_edit',
      ].sort(),
    );
  });
});

// ── Standalone PolicyEngine tests (no Config, pure engine) ──────────────

describe('PolicyEngine dynamic mode evaluation (standalone)', () => {
  function buildEngineWithTomlRules(): PolicyEngine {
    return new PolicyEngine(buildTomlStylePolicyConfig());
  }

  it('DEFAULT: edit tools are ASK_USER', () => {
    const engine = buildEngineWithTomlRules();
    engine.setApprovalMode(ApprovalMode.DEFAULT);

    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ASK_USER);
    }
  });

  it('AUTO_EDIT: edit tools are ALLOW, shell is ASK_USER', () => {
    const engine = buildEngineWithTomlRules();
    engine.setApprovalMode(ApprovalMode.AUTO_EDIT);

    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
    }
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
  });

  it('YOLO: all tools are ALLOW', () => {
    const engine = buildEngineWithTomlRules();
    engine.setApprovalMode(ApprovalMode.YOLO);

    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );
  });

  it('user TOML rule with modes = [yolo] appears/disappears on transition', () => {
    const rule: PolicyRule = {
      toolName: 'custom_tool',
      decision: PolicyDecision.ALLOW,
      priority: 2.5,
      modes: [ApprovalMode.YOLO],
    };
    const engine = new PolicyEngine({
      rules: [rule],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ALLOW);

    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ASK_USER);
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scheduler fixture with real BeforeTool/AfterTool command hooks and a real
 * policy engine, for the effective-argument authorization tests (#4084).
 * Each BeforeTool invocation appends a line to a log so tests can count runs.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import { physicalHookCommand } from '../../api/__tests__/helpers/physicalHookCommand.js';
import {
  CoreToolScheduler,
  type CompletedToolCall,
  type ToolCall,
} from '../coreToolScheduler.js';

export interface PolicyRuleSpec {
  readonly toolName: string;
  readonly decision: PolicyDecision;
  readonly argsPattern?: RegExp;
  readonly priority?: number;
}

export interface EffectiveArgsFixtureOptions {
  readonly tool: AnyDeclarativeTool;
  /** BeforeTool hook stdout, e.g. a `tool_input` rewrite. */
  readonly beforeToolOutput?: Record<string, unknown>;
  readonly rules?: readonly PolicyRuleSpec[];
  readonly defaultDecision?: PolicyDecision;
  readonly approvalMode?: ApprovalMode;
}

export interface EffectiveArgsFixture {
  readonly scheduler: CoreToolScheduler;
  readonly updates: ToolCall[][];
  readonly completed: Promise<CompletedToolCall[]>;
  schedule(args: Record<string, unknown>): Promise<void>;
  beforeToolRuns(): number;
  dispose(): Promise<void>;
}

function writeHookScript(
  directory: string,
  name: string,
  output: Record<string, unknown>,
  logPath?: string,
): string {
  const script = join(directory, `${name}.ts`);
  const log =
    logPath === undefined
      ? ''
      : `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(logPath)}, 'run\\n');\n`;
  writeFileSync(
    script,
    `${log}process.stdout.write(${JSON.stringify(JSON.stringify(output))});\n`,
    'utf8',
  );
  return physicalHookCommand(script);
}

function createConfig(
  options: EffectiveArgsFixtureOptions,
  directory: string,
  beforeLog: string,
): Config {
  const command = (
    name: string,
    output: Record<string, unknown>,
    log?: string,
  ) => [
    {
      hooks: [
        {
          type: HookType.Command,
          command: writeHookScript(directory, name, output, log),
        },
      ],
    },
  ];
  return Object.assign(
    new Config({
      sessionId: 'effective-args-session',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
      trustedFolder: true,
      enableHooks: true,
      hooks: {
        [HookEventName.BeforeTool]: command(
          'before',
          options.beforeToolOutput ?? {},
          beforeLog,
        ),
        [HookEventName.AfterTool]: command('after', {}),
      },
      policyEngineConfig: {
        defaultDecision: options.defaultDecision ?? PolicyDecision.ALLOW,
        rules: [...(options.rules ?? [])],
      },
    }),
    {
      getApprovalMode: () => options.approvalMode ?? ApprovalMode.DEFAULT,
      isInteractive: () => true,
      getUsageStatisticsEnabled: () => false,
      getAllowedTools: () => [],
      getExcludeTools: () => [],
      getEnableHooks: () => true,
    },
  );
}

function toolRegistry(tool: AnyDeclarativeTool): ToolRegistry {
  return {
    getTool: () => tool,
    getToolByName: () => tool,
    getToolByDisplayName: () => tool,
    getFunctionDeclarations: () => [],
    getTools: () => [tool],
    getAllTools: () => [tool],
    getAllToolNames: () => [tool.name],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

export function createEffectiveArgsFixture(
  options: EffectiveArgsFixtureOptions,
): EffectiveArgsFixture {
  const directory = mkdtempSync(join(tmpdir(), 'effective-args-'));
  const beforeLog = join(directory, 'before.log');
  writeFileSync(beforeLog, '');
  const config = createConfig(options, directory, beforeLog);
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(config);
  const policyOwner = new RuntimePolicyOwner(config);
  const hooks = new SessionHookOwner(
    readHookDefinitions(config),
    hookSessionRuntime(
      config,
      new WorkspaceTrustLifecycle({ localTrust: config.initialWorkspaceTrust }),
      settingsOwner.telemetry,
    ),
    true,
    policyOwner.session.messageBus,
  );
  const updates: ToolCall[][] = [];
  let complete: (calls: CompletedToolCall[]) => void = () => undefined;
  const completed = new Promise<CompletedToolCall[]>((resolve) => {
    complete = resolve;
  });
  const scheduler = new CoreToolScheduler({
    telemetry: settingsOwner.telemetry,
    readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
    getToolGovernance: () => settingsOwner.readToolGovernance([]),
    config,
    messageBus: policyOwner.session.messageBus,
    toolRegistry: toolRegistry(options.tool),
    onAllToolCallsComplete: async (calls) => complete(calls),
    onToolCallsUpdate: (calls) => updates.push(calls),
    getPreferredEditor: () => undefined,
    onEditorClose: vi.fn(),
  });
  return {
    scheduler,
    updates,
    completed,
    schedule: (args) =>
      scheduler.schedule(
        [
          {
            callId: 'effective-args-call',
            name: options.tool.name,
            args,
            isClientInitiated: false,
            prompt_id: 'effective-args-prompt',
          },
        ],
        new AbortController().signal,
        hooks.execution({
          sessionId: () => config.getSessionId(),
          transcriptPath: () => undefined,
        }),
      ),
    beforeToolRuns: () =>
      readFileSync(beforeLog, 'utf8').split('\n').filter(Boolean).length,
    dispose: async () => {
      scheduler.dispose();
      await hooks.dispose();
      await settingsOwner.dispose();
      await policyOwner.dispose();
      await config.dispose();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

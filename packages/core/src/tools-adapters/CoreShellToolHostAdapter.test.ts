/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import os from 'node:os';

import { Config } from '../config/config.js';
import { CoreShellToolHostAdapter } from './CoreShellToolHostAdapter.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { ShellJob, ShellJobManager } from '../services/shellJobManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ShellTool, type IToolMessageBus } from '@vybestack/llxprt-code-tools';
import { initializeParser, isParserAvailable } from '../utils/shell-parser.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import type { IContent } from '../services/history/IContent.js';
import { createTestAgentClient } from '../test-utils/config.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';

/**
 * Windows-only end-to-end coverage for the real background-job path that was
 * previously only exercised through a fake host (`shell-tool.test.ts`):
 *
 *   ShellTool -> CoreShellToolHostAdapter.launchBackgroundJob()
 *             -> real ShellJobManager -> real PowerShell process
 *
 * Every command here drives a REAL process and REAL log files through the
 * production adapter wired to a production Config. Nothing the adapter or
 * manager does is mocked. Deleting either implementation makes these tests
 * fail (no job created, no process spawned, no terminal transition, empty tail).
 */

let sessionIdCounter = 0;

function makeAdapter(): {
  config: Config;
  adapter: CoreShellToolHostAdapter;
} {
  sessionIdCounter += 1;
  const config = new Config({
    model: 'test-model',
    question: 'test question',
    embeddingModel: 'test-embedding',
    targetDir: os.tmpdir(),
    usageStatisticsEnabled: false,
    sessionId: `adapter-e2e-${Date.now()}-${sessionIdCounter}`,
    debugMode: false,
    cwd: os.tmpdir(),
    settingsService: new SettingsService(),
  });
  const adapter = new CoreShellToolHostAdapter(config);
  return { config, adapter };
}

/**
 * Message bus whose only method throws. Background launches must never request
 * confirmation, so if the tool ever calls it the test fails loudly. This is a
 * real (inert) dependency, not a mock of the component under test.
 */
function createInertMessageBus(): IToolMessageBus {
  return {
    requestConfirmation: async (): Promise<never> => {
      throw new Error(
        'requestConfirmation must not be called for a background job launch',
      );
    },
  };
}

function waitForTerminal(
  manager: ShellJobManager,
  id: string,
  timeoutMs = 10000,
): Promise<ShellJob> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const job = manager.get(id);
      if (job !== undefined && job.state !== 'running') {
        resolve(job);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Job ${id} did not reach a terminal state in time`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Returns the ShellJobManager the adapter lazily built. Lives outside the test
 * body so its guard is not a conditional-in-test. Throwing here (rather than
 * asserting) also preserves the precise TypeScript narrowing the caller needs.
 */
function requireManager(config: Config): ShellJobManager {
  const manager = config.getShellJobManager();
  if (manager === undefined) {
    throw new Error('ShellJobManager was not created by the adapter');
  }
  return manager;
}

/** Extracts the real job id the tool printed, throwing if absent. */
function extractJobId(llm: string): string {
  const match = /Job ID: (shell_\w+)/.exec(llm);
  if (match === null) {
    throw new Error('Could not extract job id from tool result');
  }
  return match[1];
}

// Ensure the PowerShell grammar is loaded so ShellTool.build() validation
// succeeds on Windows where the execution shell is PowerShell (#3181).
// Only initialize on Windows to avoid loading parsers unnecessarily on
// non-Windows CI runners.
const pwshAvailable =
  os.platform() === 'win32' &&
  (await initializeParser()) &&
  isParserAvailable('powershell');

describe.skipIf(os.platform() !== 'win32')(
  'CoreShellToolHostAdapter -> real ShellJobManager (Windows end-to-end)',
  () => {
    let config: Config;
    let adapter: CoreShellToolHostAdapter;

    beforeEach(() => {
      const built = makeAdapter();
      config = built.config;
      adapter = built.adapter;
    });

    afterEach(async () => {
      const manager = config.getShellJobManager();
      if (manager !== undefined) {
        // dispose() rejects by design when Windows survivors are retained.
        // Catch so teardown does not mask real test results or leak processes.
        try {
          await manager.dispose();
        } catch (err) {
          debugLogger.warn(
            '[CoreShellToolHostAdapter.test] dispose() rejected during teardown:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    });

    it('launchBackgroundJob returns a shell_ id and the real output is retrievable via tailBackgroundJob', async () => {
      const job = adapter.launchBackgroundJob({
        command: "Write-Output 'adapter-e2e-success'",
        cwd: os.tmpdir(),
      });

      // The id must come from the real ShellJobManager's id generator.
      expect(job.id).toMatch(/^shell_/);
      expect(job.state).toBe('running');

      const manager = requireManager(config);
      const terminal = await waitForTerminal(manager, job.id);

      // The real process reached a terminal state with a real exit code.
      expect(terminal.state).toBe('completed');
      expect(terminal.exitCode).toBe(0);

      // The real command output is retrievable through the adapter's tail.
      const tail = adapter.tailBackgroundJob(job.id);
      expect(tail.output).toContain('adapter-e2e-success');
    });

    it('launchBackgroundJob reports the real non-zero exit code for a failing command', async () => {
      const job = adapter.launchBackgroundJob({
        command: 'exit 7',
        cwd: os.tmpdir(),
      });

      expect(job.id).toMatch(/^shell_/);

      const manager = requireManager(config);
      const terminal = await waitForTerminal(manager, job.id);

      // A real failing command surfaces its real non-zero exit code.
      expect(terminal.state).toBe('failed');
      expect(terminal.exitCode).toBe(7);
    });

    it('ShellTool wired to the real adapter launches a REAL background job with a shell_ id and contract-clean output', async () => {
      const tool = new ShellTool(adapter, createInertMessageBus());

      const invocation = tool.build({
        command: "Write-Output 'via-shell-tool'",
        is_background: true,
      });
      const result = await invocation.execute(new AbortController().signal);

      const llm = String(result.llmContent);
      expect(llm).toContain('Background job launched.');
      expect(llm).toContain('Job ID: shell_');
      expect(llm).toContain('State:');

      // Extract the real job id the tool obtained from the real manager and
      // prove the process actually ran: terminal state + retrievable output.
      const jobId = extractJobId(llm);

      const manager = requireManager(config);
      const terminal = await waitForTerminal(manager, jobId);
      expect(terminal.state).toBe('completed');
      expect(terminal.exitCode).toBe(0);

      const tail = adapter.tailBackgroundJob(jobId);
      expect(tail.output).toContain('via-shell-tool');
    });
  },
);

/**
 * Finding 5 (#3181): Real adapter + ShellTool permission integration.
 *
 * These tests exercise the REAL CoreShellToolHostAdapter (not a fake host)
 * through the REAL ShellTool.validateToolParamValues / build path. On Windows,
 * getShellConfiguration().shell is 'powershell', so the adapter delegates to
 * the real PowerShell parser. No parser/policy results are mocked.
 *
 * Coverage:
 * (a) The exact issue #3181 reproduction command passes validation.
 * (b) Malformed PowerShell is hard-denied by the real parser.
 * (c) A blocklisted command nested in a script block is rejected.
 * (d) isShellInvocationAllowlisted requires EVERY nested command to be allowed.
 * (e) Dynamic/expression targets fail closed under a strict allowedTools set.
 */
describe.skipIf(os.platform() !== 'win32' || !pwshAvailable)(
  'CoreShellToolHostAdapter -> ShellTool permission integration (#3181)',
  () => {
    function makePermissionConfig(
      allowedTools: string[] = [],
      excludeTools: string[] = [],
    ): { config: Config; adapter: CoreShellToolHostAdapter } {
      const config = new Config({
        model: 'test-model',
        question: 'test question',
        embeddingModel: 'test-embedding',
        targetDir: os.tmpdir(),
        usageStatisticsEnabled: false,
        sessionId: `perm-${Date.now()}-${++sessionIdCounter}`,
        debugMode: false,
        cwd: os.tmpdir(),
        settingsService: new SettingsService(),
        coreTools: allowedTools,
        allowedTools,
        excludeTools,
      });
      return { config, adapter: new CoreShellToolHostAdapter(config) };
    }

    it('(a) exact issue #3181 reproduction command passes adapter validation', () => {
      const { adapter } = makePermissionConfig();
      const issueCmd =
        'git status --short --branch; git checkout main; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }';
      const result = adapter.isCommandAllowed(issueCmd);
      expect(result.allowed).toBe(true);
    });

    it('(a) ShellTool.build does not throw for the issue #3181 command', () => {
      const { adapter } = makePermissionConfig();
      const tool = new ShellTool(adapter);
      expect(() =>
        tool.build({
          command:
            'git status --short --branch; git checkout main; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
        }),
      ).not.toThrow();
    });

    it('(b) malformed PowerShell is hard-denied with PowerShell diagnostic', () => {
      const { adapter } = makePermissionConfig();
      const result = adapter.isCommandAllowed('Get-ChildItem |');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('tree-sitter-pwsh');
    });

    it('(b) ShellTool.build throws for malformed PowerShell', () => {
      const { adapter } = makePermissionConfig();
      const tool = new ShellTool(adapter);
      expect(() => tool.build({ command: 'Get-ChildItem |' })).toThrow(
        /tree-sitter-pwsh/,
      );
    });

    it('(c) blocklisted command nested in script block is rejected', () => {
      const { adapter } = makePermissionConfig([], ['ShellTool(rm)']);
      const result = adapter.isCommandAllowed('ForEach-Object { rm -rf /tmp }');
      expect(result.allowed).toBe(false);
    });

    it('(d) isShellInvocationAllowlisted requires all nested commands', () => {
      const { adapter } = makePermissionConfig(['ShellTool(Get-Process)']);
      // Get-Process is allowed but Where-Object is not
      expect(
        adapter.isShellInvocationAllowlisted(
          'Get-Process | Where-Object { $_.Name -eq "x" }',
        ),
      ).toBe(false);
    });

    it('(d) isShellInvocationAllowlisted returns true when all nested commands are allowed', () => {
      const { adapter } = makePermissionConfig([
        'ShellTool(Get-Process)',
        'ShellTool(Where-Object)',
      ]);
      expect(
        adapter.isShellInvocationAllowlisted(
          'Get-Process | Where-Object { $_.Name -eq "x" }',
        ),
      ).toBe(true);
    });

    it('(e) dynamic call target fails closed under strict allowedTools', () => {
      const { adapter } = makePermissionConfig(['ShellTool(git)']);
      const result = adapter.isCommandAllowed('& $cmd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dynamic or expression');
    });

    it('(e) .NET Process::Start fails closed under strict allowedTools', () => {
      const { adapter } = makePermissionConfig(['ShellTool(git)']);
      const result = adapter.isCommandAllowed(
        '[System.Diagnostics.Process]::Start("cmd.exe")',
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dynamic or expression');
    });
  },
);

/**
 * Issue #2626: `trySummarizeOutput` must honor the caller's token budget on
 * every runtime. The previous implementation refused to summarize unless the
 * content generator config carried a gemini serverToolsProvider — a
 * server-tools-era gate unrelated to summarization. These tests drive the
 * real adapter against a real initialized Config whose agent client performs
 * the summarization; the only substituted piece is the generation boundary
 * itself (no network), which reports the prompt it received.
 */
describe('CoreShellToolHostAdapter.trySummarizeOutput (issue #2626: uniform summarization)', () => {
  async function makeSummarizingAdapter(providerManager?: {
    getActiveProvider(): { name: string } | undefined;
  }): Promise<{
    adapter: CoreShellToolHostAdapter;
    summarizedPromptLengths: number[];
  }> {
    sessionIdCounter += 1;
    const summarizedPromptLengths: number[] = [];
    const agentClient = createTestAgentClient({
      generateContent: async (contents: IContent[]) => {
        const prompt = partToText(contents[0]?.blocks);
        summarizedPromptLengths.push(prompt.length);
        return {
          content: {
            speaker: 'ai' as const,
            blocks: [
              { type: 'text' as const, text: `SUMMARY:${prompt.length}` },
            ],
          },
        };
      },
    });
    const config = new Config({
      model: 'test-model',
      question: 'test question',
      embeddingModel: 'test-embedding',
      targetDir: os.tmpdir(),
      usageStatisticsEnabled: false,
      sessionId: `adapter-summarize-${Date.now()}-${sessionIdCounter}`,
      debugMode: false,
      cwd: os.tmpdir(),
      settingsService: new SettingsService(),
      agentClientFactory: () => agentClient,
    });

    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    await config.initialize({ messageBus });
    if (providerManager !== undefined) {
      const target = config as unknown as {
        contentGeneratorConfig: ContentGeneratorConfig;
      };
      target.contentGeneratorConfig = {
        model: 'test-model',
        providerManager:
          providerManager as unknown as ContentGeneratorConfig['providerManager'],
      };
    }
    return {
      adapter: new CoreShellToolHostAdapter(config),
      summarizedPromptLengths,
    };
  }

  it('summarizes oversized output when no provider manager is configured', async () => {
    const { adapter, summarizedPromptLengths } = await makeSummarizingAdapter();
    const oversized = `command output line
${'x'.repeat(1200)}`;

    const result = await adapter.trySummarizeOutput(
      oversized,
      new AbortController().signal,
      1000,
    );

    expect(result).not.toBe(oversized);
    expect(result).toMatch(/^SUMMARY:\d+$/);
    // The full oversized content must reach the summarizer prompt: the
    // returned length is the prompt's length, which embeds the content plus
    // the instruction template.
    const promptLength = Number(result.slice('SUMMARY:'.length));
    expect(promptLength).toBeGreaterThan(oversized.length);
    expect(summarizedPromptLengths).toEqual([promptLength]);
  });

  it('summarizes oversized output when the active provider is not gemini', async () => {
    const { adapter } = await makeSummarizingAdapter({
      getActiveProvider: () => ({ name: 'openai' }),
    });
    const oversized = `command output line
${'y'.repeat(1200)}`;

    const result = await adapter.trySummarizeOutput(
      oversized,
      new AbortController().signal,
      1000,
    );

    expect(result).not.toBe(oversized);
    expect(result).toMatch(/^SUMMARY:\d+$/);
    expect(Number(result.slice('SUMMARY:'.length))).toBeGreaterThan(
      oversized.length,
    );
  });

  it('returns content under the token budget unchanged without summarizing', async () => {
    const { adapter, summarizedPromptLengths } = await makeSummarizingAdapter();
    const small = 'short output';

    const result = await adapter.trySummarizeOutput(
      small,
      new AbortController().signal,
      1000,
    );

    expect(result).toBe(small);
    expect(summarizedPromptLengths).toEqual([]);
  });
});

function partToText(blocks: IContent['blocks'] | undefined): string {
  if (blocks === undefined) {
    return '';
  }
  return blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

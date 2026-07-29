#!/usr/bin/env node
/**
 * Cross-platform ACP integration test for Zed/ACP-mode bugs.
 *
 * Reproduces two issues that only manifest in ACP/Zed mode:
 *
 *  Bug 1: `this.isRunning is not a function` when the `task` tool is invoked.
 *  Bug 2: The pause tool does not stop the agent continuation loop.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { platform } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AcpOptions {
  profile: string;
  prompt: string;
  timeout: number;
}

interface SessionUpdate {
  sessionUpdate: string;
  content?: { text?: string };
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
}

interface ToolCallRecord {
  phase: string;
  name?: string;
  rawTitle?: string;
  rawKind?: string;
  content?: unknown;
  status?: string;
  rawStatus?: string;
}

const sessionUpdateSchema = z
  .object({
    sessionUpdate: z.string(),
    content: z.object({ text: z.string().optional() }).passthrough().optional(),
    toolCallId: z.string().optional(),
    title: z.string().optional(),
    kind: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const jsonRpcMessageSchema = z
  .object({
    id: z.number().optional(),
    method: z.string().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
    params: z
      .object({ update: sessionUpdateSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface ScenarioResult {
  label: string;
  passed: boolean;
  errors: string[];
  details: Record<string, unknown>;
}

interface ExpectationCheck {
  passed: boolean;
  message: string;
}

interface Expectation {
  name: string;
  check: (
    client: AcpClient,
    details: Record<string, unknown>,
  ) => ExpectationCheck;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): AcpOptions {
  const args = process.argv.slice(2);
  const opts: AcpOptions = {
    profile: process.env.LLXPRT_PROFILE || 'gpt56high',
    prompt: '',
    timeout: 120_000,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--profile':
        opts.profile = args[++i];
        break;
      case '--prompt':
        opts.prompt = args[++i];
        break;
      case '--timeout':
        opts.timeout = Number(args[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }
  if (!opts.prompt) {
    opts.prompt =
      'Use the todo_write tool to create a single todo item that says "test". ' +
      'Then immediately call todo_pause with reason "testing pause in ACP mode". ' +
      'Do not do anything else.';
  }
  return opts;
}

function printHelp(): void {
  console.log(`
Usage: node scripts/test-acp-zed-bugs.ts [options]

Options:
  --profile <name>   Profile to load (default: gpt56high, env: LLXPRT_PROFILE)
  --prompt <text>    Custom prompt to send (default: triggers todo_pause)
  --timeout <ms>     Timeout in milliseconds (default: 120000)
  -h, --help         Show this help

Environment:
  LLXPRT_BINARY      Override bun binary path
  LLXPRT_ENTRY       Override index.ts entry point
  DEBUG              Set to 'llxprt:*' for verbose logs
`);
}

// ---------------------------------------------------------------------------
// Binary resolution (cross-platform)
// ---------------------------------------------------------------------------

function findBunBinary(): string {
  if (process.env.LLXPRT_BINARY) {
    return process.env.LLXPRT_BINARY;
  }

  const cwd = process.cwd();
  const isWin = platform() === 'win32';
  const exe = isWin ? 'bun.exe' : 'bun';

  // 1. Local node_modules bun (project devDependency)
  const localBun = join(cwd, 'node_modules', 'bun', 'bin', exe);
  if (existsSync(localBun)) {
    return localBun;
  }

  // 2. Global npm install path (common on Windows)
  if (isWin) {
    const globalBun = join(
      process.env.APPDATA || '',
      'npm',
      'node_modules',
      '@vybestack',
      'llxprt-code',
      'node_modules',
      'bun',
      'bin',
      exe,
    );
    if (existsSync(globalBun)) {
      return globalBun;
    }
  }

  // 3. Fallback: just "bun" on PATH
  return 'bun';
}

function findEntryPoint(): string {
  if (process.env.LLXPRT_ENTRY) {
    return process.env.LLXPRT_ENTRY;
  }
  // Local dev entry point
  return join(projectRoot, 'packages', 'cli', 'index.ts');
}

// ---------------------------------------------------------------------------
// ACP JSON-RPC client
// ---------------------------------------------------------------------------

class AcpClient {
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  nextId: number;
  pending: Map<number, PendingRequest>;
  sessionUpdates: SessionUpdate[];
  toolCalls: ToolCallRecord[];
  agentMessages: string[];
  errors: string[];

  constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.sessionUpdates = [];
    this.toolCalls = [];
    this.agentMessages = [];
    this.errors = [];

    this.proc.stdout.on('data', (chunk: Buffer) => this._onData(chunk));
  }

  _onData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch {
        // Non-JSON line (debug logs etc.) — ignore
      }
    }
  }

  _handleMessage(value: unknown): void {
    const parsed = jsonRpcMessageSchema.safeParse(value);
    if (!parsed.success) {
      return;
    }
    const msg = parsed.data;
    const msgId = msg.id;
    if (msgId !== undefined) {
      const pending = this.pending.get(msgId);
      if (pending !== undefined) {
        this.pending.delete(msgId);
        if (msg.error) {
          pending.reject(
            new Error(
              typeof msg.error.message === 'string'
                ? msg.error.message
                : JSON.stringify(msg.error),
            ),
          );
        } else {
          pending.resolve(msg.result ?? {});
        }
        return;
      }
    }

    if (msg.method === 'session/update') {
      const update = msg.params?.update;
      if (update) {
        this.sessionUpdates.push(update);
        this._categorizeUpdate(update);
      }
    }
  }

  _categorizeUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.text) {
          this.agentMessages.push(update.content.text);
        }
        break;
      case 'tool_call':
        this.toolCalls.push({
          phase: 'start',
          name: update.toolCallId,
          rawTitle: update.title,
          rawKind: update.kind,
          content: update.content,
          status: update.status,
        });
        break;
      case 'tool_call_update':
        this.toolCalls.push({
          phase: 'update',
          rawStatus: update.status,
          content: update.content,
        });
        break;
    }
  }

  async send(
    method: string,
    params: unknown,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(request) + '\n');

      // Per-request timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request ${method} (id=${id}) timed out`));
        }
      }, 30_000);
    });
  }

  waitForCompletion(totalTimeout: number | undefined): Promise<{
    exited: true;
    code: number | null;
    signal: NodeJS.Signals | null;
  }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Prompt did not complete within ${totalTimeout}ms`));
      }, totalTimeout);

      this.proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ exited: true, code, signal });
      });
    });
  }

  /** Drain stderr for error detection. */
  attachStderr(): void {
    this.proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (
        text.includes('isRunning') ||
        text.includes('not a function') ||
        text.includes('ERROR')
      ) {
        this.errors.push(text.trim());
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

/**
 * Performs ACP handshake: initialize → authenticate → session/new.
 * Returns the session ID or null on failure.
 */
async function performAcpHandshake(
  client: AcpClient,
  opts: AcpOptions,
  results: ScenarioResult,
): Promise<string | null> {
  // Step 1: Initialize
  console.log('\n[1/4] Sending initialize...');
  const initResult = await client.send('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
    },
  });
  console.log('  [OK] Initialize succeeded');
  results.details.protocolVersion = initResult.protocolVersion;

  // Step 2: Authenticate (load profile)
  console.log('\n[2/4] Sending authenticate...');
  try {
    await client.send('session/authenticate', { methodId: opts.profile });
    console.log('  [OK] Authenticated');
  } catch (e) {
    console.log(
      `   Auth step skipped/failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Step 3: Create session
  console.log('\n[3/4] Sending session/new...');
  const sessionResult = await client.send('session/new', {
    cwd: projectRoot,
    mcpServers: [],
  });
  const sessionId = sessionResult.sessionId;
  console.log(`  [OK] Session created: ${sessionId}`);
  results.details.sessionId = sessionId;

  return typeof sessionId === 'string' ? sessionId : null;
}

function collectAcpMetrics(client: AcpClient, results: ScenarioResult): void {
  results.details.toolCallCount = client.toolCalls.length;
  results.details.messageCount = client.agentMessages.length;
  results.details.stderrErrors = client.errors.length;
  results.details.stderrErrorSnippets = client.errors.slice(0, 3);
}

function evaluateExpectations(
  expectations: Expectation[],
  client: AcpClient,
  results: ScenarioResult,
): void {
  for (const expectation of expectations) {
    const check = expectation.check(client, results.details);
    results.details[expectation.name] = check;
    if (!check.passed) {
      results.errors.push(check.message);
    }
    console.log(
      `  ${check.passed ? 'PASS' : 'FAIL'} ${expectation.name}: ${check.message}`,
    );
  }
}

async function runScenarioPhase(
  client: AcpClient,
  opts: AcpOptions,
  prompt: string,
  expectations: Expectation[],
  results: ScenarioResult,
): Promise<void> {
  // Wait for process to be ready
  await sleep(1000);

  const sessionId = await performAcpHandshake(client, opts, results);
  if (!sessionId) return;

  // Step 4: Prompt
  console.log('\n[4/4] Sending session/prompt...');
  const promptPromise = client.send('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: prompt }],
  });

  // Wait for prompt to complete (or timeout)
  // Attach a no-op catch to prevent unhandled rejection if the race
  // resolves via the timeout/process-exit path first.
  promptPromise.catch(() => {});

  const promptResult = await Promise.race([
    promptPromise,
    client.waitForCompletion(opts.timeout),
  ]);

  const stopReason =
    'stopReason' in promptResult && typeof promptResult.stopReason === 'string'
      ? promptResult.stopReason
      : undefined;
  console.log(`  [OK] Prompt completed: stopReason=${stopReason || 'N/A'}`);
  results.details.stopReason = stopReason;

  // Analyze results
  await sleep(500);
  collectAcpMetrics(client, results);
  evaluateExpectations(expectations, client, results);

  results.passed = results.errors.length === 0;
}

async function runScenario(
  opts: AcpOptions,
  label: string,
  prompt: string,
  expectations: Expectation[],
): Promise<ScenarioResult> {
  const binary = findBunBinary();
  const entry = findEntryPoint();

  const args = [
    entry,
    '--experimental-acp',
    '--profile-load',
    opts.profile,
    '--yolo',
  ];
  const env: Record<string, string | undefined> = { ...process.env };
  if (!env.DEBUG) {
    env.DEBUG = 'llxprt:*';
  }
  env.LLXPRT_LOG_HOME =
    env.LLXPRT_LOG_HOME || join(projectRoot, '.acp-test-logs');

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Scenario: ${label}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Binary:  ${binary}`);
  console.log(`Entry:   ${entry}`);
  console.log(`Profile: ${opts.profile}`);
  console.log(`Prompt:  ${prompt.substring(0, 100)}...`);

  const child = spawn(binary, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: projectRoot,
    env,
  });

  const client = new AcpClient(child);
  client.attachStderr();

  const results: ScenarioResult = {
    label,
    passed: false,
    errors: [],
    details: {},
  };

  try {
    await runScenarioPhase(client, opts, prompt, expectations, results);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.errors.push(msg);
    results.details.fatalError = msg;
    console.error(`\n  ✗ FATAL: ${msg}`);
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process may have already exited
    }
    await sleep(500);
    try {
      child.kill('SIGKILL');
    } catch {
      // Process may have already exited
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Expectation helpers
// ---------------------------------------------------------------------------

function expectNoStderrErrors(): Expectation {
  return {
    name: 'No stderr "isRunning" / "not a function" errors',
    check: (client: AcpClient): ExpectationCheck => {
      const hasError = client.errors.some(
        (e: string) => e.includes('isRunning') || e.includes('not a function'),
      );
      return {
        passed: !hasError,
        message: hasError
          ? `Found error in stderr: ${client.errors.find((e: string) => e.includes('isRunning'))?.substring(0, 200)}`
          : 'No isRunning/not-a-function errors detected',
      };
    },
  };
}

function expectTodoPauseStopsLoop(): Expectation {
  return {
    name: 'pause tool stops continuation (stopReason is end_turn, not loop-detected)',
    check: (
      _client: AcpClient,
      details: Record<string, unknown>,
    ): ExpectationCheck => {
      // After the pause tool, the agent should stop — not continue the loop.
      // We check: the stopReason should be 'end_turn' and there should
      // NOT be excessive tool calls (which would indicate looping).
      const stopReason = details.stopReason;
      const timedOut = details.timedOut === true;
      // A timeout means the loop never stopped — that's the bug.
      // Otherwise, a normal end_turn/cancelled is correct behavior.
      const validStopReason =
        stopReason === 'end_turn' || stopReason === 'cancelled';
      const toolCallCount =
        typeof details.toolCallCount === 'number' ? details.toolCallCount : 0;
      const hasValidStop =
        validStopReason || (stopReason === undefined && toolCallCount < 10);
      const passed = !timedOut && hasValidStop;
      const timeoutMessage = `TIMEOUT after ${details.timeout || 'N/A'}ms — loop did not stop (BUG REPRODUCED)`;
      const successMessage = `stopReason=${stopReason}, toolCalls=${toolCallCount}`;
      return {
        passed,
        message: timedOut ? timeoutMessage : successMessage,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number | undefined): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function summarizeResults(allResults: ScenarioResult[]): boolean {
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(70)}`);

  let allPassed = true;
  for (const r of allResults) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.label}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) {
        console.log(`    → ${e}`);
      }
      allPassed = false;
    }
  }

  console.log(
    `\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`,
  );
  return allPassed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  const results: ScenarioResult[] = [];

  // Scenario 1: pause tool should stop the loop
  results.push(
    await runScenario(
      opts,
      'pause tool stops continuation in ACP mode',
      'Use the todo_write tool to create a single todo item that says "test". ' +
        'Then immediately call todo_pause with reason "testing pause in ACP mode". ' +
        'Do not do anything else. Do not continue working.',
      [expectTodoPauseStopsLoop(), expectNoStderrErrors()],
    ),
  );

  // Scenario 2: task tool should not crash with isRunning error
  results.push(
    await runScenario(
      opts,
      'task tool does not crash with isRunning error in ACP mode',
      'Use the task tool to launch the deepthinker subagent with the goal "write a single haiku". ' +
        'Do not use any other tools. Return the haiku.',
      [expectNoStderrErrors()],
    ),
  );

  const allPassed = summarizeResults(results);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

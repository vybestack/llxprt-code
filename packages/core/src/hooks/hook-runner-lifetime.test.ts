import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../config/config.js';
import { hookSessionRuntime } from './hook-configuration.js';
import { HookRunner } from './hookRunner.js';
import { ConfigSource } from './hookRegistry.js';
import { HookEventName, HookType, type HookInput } from './types.js';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { escapeShellArg } from '../utils/shell-utils.js';

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Hook did not create ${path}`);
    await sleep(10);
  }
}

function input(directory: string): HookInput {
  return {
    session_id: 'same-label',
    cwd: directory,
    transcript_path: '',
    hook_event_name: HookEventName.BeforeTool,
    timestamp: '2026-10-06T00:00:00.000Z',
  };
}

async function heldCommand(directory: string): Promise<string> {
  const child = join(directory, 'descendant.ts');
  const parent = join(directory, 'parent.ts');
  await writeFile(
    child,
    `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync('descendant.pid', String(process.pid));
setTimeout(() => { writeFileSync('late-privileged', 'ran'); process.exit(0); }, 1200);
`,
  );
  await writeFile(
    parent,
    `import { spawn } from 'node:child_process';
spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'inherit' });
await new Promise(resolve => setTimeout(resolve, 2000));
`,
  );
  return `exec ${escapeShellArg('node', 'bash')} ${escapeShellArg(parent, 'bash')}`;
}

function runner(directory: string): HookRunner {
  const config = new Config({
    sessionId: 'same-label',
    targetDir: directory,
    cwd: directory,
    debugMode: false,
    model: 'physical-hook',
    trustedFolder: true,
  });
  const session = hookSessionRuntime(
    config,
    new WorkspaceTrustLifecycle({ localTrust: config.initialWorkspaceTrust }),
    RootTelemetry.prepare({
      enabled: false,
      sessionId: 'isolated-caller-fixture',
      maxBytes: 1024,
      maxFiles: 1,
    }),
  );
  return new HookRunner(
    session.process,
    session.isTrustedFolder,
    () => new AbortController().signal,
  );
}

describe('physical hook ownership', () => {
  function useProject(): () => string {
    let directory = '';
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'llxprt-hook-lifetime-'));
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    return () => directory;
  }

  describe.skipIf(process.platform === 'win32')(
    'hook subprocess lifetime',
    () => {
      const project = useProject();

      it('joins cancellation through a TERM-immune descendant and retains the original reason', async () => {
        const directory = project();
        const cancellation = new AbortController();
        const reason = new Error('the turn was cancelled');
        const pending = runner(directory).executeHook(
          {
            type: HookType.Command,
            source: ConfigSource.Project,
            command: await heldCommand(directory),
          },
          HookEventName.BeforeTool,
          input(directory),
          cancellation.signal,
        );
        await waitForFile(join(directory, 'descendant.pid'));
        cancellation.abort(reason);
        const result = await pending;
        await sleep(1300);
        expect({
          success: result.success,
          error: result.error,
          late: existsSync(join(directory, 'late-privileged')),
        }).toStrictEqual({ success: false, error: reason, late: false });
      });

      it('joins timeout cleanup before a descendant can perform its delayed write', async () => {
        const directory = project();
        const result = await runner(directory).executeHook(
          {
            type: HookType.Command,
            source: ConfigSource.Project,
            command: await heldCommand(directory),
            timeout: 250,
          },
          HookEventName.BeforeTool,
          input(directory),
        );
        await sleep(1300);
        expect({
          success: result.success,
          message: result.error?.message,
          late: existsSync(join(directory, 'late-privileged')),
        }).toStrictEqual({
          success: false,
          message: 'Hook timed out after 250ms',
          late: false,
        });
      });

      it('delivers JSON stdin and preserves stdout feedback and stderr', async () => {
        const directory = project();
        const script = join(directory, 'feedback.mts');
        await writeFile(
          script,
          `import { writeFileSync } from 'node:fs';
let json = '';
process.stdin.on('data', chunk => { json += chunk.toString(); });
process.stdin.on('end', () => {
  const input = JSON.parse(json);
  writeFileSync('input.json', JSON.stringify(input));
  console.error('hook diagnostic');
  console.log(JSON.stringify({ hookSpecificOutput: { tool_input: { file_path: input.cwd + '/owned.txt' } } }));
});
process.stdin.resume();
`,
        );
        const driver = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL('./hook-runner-physical-driver.ts', import.meta.url),
            ),
            directory,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stderr = '';
        driver.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        driver.stdout.resume();
        const exit = await new Promise<number | null>((resolve, reject) => {
          driver.on('error', reject);
          driver.on('close', resolve);
        });
        expect({ exit, stderr }).toStrictEqual({ exit: 0, stderr: '' });
        const result = z
          .object({
            success: z.boolean(),
            stdout: z.string(),
            stderr: z.string(),
            exitCode: z.number(),
            output: z.object({ hookSpecificOutput: z.record(z.unknown()) }),
          })
          .parse(
            JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')),
          );
        expect({
          success: result.success,
          stderr: result.stderr.trim(),
          stdout: result.stdout,
          code: result.exitCode,
        }).toStrictEqual({
          success: true,
          stderr: 'hook diagnostic',
          stdout:
            JSON.stringify({
              hookSpecificOutput: {
                tool_input: { file_path: join(directory, 'owned.txt') },
              },
            }) + String.fromCharCode(10),
          code: 0,
        });
        expect({
          input: JSON.parse(
            await readFile(join(directory, 'input.json'), 'utf8'),
          ),
          feedback: result.output.hookSpecificOutput,
          stderr: result.stderr.trim(),
        }).toStrictEqual({
          input: input(directory),
          feedback: { tool_input: { file_path: join(directory, 'owned.txt') } },
          stderr: 'hook diagnostic',
        });
      });
    },
  );
});

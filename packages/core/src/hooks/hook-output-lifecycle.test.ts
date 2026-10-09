/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { Config } from '../config/config.js';
import { escapeShellArg, getShellConfiguration } from '../utils/shell-utils.js';
import { HookRunner } from './hookRunner.js';
import { HookOutputOwner } from './hookOutputSnapshot.js';
import { runHookSnapshot } from './hookSnapshotProcess.js';
import type { HookModelRowsInput } from './hookModelInputStream.js';
import { HookEventName, HookType, type HookConfig } from './types.js';

function command(script: string): HookConfig {
  const shell = getShellConfiguration().shell;
  return {
    type: HookType.Command,
    command: `exec node -e ${escapeShellArg(script, shell)}`,
    timeout: 5000,
  };
}

function input(root: string): HookModelRowsInput {
  return {
    session_id: 'scratch-lifecycle',
    transcript_path: join(root, 'transcript'),
    cwd: root,
    hook_event_name: HookEventName.BeforeModel,
    timestamp: new Date(0).toISOString(),
    llm_request: {
      version: 2,
      model: 'test',
      contents: {
        count: 2,
        async *openReader(): AsyncGenerator<unknown, void, unknown> {
          yield { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] };
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] };
        },
      },
      tools: [],
    },
  };
}

const responseScript = `
  (async () => {
    process.stdin.setEncoding('utf8');
    let body = ''; for await (const chunk of process.stdin) body += chunk;
    const request = JSON.parse(body).llm_request;
    request.contents.reverse();
    process.stderr.write('diagnostic 雪');
    const output = {hookSpecificOutput: {llm_request: request}};
    process.stdout.write(ENCODE);
  })();
`;

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!fs.existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Child did not create ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function scratch(root: string): string[] {
  return fs.readdirSync(root).filter((name) => name.startsWith('hook-output-'));
}

let root: string;
let runner: HookRunner;

describe('disk hook output scratch lifecycle', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(join(process.cwd(), 'tmp/hook-lifecycle-'));
    runner = new HookRunner(
      new Config({
        sessionId: 'scratch-lifecycle',
        targetDir: root,
        cwd: root,
        debugMode: false,
        model: 'test',
      }),
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  registerReaderTests();
  registerDiagnosticTests();
  registerChildFailureTests();
  registerValidationTests();
  registerConstructionTests();
  registerDiskErrorTests();
  registerSpawnTests();
  registerSetupTest();
});

function registerReaderTests(): void {
  describe('ReaderTests', () => {
    for (const encoded of [false, true]) {
      it(`keeps ${encoded ? 'decoded' : 'direct'} output live for independent readers and removes all scratch on disposal`, async () => {
        const result = await runner.executeHookWithRequestRows(
          command(
            responseScript.replace(
              'ENCODE',
              encoded
                ? 'JSON.stringify(JSON.stringify(output))'
                : 'JSON.stringify(output)',
            ),
          ),
          HookEventName.BeforeModel,
          input(root),
        );
        const directory = dirname(result.stdout.path);
        try {
          expect(result.success).toBe(true);
          expect(result.stderr.readText()).toBe('diagnostic 雪');
          expect(fs.existsSync(directory)).toBe(true);
          expect(fs.readdirSync(directory)).toContain('rows.index');
          expect(fs.readdirSync(directory)).toContain('document.utf16');
          const rows = result.output?.replacement;
          if (rows === undefined) throw new Error('Missing hook replacement');
          expect(rows.count).toBe(2);
          const left = rows.openReader();
          const right = rows.openReader();
          const first = await left.next();
          expect(first).toStrictEqual({
            done: false,
            value: {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'second' }],
            },
          });
          expect(await right.next()).toStrictEqual(first);
          const second = await left.next();
          expect(second).toStrictEqual({
            done: false,
            value: {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'first' }],
            },
          });
          expect(await left.next()).toStrictEqual({
            done: true,
            value: undefined,
          });
          expect(await right.next()).toStrictEqual(second);
          expect(scratch(root)).toStrictEqual([basename(directory)]);
          result.dispose();
          expect(fs.existsSync(directory)).toBe(false);
          await expect(left.next()).rejects.toThrow('Hook output disposed');
          expect(scratch(root)).toStrictEqual([]);
          await expect(right.next()).rejects.toThrow('Hook output disposed');
          expect(() => rows.openReader()).toThrow('Hook output disposed');
          expect(() => result.output?.readValue(['decision'])).toThrow(
            'Hook output disposed',
          );
          expect(() => result.stdout.readText()).toThrow(
            'Hook output disposed',
          );
          expect(result.dispose()).toBeUndefined();
        } finally {
          result.dispose();
        }
      });
    }
  });
}

function registerDiagnosticTests(): void {
  describe('DiagnosticTests', () => {
    for (const [script, field, diagnostic] of [
      [
        "process.stderr.write('blocked 雪'); process.exitCode = 2",
        'reason',
        'blocked 雪',
      ],
      [
        "process.stdout.write('plain diagnostic 雪')",
        'systemMessage',
        'plain diagnostic 雪',
      ],
    ]) {
      it(`retains ${field} diagnostics until the failed or fallback result is disposed`, async () => {
        const result = await runner.executeHookWithRequestRows(
          command(
            `process.stdin.resume(); process.stdin.on('end', () => { ${script}; });`,
          ),
          HookEventName.BeforeModel,
          input(root),
        );
        try {
          expect(result.output?.readValue([field])).toBe(diagnostic);
          expect(fs.existsSync(dirname(result.stderr.path))).toBe(true);
          result.dispose();
          expect(scratch(root)).toStrictEqual([]);
        } finally {
          result.dispose();
        }
      });
    }
  });
}

function registerChildFailureTests(): void {
  describe('ChildFailureTests', () => {
    for (const mode of ['timeout', 'cancel', 'input-error']) {
      it(`removes real child scratch after ${mode} and preserves live diagnostics`, async () => {
        const controller = new AbortController();
        const source = input(root);
        const marker = join(root, 'ready');
        const failure = new Error('input reader failed');
        const contents =
          mode === 'input-error'
            ? {
                count: 1,
                async *openReader(): AsyncGenerator<unknown, void, unknown> {
                  await waitForFile(marker);
                  yield { speaker: 'human', blocks: [] };
                  throw failure;
                },
              }
            : source.llm_request.contents;
        const hook = command(`
        process.stderr.write('unfinished diagnostic 雪', () => {
          require('node:fs').writeFileSync('ready', String(process.pid));
        });
        process.stdin.resume(); setInterval(() => {}, 1000);
      `);
        const pending = runner.executeHookWithRequestRows(
          { ...hook, timeout: mode === 'timeout' ? 200 : 5000 },
          HookEventName.BeforeModel,
          { ...source, llm_request: { ...source.llm_request, contents } },
          controller.signal,
        );
        if (mode === 'cancel') {
          await waitForFile(marker);
          controller.abort(new Error('cancel lifecycle'));
        }
        const result = await pending;
        try {
          expect(result.success).toBe(false);
          expect(result.error?.message).toMatch(
            /timed out|cancel lifecycle|input reader failed/,
          );
          expect(result.stderr.readText()).toBe('unfinished diagnostic 雪');
          const pid = Number(fs.readFileSync(marker, 'utf8'));
          expect(() => process.kill(pid, 0)).toThrow('ESRCH');
          expect(fs.existsSync(dirname(result.stdout.path))).toBe(true);
          result.dispose();
          expect(scratch(root)).toStrictEqual([]);
          expect(() => result.stderr.readText()).toThrow(
            'Hook output disposed',
          );
        } finally {
          result.dispose();
        }
      });
    }
  });
}

function registerValidationTests(): void {
  describe('ValidationTests', () => {
    for (const mode of ['pre-aborted', 'missing-command']) {
      it(`removes validation failure scratch on disposal for ${mode}`, async () => {
        const controller = new AbortController();
        if (mode === 'pre-aborted')
          controller.abort(new Error('pre-aborted lifecycle'));
        const result = await runner.executeHookWithRequestRows(
          {
            type: HookType.Command,
            command: mode === 'missing-command' ? '' : 'exit 0',
          },
          HookEventName.BeforeModel,
          input(root),
          controller.signal,
        );
        try {
          expect(result.success).toBe(false);
          expect(result.error?.message).toMatch(
            /pre-aborted lifecycle|missing command/,
          );
          result.dispose();
          expect(scratch(root)).toStrictEqual([]);
        } finally {
          result.dispose();
        }
      });
    }
  });
}

function registerConstructionTests(): void {
  describe('ConstructionTests', () => {
    for (const name of ['stdout', 'stderr']) {
      it(`removes partially constructed scratch when opening ${name} fails`, () => {
        const open = fs.openSync;
        const injected = new Error(`cannot open ${name}`);
        const intercepted = spyOn(fs, 'openSync').mockImplementation(
          (path, flags, mode) => {
            if (String(path).endsWith(`/${name}`)) throw injected;
            return open(path, flags, mode);
          },
        );
        try {
          expect(() => new HookOutputOwner(root)).toThrow(injected.message);
          expect(scratch(root)).toStrictEqual([]);
        } finally {
          intercepted.mockRestore();
        }
      });
    }
  });
}

function registerDiskErrorTests(): void {
  describe('DiskErrorTests', () => {
    it('removes scratch when parsing a real child output cannot open its document', async () => {
      const open = fs.openSync;
      const intercepted = spyOn(fs, 'openSync').mockImplementation(
        (path, flags, mode) => {
          if (String(path).endsWith('/document.utf16'))
            throw new Error('document open failed');
          return open(path, flags, mode);
        },
      );
      try {
        await expect(
          runner.executeHookWithRequestRows(
            command(responseScript.replace('ENCODE', 'JSON.stringify(output)')),
            HookEventName.BeforeModel,
            input(root),
          ),
        ).rejects.toThrow('document open failed');
        expect(scratch(root)).toStrictEqual([]);
      } finally {
        intercepted.mockRestore();
      }
    });

    it('removes all scratch and closes remaining descriptors when a close reports an error', () => {
      const owner = new HookOutputOwner(root);
      owner.stdout.append(
        Buffer.from(
          JSON.stringify({
            hookSpecificOutput: { llm_request: { contents: [1, 2] } },
          }),
        ),
      );
      const output = owner.output(0);
      const descriptor = owner.stdout.descriptor();
      const close = fs.closeSync;
      const intercepted = spyOn(fs, 'closeSync').mockImplementation((fd) => {
        close(fd);
        if (fd === descriptor) throw new Error('stdout close failed');
      });
      try {
        expect(() => owner.dispose()).toThrow('stdout close failed');
        expect(scratch(root)).toStrictEqual([]);
        expect(() => output?.replacement?.openReader()).toThrow(
          'Hook output disposed',
        );
        expect(() => owner.stderr.descriptor()).toThrow('Hook output disposed');
      } finally {
        intercepted.mockRestore();
        owner.dispose();
      }
    });
  });
}

function registerSpawnTests(): void {
  describe('SpawnTests', () => {
    it('transfers an OS spawn failure result to the caller for disposal', async () => {
      const owner = new HookOutputOwner(root);
      const result = await runHookSnapshot(
        {
          hookConfig: command('unused'),
          eventName: HookEventName.BeforeModel,
          input: input(root),
          startTime: Date.now(),
          timeout: 5000,
          spawn: () =>
            spawn(join(root, 'missing-executable'), [], {
              cwd: root,
              stdio: 'pipe',
            }),
          killTimeout: () => ({ clear: () => undefined }),
        },
        owner,
      );
      try {
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('ENOENT');
        result.dispose();
        expect(scratch(root)).toStrictEqual([]);
      } finally {
        result.dispose();
      }
    });
    it('transfers a synchronous spawn failure result to the caller for disposal', async () => {
      const owner = new HookOutputOwner(root);
      const failure = new Error('spawn setup failed');
      const result = await runHookSnapshot(
        {
          hookConfig: command('unused'),
          eventName: HookEventName.BeforeModel,
          input: input(root),
          startTime: Date.now(),
          timeout: 5000,
          spawn: () => {
            throw failure;
          },
          killTimeout: () => ({ clear: () => undefined }),
        },
        owner,
      );
      try {
        expect(result.error).toBe(failure);
        expect(result.stdout.readText()).toBe('');
        result.dispose();
        expect(scratch(root)).toStrictEqual([]);
      } finally {
        result.dispose();
      }
    });
  });
}

function registerSetupTest(): void {
  describe('SetupTest', () => {
    it('stops a real child and removes scratch when process setup throws', async () => {
      const owner = new HookOutputOwner(root);
      let pid: number | undefined;
      const pending = runHookSnapshot(
        {
          hookConfig: command('unused'),
          eventName: HookEventName.BeforeModel,
          input: input(root),
          startTime: Date.now(),
          timeout: 5000,
          spawn: () => {
            const child = spawn(
              'node',
              ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
              {
                cwd: root,
                detached: true,
                stdio: 'pipe',
              },
            );
            pid = child.pid;
            return child;
          },
          killTimeout: () => {
            throw new Error('timeout setup failed');
          },
        },
        owner,
      );
      try {
        await expect(pending).rejects.toThrow('timeout setup failed');
        expect(fs.existsSync(owner.directory)).toBe(false);
        const childPid = pid;
        if (childPid === undefined) throw new Error('Real child has no pid');
        expect(() => process.kill(childPid, 0)).toThrow('ESRCH');
      } finally {
        stopChild(pid);
        owner.dispose();
      }
    });
  });
}

function stopChild(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ESRCH'))
      throw error;
  }
}

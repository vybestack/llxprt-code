/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { posix, resolve } from 'node:path';
import {
  asString,
  compositeActionSteps,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';
import type { WorkflowStep } from './typed-test-helpers.ts';

export const root = resolve(import.meta.dirname, '../..');
export const requiredText = readFileSync(
  resolve(root, '.github/workflows/e2e.yml'),
  'utf8',
);
export const required = parseWorkflowYaml(requiredText);
const SETUP_ACTION_PATH = './.github/actions/setup-local-gemma';
export const setupActionText = readFileSync(
  resolve(root, '.github/actions/setup-local-gemma/action.yml'),
  'utf8',
);
export const setupActionSteps = compositeActionSteps(setupActionText);

export type BackendVerifierResult = {
  stdout: string;
  stderr: string;
  status: number;
};

let fixtureCounter = 0;

/** Returns a process-unique number for naming per-test fixture directories. */
export function nextFixtureId(): number {
  return fixtureCounter++;
}

export function writeExecutable(bin: string, name: string, body: string): void {
  const path = resolve(bin, name);
  writeFileSync(
    path,
    `#!/bin/bash
${body}
`,
  );
  Bun.spawnSync(['chmod', '+x', path]);
}

export function runBackendVerifier(
  maps: string,
  livePid = true,
  options: {
    cmdline?: string;
    vendor?: string;
    mapsFifo?: boolean;
    mapsDisappearAfterPgrep?: boolean;
  } = {},
): BackendVerifierResult {
  const fixture = resolve(root, `tmp/verify3764/behavior-${nextFixtureId()}`);
  rmSync(fixture, { recursive: true, force: true });
  const runnerTemp = resolve(fixture, 'runner-temp');
  const procRoot = resolve(fixture, 'proc');
  const bin = resolve(fixture, 'bin');
  const processDir = resolve(procRoot, '4242');
  const parentDir = resolve(procRoot, '4200');
  const ollamaDir = resolve(runnerTemp, 'ollama/lib/ollama');
  mkdirSync(bin, { recursive: true });
  mkdirSync(processDir, { recursive: true });
  mkdirSync(parentDir, { recursive: true });
  mkdirSync(ollamaDir, { recursive: true });
  const shellDirectory = spawnSync('bash', ['-c', 'pwd -P'], {
    cwd: fixture,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (shellDirectory.error) throw shellDirectory.error;
  if (shellDirectory.status !== 0) {
    throw new Error(shellDirectory.stderr);
  }
  const shellRoot = shellDirectory.stdout.trim();
  const shellRunnerTemp = posix.join(shellRoot, 'runner-temp');
  const shellProcRoot = posix.join(shellRoot, 'proc');
  const shellBin = posix.join(shellRoot, 'bin');
  writeFileSync(
    resolve(procRoot, 'cpuinfo'),
    `vendor_id : ${options.vendor ?? 'GenuineIntel'}\n`,
  );
  writeFileSync(
    resolve(processDir, 'cmdline'),
    options.cmdline ??
      `${posix.join(shellRunnerTemp, 'ollama/lib/ollama/llama-server')}\0--model\0gemma\0`,
  );
  writeFileSync(
    resolve(processDir, 'status'),
    'Name:\tllama-server\nPPid:\t4200\n',
  );
  writeFileSync(resolve(parentDir, 'cmdline'), 'ollama\0serve\0');
  const shellMapsPath = posix.join(shellProcRoot, '4242/maps');
  if (options.mapsFifo) {
    // The verifier runs under bash, so the FIFO is created, inspected and
    // removed by the same bash. On Windows, Git Bash FIFOs are not visible to
    // native stat or unlink.
    const fifo = spawnSync('mkfifo', [shellMapsPath], { encoding: 'utf8' });
    if (fifo.error) throw fifo.error;
    if (fifo.status !== 0) throw new Error(fifo.stderr);
    const zeroSizeFifo = spawnSync(
      'bash',
      ['-c', 'test -p "$1" && ! test -s "$1"', '--', shellMapsPath],
      { encoding: 'utf8' },
    );
    if (zeroSizeFifo.error) throw zeroSizeFifo.error;
    if (zeroSizeFifo.status !== 0) {
      throw new Error('FIFO maps fixture must be a FIFO with zero stat size');
    }
    const writer = Bun.spawn([
      'bash',
      '-c',
      'printf %s "$1" > "$2"',
      '--',
      maps.replaceAll('/runner-temp', shellRunnerTemp),
      shellMapsPath,
    ]);
    writer.unref();
  } else {
    writeFileSync(
      resolve(processDir, 'maps'),
      maps.replaceAll('/runner-temp', shellRunnerTemp),
    );
  }
  writeFileSync(
    resolve(runnerTemp, 'ollama-server.log'),
    'cmn  common_param: system_info: n_threads = 2 (n_threads_batch = 2) / 4 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1 | LLAMAFILE = 1 | REPACK = 1 | \n',
  );
  writeFileSync(resolve(ollamaDir, 'llama-server'), 'fixture process');
  writeExecutable(
    bin,
    'curl',
    `printf '%s\\n' '{"done":true,"error":null,"response":"Hello"}'`,
  );
  writeExecutable(bin, 'jq', 'cat >/dev/null; exit 0');
  let pgrepBody = 'exit 1';
  if (options.mapsDisappearAfterPgrep) {
    pgrepBody = `rm -rf -- "$LLXPRT_PROC_ROOT/4242"; printf '%s\\n' 4242`;
  } else if (livePid) {
    pgrepBody = `printf '%s\\n' 4242`;
  }
  writeExecutable(bin, 'pgrep', pgrepBody);
  const script = asString(step('Verify CPU backend warm-up').run);
  const result = spawnSync(
    'bash',
    ['-c', `export PATH="$LLXPRT_FIXTURE_BIN:$PATH"\n${script}`],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LLXPRT_FIXTURE_BIN: shellBin,
        RUNNER_TEMP: shellRunnerTemp,
        LLXPRT_PROC_ROOT: shellProcRoot,
        OLLAMA_HOST: '127.0.0.1:12644',
      },
    },
  );
  if (options.mapsFifo) {
    const removed = spawnSync('rm', ['-f', shellMapsPath], {
      encoding: 'utf8',
    });
    if (removed.error) throw removed.error;
  }
  rmSync(fixture, { recursive: true, force: true });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

export function runLiveLinuxProcVerifier(): BackendVerifierResult {
  const fixture = resolve(root, `tmp/verify3764/live-proc-${nextFixtureId()}`);
  const runnerTemp = resolve(fixture, 'runner-temp');
  const bin = resolve(fixture, 'bin');
  const ollamaDir = resolve(runnerTemp, 'ollama/lib/ollama');
  mkdirSync(bin, { recursive: true });
  mkdirSync(ollamaDir, { recursive: true });
  const library = resolve(ollamaDir, 'libggml-cpu-haswell.so');
  const executable = resolve(ollamaDir, 'llama-server');
  const compiledLibrary = spawnSync(
    'cc',
    ['-shared', '-fPIC', '-x', 'c', '-o', library, '-'],
    { input: 'int haswell_fixture(void) { return 1; }', encoding: 'utf8' },
  );
  if (compiledLibrary.status !== 0) {
    throw new Error(`${compiledLibrary.stdout}\n${compiledLibrary.stderr}`);
  }
  const compiledServer = spawnSync(
    'cc',
    ['-x', 'c', '-o', executable, '-', '-ldl'],
    {
      input:
        '#include <dlfcn.h>\n#include <unistd.h>\nint main(int argc, char **argv) { if (argc < 4 || !dlopen(argv[3], RTLD_NOW)) return 2; for (;;) pause(); }',
      encoding: 'utf8',
    },
  );
  if (compiledServer.status !== 0) {
    throw new Error(`${compiledServer.stdout}\n${compiledServer.stderr}`);
  }
  writeExecutable(bin, 'curl', `printf '%s\\n' '{"done":true,"error":null}'`);
  writeExecutable(bin, 'jq', 'cat >/dev/null; exit 0');
  writeFileSync(
    resolve(runnerTemp, 'ollama-server.log'),
    'system_info: CPU : AVX2 = 1\n',
  );
  const server = Bun.spawn([executable, '--model', 'gemma', library], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    const mapsPath = `/proc/${server.pid}/maps`;
    let maps = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        maps = readFileSync(mapsPath, 'utf8');
      } catch {
        maps = '';
      }
      if (maps.includes(library)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    if (!maps.includes(library))
      throw new Error('live helper did not map the haswell fixture library');
    if (statSync(mapsPath).size !== 0)
      throw new Error('Linux proc maps fixture must report zero stat size');
    const script = asString(step('Verify CPU backend warm-up').run).replace(
      '"$proc_root/cpuinfo"',
      `'${resolve(fixture, 'cpuinfo')}'`,
    );
    writeFileSync(resolve(fixture, 'cpuinfo'), 'vendor_id : GenuineIntel\n');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: runnerTemp,
        OLLAMA_HOST: '127.0.0.1:12644',
      },
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status ?? 1,
    };
  } finally {
    server.kill();
    rmSync(fixture, { recursive: true, force: true });
  }
}

export const linuxJobSteps = workflowJob(required, 'e2e_linux').steps ?? [];
export const setupStep = linuxJobSteps.find(
  (candidate) => candidate.uses === SETUP_ACTION_PATH,
);

// The Ollama runtime, model and provider environment live in the shared
// composite action. Its steps are expanded in place so ordering assertions
// compare them against the workflow's own steps in execution order.
export const steps: WorkflowStep[] = linuxJobSteps.flatMap((candidate) =>
  candidate === setupStep ? setupActionSteps : [candidate],
);

export function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing local model E2E step: ${name}`);
  return found;
}

export function actionStep(name: string): WorkflowStep {
  const found = setupActionSteps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing setup-local-gemma step: ${name}`);
  return found;
}

export function exportedTestEnvironment(): Record<string, string> {
  const script = asString(
    actionStep('Export local model test environment').run,
  );
  const exported: Record<string, string> = {};
  for (const match of script.matchAll(/echo '([A-Z0-9_]+)=([^']*)'/g)) {
    exported[match[1]] = match[2];
  }
  return exported;
}

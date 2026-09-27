/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  asOptionalRecord,
  asRecord,
  asString,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';

const root = resolve(import.meta.dirname, '../..');
const requiredText = readFileSync(
  resolve(root, '.github/workflows/e2e.yml'),
  'utf8',
);
const required = parseWorkflowYaml(requiredText);
const pilot = required;

type BackendVerifierResult = {
  stdout: string;
  stderr: string;
  status: number;
};

let fixtureCounter = 0;

function writeExecutable(bin: string, name: string, body: string): void {
  const path = resolve(bin, name);
  writeFileSync(
    path,
    `#!/bin/bash
${body}
`,
  );
  Bun.spawnSync(['chmod', '+x', path]);
}

function runBackendVerifier(
  maps: string,
  livePid = true,
  options: {
    cmdline?: string;
    mapsFifo?: boolean;
    mapsDisappearAfterPgrep?: boolean;
  } = {},
): BackendVerifierResult {
  const fixture = resolve(root, `tmp/verify3764/behavior-${fixtureCounter++}`);
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
  writeFileSync(resolve(procRoot, 'cpuinfo'), 'vendor_id : GenuineIntel\n');
  writeFileSync(
    resolve(processDir, 'cmdline'),
    options.cmdline ??
      `${resolve(ollamaDir, 'llama-server')}\0--model\0gemma\0`,
  );
  writeFileSync(
    resolve(processDir, 'status'),
    'Name:\tllama-server\nPPid:\t4200\n',
  );
  writeFileSync(resolve(parentDir, 'cmdline'), 'ollama\0serve\0');
  const mapsPath = resolve(processDir, 'maps');
  if (options.mapsFifo) {
    const fifo = spawnSync('mkfifo', [mapsPath]);
    if (fifo.status !== 0) throw new Error(fifo.stderr);
    if (statSync(mapsPath).size !== 0) {
      throw new Error('FIFO maps fixture must report zero stat size');
    }
    const writer = Bun.spawn([
      'bash',
      '-c',
      'printf %s "$1" > "$2"',
      '--',
      maps.replaceAll('/runner-temp', runnerTemp),
      mapsPath,
    ]);
    writer.unref();
  } else {
    writeFileSync(mapsPath, maps.replaceAll('/runner-temp', runnerTemp));
  }
  writeFileSync(
    resolve(runnerTemp, 'ollama-server.log'),
    'cmn  common_param: system_info: n_threads = 2 (n_threads_batch = 2) / 4 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1 | LLAMAFILE = 1 | REPACK = 1 | \n',
  );
  writeFileSync(resolve(ollamaDir, 'llama-server'), 'fixture process');
  writeExecutable(bin, 'curl', `printf '%s\\n' '{"done":true,"error":null}'`);
  writeExecutable(bin, 'jq', 'cat >/dev/null; exit 0');
  let pgrepBody = 'exit 1';
  if (options.mapsDisappearAfterPgrep) {
    pgrepBody = `rm -rf '${processDir}'; printf '%s\\n' 4242`;
  } else if (livePid) {
    pgrepBody = `printf '%s\\n' 4242`;
  }
  writeExecutable(bin, 'pgrep', pgrepBody);
  const script = asString(step('Verify Intel CPU backend warm-up').run);
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: runnerTemp,
      LLXPRT_PROC_ROOT: procRoot,
      OLLAMA_HOST: '127.0.0.1:12644',
    },
  });
  rmSync(fixture, { recursive: true, force: true });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

function runLiveLinuxProcVerifier(): BackendVerifierResult {
  const fixture = resolve(root, `tmp/verify3764/live-proc-${fixtureCounter++}`);
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
    const script = asString(
      step('Verify Intel CPU backend warm-up').run,
    ).replace('"$proc_root/cpuinfo"', `'${resolve(fixture, 'cpuinfo')}'`);
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

const steps = workflowJob(pilot, 'local_model_canaries').steps ?? [];

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing pilot step: ${name}`);
  return found;
}

describe('optional local-model E2E pilot', () => {
  it('dispatches the default-branch workflow against a selected ref with explicit opt-in', () => {
    const dispatch = asRecord(required.on?.workflow_dispatch);
    const inputs = asRecord(dispatch.inputs);
    expect(asRecord(inputs.branch_ref)).toEqual({
      description: 'Branch to run on',
      required: true,
      default: 'main',
      type: 'string',
    });
    expect(asRecord(inputs.pilot_local_model)).toMatchObject({
      required: false,
      default: false,
      type: 'boolean',
    });
    expect(asString(workflowJob(pilot, 'local_model_canaries').if)).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.pilot_local_model == true",
    );
    expect(asString(workflowJob(required, 'e2e_linux').if)).toContain(
      "!(github.event_name == 'workflow_dispatch' && inputs.pilot_local_model == true)",
    );
  });

  it('leaves required provider E2E events, check names, quota selection and budget unchanged', () => {
    expect(required.on).toHaveProperty('pull_request');
    expect(required.on).toHaveProperty('push');
    expect(required.on).toHaveProperty('merge_group');
    expect(required.on).toHaveProperty('pull_request_target');
    expect(workflowJob(required, 'e2e_linux').name).toBe(
      'E2E Test (Linux) - ${{ matrix.sandbox }}',
    );
    expect(requiredText).not.toContain('Block unqualified local-model gating');
    const requiredSteps = workflowJob(required, 'e2e_linux').steps ?? [];
    expect(requiredSteps.map((candidate) => candidate.name)).toContain(
      'Check API quota and select optimal key',
    );
    expect(requiredSteps.map((candidate) => candidate.name)).toContain(
      'Check E2E real-model budget (issue #2278)',
    );
  });

  it('only runs on explicit dispatch and uses distinct non-required check names', () => {
    expect(Object.keys(pilot.jobs ?? {})).toEqual([
      'skip_check',
      'mergeability-gate',
      'e2e_doc_change_filter',
      'e2e_linux',
      'local_model_canaries',
    ]);
    const job = workflowJob(pilot, 'local_model_canaries');
    expect(job.name).toContain('Local Gemma 4 E2B pilot');
    expect(job.name).not.toContain('E2E Test (Linux)');
    expect(asString(job.if ?? '')).toContain(
      'inputs.pilot_local_model == true',
    );
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBe(90);
    expect(job['runs-on']).toBe('ubuntu-24.04-arm');
    expect(asRecord(job.strategy).matrix).toEqual({
      sandbox: ['sandbox:none', 'sandbox:docker'],
      include: [
        { sandbox: 'sandbox:none', artifact_id: 'none' },
        { sandbox: 'sandbox:docker', artifact_id: 'docker' },
      ],
    });
  });

  it('gives every sandbox a distinct artifact name without forbidden characters', () => {
    const matrix = asRecord(
      asRecord(workflowJob(pilot, 'local_model_canaries').strategy).matrix,
    );
    const sandboxes = matrix.sandbox;
    expect(sandboxes).toEqual(['sandbox:none', 'sandbox:docker']);
    const entries = matrix.include;
    expect(Array.isArray(entries)).toBe(true);
    if (!Array.isArray(entries))
      throw new Error('Pilot matrix include is required');
    const name = asString(
      asOptionalRecord(step('Upload local model diagnostics').with)?.name,
    );
    expect(name).toBe('local-gemma4-pilot-${{ matrix.artifact_id }}');
    const resolvedNames = entries.map((entry) => {
      const row = asRecord(entry);
      expect(sandboxes).toContain(row.sandbox);
      const id = asString(row.artifact_id);
      expect(id).toMatch(/^[a-z0-9-]+$/);
      return name.replace('${{ matrix.artifact_id }}', id);
    });
    expect(new Set(resolvedNames).size).toBe(sandboxes.length);
    expect(
      resolvedNames.every((resolved) => !/[\\/:*?"<>|\r\n]/.test(resolved)),
    ).toBe(true);
  });

  it('downloads a pinned Ollama runtime and verifies its archive before extraction', () => {
    const install = asString(step('Install Ollama CPU runtime').run);
    expect(install).toContain('uname -m');
    expect(install).toContain('aarch64');
    expect(install).toContain('ollama-linux-arm64.tar.zst?version=0.31.1');
    expect(install).toContain(
      `printf '%s  %s\\n' '47c82a67e59e060a735d1cb50a2acf020126a3a4be3f6847d5b58b7dd59620b6' "$RUNNER_TEMP/ollama-linux-arm64.tar.zst" | sha256sum --check -`,
    );
    expect(install.indexOf('sha256sum --check')).toBeLessThan(
      install.indexOf('tar --zstd'),
    );
    expect(install).toContain("--exclude='lib/ollama/cuda_v12/*'");
    expect(install).toContain("--exclude='lib/ollama/cuda_v13/*'");
    expect(install).toContain("--exclude='lib/ollama/vulkan/*'");
    expect(install).toContain('rm "$RUNNER_TEMP/ollama-linux-arm64.tar.zst"');
  });

  it('restricts the CPU-backend A/B to the Intel Docker pilot and structurally checks live backend verification', () => {
    const select = step('Select pilot CPU backend on Intel');
    expect(select.if).toBeUndefined();
    const script = asString(select.run);
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('grep -qm1');
    expect(script).toContain('GenuineIntel');
    expect(script).toContain('libggml-cpu-haswell.so');
    expect(script).toContain('libggml-cpu-*.so');
    expect(script).not.toContain('OLLAMA_LLM_LIBRARY');
    expect(steps.indexOf(select)).toBeGreaterThan(
      steps.indexOf(step('Install Ollama CPU runtime')),
    );
    expect(steps.indexOf(select)).toBeLessThan(
      steps.indexOf(step('Start local Gemma 4 E2B model')),
    );
    const verify = step('Verify Intel CPU backend warm-up');
    expect(verify.if).toBeUndefined();
    expect(asString(verify.run)).toContain(
      'http://127.0.0.1:12644/api/generate',
    );
    expect(asString(verify.run)).toContain('ollama-server.log');
    expect(asString(verify.run)).toContain('LLXPRT_PROC_ROOT:-/proc');
    expect(asString(verify.run)).toContain('libggml-cpu-haswell.so');
    expect(verify.if).toBeUndefined();
    expect(asString(verify.run)).toContain('pgrep -f');
    expect(asString(verify.run)).toContain('/cmdline');
    expect(asString(verify.run)).toContain('/status');
    expect(asString(verify.run)).toContain('parent cmdline');
    expect(asString(verify.run)).not.toContain('-s "$maps');
    expect(steps.indexOf(verify)).toBeGreaterThan(
      steps.indexOf(step('Start local Gemma 4 E2B model')),
    );
    expect(steps.indexOf(verify)).toBeLessThan(
      steps.indexOf(step('Run local-model canaries')),
    );
  });

  it('checks model version and digest before running either canary', () => {
    const server = step('Start local Gemma 4 E2B model');
    const start = asString(server.run);
    const env = asOptionalRecord(server.env);
    expect(env?.OLLAMA_CONTEXT_LENGTH).toBe('32768');
    expect(env?.OLLAMA_NUM_PARALLEL).toBe('1');
    expect(env?.OLLAMA_HOST).toBe('127.0.0.1:12644');
    expect(start).toContain('jq -e \'.version == "0.31.1"\'');
    expect(start).toContain('ollama pull gemma4:e2b-it-qat');
    expect(start).toContain(
      '07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c',
    );
    const inference = step('Verify CPU-only model inference');
    const inferenceScript = asString(inference.run);
    expect(inferenceScript).toContain('/api/ps');
    expect(inferenceScript).toContain('.size_vram == 0');
    expect(inferenceScript).toContain('/api/generate');
    expect(inferenceScript.indexOf('/api/generate')).toBeLessThan(
      inferenceScript.indexOf('/api/ps'),
    );
    expect(asString(inference.run)).toContain(
      '.done == true and .error == null',
    );
    expect(inference.env?.OLLAMA_HOST).toBe('127.0.0.1:12644');
    expect(steps.indexOf(server)).toBeLessThan(steps.indexOf(inference));
    expect(steps.indexOf(inference)).toBeLessThan(
      steps.indexOf(step('Run local-model canaries')),
    );
  });

  it('matches the required Linux E2E test invocations in both sandbox legs without provider secrets', () => {
    const job = workflowJob(pilot, 'local_model_canaries');
    const run = step('Run local-model canaries');
    const command = asString(run.run);
    const requiredRun = asString(
      (workflowJob(required, 'e2e_linux').steps ?? []).find(
        (candidate) => candidate.name === 'Run E2E tests',
      )?.run,
    );
    const normalize = (script: string): string =>
      script.replace(/\\\s*/g, ' ').replace(/\s+/g, ' ');
    const fullArgs =
      '--exclude="**/todo-continuation.e2e.test.ts" --exclude="**/run_shell_command.test.ts"';
    const shellArgs =
      'integration-tests/run_shell_command.test.ts --testNamePattern="should be able to run a shell command|should be able to run a shell command via stdin|should run a platform-specific file listing command"';
    const normalizedRequired = normalize(requiredRun);
    const normalizedCommand = normalize(command);
    for (const sandbox of ['sandbox:none', 'sandbox:docker']) {
      const fullInvocation = `npm run test:integration:${sandbox} -- ${fullArgs}`;
      const firstInvocationPattern = new RegExp(
        `npm run test:integration:${sandbox} -- (.*?) npm run test:integration:${sandbox} --`,
      );
      const requiredFirstInvocation = normalizedRequired.match(
        firstInvocationPattern,
      );
      const pilotFirstInvocation = normalizedCommand.match(
        firstInvocationPattern,
      );
      expect(requiredFirstInvocation?.[1]).toBe(fullArgs);
      expect(pilotFirstInvocation?.[1]).toBe(fullArgs);
      expect(normalizedRequired).toContain(fullInvocation);
      expect(normalizedCommand).toContain(fullInvocation);
      const shellInvocation = `npm run test:integration:${sandbox} -- --exclude="**/todo-continuation.e2e.test.ts" ${shellArgs}`;
      expect(normalizedRequired).toContain(shellInvocation);
      expect(normalizedCommand).toContain(shellInvocation);
    }
    expect(command.match(/--exclude=/g)).toHaveLength(6);
    const env = asOptionalRecord(run.env);
    expect(env?.OPENAI_BASE_URL).toBe('http://127.0.0.1:12644/v1');
    expect(env?.LLXPRT_DEFAULT_PROVIDER).toBe('openai');
    expect(env?.LLXPRT_DEFAULT_MODEL).toBe('gemma4:e2b-it-qat');
    expect(env?.OPENAI_API_KEY).toBe('ollama-local-only');
    expect(env?.LLXPRT_TEST_PROFILE).toBe('local-gemma4-pilot');
    expect(env?.LLXPRT_CONTEXT_LIMIT).toBe('32768');
    expect(env?.LLXPRT_MAX_OUTPUT_TOKENS).toBe('8192');
    expect(env?.LLXPRT_LOCAL_MODEL_PILOT).toBe('true');
    expect(Number(env?.LLXPRT_CONTEXT_LIMIT)).toBe(
      Number(step('Start local Gemma 4 E2B model').env?.OLLAMA_CONTEXT_LENGTH),
    );
    expect(Number(env?.LLXPRT_MAX_OUTPUT_TOKENS)).toBeLessThan(
      Number(env?.LLXPRT_CONTEXT_LIMIT),
    );
    expect(env?.GIT_CEILING_DIRECTORIES).toBe(
      '${{ github.workspace }}/.integration-tests',
    );
    expect(asString(run.run).startsWith('set -euo pipefail')).toBe(true);
    expect(asString(run.run)).toContain(
      'integration-tests/run_shell_command.test.ts',
    );
    expect(JSON.stringify(job)).not.toMatch(/\bsecrets(?:\.|\[)/);
    const budget = step('Check E2E real-model budget (issue #2278)');
    expect(budget.if).toBe('success()');
    expect(asString(budget.run).trim()).toBe(
      'bun scripts/check-e2e-model-budget.ts --ledger "$LLXPRT_E2E_MODEL_LEDGER"',
    );
    expect(asOptionalRecord(budget.env)?.LLXPRT_E2E_MODEL_LEDGER).toBe(
      '${{ runner.temp }}/e2e-model-ledger.jsonl',
    );
  });

  it('uses host networking only for the Docker leg, and retains diagnostics on failure', () => {
    const env = asOptionalRecord(step('Run local-model canaries').env);
    expect(env?.SANDBOX_FLAGS).toBe(
      "${{ matrix.sandbox == 'sandbox:docker' && '--network host' || '' }}",
    );
    expect(env?.KEEP_OUTPUT).toBe('true');
    expect(env?.LLXPRT_E2E_MODEL_LEDGER).toBe(
      '${{ runner.temp }}/e2e-model-ledger.jsonl',
    );
    const report = step('Report local model resources');
    const upload = step('Upload local model diagnostics');
    expect(report.if).toBe('always()');
    expect(asString(report.run)).toContain('/api/ps');
    expect(asString(report.run)).toContain('free -h');
    expect(asString(report.run)).toContain('df -h');
    expect(upload.if).toBe('always()');
    const paths = asString(asOptionalRecord(upload.with)?.path).split('\n');
    expect(paths).toContain('${{ runner.temp }}/ollama-server.log');
    expect(paths).toContain('${{ runner.temp }}/e2e-model-ledger.jsonl');
    expect(paths).toContain(
      '${{ github.workspace }}/.integration-tests/*/*/telemetry.log',
    );
    expect(paths).toContain(
      '${{ github.workspace }}/.integration-tests/*/*/harness-diagnostics.log',
    );
    expect(asOptionalRecord(upload.with)?.['if-no-files-found']).toBe('error');
    expect(asOptionalRecord(upload.with)?.['include-hidden-files']).toBe(true);
  });
});

describe('workflow CPU variant selection behavior', () => {
  const runSelection = (intel: boolean, variants: string[]): string[] => {
    const fixture = resolve(
      root,
      `tmp/verify3764/selection-${fixtureCounter++}`,
    );
    const temp = resolve(fixture, 'temp');
    const libdir = resolve(temp, 'ollama/lib/ollama');
    mkdirSync(libdir, { recursive: true });
    mkdirSync(temp, { recursive: true });
    for (const variant of variants)
      writeFileSync(resolve(libdir, variant), 'variant');
    const cpuinfo = resolve(fixture, 'cpuinfo');
    writeFileSync(
      cpuinfo,
      intel ? 'vendor_id : GenuineIntel\n' : 'vendor_id : AuthenticAMD\n',
    );
    const script = asString(
      step('Select pilot CPU backend on Intel').run,
    ).replace('/proc/cpuinfo', cpuinfo);
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: temp },
    });
    if (result.status !== 0)
      throw new Error(`${result.stdout}\n${result.stderr}`);
    const selected = Bun.spawnSync([
      'find',
      libdir,
      '-maxdepth',
      '1',
      '-type',
      'f',
      '-name',
      'libggml-cpu-*.so',
    ]);
    const files = selected.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((path) => path.slice(libdir.length + 1))
      .sort();
    rmSync(fixture, { recursive: true, force: true });
    return files;
  };

  it('forces haswell in each Intel matrix leg and leaves AMD variants unchanged', () => {
    const variants = [
      'libggml-cpu-haswell.so',
      'libggml-cpu-avx512.so',
      'libggml-cpu-amx.so',
    ];
    for (const _matrixLeg of ['sandbox:none', 'sandbox:docker']) {
      expect(runSelection(true, variants)).toEqual(['libggml-cpu-haswell.so']);
    }
    expect(runSelection(false, variants)).toEqual(variants.sort());
  });
});

describe('workflow backend verification behavior', () => {
  const haswell = '/runner-temp/ollama/lib/ollama/libggml-cpu-haswell.so';
  const mapping = (path: string): string =>
    `7f000000-7f100000 r-xp 00000000 08:01 42 ${path}\n`;

  it.skipIf(process.platform !== 'linux')(
    'accepts the sole haswell mapping from a live stat-zero Linux proc maps file',
    () => {
      const result = runLiveLinuxProcVerifier();
      expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('Loaded CPU backends:');
      expect(result.stdout).toContain('llama-server cmdline:');
      expect(result.stdout).toContain('llama-server PPid:');
    },
    15_000,
  );

  it('accepts the exact sole haswell mapping when the incident log omits AVX512 and AMX fields', () => {
    const result = runBackendVerifier(mapping(haswell));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Loaded CPU backends:');
    expect(result.stdout).toContain('llama-server cmdline:');
    expect(result.stdout).toContain(
      'llama-server PPid: 4200; parent cmdline: ollama serve',
    );
  });

  it('fails when the live process is absent even though the log reports AVX2', () => {
    const result = runBackendVerifier(mapping(haswell), false);
    expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain('Live llama-server process not found');
  });

  it('fails explicitly when the PID vanishes after pgrep returns it', () => {
    const result = runBackendVerifier(mapping(haswell), true, {
      mapsDisappearAfterPgrep: true,
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain('Live llama-server maps are unavailable');
  });

  it('fails specifically when readable live-process maps contain no CPU backend despite an AVX2 log', () => {
    const result = runBackendVerifier(mapping('/usr/lib/libc.so.6'));
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain('No mapped llama-server CPU backend');
    expect(result.stderr).not.toContain('maps are unavailable or empty');
  });

  it('rejects additional and alternative mapped CPU library variants', () => {
    for (const maps of [
      `${mapping(haswell)}${mapping('/other/libggml-cpu-avx512.so')}`,
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-skylake.so'),
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-avx512-vnni.so'),
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-amx.so'),
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-sapphirerapids.so'),
      mapping(`${haswell} (deleted)`),
    ]) {
      const result = runBackendVerifier(maps);
      expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
      expect(result.stderr).toContain(
        'Unexpected mapped llama-server CPU library',
      );
    }
  }, 15_000);

  it('reads nonempty maps from a zero-size-reported FIFO', () => {
    const result = runBackendVerifier(mapping(haswell), true, {
      mapsFifo: true,
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Loaded CPU backends:');
  }, 15_000);

  it('rejects a process whose cmdline does not match the expected server', () => {
    const result = runBackendVerifier(mapping(haswell), true, {
      cmdline: 'spoofed\\0--model\\0gemma\\0',
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain(
      'Matched PID is not the expected llama-server process',
    );
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  asOptionalRecord,
  asRecord,
  asString,
  workflowJob,
} from './typed-test-helpers.ts';
import {
  actionStep,
  exportedTestEnvironment,
  required,
  requiredText,
  setupActionText,
  setupStep,
  step,
  steps,
  setupActionSteps,
} from './e2e-local-model-fixture.ts';

describe('ordinary local-model E2E', () => {
  it('dispatches the selected branch through the ordinary E2E job with no extra input', () => {
    const dispatch = asRecord(required.on?.workflow_dispatch);
    expect(asRecord(dispatch.inputs)).toEqual({
      branch_ref: {
        description: 'Branch to run on',
        required: true,
        default: 'main',
        type: 'string',
      },
    });
    expect(Object.keys(required.jobs ?? {})).toEqual([
      'skip_check',
      'mergeability-gate',
      'e2e_doc_change_filter',
      'e2e_linux',
    ]);
    const checkout = step('Checkout');
    expect(asOptionalRecord(checkout.with)?.ref).toBe(
      "${{ github.event_name == 'workflow_dispatch' && inputs.branch_ref || github.ref }}",
    );
  });

  it('keeps required E2E events, check names and budget while running without provider credentials', () => {
    expect(required.on).toHaveProperty('pull_request');
    expect(required.on).toHaveProperty('push');
    expect(required.on).toHaveProperty('merge_group');
    expect(required.on).toHaveProperty('pull_request_target');
    expect(workflowJob(required, 'e2e_linux').name).toBe(
      'E2E Test (Linux) - ${{ matrix.sandbox }}',
    );
    expect(requiredText).not.toContain('Block unqualified local-model gating');
    const requiredSteps = workflowJob(required, 'e2e_linux').steps ?? [];
    expect(requiredSteps.map((candidate) => candidate.name)).not.toContain(
      'Check API quota and select optimal key',
    );
    expect(requiredSteps.map((candidate) => candidate.name)).toContain(
      'Check E2E real-model budget (issue #2278)',
    );
    const linuxText = JSON.stringify(workflowJob(required, 'e2e_linux'));
    expect(linuxText).not.toContain('secrets[');
    expect(linuxText).not.toContain('vars.');
    expect(linuxText).not.toContain('ci-quota-check');
  });

  it('runs the pinned local runtime and both E2E legs in one required job', () => {
    const linux = workflowJob(required, 'e2e_linux');
    expect(linux['timeout-minutes']).toBe(90);
    expect(asRecord(asRecord(linux.strategy).matrix).sandbox).toBe(
      '${{ fromJSON(github.event_name == \'push\' && \'["sandbox:none"]\' || \'["sandbox:none","sandbox:docker"]\') }}',
    );
    expect(setupStep?.name).toBe('Set up local Gemma 4 E2B model');
    expect(setupStep?.with).toBeUndefined();
    for (const name of [
      'Install Ollama CPU runtime',
      'Select CPU backend on Intel',
      'Start local Gemma 4 E2B model',
      'Verify CPU backend warm-up',
      'Verify CPU-only model inference',
      'Export local model test environment',
      'Run E2E tests',
      'Check E2E real-model budget (issue #2278)',
      'Upload local model diagnostics',
    ]) {
      expect(step(name).name).toBe(name);
    }
    expect(step('Upload local model diagnostics').if).toBe('always()');
  });

  it('names distinct safe diagnostic artifacts for host and Docker', () => {
    const name = asString(
      asOptionalRecord(step('Upload local model diagnostics').with)?.name,
    );
    expect(name).toBe(
      "local-gemma4-e2e-${{ matrix.sandbox == 'sandbox:docker' && 'docker' || 'none' }}",
    );
    for (const sandbox of ['none', 'docker']) {
      expect(`local-gemma4-e2e-${sandbox}`).not.toMatch(/[\\/:*?"<>|\r\n]/);
    }
  });

  it('downloads a pinned Ollama runtime and verifies its archive before extraction', () => {
    const install = asString(step('Install Ollama CPU runtime').run);
    expect(install).toContain('uname -m');
    expect(install).toContain('x86_64');
    expect(install).toContain('ollama-linux-amd64.tar.zst?version=0.31.1');
    expect(install).toContain(
      `printf '%s  %s\\n' 'd297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4' "$RUNNER_TEMP/ollama-linux-amd64.tar.zst" | sha256sum --check -`,
    );
    expect(install.indexOf('sha256sum --check')).toBeLessThan(
      install.indexOf('tar --zstd'),
    );
    expect(install).toContain("--exclude='lib/ollama/cuda_v12/*'");
    expect(install).toContain("--exclude='lib/ollama/cuda_v13/*'");
    expect(install).toContain("--exclude='lib/ollama/vulkan/*'");
    expect(install).toContain('rm "$RUNNER_TEMP/ollama-linux-amd64.tar.zst"');
  });

  it('pins Intel backend selection before startup and verifies live mapped backends', () => {
    const select = step('Select CPU backend on Intel');
    expect(select.if).toBe("runner.os == 'Linux'");
    const script = asString(select.run);
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('grep -qm1');
    expect(script).toContain('GenuineIntel');
    expect(script).toContain('Host CPU vendor:');
    expect(script).toContain('libggml-cpu-haswell.so');
    expect(script).toContain('libggml-cpu-*.so');
    expect(script).not.toContain('OLLAMA_LLM_LIBRARY');
    expect(steps.indexOf(select)).toBeGreaterThan(
      steps.indexOf(step('Install Ollama CPU runtime')),
    );
    expect(steps.indexOf(select)).toBeLessThan(
      steps.indexOf(step('Start local Gemma 4 E2B model')),
    );
    const verify = step('Verify CPU backend warm-up');
    expect(verify.if).toBe("runner.os == 'Linux'");
    expect(asString(verify.run)).toContain(
      'http://127.0.0.1:12644/api/generate',
    );
    expect(asString(verify.run)).toContain('ollama-server.log');
    expect(asString(verify.run)).toContain('"think":false');
    expect(asString(verify.run)).toContain('(.response | length > 0)');
    expect(asString(verify.run)).toContain('LLXPRT_PROC_ROOT:-/proc');
    expect(asString(verify.run)).toContain('libggml-cpu-haswell.so');
    expect(asString(verify.run)).toContain('pgrep -f');
    expect(asString(verify.run)).toContain('/cmdline');
    expect(asString(verify.run)).toContain('/status');
    expect(asString(verify.run)).toContain('parent cmdline');
    expect(asString(verify.run)).not.toContain('-s "$maps');
    expect(steps.indexOf(verify)).toBeGreaterThan(
      steps.indexOf(step('Start local Gemma 4 E2B model')),
    );
    expect(steps.indexOf(verify)).toBeLessThan(
      steps.indexOf(step('Run E2E tests')),
    );
  });

  it('checks model version and digest before running integration tests', () => {
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
      steps.indexOf(step('Run E2E tests')),
    );
  });

  it('matches the required Linux E2E test invocations in both sandbox legs without provider secrets', () => {
    const job = workflowJob(required, 'e2e_linux');
    const run = step('Run E2E tests');
    const command = asString(run.run);
    const normalize = (script: string): string =>
      script.replace(/\\\s*/g, ' ').replace(/\s+/g, ' ');
    const fullArgs =
      '--exclude="**/todo-continuation.e2e.test.ts" --exclude="**/run_shell_command.test.ts" --exclude="**/run_shell_command.full.*.test.ts"';
    const shellArgs =
      'integration-tests/run_shell_command.test.ts --testNamePattern="should be able to run a shell command|should be able to run a shell command via stdin|should run a platform-specific file listing command"';
    const normalizedCommand = normalize(command);
    for (const sandbox of ['sandbox:none', 'sandbox:docker']) {
      const fullInvocation = `npm run test:integration:${sandbox} -- ${fullArgs}`;
      const firstInvocationPattern = new RegExp(
        `npm run test:integration:${sandbox} -- (.*?) npm run test:integration:${sandbox} --`,
      );
      const firstInvocation = normalizedCommand.match(firstInvocationPattern);
      expect(firstInvocation?.[1]).toBe(fullArgs);
      expect(normalizedCommand).toContain(fullInvocation);
      const shellInvocation = `npm run test:integration:${sandbox} -- --exclude="**/todo-continuation.e2e.test.ts" ${shellArgs}`;
      expect(normalizedCommand).toContain(shellInvocation);
    }
    expect(command.match(/--exclude=/g)).toHaveLength(8);
    // The local-model provider environment is exported by the shared setup
    // action (via GITHUB_ENV) before 'Run E2E tests' starts.
    const exported = exportedTestEnvironment();
    expect(exported).toEqual({
      OPENAI_API_KEY: 'ollama-local-only',
      OPENAI_BASE_URL: 'http://127.0.0.1:12644/v1',
      LLXPRT_DEFAULT_MODEL: 'gemma4:e2b-it-qat',
      LLXPRT_DEFAULT_PROVIDER: 'openai',
      LLXPRT_AUTH_TYPE: 'provider',
      LLXPRT_TEST_PROFILE: 'local-gemma4-e2e',
      LLXPRT_CONTEXT_LIMIT: '32768',
      LLXPRT_MAX_OUTPUT_TOKENS: '8192',
      LLXPRT_LOCAL_MODEL_E2E: 'true',
    });
    expect(
      asString(actionStep('Export local model test environment').run),
    ).toContain('>>"$GITHUB_ENV"');
    expect(
      steps.indexOf(step('Export local model test environment')),
    ).toBeLessThan(steps.indexOf(run));
    expect(Number(exported.LLXPRT_CONTEXT_LIMIT)).toBe(
      Number(step('Start local Gemma 4 E2B model').env?.OLLAMA_CONTEXT_LENGTH),
    );
    expect(Number(exported.LLXPRT_MAX_OUTPUT_TOKENS)).toBeLessThan(
      Number(exported.LLXPRT_CONTEXT_LIMIT),
    );
    const env = asOptionalRecord(run.env);
    for (const name of Object.keys(exported)) {
      expect(
        env?.[name],
        `${name} must come from the setup action`,
      ).toBeUndefined();
    }
    expect(env?.GIT_CEILING_DIRECTORIES).toBe(
      '${{ github.workspace }}/.integration-tests',
    );
    expect(asString(run.run).startsWith('set -euo pipefail')).toBe(true);
    expect(asString(run.run)).toContain(
      'integration-tests/run_shell_command.test.ts',
    );
    expect(JSON.stringify(job)).not.toMatch(/\bsecrets(?:\.|\[)/);
    expect(JSON.stringify(setupActionSteps)).not.toMatch(/\bsecrets(?:\.|\[)/);
    expect(JSON.stringify(setupActionSteps)).not.toContain('vars.');
    const budget = step('Check E2E real-model budget (issue #2278)');
    expect(budget.if).toBe('success()');
    expect(asString(budget.run).trim()).toBe(
      'bun scripts/check-e2e-model-budget.ts --ledger "$LLXPRT_E2E_MODEL_LEDGER"',
    );
    expect(asOptionalRecord(budget.env)?.LLXPRT_E2E_MODEL_LEDGER).toBe(
      '${{ runner.temp }}/e2e-model-ledger.jsonl',
    );
  });

  it('installs the same pinned Ollama version natively on macOS and Windows with checksum verification before extraction', () => {
    const macos = actionStep('Install Ollama runtime (macOS)');
    expect(macos.if).toBe("runner.os == 'macOS'");
    const macosScript = asString(macos.run);
    expect(macosScript).toContain('/v0.31.1/ollama-darwin.tgz');
    expect(macosScript).toContain(
      '0c4f92389fcc1f651c17282e2eaffd68c8d3d06e1f7b307604102ad0e09a10c9',
    );
    expect(macosScript.indexOf('shasum -a 256 -c')).toBeGreaterThan(-1);
    expect(macosScript.indexOf('shasum -a 256 -c')).toBeLessThan(
      macosScript.indexOf('tar -xzf'),
    );

    const windows = actionStep('Install Ollama runtime (Windows)');
    expect(windows.if).toBe("runner.os == 'Windows'");
    const windowsScript = asString(windows.run);
    expect(windowsScript).toContain('/v0.31.1/ollama-windows-amd64.zip');
    expect(windowsScript).toContain(
      '9ecf5a631561c7dff3a143925f11e2008327be738a7279fcf0c5462b9c422700',
    );
    expect(windowsScript.indexOf('Get-FileHash')).toBeLessThan(
      windowsScript.indexOf('7z x'),
    );
    expect(windowsScript).toContain('checksum mismatch');
  });

  it('starts the Windows server with the same version, context and digest checks as the POSIX start', () => {
    const posix = actionStep('Start local Gemma 4 E2B model');
    expect(posix.if).toBe("runner.os != 'Windows'");
    const windows = actionStep('Start local Gemma 4 E2B model (Windows)');
    expect(windows.if).toBe("runner.os == 'Windows'");
    expect(windows.env).toEqual({
      OLLAMA_HOST: '127.0.0.1:12644',
      OLLAMA_CONTEXT_LENGTH: '32768',
      OLLAMA_NUM_PARALLEL: '1',
      OLLAMA_MODELS: '${{ github.workspace }}\\tmp\\ollama-models',
      MODEL_CACHE_HIT: '${{ steps.model-cache.outputs.cache-hit }}',
    });
    expect(posix.env).toEqual({
      ...windows.env,
      OLLAMA_MODELS: '${{ github.workspace }}/tmp/ollama-models',
    });
    const script = asString(windows.run);
    expect(script).toContain("'0.31.1'");
    expect(script).toContain('pull gemma4:e2b-it-qat');
    expect(script).toContain("$env:MODEL_CACHE_HIT -eq 'true'");
    expect(script).toContain(
      '07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c',
    );
  });

  it('caches the complete digest-keyed model store with SHA-pinned cache actions, saving only after verification', () => {
    const digest =
      '07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c';
    const restore = actionStep('Restore local Gemma 4 E2B model cache');
    const save = actionStep('Save local Gemma 4 E2B model cache');
    expect(restore.id).toBe('model-cache');
    expect(restore.uses).toMatch(/^actions\/cache\/restore@[0-9a-f]{40}$/);
    expect(save.uses).toMatch(/^actions\/cache\/save@[0-9a-f]{40}$/);
    expect(setupActionText).toContain('# ratchet:actions/cache/restore@v6');
    expect(setupActionText).toContain('# ratchet:actions/cache/save@v6');
    const key = `ollama-models-portable-v1-gemma4-e2b-it-qat-${digest}`;
    for (const cacheStep of [restore, save]) {
      expect(asOptionalRecord(cacheStep.with)?.key).toBe(key);
      expect(asOptionalRecord(cacheStep.with)?.path).toBe('tmp/ollama-models');
      expect(asOptionalRecord(cacheStep.with)?.enableCrossOsArchive).toBe(true);
      expect(
        asOptionalRecord(cacheStep.with)?.['restore-keys'],
      ).toBeUndefined();
    }
    expect(save.if).toBe("steps.model-cache.outputs.cache-hit != 'true'");

    const restoredStore = actionStep('Verify restored model store');
    const storeBeforeSave = actionStep('Verify model store before saving');
    expect(restoredStore.if).toBe(
      "steps.model-cache.outputs.cache-hit == 'true'",
    );
    expect(storeBeforeSave.if).toBe(save.if);
    for (const verify of [restoredStore, storeBeforeSave]) {
      expect(verify.shell).toBe('bash');
      expect(verify.env).toEqual({ ACTION_PATH: '${{ github.action_path }}' });
      expect(asString(verify.run).trim()).toBe(
        'set -euo pipefail\nbun "$ACTION_PATH/verify-model-store.ts" "$GITHUB_WORKSPACE/tmp/ollama-models"',
      );
    }

    const names = setupActionSteps.map((candidate) => candidate.name);
    const index = (name: string): number => names.indexOf(name);
    expect(index(restoredStore.name ?? '')).toBeGreaterThan(
      index(restore.name ?? ''),
    );
    for (const startName of [
      'Start local Gemma 4 E2B model',
      'Start local Gemma 4 E2B model (Windows)',
    ]) {
      expect(index(restoredStore.name ?? '')).toBeLessThan(index(startName));
    }
    expect(index(storeBeforeSave.name ?? '')).toBeLessThan(
      index(save.name ?? ''),
    );
    for (const verified of [
      'Start local Gemma 4 E2B model',
      'Start local Gemma 4 E2B model (Windows)',
      'Verify CPU-only model inference',
      'Verify model inference (macOS and Windows)',
    ]) {
      expect(index(storeBeforeSave.name ?? '')).toBeGreaterThan(
        index(verified),
      );
      expect(index(save.name ?? '')).toBeGreaterThan(index(verified));
    }
    expect(index(save.name ?? '')).toBeLessThan(
      index('Export local model test environment'),
    );

    for (const name of [
      'Start local Gemma 4 E2B model',
      'Start local Gemma 4 E2B model (Windows)',
    ]) {
      expect(asOptionalRecord(actionStep(name).env)?.MODEL_CACHE_HIT).toBe(
        '${{ steps.model-cache.outputs.cache-hit }}',
      );
    }
  });

  it('keeps the macOS model and vision projector on the CPU for warm-up and every later request', () => {
    const posix = asString(actionStep('Start local Gemma 4 E2B model').run);
    const macosBlock = posix.slice(
      posix.indexOf('if [[ "$RUNNER_OS" == macOS ]]'),
      posix.indexOf('nohup ollama serve'),
    );
    expect(macosBlock).toContain('export LLAMA_ARG_N_GPU_LAYERS=0');
    expect(macosBlock).toContain('export LLAMA_ARG_MMPROJ_OFFLOAD=0');
    expect(posix.indexOf('LLAMA_ARG_MMPROJ_OFFLOAD')).toBeLessThan(
      posix.indexOf('nohup ollama serve'),
    );

    const verify = actionStep('Verify CPU-only model backend (macOS)');
    expect(verify.if).toBe("runner.os == 'macOS'");
    const script = asString(verify.run);
    expect(script).toContain('.size_vram == 0');
    expect(script).toContain('offloaded 0/');
    expect(script).toContain('CLIP using CPU backend');
  });

  it('starts the Windows server outside the step process tree and fails clearly when it is gone', () => {
    const start = asString(
      actionStep('Start local Gemma 4 E2B model (Windows)').run,
    );
    expect(start).not.toContain('Start-Process');
    expect(start).toContain('Win32_Process');
    expect(start).toContain('OLLAMA_SERVER_PID=');
    expect(start).toContain('ollama-server.pid');

    const verify = actionStep(
      'Verify local model server is still running (Windows)',
    );
    expect(verify.if).toBe("runner.os == 'Windows'");
    const script = asString(verify.run);
    expect(script).toContain('is no longer running');
    expect(script).not.toMatch(/Start-Sleep|Invoke-RestMethod/);

    const names = steps.map((candidate) => candidate.name);
    const order = [
      'Start local Gemma 4 E2B model (Windows)',
      'Verify local model server is still running (Windows)',
      'Verify model inference (macOS and Windows)',
    ].map((name) => names.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('proves a real generation on macOS and Windows where CPU-only evidence is unavailable', () => {
    const inference = actionStep('Verify model inference (macOS and Windows)');
    expect(inference.if).toBe("runner.os != 'Linux'");
    expect(inference.env?.OLLAMA_HOST).toBe('127.0.0.1:12644');
    const script = asString(inference.run);
    expect(script).toContain('/api/generate');
    expect(script).toContain('think   = $false');
    expect(script).toContain('num_predict = 16');
    expect(script).toContain('ollama-inference.json');
    expect(script).toContain('did not return a completed non-empty response');
    expect(asString(actionStep('Verify CPU-only model inference').if)).toBe(
      "runner.os == 'Linux'",
    );
  });

  it('uses host networking only for the Docker leg, and retains diagnostics on failure', () => {
    const env = asOptionalRecord(step('Run E2E tests').env);
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

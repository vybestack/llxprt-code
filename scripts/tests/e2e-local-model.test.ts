/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
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
    expect(job.name).toContain('Local Qwen3.5 pilot');
    expect(job.name).not.toContain('E2E Test (Linux)');
    expect(asString(job.if ?? '')).toContain(
      'inputs.pilot_local_model == true',
    );
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBe(90);
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
    expect(name).toBe('local-qwen35-pilot-${{ matrix.artifact_id }}');
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

  it('checks model version and digest before running either canary', () => {
    const server = step('Start local Qwen3.5 model');
    const start = asString(server.run);
    const env = asOptionalRecord(server.env);
    expect(env?.OLLAMA_CONTEXT_LENGTH).toBe('32768');
    expect(env?.OLLAMA_NUM_PARALLEL).toBe('1');
    expect(env?.OLLAMA_HOST).toBe('127.0.0.1:12644');
    expect(start).toContain('jq -e \'.version == "0.31.1"\'');
    expect(start).toContain('ollama pull qwen3.5:2b');
    expect(start).toContain(
      '324d162be6ca5629ae4517c8710434d0bd2d665bc94dbad46e9af8fbf8a2f0df',
    );
    expect(steps.indexOf(server)).toBeLessThan(
      steps.indexOf(step('Run local-model canaries')),
    );
  });

  it('runs only real shell and replace TestRig canaries without provider secrets', () => {
    const job = workflowJob(pilot, 'local_model_canaries');
    const run = step('Run local-model canaries');
    const env = asOptionalRecord(run.env);
    expect(env?.OPENAI_BASE_URL).toBe('http://127.0.0.1:12644/v1');
    expect(env?.LLXPRT_DEFAULT_PROVIDER).toBe('openai');
    expect(env?.LLXPRT_DEFAULT_MODEL).toBe('qwen3.5:2b');
    expect(env?.OPENAI_API_KEY).toBe('ollama-local-only');
    expect(env?.LLXPRT_TEST_PROFILE).toBe('local-qwen35-pilot');
    expect(env?.LLXPRT_CONTEXT_LIMIT).toBe('32768');
    expect(env?.LLXPRT_MAX_OUTPUT_TOKENS).toBe('8192');
    expect(env?.LLXPRT_LOCAL_MODEL_PILOT).toBe('true');
    expect(Number(env?.LLXPRT_CONTEXT_LIMIT)).toBe(
      Number(step('Start local Qwen3.5 model').env?.OLLAMA_CONTEXT_LENGTH),
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
    expect(asString(run.run)).toContain('integration-tests/replace.test.ts');
    expect(asString(run.run)).toContain(
      'should be able to replace content in a file',
    );
    expect(asString(run.run)).toContain(
      'should be able to run a shell command',
    );
    expect(asString(run.run)).not.toContain('--exclude=');
    expect(JSON.stringify(job)).not.toMatch(/\bsecrets(?:\.|\[)/);
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

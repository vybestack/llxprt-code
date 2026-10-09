/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readRootFile } from './ocr-review-workflow-helpers.ts';
import {
  parseWorkflowYaml,
  asOptionalRecord,
  jobSteps,
  asString,
} from './typed-test-helpers.ts';

const source = readRootFile('.github/workflows/pr-review.yml');
const workflow = parseWorkflowYaml(source);
const review = workflow.jobs?.review;
const steps = jobSteps(review);
function run(name: string): string {
  return asString(steps.find((s) => s.name === name)?.run ?? '');
}

describe('runner-local prereview workflow', () => {
  it('offers manual validation of trusted workflow code without a PR-head checkout', () => {
    const inputs = asOptionalRecord(
      asOptionalRecord(workflow.on?.workflow_call)?.inputs,
    );
    expect(inputs).toHaveProperty('pull_request_number');
    expect(inputs).toHaveProperty('expected_head_sha');
    expect(
      asOptionalRecord(
        steps.find((s) => s.name === 'Checkout base revision')?.with,
      )?.ref,
    ).toContain("github.event_name == 'workflow_dispatch' && github.sha");
    expect(run('Resolve validation metadata')).toContain('EXPECTED_HEAD_SHA');
    expect(run('Resolve validation metadata')).toContain('current_head');
    expect(run('Resolve validation metadata')).not.toContain('git checkout');
  });
  it('uses no hosted credentials, nightly CLI, quota selector or remote model configuration', () => {
    expect(source).not.toContain('secrets[');
    expect(source).not.toContain('ci-quota-check.ts');
    expect(source).not.toContain('@vybestack/llxprt-code@nightly');
    expect(source).not.toContain('vars.LLXPRT');
    expect(asOptionalRecord(review?.env)?.OPENAI_BASE_URL).toBeUndefined();
  });
  it('pins the proven runtime and model with one server and model store', () => {
    expect(run('Install Ollama CPU runtime')).toContain('version=0.31.1');
    expect(run('Install Ollama CPU runtime')).toContain(
      'd297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4',
    );
    expect(run('Start pinned local Qwen model')).toContain(
      '2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd',
    );
    expect(source.match(/nohup[^\n]*ollama serve/g)).toHaveLength(1);
    expect(source).toContain("OLLAMA_NUM_PARALLEL: '1'");
    expect(source).toContain("OLLAMA_CONTEXT_LENGTH: '32768'");
    expect(run('Verify CPU-only model inference')).toContain('.size_vram == 0');
    expect(run('Verify CPU-only model inference')).toContain(
      '.context_length == 32768',
    );
    expect(run('Stop owned local model server')).toContain('ollama-server.pid');
  });
  it('retains trusted checkout and SHA checks without head execution', () => {
    expect(
      asOptionalRecord(
        steps.find((s) => s.name === 'Checkout base revision')?.with,
      )?.ref,
    ).toBe(
      "${{ github.event_name == 'workflow_dispatch' && github.sha || github.event.pull_request.base.sha }}",
    );
    expect(run('Fetch pull request head')).toContain('EXPECTED_HEAD_SHA');
    expect(source).not.toMatch(/checkout[^\n]*head|ref:.*head\.sha/);
    expect(run('Run walkthrough pipeline')).toContain(
      'env -u GH_TOKEN -u GITHUB_TOKEN',
    );
    expect(run('Start pinned local Qwen model')).toContain('ss -ltn');
  });
  it('keeps runtime setup failures advisory, gated and visible through fallback', () => {
    for (const id of ['install', 'model', 'quota']) {
      const step = steps.find((s) => s.id === id);
      expect(step?.['continue-on-error']).toBe(true);
      expect(steps.find((s) => s.id === 'walkthrough')?.if).toContain(
        `steps.${id}.outcome == 'success'`,
      );
    }
    expect(run('Ensure fallback comment')).toContain('unavailable');
    expect(
      asOptionalRecord(
        steps.find((s) => s.name === 'Upload walkthrough diagnostics')?.with,
      )?.path,
    ).toContain('review/result.json');
  });
  it('records model residency and peak worker memory, then verifies owned resource cleanup', () => {
    expect(run('Capture local run resources')).toContain('VmHWM');
    expect(run('Capture local run resources')).toContain('/api/ps');
    expect(run('Stop owned local model server')).toContain('kill -0');
    expect(run('Stop owned local model server')).toContain(
      'ollama stop qwen3.5:4b',
    );
    expect(run('Stop owned local model server')).toContain(
      'Local inference port is closed',
    );
    expect(run('Stop owned local model server')).toContain('test ! -d');
  });
});

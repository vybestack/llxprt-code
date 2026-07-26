/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { beforeAll, expect } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

const VM_TIMEOUT_MS = 2000;

function defaultSandboxGlobals() {
  return {
    Number,
    Math,
    JSON,
    String,
    Object,
    Array,
    Boolean,
    Error,
    Set,
    Map,
  };
}

export const BASE_MANIFEST_PARAMS = {
  repository: 'acme/widget',
  prNumber: 42,
  headSha: 'abc123def456',
  mergeBaseSha: 'fed654cba321',
  trigger: 'pull_request_target',
  runId: '999888777',
  runAttempt: '1',
  ocrVersion: '1.7.16',
  providerModel: 'gpt-4o',
  concurrency: 2,
  ocrSessionId: 'sess-abc',
  ocrParentSessionId: 'parent-sess-xyz',
  ruleConfigHash: 'sha256:deadbeef',
  selectedFiles: ['src/a.ts', 'src/b.ts'],
  completedFiles: ['src/a.ts', 'src/b.ts'],
  failedFiles: [],
  reusedFiles: [],
  waivedFiles: [],
  ocrExitCode: 0,
  ocrStatus: 'success',
  skipped: false,
  artifactHashes: {},
};

export function useWorkflowFixture() {
  const ctx = {};
  beforeAll(() => {
    const workflowYml = readRootFile(WORKFLOW_PATH);
    const workflow = yaml.load(workflowYml);
    if (!workflow || typeof workflow !== 'object') {
      throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
    }
    const codeReviewJob = workflow.jobs?.['code-review'];
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    const postStep = stepNamed(codeReviewJob, 'Post OCR results');
    const postScript = commandText(postStep);
    ctx.workflow = workflow;
    ctx.codeReviewJob = codeReviewJob;
    ctx.postStep = postStep;
    ctx.postScript = postScript;
  });
  return ctx;
}

export function makeLoadFunction(ctx) {
  return function loadFunction(funcName, sandboxGlobals = {}) {
    const source = extractFunctionSource(ctx.postScript, funcName);
    const sandbox = {
      ...defaultSandboxGlobals(),
      ...sandboxGlobals,
    };
    vm.createContext(sandbox);
    try {
      vm.runInContext(source, sandbox, { timeout: VM_TIMEOUT_MS });
    } catch (error) {
      throw new Error(`Failed to load workflow function ${funcName}`, {
        cause: error,
      });
    }
    const fn = sandbox[funcName];
    expect(typeof fn, `${funcName} should be defined after vm execution`).toBe(
      'function',
    );
    return fn;
  };
}

export function makeLoadFunctionsTogether(ctx) {
  return function loadFunctionsTogether(funcNames, sandboxGlobals = {}) {
    const sources = funcNames.map((name) =>
      extractFunctionSource(ctx.postScript, name),
    );
    const sandbox = {
      ...defaultSandboxGlobals(),
      ...sandboxGlobals,
    };
    vm.createContext(sandbox);
    try {
      vm.runInContext(sources.join('\n'), sandbox, {
        timeout: VM_TIMEOUT_MS,
      });
    } catch (error) {
      throw new Error(
        `Failed to load workflow functions ${funcNames.join(', ')}`,
        { cause: error },
      );
    }
    for (const name of funcNames) {
      expect(
        typeof sandbox[name],
        `${name} should be defined after vm execution`,
      ).toBe('function');
    }
    return sandbox;
  };
}

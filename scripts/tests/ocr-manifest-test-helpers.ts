/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import {
  asRecord,
  asStringArray,
  asVmFunction,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

const VM_TIMEOUT_MS = 2000;

interface WorkflowFixture {
  workflow: Record<string, unknown>;
  codeReviewJob: Record<string, unknown>;
  postStep: {
    name?: string;
    run?: string;
    with?: { script?: string; [key: string]: unknown };
    env?: Record<string, unknown>;
    [key: string]: unknown;
  };
  postScript: string;
}

type SandboxGlobals = Record<string, unknown>;

function defaultSandboxGlobals(): SandboxGlobals {
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
  failedFiles: asStringArray([]),
  reusedFiles: asStringArray([]),
  waivedFiles: asStringArray([]),
  ocrExitCode: 0,
  ocrStatus: 'success',
  skipped: false,
  artifactHashes: asRecord({}),
};

export function useWorkflowFixture(): WorkflowFixture {
  let cached: {
    workflow: Record<string, unknown>;
    codeReviewJob: Record<string, unknown>;
    postStep: WorkflowFixture['postStep'];
    postScript: string;
  } | null = null;

  function ensureLoaded() {
    if (cached) return cached;
    const workflowYml = readRootFile(WORKFLOW_PATH);
    const workflow = parseWorkflowYaml(workflowYml);
    const jobs = workflow.jobs;
    if (!jobs) throw new Error(`${WORKFLOW_PATH} has no jobs`);
    const codeReviewJob = jobs['code-review'];
    if (!codeReviewJob)
      throw new Error('workflow should contain job: code-review');
    const postStep = stepNamed(codeReviewJob, 'Post OCR results');
    const postScript = commandText(postStep);
    cached = { workflow, codeReviewJob, postStep, postScript };
    return cached;
  }

  return {
    get workflow() {
      return ensureLoaded().workflow;
    },
    get codeReviewJob() {
      return ensureLoaded().codeReviewJob;
    },
    get postStep() {
      return ensureLoaded().postStep;
    },
    get postScript() {
      return ensureLoaded().postScript;
    },
  };
}

export function makeLoadFunction(ctx: WorkflowFixture) {
  return function loadFunction(
    funcName: string,
    sandboxGlobals: SandboxGlobals = {},
  ): (...args: unknown[]) => unknown {
    const source = extractFunctionSource(ctx.postScript, funcName);
    const sandbox: SandboxGlobals = {
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
    if (typeof fn !== 'function')
      throw new Error(`${funcName} should be defined after vm execution`);
    return asVmFunction(fn);
  };
}

export function makeLoadFunctionsTogether(ctx: WorkflowFixture) {
  return function loadFunctionsTogether(
    funcNames: string[],
    sandboxGlobals: SandboxGlobals = {},
  ): SandboxGlobals {
    const sources = funcNames.map((name) =>
      extractFunctionSource(ctx.postScript, name),
    );
    const sandbox: SandboxGlobals = {
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
      if (typeof sandbox[name] !== 'function')
        throw new Error(`${name} should be defined after vm execution`);
    }
    return sandbox;
  };
}

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'bun:test';
import {
  asRecord,
  asString,
  asVmFunction,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import type {
  WorkflowDocument,
  WorkflowJob,
  WorkflowStep,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

type LoadedFunctions = Record<string, (...args: unknown[]) => unknown>;

function asLoadedFunctions(value: unknown): LoadedFunctions {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected LoadedFunctions to be an object');
  }
  const result: LoadedFunctions = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'function') {
      // typeof check narrows to Function; call with spread args
      const fn = (...args: unknown[]) => val(...args);
      result[key] = fn;
    }
  }
  return result;
}

function loadFunctions(
  script: string | string[],
  functionNames: string[],
): LoadedFunctions {
  const scriptStr = Array.isArray(script) ? script.join('\n') : script;
  const sandbox: Record<string, unknown> = {
    Array,
    Boolean,
    Buffer,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Error,
    JSON,
    Math,
    Number,
    Object,
    Set,
    String,
    undefined,
  };
  const sources = functionNames.map((name) =>
    extractFunctionSource(scriptStr, name),
  );
  try {
    vm.runInNewContext(
      `${sources.join('\n')}\n__FUNCTIONS__ = { ${functionNames.join(', ')} };`,
      sandbox,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load functions [${functionNames.join(', ')}]: ${message}`,
      { cause: err },
    );
  }
  const rawFunctions = sandbox.__FUNCTIONS__;
  if (!rawFunctions || typeof rawFunctions !== 'object') {
    throw new Error('Failed to load functions: __FUNCTIONS__ not defined');
  }
  const functions = asLoadedFunctions(rawFunctions);
  return functions;
}

describe('.github/workflows/ocr-review.yml — incremental checkpoints (issue #2649)', () => {
  let workflow: WorkflowDocument;
  let codeReviewJob: WorkflowJob | undefined;
  let resolveRangeStep: WorkflowStep | undefined;
  let resolveRangeRun: string;
  let postStep: WorkflowStep | undefined;
  let postScript: string;
  let checkpointFunctions: LoadedFunctions | undefined;
  let rangeFunctions: LoadedFunctions | undefined;

  beforeAll(() => {
    workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
    const jobs = workflow.jobs;
    codeReviewJob = jobs?.['code-review'];
    expect(codeReviewJob).toBeTruthy();
    if (!codeReviewJob)
      throw new Error('workflow should contain job: code-review');
    resolveRangeStep = stepNamed(codeReviewJob, 'Resolve review range');
    resolveRangeRun = commandText(resolveRangeStep);
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);

    checkpointFunctions = loadFunctions(postScript, [
      'serializeCheckpoint',
      'deserializeCheckpoint',
      'extractCheckpointFromComment',
      'embedCheckpointInBody',
      'isAncestralCheckpoint',
    ]);
    rangeFunctions = loadFunctions(resolveRangeRun, [
      'isAncestralCheckpoint',
      'resolveReviewRange',
    ]);
  });

  function completeCheckpoint(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schema: 1,
      pr_number: 2610,
      head_sha: 'checkpoint-head',
      base_sha: 'api-base',
      merge_base: 'merge-base',
      reviewed_at: '2026-07-22T19:05:06Z',
      run_url: 'https://github.com/owner/repo/actions/runs/123',
      ocr_version: '1.7.16',
      ocr_model: '',
      rules_hash: '',
      policy_hash: '',
      workflow_schema_hash: '',
      completion_state: 'complete',
      range_mode: 'full',
      selected_files: 7,
      completed_files: 7,
      publication_state: 'complete',
      ...overrides,
    };
  }

  function resolveRange(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const fn = asVmFunction(rangeFunctions?.resolveReviewRange);
    if (!fn) return {};
    return asRecord(
      fn({
        eventName: 'pull_request_target',
        eventAction: 'synchronize',
        mergeBase: 'merge-base',
        headSha: 'current-head',
        baseSha: 'api-base',
        ocrVersion: '1.7.16',
        ocrModel: '',
        rulesHash: '',
        policyHash: '',
        workflowSchemaHash: '',
        checkpointFound: true,
        checkpoint: completeCheckpoint(),
        isAncestor: true,
        ...overrides,
      }),
    );
  }

  describe('checkpoint serialization and deserialization', () => {
    it('produces valid base64 and round-trips checkpoint data', () => {
      const input = completeCheckpoint();
      const serialized = asString(
        checkpointFunctions?.serializeCheckpoint(input),
      );

      expect(() => Buffer.from(serialized, 'base64')).not.toThrow();
      expect(checkpointFunctions?.deserializeCheckpoint(serialized)).toEqual(
        input,
      );
    });

    it('returns null for invalid base64', () => {
      expect(
        checkpointFunctions?.deserializeCheckpoint('%%%not-base64%%%'),
      ).toBe(null);
    });

    it('returns null for valid base64 containing non-JSON text', () => {
      const encoded = Buffer.from('not json', 'utf8').toString('base64');

      expect(checkpointFunctions?.deserializeCheckpoint(encoded)).toBe(null);
    });

    it('round-trips unicode in run_url', () => {
      const input = completeCheckpoint({
        run_url: 'https://example.test/runs/雪だるま/☃️',
      });
      const deserialized = asRecord(
        checkpointFunctions?.deserializeCheckpoint(
          asString(checkpointFunctions?.serializeCheckpoint(input)),
        ),
      );

      expect(deserialized.run_url).toBe(input.run_url);
    });

    it('always serializes schema version 1', () => {
      const serialized = asString(
        checkpointFunctions?.serializeCheckpoint({
          ...completeCheckpoint(),
          schema: 99,
        }),
      );

      expect(
        asRecord(checkpointFunctions?.deserializeCheckpoint(serialized)).schema,
      ).toBe(1);
    });
  });

  describe('checkpoint extraction from the marker comment', () => {
    it('finds and deserializes an ocr-checkpoint HTML comment', () => {
      const checkpoint = completeCheckpoint();
      const encoded = asString(
        checkpointFunctions?.serializeCheckpoint(checkpoint),
      );
      const body = `summary\n<!-- ocr-checkpoint:${encoded} -->`;

      expect(checkpointFunctions?.extractCheckpointFromComment(body)).toEqual(
        checkpoint,
      );
    });

    it('returns null when no checkpoint is present', () => {
      expect(
        checkpointFunctions?.extractCheckpointFromComment(
          '<!-- llxprt-code-ocr-review -->',
        ),
      ).toBe(null);
    });

    it('returns null when the checkpoint is corrupt', () => {
      expect(
        checkpointFunctions?.extractCheckpointFromComment(
          '<!-- ocr-checkpoint:%%% -->',
        ),
      ).toBe(null);
    });

    it('finds a checkpoint among multiple HTML comments', () => {
      const checkpoint = completeCheckpoint();
      const encoded = asString(
        checkpointFunctions?.serializeCheckpoint(checkpoint),
      );
      const body = [
        '<!-- llxprt-code-ocr-review -->',
        '<!-- ocr-auto-count:3 -->',
        `<!-- ocr-checkpoint:${encoded} -->`,
        '<!-- unrelated:value -->',
      ].join('\n');

      expect(checkpointFunctions?.extractCheckpointFromComment(body)).toEqual(
        checkpoint,
      );
    });

    it('accepts whitespace around the base64 payload', () => {
      const checkpoint = completeCheckpoint();
      const encoded = asString(
        checkpointFunctions?.serializeCheckpoint(checkpoint),
      );

      expect(
        checkpointFunctions?.extractCheckpointFromComment(
          `<!-- ocr-checkpoint:  ${encoded}  -->`,
        ),
      ).toEqual(checkpoint);
    });
  });

  describe('checkpoint embedding', () => {
    it('adds a checkpoint to a body without one', () => {
      const body = '<!-- llxprt-code-ocr-review -->\nSummary';
      const embedded = asString(
        checkpointFunctions?.embedCheckpointInBody(body, completeCheckpoint()),
      );

      expect(embedded).toContain('<!-- ocr-checkpoint:');
      expect(
        checkpointFunctions?.extractCheckpointFromComment(embedded),
      ).toEqual(completeCheckpoint());
    });

    it('replaces an existing checkpoint instead of appending another', () => {
      const oldEncoded = asString(
        checkpointFunctions?.serializeCheckpoint(
          completeCheckpoint({ head_sha: 'old-head' }),
        ),
      );
      const replacement = completeCheckpoint({ head_sha: 'new-head' });
      const body = `Summary\n<!-- ocr-checkpoint:${oldEncoded} -->`;
      const embedded = asString(
        checkpointFunctions?.embedCheckpointInBody(body, replacement),
      );

      expect(embedded.match(/<!--\s*ocr-checkpoint:/g)).toHaveLength(1);
      expect(
        asRecord(checkpointFunctions?.extractCheckpointFromComment(embedded))
          .head_sha,
      ).toBe('new-head');
    });

    it('preserves auto-review state and visible content', () => {
      const body = [
        '<!-- llxprt-code-ocr-review -->',
        'Visible summary',
        '<!-- ocr-auto-count:4 -->',
      ].join('\n');
      const embedded = asString(
        checkpointFunctions?.embedCheckpointInBody(body, completeCheckpoint()),
      );

      expect(embedded).toContain('Visible summary');
      expect(embedded).toContain('<!-- ocr-auto-count:4 -->');
    });

    it('is idempotent for the same checkpoint data', () => {
      const body = '<!-- llxprt-code-ocr-review -->\nSummary';
      const checkpoint = completeCheckpoint();
      const once = asString(
        checkpointFunctions?.embedCheckpointInBody(body, checkpoint),
      );
      const twice = asString(
        checkpointFunctions?.embedCheckpointInBody(once, checkpoint),
      );

      expect(twice).toBe(once);
    });
  });

  describe('structural checkpoint validation', () => {
    it('accepts a complete schema-1 checkpoint with a matching base', () => {
      expect(
        checkpointFunctions?.isAncestralCheckpoint(
          completeCheckpoint(),
          'current-head',
          'api-base',
        ),
      ).toBe(true);
    });

    it.each([
      ['an incomplete checkpoint', { completion_state: 'partial' }, 'api-base'],
      ['a mismatched base', {}, 'different-base'],
      ['a missing head SHA', { head_sha: '' }, 'api-base'],
      ['a schema mismatch', { schema: 2 }, 'api-base'],
    ])('rejects %s', (_label, overrides, baseSha) => {
      expect(
        checkpointFunctions?.isAncestralCheckpoint(
          completeCheckpoint(overrides),
          'current-head',
          baseSha,
        ),
      ).toBe(false);
    });

    it('rejects null input', () => {
      expect(
        checkpointFunctions?.isAncestralCheckpoint(
          null,
          'current-head',
          'api-base',
        ),
      ).toBe(false);
    });
  });

  describe('range mode behavior', () => {
    it('uses the merge base for an opened event without a checkpoint', () => {
      const result = resolveRange({
        eventAction: 'opened',
        checkpointFound: false,
        checkpoint: null,
        isAncestor: false,
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBe('');
    });

    it('uses the complete ancestral checkpoint for synchronize', () => {
      const result = resolveRange();

      expect(result.FROM_SHA).toBe('checkpoint-head');
      expect(result.RANGE_MODE).toBe('incremental');
      expect(result.CHECKPOINT_HEAD).toBe('checkpoint-head');
      expect(result.FALLBACK_REASON).toBe('');
    });

    it('falls back full for an incomplete synchronize checkpoint', () => {
      const result = resolveRange({
        checkpoint: completeCheckpoint({ completion_state: 'partial' }),
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBeTruthy();
    });

    it('falls back full when the checkpoint head is not an ancestor', () => {
      const result = resolveRange({ isAncestor: false });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBeTruthy();
    });

    it('returns an observable no-op for the same synchronize head', () => {
      const result = resolveRange({
        headSha: 'checkpoint-head',
        isAncestor: true,
      });

      expect(result.FROM_SHA).toBe('checkpoint-head');
      expect(result.RANGE_MODE).toBe('noop');
      expect(result.SAME_HEAD).toBe(true);
    });

    it('falls back full when the OCR version changes', () => {
      const result = resolveRange({ ocrVersion: '1.7.17' });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBeTruthy();
    });

    it('falls back full when the OCR model changes', () => {
      const result = resolveRange({
        ocrModel: 'new-model',
        checkpoint: completeCheckpoint({ ocr_model: 'old-model' }),
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBe('ocr-model-changed');
    });

    it('falls back full when the rules hash changes', () => {
      const result = resolveRange({
        rulesHash: 'new-rules-hash',
        checkpoint: completeCheckpoint({ rules_hash: 'old-rules-hash' }),
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBe('rules-hash-changed');
    });

    it('falls back full when the policy hash changes', () => {
      const result = resolveRange({
        policyHash: 'new-policy-hash',
        checkpoint: completeCheckpoint({ policy_hash: 'old-policy-hash' }),
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBe('policy-hash-changed');
    });

    it('falls back full when the workflow schema hash changes', () => {
      const result = resolveRange({
        workflowSchemaHash: 'new-ws-hash',
        checkpoint: completeCheckpoint({
          workflow_schema_hash: 'old-ws-hash',
        }),
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBe('workflow-schema-changed');
    });

    it('ignores empty model/hash fields (backward compatible)', () => {
      const result = resolveRange({
        ocrModel: '',
        rulesHash: '',
        policyHash: '',
        workflowSchemaHash: '',
        checkpoint: completeCheckpoint({
          ocr_model: '',
          rules_hash: '',
          policy_hash: '',
          workflow_schema_hash: '',
        }),
      });

      expect(result.RANGE_MODE).toBe('incremental');
    });

    it('always performs a full review for manual workflow dispatch', () => {
      const result = resolveRange({
        eventName: 'workflow_dispatch',
        eventAction: '',
      });

      expect(result.FROM_SHA).toBe('merge-base');
      expect(result.RANGE_MODE).toBe('full');
      expect(result.FALLBACK_REASON).toBe('');
    });
  });
});

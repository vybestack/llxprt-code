/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

function loadFunctions(script, functionNames) {
  const sandbox = {
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
    extractFunctionSource(script, name),
  );
  try {
    vm.runInNewContext(
      `${sources.join('\n')}\n__FUNCTIONS__ = { ${functionNames.join(', ')} };`,
      sandbox,
    );
  } catch (err) {
    throw new Error(
      `Failed to load functions [${functionNames.join(', ')}]: ${err.message}`,
      { cause: err },
    );
  }
  return sandbox.__FUNCTIONS__;
}

describe('.github/workflows/ocr-review.yml — incremental checkpoints (issue #2649)', () => {
  let workflow;
  let codeReviewJob;
  let readCheckpointStep;
  let readCheckpointScript;
  let resolveRangeStep;
  let resolveRangeRun;
  let reviewStep;
  let reviewRun;
  let previewStep;
  let postStep;
  let postScript;
  let redactRun;
  let placeholderRun;
  let uploadStep;
  let checkpointFunctions;
  let rangeFunctions;
  let metadataFunctions;

  beforeAll(() => {
    workflow = yaml.load(readRootFile(WORKFLOW_PATH));
    codeReviewJob = workflow.jobs?.['code-review'];
    expect(codeReviewJob).toBeTruthy();
    readCheckpointStep = stepNamed(codeReviewJob, 'Read OCR checkpoint');
    readCheckpointScript = commandText(readCheckpointStep);
    resolveRangeStep = stepNamed(codeReviewJob, 'Resolve review range');
    resolveRangeRun = commandText(resolveRangeStep);
    reviewStep = stepNamed(codeReviewJob, 'Run OpenCodeReview');
    reviewRun = commandText(reviewStep);
    previewStep = stepNamed(
      codeReviewJob,
      'Verify review scope includes changed tests',
    );
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
    redactRun = commandText(
      stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts'),
    );
    placeholderRun = commandText(
      stepNamed(codeReviewJob, 'Ensure OCR artifact placeholders exist'),
    );
    uploadStep = stepNamed(codeReviewJob, 'Upload OCR artifacts');

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
    metadataFunctions = loadFunctions(postScript, [
      'shouldAdvanceCheckpoint',
      'completionStateForResult',
      'ocrObservabilityFromResult',
      'findingDistribution',
      'buildOcrMetadata',
    ]);
  });

  function completeCheckpoint(overrides = {}) {
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

  function resolveRange(overrides = {}) {
    return rangeFunctions.resolveReviewRange({
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
    });
  }

  describe('checkpoint serialization and deserialization', () => {
    it('produces valid base64 and round-trips checkpoint data', () => {
      const input = completeCheckpoint();
      const serialized = checkpointFunctions.serializeCheckpoint(input);

      expect(() => Buffer.from(serialized, 'base64')).not.toThrow();
      expect(checkpointFunctions.deserializeCheckpoint(serialized)).toEqual(
        input,
      );
    });

    it('returns null for invalid base64', () => {
      expect(
        checkpointFunctions.deserializeCheckpoint('%%%not-base64%%%'),
      ).toBe(null);
    });

    it('returns null for valid base64 containing non-JSON text', () => {
      const encoded = Buffer.from('not json', 'utf8').toString('base64');

      expect(checkpointFunctions.deserializeCheckpoint(encoded)).toBe(null);
    });

    it('round-trips unicode in run_url', () => {
      const input = completeCheckpoint({
        run_url: 'https://example.test/runs/雪だるま/☃️',
      });

      expect(
        checkpointFunctions.deserializeCheckpoint(
          checkpointFunctions.serializeCheckpoint(input),
        ).run_url,
      ).toBe(input.run_url);
    });

    it('always serializes schema version 1', () => {
      const serialized = checkpointFunctions.serializeCheckpoint({
        ...completeCheckpoint(),
        schema: 99,
      });

      expect(checkpointFunctions.deserializeCheckpoint(serialized).schema).toBe(
        1,
      );
    });
  });

  describe('checkpoint extraction from the marker comment', () => {
    it('finds and deserializes an ocr-checkpoint HTML comment', () => {
      const checkpoint = completeCheckpoint();
      const encoded = checkpointFunctions.serializeCheckpoint(checkpoint);
      const body = `summary\n<!-- ocr-checkpoint:${encoded} -->`;

      expect(checkpointFunctions.extractCheckpointFromComment(body)).toEqual(
        checkpoint,
      );
    });

    it('returns null when no checkpoint is present', () => {
      expect(
        checkpointFunctions.extractCheckpointFromComment(
          '<!-- llxprt-code-ocr-review -->',
        ),
      ).toBe(null);
    });

    it('returns null when the checkpoint is corrupt', () => {
      expect(
        checkpointFunctions.extractCheckpointFromComment(
          '<!-- ocr-checkpoint:%%% -->',
        ),
      ).toBe(null);
    });

    it('finds a checkpoint among multiple HTML comments', () => {
      const checkpoint = completeCheckpoint();
      const encoded = checkpointFunctions.serializeCheckpoint(checkpoint);
      const body = [
        '<!-- llxprt-code-ocr-review -->',
        '<!-- ocr-auto-count:3 -->',
        `<!-- ocr-checkpoint:${encoded} -->`,
        '<!-- unrelated:value -->',
      ].join('\n');

      expect(checkpointFunctions.extractCheckpointFromComment(body)).toEqual(
        checkpoint,
      );
    });

    it('accepts whitespace around the base64 payload', () => {
      const checkpoint = completeCheckpoint();
      const encoded = checkpointFunctions.serializeCheckpoint(checkpoint);

      expect(
        checkpointFunctions.extractCheckpointFromComment(
          `<!-- ocr-checkpoint:  ${encoded}  -->`,
        ),
      ).toEqual(checkpoint);
    });
  });

  describe('checkpoint embedding', () => {
    it('adds a checkpoint to a body without one', () => {
      const body = '<!-- llxprt-code-ocr-review -->\nSummary';
      const embedded = checkpointFunctions.embedCheckpointInBody(
        body,
        completeCheckpoint(),
      );

      expect(embedded).toContain('<!-- ocr-checkpoint:');
      expect(
        checkpointFunctions.extractCheckpointFromComment(embedded),
      ).toEqual(completeCheckpoint());
    });

    it('replaces an existing checkpoint instead of appending another', () => {
      const oldEncoded = checkpointFunctions.serializeCheckpoint(
        completeCheckpoint({ head_sha: 'old-head' }),
      );
      const replacement = completeCheckpoint({ head_sha: 'new-head' });
      const body = `Summary\n<!-- ocr-checkpoint:${oldEncoded} -->`;
      const embedded = checkpointFunctions.embedCheckpointInBody(
        body,
        replacement,
      );

      expect(embedded.match(/<!--\s*ocr-checkpoint:/g)).toHaveLength(1);
      expect(
        checkpointFunctions.extractCheckpointFromComment(embedded).head_sha,
      ).toBe('new-head');
    });

    it('preserves auto-review state and visible content', () => {
      const body = [
        '<!-- llxprt-code-ocr-review -->',
        'Visible summary',
        '<!-- ocr-auto-count:4 -->',
      ].join('\n');
      const embedded = checkpointFunctions.embedCheckpointInBody(
        body,
        completeCheckpoint(),
      );

      expect(embedded).toContain('Visible summary');
      expect(embedded).toContain('<!-- ocr-auto-count:4 -->');
    });

    it('is idempotent for the same checkpoint data', () => {
      const body = '<!-- llxprt-code-ocr-review -->\nSummary';
      const checkpoint = completeCheckpoint();
      const once = checkpointFunctions.embedCheckpointInBody(body, checkpoint);
      const twice = checkpointFunctions.embedCheckpointInBody(once, checkpoint);

      expect(twice).toBe(once);
    });
  });

  describe('structural checkpoint validation', () => {
    it('accepts a complete schema-1 checkpoint with a matching base', () => {
      expect(
        checkpointFunctions.isAncestralCheckpoint(
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
        checkpointFunctions.isAncestralCheckpoint(
          completeCheckpoint(overrides),
          'current-head',
          baseSha,
        ),
      ).toBe(false);
    });

    it('rejects null input', () => {
      expect(
        checkpointFunctions.isAncestralCheckpoint(
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

  describe('checkpoint advancement and terminal state behavior', () => {
    it('advances only a successful, fully published review with proven file coverage', () => {
      expect(
        metadataFunctions.shouldAdvanceCheckpoint({
          ran: true,
          exitCode: 0,
          infrastructureFailure: '',
          policyFailure: '',
          failedFindings: 0,
          completionState: 'complete',
          publicationState: 'complete',
          selectedFiles: 7,
          completedFiles: 7,
          resultSource: 'parsed',
        }),
      ).toBe(true);
    });

    it.each([
      ['did not run', { ran: false }],
      ['nonzero exit', { exitCode: 1 }],
      ['infrastructure failure', { infrastructureFailure: 'provider failed' }],
      ['policy failure', { policyFailure: 'tests omitted' }],
      ['failed finding publication', { failedFindings: 1 }],
      ['partial OCR result', { completionState: 'partial' }],
      ['ambiguous publication', { publicationState: 'ambiguous' }],
      ['synthesized result', { resultSource: 'synthesized' }],
      ['zero selected files', { selectedFiles: 0 }],
      ['incomplete file coverage', { completedFiles: 5, selectedFiles: 7 }],
    ])('does not advance when the review %s', (_label, override) => {
      expect(
        metadataFunctions.shouldAdvanceCheckpoint({
          ran: true,
          exitCode: 0,
          infrastructureFailure: '',
          policyFailure: '',
          failedFindings: 0,
          completionState: 'complete',
          publicationState: 'complete',
          selectedFiles: 7,
          completedFiles: 7,
          resultSource: 'parsed',
          ...override,
        }),
      ).toBe(false);
    });

    it('treats success, warnings, and skipped no-op results as complete', () => {
      expect(metadataFunctions.completionStateForResult('success')).toBe(
        'complete',
      );
      expect(
        metadataFunctions.completionStateForResult('completed_with_warnings'),
      ).toBe('complete');
      expect(metadataFunctions.completionStateForResult('skipped')).toBe(
        'complete',
      );
    });

    it('treats per-file errors and unknown result states as partial', () => {
      expect(
        metadataFunctions.completionStateForResult('completed_with_errors'),
      ).toBe('partial');
      expect(metadataFunctions.completionStateForResult('unknown')).toBe(
        'partial',
      );
    });

    it('treats synthesized results as partial regardless of status', () => {
      expect(
        metadataFunctions.completionStateForResult('success', 'synthesized'),
      ).toBe('partial');
      expect(
        metadataFunctions.completionStateForResult(
          'completed_with_warnings',
          'synthesized',
        ),
      ).toBe('partial');
    });
  });

  describe('metadata assembly behavior', () => {
    it('extracts OCR token, file, warning, and duration observability', () => {
      expect(
        metadataFunctions.ocrObservabilityFromResult({
          status: 'completed_with_warnings',
          summary: {
            files_reviewed: 7,
            input_tokens: 300,
            output_tokens: 100,
            cache_read_tokens: 50,
            cache_write_tokens: 25,
            total_tokens: 400,
            elapsed: '46m31s',
          },
          warnings: [{ type: 'info', message: 'notice' }],
        }),
      ).toEqual({
        completed_files: 7,
        elapsed: '46m31s',
        tokens: {
          input: 300,
          output: 100,
          cache_read: 50,
          cache_write: 25,
          cache: 75,
          total: 400,
        },
        warnings: [{ type: 'info', message: 'notice' }],
        completion_state: 'complete',
        result_source: 'parsed',
      });
    });

    it('builds deterministic normalized finding distributions', () => {
      const findings = [
        { severity: 'high' },
        { severity: 'low' },
        { severity: 'high' },
        {},
        null,
      ];

      expect(
        metadataFunctions.findingDistribution(findings, 'severity'),
      ).toEqual({ high: 2, low: 1, unknown: 2 });
    });

    it('emits the complete Phase 0 observability contract', () => {
      const checkpointBefore = completeCheckpoint({
        head_sha: 'previous-head',
      });
      const checkpointAfter = completeCheckpoint({ head_sha: 'current-head' });
      const metadata = metadataFunctions.buildOcrMetadata({
        eventName: 'pull_request_target',
        eventAction: 'synchronize',
        eventBefore: 'event-before',
        eventAfter: 'event-after',
        apiBaseSha: 'api-base',
        apiHeadSha: 'current-head',
        checkpointBefore,
        checkpointAfter,
        rangeMode: 'incremental',
        fallbackReason: '',
        cumulative: {
          base_sha: 'merge-base',
          head_sha: 'current-head',
          files: 63,
          lines: { additions: 12525, deletions: 3175, total: 15700 },
        },
        selected: {
          base_sha: 'previous-head',
          head_sha: 'current-head',
          files: 7,
          lines: { additions: 282, deletions: 41, total: 323 },
        },
        ocrVersion: '1.7.16',
        model: 'test-model',
        concurrency: 2,
        elapsed: '46m31s',
        tokens: {
          input: 300,
          output: 100,
          cache_read: 50,
          cache_write: 25,
          cache: 75,
          total: 400,
        },
        findings: {
          raw: 75,
          duplicate: 1,
          schema_invalid: 2,
          policy_tiered: 0,
          inline: 50,
          summary: 23,
          overflow: 1,
          failed: 0,
          severity_distribution: { high: 4, medium: 37, low: 33, unknown: 1 },
          category_distribution: { bug: 13, maintainability: 31, unknown: 1 },
        },
        warnings: [{ type: 'info', message: 'notice' }],
        completenessState: 'complete',
        publicationState: 'complete',
        sourceRunUrl: 'https://github.com/owner/repo/actions/runs/123',
      });

      expect(metadata.schema).toBe(1);
      expect(metadata.event).toEqual({
        name: 'pull_request_target',
        action: 'synchronize',
        before: 'event-before',
        after: 'event-after',
      });
      expect(metadata.api_resolved).toEqual({
        base_sha: 'api-base',
        head_sha: 'current-head',
      });
      expect(metadata.checkpoint).toEqual({
        before: checkpointBefore,
        after: checkpointAfter,
      });
      expect(metadata.range.mode).toBe('incremental');
      expect(metadata.range.cumulative.files).toBe(63);
      expect(metadata.range.selected.files).toBe(7);
      expect(metadata.ocr.tokens).toEqual({
        input: 300,
        output: 100,
        cache_read: 50,
        cache_write: 25,
        cache: 75,
        total: 400,
      });
      expect(metadata.findings.raw).toBe(75);
      expect(metadata.findings.severity_distribution.high).toBe(4);
      expect(metadata.warnings).toEqual([{ type: 'info', message: 'notice' }]);
      expect(metadata.terminal).toEqual({
        completeness_state: 'complete',
        publication_state: 'complete',
      });
      expect(metadata.source_run_url).toContain('/actions/runs/123');
    });
  });

  describe('workflow wiring', () => {
    it('places checkpoint reading and range resolution after fetch and before artifact initialization', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const fetchIndex = names.indexOf('Fetch PR head and compute merge-base');
      const readIndex = names.indexOf('Read OCR checkpoint');
      const resolveIndex = names.indexOf('Resolve review range');
      const initializeIndex = names.indexOf('Initialize OCR artifact files');

      expect(fetchIndex).toBeGreaterThan(-1);
      expect(readIndex).toBeGreaterThan(fetchIndex);
      expect(resolveIndex).toBeGreaterThan(readIndex);
      expect(initializeIndex).toBeGreaterThan(resolveIndex);
      expect(resolveRangeStep.id).toBe('resolve-range');
    });

    it('emits every required range output', () => {
      for (const output of [
        'FROM_SHA',
        'RANGE_MODE',
        'CHECKPOINT_HEAD',
        'FALLBACK_REASON',
        'CHECKPOINT_FOUND',
        'SAME_HEAD',
      ]) {
        expect(resolveRangeRun).toContain(`echo "${output}=`);
      }
      expect(resolveRangeRun).toContain(
        'git diff --numstat --diff-filter=d "${from_sha}..${to_sha}"',
      );
      expect(resolveRangeRun).toContain(
        'git diff --name-only --diff-filter=d "${from_sha}..${to_sha}"',
      );
    });

    it('reads only the authenticated bot marker comment through the GitHub API', () => {
      expect(readCheckpointScript).toContain('github.rest.issues.listComments');
      expect(readCheckpointScript).toContain(
        "const MARKER = '<!-- llxprt-code-ocr-review -->';",
      );
      expect(readCheckpointScript).toContain(
        'github.rest.users.getAuthenticated',
      );
      expect(readCheckpointScript).toContain("comment.user.type === 'Bot'");
      expect(readCheckpointScript).toContain('comment.user.login === botLogin');
      const fetchMarkerSource = extractFunctionSource(
        postScript,
        'fetchMarkerComments',
      );
      expect(fetchMarkerSource).toContain("c.user.type === 'Bot'");
      expect(fetchMarkerSource).toContain('c.user.login === botLogin');
    });

    it('handles getAuthenticated failure gracefully with OCR_BOT_LOGIN fallback', () => {
      expect(readCheckpointScript).toContain(
        'core.warning(`Could not resolve authenticated bot login',
      );
      expect(readCheckpointScript).toContain("process.env.OCR_BOT_LOGIN || ''");
      expect(readCheckpointStep.env?.OCR_BOT_LOGIN).toBe(
        '${{ vars.OCR_BOT_LOGIN }}',
      );
    });

    it('uses find() not findLast() for marker comment lookup (symmetric with reconcileMarkerComment)', () => {
      expect(readCheckpointScript).toContain('comments.find(');
      expect(readCheckpointScript).not.toContain('findLast(');
    });

    it('performs ancestry validation in bash and checks OCR version compatibility', () => {
      expect(resolveRangeStep.shell).toBe('bash');
      expect(resolveRangeRun).toContain('git merge-base --is-ancestor');
      expect(resolveRangeStep.env?.OCR_VERSION).toBe('${{ env.OCR_VERSION }}');
      expect(resolveRangeRun).toContain('checkpoint.ocr_version');
      expect(resolveRangeRun).toContain('ocrVersion');
    });

    it('uses the selected range for OCR and changed-test preview scope', () => {
      expect(reviewStep.env?.FROM_SHA).toBe(
        '${{ steps.resolve-range.outputs.FROM_SHA }}',
      );
      expect(reviewRun).toContain('--from "$FROM_SHA"');
      expect(reviewRun).not.toContain('--from "$BASE_SHA"');
      expect(previewStep.env?.BASE_SHA).toBe(
        '${{ steps.resolve-range.outputs.FROM_SHA }}',
      );
    });

    it('skips the expensive OCR command for observable same-head no-op mode', () => {
      expect(reviewStep.env?.RANGE_MODE).toBe(
        '${{ steps.resolve-range.outputs.RANGE_MODE }}',
      );
      expect(reviewRun).toContain('if [ "$RANGE_MODE" = "noop" ]; then');
      expect(
        reviewRun.indexOf('if [ "$RANGE_MODE" = "noop" ]; then'),
      ).toBeLessThan(reviewRun.indexOf('ocr review'));
    });

    it('writes, redacts, preserves, and uploads ocr-metadata.json', () => {
      expect(postScript).toContain("fs.writeFileSync('ocr-metadata.json'");
      expect(redactRun).toContain("'ocr-metadata.json'");
      expect(placeholderRun).toContain('ocr-metadata.json');
      expect(uploadStep.with?.path).toContain('ocr-metadata.json');
    });

    it('preserves the prior checkpoint while posting a failed-run summary', () => {
      expect(postScript).toContain('const summaryWithExistingCheckpoint');
      expect(postScript).toContain(
        'createOrUpdateMarkerComment(summaryWithExistingCheckpoint)',
      );
      expect(
        postScript.indexOf('const summaryWithExistingCheckpoint'),
      ).toBeLessThan(
        postScript.indexOf(
          'createOrUpdateMarkerComment(summaryWithExistingCheckpoint)',
        ),
      );
    });

    it('embeds a new checkpoint only inside the successful advancement gate', () => {
      const gateIndex = postScript.indexOf(
        'if (shouldAdvanceCheckpoint(checkpointDecision) && summaryComment && summaryComment.id)',
      );
      const embedIndex = postScript.indexOf(
        'embedCheckpointInBody(summary, checkpointAfter)',
      );

      expect(gateIndex).toBeGreaterThan(-1);
      expect(embedIndex).toBeGreaterThan(gateIndex);
      expect(postScript.slice(gateIndex, embedIndex)).not.toContain('else if');
    });

    it('guards checkpoint advancement against null summaryComment', () => {
      expect(postScript).toContain('&& summaryComment && summaryComment.id');
    });

    it('writes ocr-metadata.json after checkpoint advancement (not before)', () => {
      const checkpointAdvanceIndex = postScript.indexOf(
        'if (shouldAdvanceCheckpoint(checkpointDecision) && summaryComment && summaryComment.id)',
      );
      const metadataIndex = postScript.indexOf(
        "fs.writeFileSync('ocr-metadata.json'",
      );
      expect(checkpointAdvanceIndex).toBeGreaterThan(-1);
      expect(metadataIndex).toBeGreaterThan(checkpointAdvanceIndex);
    });

    it('wires hash env vars into the Post OCR results step', () => {
      expect(postStep.env?.OCR_RULES_HASH).toBe('${{ vars.OCR_RULES_HASH }}');
      expect(postStep.env?.OCR_POLICY_HASH).toBe('${{ vars.OCR_POLICY_HASH }}');
      expect(postStep.env?.OCR_WORKFLOW_SCHEMA_HASH).toBe(
        '${{ vars.OCR_WORKFLOW_SCHEMA_HASH }}',
      );
    });
  });
});

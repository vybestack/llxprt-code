/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  asRecord,
  asRecordArray,
  asString,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

type LoadedFunctions = Record<string, (...args: unknown[]) => unknown>;

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
      `${sources.join('\n')}
__FUNCTIONS__ = { ${functionNames.join(', ')} };`,
      sandbox,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load functions [${functionNames.join(', ')}]: ${message}`,
      { cause: err },
    );
  }
  const functions: LoadedFunctions = {};
  for (const name of functionNames) {
    const fn = sandbox[name];
    if (typeof fn === 'function') {
      functions[name] = (...args: unknown[]) => fn(...args);
    }
  }
  return functions;
}

describe('.github/workflows/ocr-review.yml — incremental checkpoints (issue #2649)', () => {
  let codeReviewJob: Record<string, unknown> | undefined;
  let resolveRangeStep: Record<string, unknown> | undefined;
  let resolveRangeRun: string;
  let postStep: Record<string, unknown> | undefined;
  let postScript: string | string[];
  let readCheckpointStep: Record<string, unknown> | undefined;
  let readCheckpointScript: string;
  let reviewStep: Record<string, unknown> | undefined;
  let reviewRun: string;
  let previewStep: Record<string, unknown> | undefined;
  let redactStep: Record<string, unknown> | undefined;
  let redactRun: string;
  let placeholderStep: Record<string, unknown> | undefined;
  let placeholderRun: string;
  let uploadStep: Record<string, unknown> | undefined;
  let metadataFunctions: LoadedFunctions | undefined;

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

  function stepNames(): string[] {
    const steps = asRecordArray(codeReviewJob?.steps) ?? [];
    return steps.map((s) => String(s.name ?? ''));
  }

  function getEnv(
    step: Record<string, unknown> | undefined,
  ): Record<string, string> | undefined {
    const env = step?.env;
    if (typeof env === 'object' && env !== null && !Array.isArray(env)) {
      const raw = asRecord(env);
      const result: Record<string, string> = {};
      for (const [key, val] of Object.entries(raw)) {
        result[key] = String(val);
      }
      return result;
    }
    return undefined;
  }

  function getWith(
    step: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    const withMap = step?.with;
    if (
      typeof withMap === 'object' &&
      withMap !== null &&
      !Array.isArray(withMap)
    ) {
      return asRecord(withMap);
    }
    return undefined;
  }

  beforeAll(() => {
    const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
    const jobs = workflow.jobs;
    codeReviewJob = jobs?.['code-review'] ?? undefined;
    expect(codeReviewJob).toBeTruthy();
    const job = codeReviewJob ?? {};
    resolveRangeStep = stepNamed(job, 'Resolve review range');
    resolveRangeRun = commandText(resolveRangeStep);
    postStep = stepNamed(job, 'Post OCR results');
    postScript = commandText(postStep);
    readCheckpointStep = stepNamed(job, 'Read OCR checkpoint');
    readCheckpointScript = commandText(readCheckpointStep);
    reviewStep = stepNamed(job, 'Run OpenCodeReview');
    reviewRun = commandText(reviewStep);
    previewStep = stepNamed(job, 'Verify review scope includes changed tests');
    redactStep = stepNamed(job, 'Redact OCR diagnostic artifacts');
    redactRun = commandText(redactStep);
    placeholderStep = stepNamed(job, 'Ensure OCR artifact placeholders exist');
    placeholderRun = commandText(placeholderStep);
    uploadStep = stepNamed(job, 'Upload OCR artifacts');
    metadataFunctions = loadFunctions(postScript, [
      'shouldAdvanceCheckpoint',
      'completionStateForResult',
      'ocrObservabilityFromResult',
      'findingDistribution',
      'buildOcrMetadata',
    ]);
  });

  describe('checkpoint advancement and terminal state behavior', () => {
    it('advances only a successful, fully published review with proven file coverage', () => {
      expect(
        metadataFunctions?.shouldAdvanceCheckpoint({
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
        metadataFunctions?.shouldAdvanceCheckpoint({
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
      expect(metadataFunctions?.completionStateForResult('success')).toBe(
        'complete',
      );
      expect(
        metadataFunctions?.completionStateForResult('completed_with_warnings'),
      ).toBe('complete');
      expect(metadataFunctions?.completionStateForResult('skipped')).toBe(
        'complete',
      );
    });

    it('treats per-file errors and unknown result states as partial', () => {
      expect(
        metadataFunctions?.completionStateForResult('completed_with_errors'),
      ).toBe('partial');
      expect(metadataFunctions?.completionStateForResult('unknown')).toBe(
        'partial',
      );
    });

    it('treats synthesized results as partial regardless of status', () => {
      expect(
        metadataFunctions?.completionStateForResult('success', 'synthesized'),
      ).toBe('partial');
      expect(
        metadataFunctions?.completionStateForResult(
          'completed_with_warnings',
          'synthesized',
        ),
      ).toBe('partial');
    });
  });

  describe('metadata assembly behavior', () => {
    it('extracts OCR token, file, warning, and duration observability', () => {
      expect(
        metadataFunctions?.ocrObservabilityFromResult({
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
        metadataFunctions?.findingDistribution(findings, 'severity'),
      ).toEqual({ high: 2, low: 1, unknown: 2 });
    });

    it('emits the complete Phase 0 observability contract', () => {
      const checkpointBefore = completeCheckpoint({
        head_sha: 'previous-head',
      });
      const checkpointAfter = completeCheckpoint({ head_sha: 'current-head' });
      const metadata = asRecord(
        metadataFunctions?.buildOcrMetadata({
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
        }),
      );

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
      const range = asRecord(metadata.range);
      const rangeMode = asString(range.mode);
      expect(rangeMode).toBe('incremental');
      const cumulative = asRecord(range.cumulative);
      expect(cumulative.files).toBe(63);
      const selected = asRecord(range.selected);
      expect(selected.files).toBe(7);
      const ocr = asRecord(metadata.ocr);
      expect(ocr.tokens).toEqual({
        input: 300,
        output: 100,
        cache_read: 50,
        cache_write: 25,
        cache: 75,
        total: 400,
      });
      const findings = asRecord(metadata.findings);
      expect(findings.raw).toBe(75);
      const severityDistribution = asRecord(findings.severity_distribution);
      expect(severityDistribution.high).toBe(4);
      expect(metadata.warnings).toEqual([{ type: 'info', message: 'notice' }]);
      expect(metadata.terminal).toEqual({
        completeness_state: 'complete',
        publication_state: 'complete',
      });
      expect(String(metadata.source_run_url)).toContain('/actions/runs/123');
    });
  });

  describe('workflow wiring', () => {
    it('places checkpoint reading and range resolution after fetch and before artifact initialization', () => {
      const names = stepNames();
      const fetchIndex = names.indexOf('Fetch PR head and compute merge-base');
      const readIndex = names.indexOf('Read OCR checkpoint');
      const resolveIndex = names.indexOf('Resolve review range');
      const initializeIndex = names.indexOf('Initialize OCR artifact files');

      expect(fetchIndex).toBeGreaterThan(-1);
      expect(readIndex).toBeGreaterThan(fetchIndex);
      expect(resolveIndex).toBeGreaterThan(readIndex);
      expect(initializeIndex).toBeGreaterThan(resolveIndex);
      expect(resolveRangeStep?.id).toBe('resolve-range');
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
        Array.isArray(postScript) ? postScript.join('\n') : postScript,
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
      const env = getEnv(readCheckpointStep);
      expect(env?.OCR_BOT_LOGIN).toBe('${{ vars.OCR_BOT_LOGIN }}');
    });

    it('uses find() not findLast() for marker comment lookup (symmetric with reconcileMarkerComment)', () => {
      expect(readCheckpointScript).toContain('comments.find(');
      expect(readCheckpointScript).not.toContain('findLast(');
    });

    it('performs ancestry validation in bash and checks OCR version compatibility', () => {
      expect(resolveRangeStep?.shell).toBe('bash');
      expect(resolveRangeRun).toContain('git merge-base --is-ancestor');
      const env = getEnv(resolveRangeStep);
      expect(env?.OCR_VERSION).toBe('${{ env.OCR_VERSION }}');
      expect(resolveRangeRun).toContain('checkpoint.ocr_version');
      expect(resolveRangeRun).toContain('ocrVersion');
    });

    it('uses the selected range for OCR and changed-test preview scope', () => {
      const effectiveFromSha =
        "${{ github.event_name == 'workflow_dispatch' && env.MERGE_BASE_SHA || steps.resolve-range.outputs.FROM_SHA }}";
      const reviewEnv = getEnv(reviewStep);
      expect(reviewEnv?.FROM_SHA).toBe(effectiveFromSha);
      expect(reviewRun).toContain('--from "$FROM_SHA"');
      expect(reviewRun).not.toContain('--from "$BASE_SHA"');
      const previewEnv = getEnv(previewStep);
      expect(previewEnv?.FROM_SHA).toBe(effectiveFromSha);
    });

    it('skips the expensive OCR command for observable same-head no-op mode', () => {
      const reviewEnv = getEnv(reviewStep);
      expect(reviewEnv?.RANGE_MODE).toBe(
        "${{ github.event_name == 'workflow_dispatch' && 'full' || steps.resolve-range.outputs.RANGE_MODE }}",
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
      const withMap = getWith(uploadStep);
      expect(String(withMap?.path)).toContain('ocr-metadata.json');
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

    it('wires trusted base and hash env vars into range resolution and posting', () => {
      const resolveEnv = getEnv(resolveRangeStep);
      expect(resolveEnv?.API_BASE_SHA).toBe(
        '${{ steps.pr-context.outputs.trusted_base_sha }}',
      );
      const postEnv = getEnv(postStep);
      expect(postEnv?.API_BASE_SHA).toBe(
        '${{ steps.pr-context.outputs.trusted_base_sha }}',
      );
      expect(postEnv?.OCR_RULES_HASH).toBe('${{ vars.OCR_RULES_HASH }}');
      expect(postEnv?.OCR_POLICY_HASH).toBe('${{ vars.OCR_POLICY_HASH }}');
      expect(postEnv?.OCR_WORKFLOW_SCHEMA_HASH).toBe(
        '${{ vars.OCR_WORKFLOW_SCHEMA_HASH }}',
      );
    });
  });
});

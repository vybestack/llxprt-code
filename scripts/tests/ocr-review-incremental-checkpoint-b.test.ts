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
  asStringArray,
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
  let previewFunctions: LoadedFunctions | undefined;

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

  function completeDecision(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ran: true,
      exitCode: 0,
      infrastructureFailure: '',
      policyFailure: '',
      failedFindings: 0,
      completionState: 'complete',
      manifestCompleteness: 'complete',
      publicationState: 'complete',
      previewValidated: true,
      selectedFiles: 7,
      completedFiles: 7,
      ocrCompletedFiles: 7,
      completedFilesValid: true,
      resultSource: 'parsed',
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
    previewFunctions = loadFunctions(commandText(previewStep), [
      'previewSelectionFromOutput',
    ]);
    redactStep = stepNamed(job, 'Redact OCR diagnostic artifacts');
    redactRun = commandText(redactStep);
    placeholderStep = stepNamed(job, 'Ensure OCR artifact placeholders exist');
    placeholderRun = commandText(placeholderStep);
    uploadStep = stepNamed(job, 'Upload OCR artifacts');
    metadataFunctions = loadFunctions(postScript, [
      'shouldAdvanceCheckpoint',
      'completionStateForResult',
      'ocrObservabilityFromResult',
      'eligibleCompletedFilesForReview',
      'normalizeFilePaths',
      'resolveCompleteness',
      'buildCheckpoint',
      'serializeCheckpoint',
      'deserializeCheckpoint',
      'findingDistribution',
      'buildOcrMetadata',
    ]);
  });

  describe('checkpoint advancement and terminal state behavior', () => {
    it('advances only a successful, validated, complete review', () => {
      expect(
        metadataFunctions?.shouldAdvanceCheckpoint(completeDecision()),
      ).toBe(true);
    });

    it.each([
      ['did not run', { ran: false }],
      ['nonzero exit', { exitCode: 1 }],
      ['infrastructure failure', { infrastructureFailure: 'provider failed' }],
      ['policy failure', { policyFailure: 'tests omitted' }],
      ['failed finding publication', { failedFindings: 1 }],
      ['partial OCR result', { completionState: 'partial' }],
      ['partial manifest', { manifestCompleteness: 'partial' }],
      ['unvalidated preview', { previewValidated: false }],
      ['ambiguous publication', { publicationState: 'ambiguous' }],
      ['synthesized result', { resultSource: 'synthesized' }],
      ['zero selected files', { selectedFiles: 0 }],
      ['fewer eligible completions', { completedFiles: 5 }],
      ['more eligible completions', { completedFiles: 8 }],
      ['fewer OCR completions', { ocrCompletedFiles: 5 }],
      ['more OCR completions', { ocrCompletedFiles: 8 }],
      ['invalid OCR completion evidence', { completedFilesValid: false }],
    ])('does not advance when the review %s', (_label, override) => {
      expect(
        metadataFunctions?.shouldAdvanceCheckpoint(completeDecision(override)),
      ).toBe(false);
    });

    it.each([
      ['NaN selected', { selectedFiles: Number.NaN }],
      ['NaN completed', { completedFiles: Number.NaN }],
      ['Infinity selected', { selectedFiles: Number.POSITIVE_INFINITY }],
      ['Infinity completed', { completedFiles: Number.POSITIVE_INFINITY }],
      ['fraction selected', { selectedFiles: 2.5 }],
      ['unsafe completed', { completedFiles: Number.MAX_SAFE_INTEGER + 1 }],
    ])('does not advance when counts are %s', (_label, override) => {
      expect(
        metadataFunctions?.shouldAdvanceCheckpoint(completeDecision(override)),
      ).toBe(false);
    });

    it.each([
      ['numeric string', '3'],
      ['boolean', true],
      ['array', [3]],
      ['fraction', 3.5],
      ['negative', -1],
      ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['NaN', Number.NaN],
      ['missing', undefined],
      ['null', null],
    ])('rejects %s files_reviewed evidence', (_label, filesReviewed) => {
      const observation = asRecord(
        metadataFunctions?.ocrObservabilityFromResult({
          status: 'success',
          summary: { files_reviewed: filesReviewed },
        }),
      );

      expect(observation.completed_files_valid).toBe(false);
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
        completed_files_valid: true,
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

    it('selects the trusted marker comment through the canonical snippet (issue #2860)', () => {
      expect(readCheckpointScript).toContain('github.rest.issues.listComments');
      expect(readCheckpointScript).toContain(
        "const MARKER = '<!-- llxprt-code-ocr-review -->';",
      );
      expect(readCheckpointScript).toContain(
        'github.rest.users.getAuthenticated',
      );
      expect(readCheckpointScript).toContain('newestTrustedMarkerMatching(');
      expect(readCheckpointScript).toContain('canonicalMarkerComment(');
      const fetchMarkerSource = extractFunctionSource(
        Array.isArray(postScript) ? postScript.join('\n') : postScript,
        'fetchMarkerComments',
      );
      expect(fetchMarkerSource).toContain('trustedMarkerComments(');
    });

    it('handles getAuthenticated failure without narrowing trust (issue #2860)', () => {
      expect(readCheckpointScript).toContain(
        'core.warning(`Could not resolve authenticated bot login',
      );
      expect(readCheckpointScript).toContain(
        'resolveTrustedMarkerLogins(apiLogin, process.env.OCR_BOT_LOGIN)',
      );
      const env = getEnv(readCheckpointStep);
      expect(env?.OCR_BOT_LOGIN).toBe('${{ vars.OCR_BOT_LOGIN }}');
    });

    it('uses deterministic canonical selection for marker comment lookup (issue #2860)', () => {
      expect(readCheckpointScript).not.toContain('comments.find(');
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
        'createOrUpdateMarkerComment(summaryWithExistingCheckpoint, isAutomatic)',
      );
      expect(
        postScript.indexOf('const summaryWithExistingCheckpoint'),
      ).toBeLessThan(
        postScript.indexOf(
          'createOrUpdateMarkerComment(summaryWithExistingCheckpoint, isAutomatic)',
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

  describe('preview-eligible checkpoint behavior (issue #2861)', () => {
    const eligiblePaths = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const defaultPreview = [
      'Will review (3):',
      '- [typescript] "src/a.ts"',
      '* src/b.ts +10 -2',
      "'src/c.ts'",
      'Excluded (1):',
      'project-plans/excluded.md',
    ].join('\n');

    function runCheckpointFixture(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      const broadFiles = asStringArray(
        overrides.broadFiles ?? [...eligiblePaths, 'project-plans/excluded.md'],
      );
      const previewOutput = asString(overrides.previewOutput ?? defaultPreview);
      const parsedPreview = asStringArray(
        previewFunctions?.previewSelectionFromOutput(previewOutput),
      );
      const normalizedEligible = asStringArray(
        metadataFunctions?.normalizeFilePaths(parsedPreview),
      );
      const filesReviewed = Reflect.get(
        { filesReviewed: normalizedEligible.length, ...overrides },
        'filesReviewed',
      );
      const ocrStatus = Reflect.get(
        { ocrStatus: 'success', ...overrides },
        'ocrStatus',
      );
      const observation = asRecord(
        metadataFunctions?.ocrObservabilityFromResult({
          status: ocrStatus,
          resultSource: overrides.resultSource ?? 'parsed',
          summary: { files_reviewed: filesReviewed },
        }),
      );
      const ran = overrides.ran ?? true;
      const exitCode = overrides.exitCode ?? 0;
      const previewValidated = overrides.previewValidated ?? true;
      const completedFiles = asStringArray(
        metadataFunctions?.eligibleCompletedFilesForReview({
          ran,
          exitCode,
          ocrStatus,
          previewValidated,
          eligibleFiles: normalizedEligible,
          completedFiles: observation.completed_files,
          completedFilesValid: observation.completed_files_valid,
        }),
      );
      const manifestCompleteness = asString(
        metadataFunctions?.resolveCompleteness({
          ocrExitCode: exitCode,
          ocrStatus,
          selectedFiles: normalizedEligible,
          completedFiles,
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      );
      const decision = completeDecision({
        ran,
        exitCode,
        infrastructureFailure: overrides.infrastructureFailure ?? '',
        policyFailure: overrides.policyFailure ?? '',
        failedFindings: overrides.failedFindings ?? 0,
        completionState: observation.completion_state,
        manifestCompleteness,
        publicationState: overrides.publicationState ?? 'complete',
        previewValidated,
        selectedFiles: normalizedEligible.length,
        completedFiles: completedFiles.length,
        ocrCompletedFiles: observation.completed_files,
        completedFilesValid: observation.completed_files_valid,
        resultSource: observation.result_source,
      });
      const advances = metadataFunctions?.shouldAdvanceCheckpoint(decision);
      const checkpoint = advances
        ? asRecord(
            metadataFunctions?.buildCheckpoint({
              prNumber: 2861,
              headSha: 'head-sha',
              baseSha: 'base-sha',
              mergeBase: 'merge-base',
              reviewedAt: '2026-07-30T12:00:00.000Z',
              runUrl: 'https://github.com/owner/repo/actions/runs/2861',
              ocrVersion: '1.7.17',
              ocrModel: 'test-model',
              rulesHash: 'rules',
              policyHash: 'policy',
              workflowSchemaHash: 'workflow',
              rangeMode: 'incremental',
              eligibleFiles: normalizedEligible,
              completedFiles: completedFiles.length,
              publicationState: 'complete',
            }),
          )
        : null;
      const persistedCheckpoint = checkpoint
        ? asRecord(
            metadataFunctions?.deserializeCheckpoint(
              metadataFunctions?.serializeCheckpoint(checkpoint),
            ),
          )
        : null;
      const metadata = asRecord(
        metadataFunctions?.buildOcrMetadata({
          cumulative: { files: broadFiles.length },
          selected: { files: broadFiles.length },
          checkpointAfter: persistedCheckpoint,
        }),
      );
      return {
        advances,
        broadFiles,
        eligibleFiles: normalizedEligible,
        completedFiles,
        manifestCompleteness,
        persistedCheckpoint,
        metadata,
      };
    }

    it('advances the cohesive 4 broad / 3 eligible fixture and persists exact eligible paths', () => {
      const fixture = runCheckpointFixture();
      const checkpoint = asRecord(fixture.persistedCheckpoint);
      const metadata = asRecord(fixture.metadata);
      const range = asRecord(metadata.range);

      expect({
        advances: fixture.advances,
        eligibleFiles: fixture.eligibleFiles,
        completedFiles: fixture.completedFiles,
        manifestCompleteness: fixture.manifestCompleteness,
        persistedSelected: checkpoint.selected_files,
        persistedCompleted: checkpoint.completed_files,
        persistedEligible: checkpoint.eligible_files,
        broadSelected: asRecord(range.selected).files,
      }).toEqual({
        advances: true,
        eligibleFiles: eligiblePaths,
        completedFiles: eligiblePaths,
        manifestCompleteness: 'complete',
        persistedSelected: 3,
        persistedCompleted: 3,
        persistedEligible: eligiblePaths,
        broadSelected: 4,
      });
    });

    it('advances when broad and preview-eligible sets are equal', () => {
      expect(runCheckpointFixture({ broadFiles: eligiblePaths }).advances).toBe(
        true,
      );
    });

    it.each([
      ['excluded', 'project-plans/excluded.md'],
      ['deleted', 'src/deleted.ts'],
      ['unsupported', 'assets/logo.bin'],
      ['generated', 'dist/generated.js'],
    ])(
      'keeps a %s broad-only path out of eligible persistence',
      (_label, path) => {
        const fixture = runCheckpointFixture({
          broadFiles: [...eligiblePaths, path],
        });
        const checkpoint = asRecord(fixture.persistedCheckpoint);

        expect(checkpoint.eligible_files).toEqual(eligiblePaths);
      },
    );

    it('does not advance zero eligible files', () => {
      const fixture = runCheckpointFixture({
        broadFiles: ['project-plans/excluded.md'],
        previewOutput:
          'Will review (0):\nExcluded (1):\nproject-plans/excluded.md',
        filesReviewed: 0,
      });

      expect(fixture.advances).toBe(false);
    });

    it.each([
      ['declared fewer', 'Will review (1):\nsrc/a.ts\nsrc/b.ts'],
      ['declared more', 'Will review (3):\nsrc/a.ts\nsrc/b.ts'],
      ['duplicate extraction', 'Will review (2):\nsrc/a.ts\nsrc/a.ts'],
      [
        'unsafe count',
        `Will review (${Number.MAX_SAFE_INTEGER + 1}):\nsrc/a.ts`,
      ],
    ])('rejects malformed preview cardinality: %s', (_label, previewOutput) => {
      expect(() => runCheckpointFixture({ previewOutput })).toThrow();
    });

    it.each(['3', true, [3], 3.5, -1, Number.POSITIVE_INFINITY, null])(
      'does not advance coercible or malformed completion evidence %j',
      (filesReviewed) => {
        expect(runCheckpointFixture({ filesReviewed }).advances).toBe(false);
      },
    );

    it.each([2, 4])(
      'does not advance completed scope drift at %i reviewed files',
      (filesReviewed) => {
        const fixture = runCheckpointFixture({ filesReviewed });
        expect({
          advances: fixture.advances,
          manifestCompleteness: fixture.manifestCompleteness,
        }).toEqual({ advances: false, manifestCompleteness: 'partial' });
      },
    );

    it.each([undefined, '', 'completed_with_warnings', 'unknown'])(
      'does not advance missing, malformed, or warning status evidence %j',
      (ocrStatus) => {
        const fixture = runCheckpointFixture({ ocrStatus });
        expect({
          advances: fixture.advances,
          manifestCompleteness: fixture.manifestCompleteness,
        }).toEqual({ advances: false, manifestCompleteness: 'partial' });
      },
    );
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'vm';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  expectContainsAll,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';
import {
  asOptionalRecord,
  asRecord,
  asVmFunction,
} from './typed-test-helpers.ts';
import type { WorkflowStep } from './typed-test-helpers.ts';
import {
  MARKER,
  trustedBot,
  createStore,
  addToStore,
  makePaginatingOctokit,
  makeCore,
  loadFunctionsFromScriptWithGithub,
} from './ocr-trusted-marker-test-helpers.ts';
import type { StoreComment } from './ocr-trusted-marker-test-helpers.ts';

/**
 * Extract a named function from the workflow script and load it into an
 * isolated VM sandbox so it can be called with real inputs. Returns the
 * bound function from the sandbox.
 */
function loadFunctionFromScript(
  script: string,
  funcName: string,
  sandboxGlobals: Record<string, unknown> = {},
): (...args: unknown[]) => unknown {
  const source = extractFunctionSource(script, funcName);
  const sandbox: Record<string, unknown> = {
    Number,
    Math,
    ...sandboxGlobals,
  };
  vm.createContext(sandbox);
  // Run as a function declaration so it binds to the sandbox's global scope.
  vm.runInContext(source, sandbox);
  const fn = sandbox[funcName];
  expect(typeof fn, `${funcName} should be defined after vm execution`).toBe(
    'function',
  );
  return asVmFunction(fn);
}

describe('.github/workflows/ocr-review.yml — issue #2670 upstream features', () => {
  let workflowYml: string;
  let workflow: Record<string, unknown>;
  let codeReviewJob: Record<string, unknown> | undefined;
  let prContextStep: WorkflowStep | undefined;
  let prContextScript: string;
  let configureLlmStep: WorkflowStep | undefined;
  let configureLlmRun: string;
  let reviewStep: WorkflowStep | undefined;
  let reviewRun: string;
  let postStep: WorkflowStep | undefined;
  let postScript: string;

  beforeAll(() => {
    workflowYml = readRootFile(WORKFLOW_PATH);
    const parsed = yaml.load(workflowYml);
    workflow = asRecord(parsed);
    const jobs = asOptionalRecord(asRecord(workflow)['jobs']);
    codeReviewJob = asOptionalRecord(jobs?.['code-review']);
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    prContextStep = stepNamed(codeReviewJob, 'Resolve PR context');
    prContextScript = commandText(prContextStep);
    configureLlmStep = stepNamed(codeReviewJob, 'Configure OCR LLM settings');
    configureLlmRun = commandText(configureLlmStep);
    reviewStep = stepNamed(codeReviewJob, 'Run OpenCodeReview');
    reviewRun = commandText(reviewStep);
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
  });

  // -----------------------------------------------------------------------
  // Feature 1: --background flag for business context
  // -----------------------------------------------------------------------
  describe('Feature 1: --background business context', () => {
    it('resolves PR title and truncated body in the pr-context step', () => {
      expectContainsAll(prContextScript, [
        "core.setOutput('pr_title'",
        "core.setOutput('pr_body'",
        'pr.title',
        'pr.body',
      ]);
    });

    it('passes PR title and body as env to the review step', () => {
      expect(reviewStep?.env?.PR_TITLE).toBe(
        '${{ steps.pr-context.outputs.pr_title }}',
      );
      expect(reviewStep?.env?.PR_BODY).toBe(
        '${{ steps.pr-context.outputs.pr_body }}',
      );
      expect(reviewStep?.env?.OCR_BACKGROUND).toBe(
        '${{ vars.OCR_BACKGROUND }}',
      );
    });

    it('conditionally adds --background when OCR_BACKGROUND is true', () => {
      expectContainsAll(reviewRun, [
        'OCR_BACKGROUND',
        "'true'",
        '--background',
        'PR_TITLE',
        'PR_BODY',
      ]);
    });

    it('does not pass --background when OCR_BACKGROUND is unset', () => {
      // --background must only appear inside the OCR_BACKGROUND='true'
      // conditional block, never in the base ocr review command.
      const NEWLINE = String.fromCharCode(10);
      const ocrReviewLine = reviewRun
        .split(NEWLINE)
        .find((line) => line.includes('ocr review'));
      expect(ocrReviewLine).toBeDefined();
      expect(ocrReviewLine).not.toContain('--background');
      // --background must be inside a conditional gated on OCR_BACKGROUND.
      const backgroundLines = reviewRun
        .split(NEWLINE)
        .filter((line) => line.includes('--background'));
      expect(backgroundLines.length).toBeGreaterThan(0);
      // Every --background reference must be inside the if-block.
      expect(reviewRun).toMatch(/OCR_BACKGROUND.*'true'/);
    });

    it('guards --background against empty title and body (issue #2670)', () => {
      // Issue 7: only append --background if at least title or body is nonempty
      expect(reviewRun).toContain('--background "$BACKGROUND_TEXT"');
      expect(reviewRun).toMatch(
        /\[ -n "\$\{PR_TITLE\}" \] \|\| \[ -n "\$\{PR_BODY\}" \]/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Feature 2: llm_extra_body with thinking disabled by default
  // -----------------------------------------------------------------------
  describe('Feature 2: llm_extra_body thinking disabled', () => {
    it('has a dedicated Configure OCR LLM settings step', () => {
      expect(configureLlmStep).toBeTruthy();
      expect(configureLlmStep?.['shell']).toBe('bash');
    });

    it('sets llm.extra_body with thinking disabled by default', () => {
      expectContainsAll(configureLlmRun, [
        'ocr config set llm.extra_body',
        '{"thinking": {"type": "disabled"}}',
      ]);
    });

    it('allows overriding via OCR_LLM_EXTRA_BODY repository variable', () => {
      expect(configureLlmStep?.env?.OCR_LLM_EXTRA_BODY).toBe(
        '${{ vars.OCR_LLM_EXTRA_BODY }}',
      );
      expect(configureLlmRun).toContain('OCR_LLM_EXTRA_BODY');
    });

    it('uses the exit-code guard and infrastructure-failure pattern', () => {
      expectContainsAll(configureLlmRun, [
        'if [ -s ocr-exit-code.txt ]; then',
        '. ./ocr-workflow-helpers.sh',
        'mark_infrastructure_failure',
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Feature 7: language configuration
  // -----------------------------------------------------------------------
  describe('Feature 7: language configuration', () => {
    it('sets review language with English default', () => {
      expectContainsAll(configureLlmRun, [
        'ocr config set language',
        'English',
      ]);
    });

    it('allows overriding via OCR_REVIEW_LANGUAGE repository variable', () => {
      expect(configureLlmStep?.env?.OCR_REVIEW_LANGUAGE).toBe(
        '${{ vars.OCR_REVIEW_LANGUAGE }}',
      );
      expect(configureLlmRun).toContain('OCR_REVIEW_LANGUAGE');
    });
  });

  // -----------------------------------------------------------------------
  // Feature 3: Incremental comment posting (IoU overlap dedup)
  // -----------------------------------------------------------------------
  describe('Feature 3: incremental IoU overlap dedup', () => {
    it('exposes incremental mode gated behind OCR_INCREMENTAL variable', () => {
      expect(postStep?.env?.['OCR_INCREMENTAL']).toBe(
        '${{ vars.OCR_INCREMENTAL }}',
      );
      expect(postScript).toContain('OCR_INCREMENTAL');
    });

    it('exposes configurable IoU overlap threshold', () => {
      expect(postStep?.env?.['OCR_INCREMENTAL_OVERLAP_THRESHOLD']).toBe(
        '${{ vars.OCR_INCREMENTAL_OVERLAP_THRESHOLD }}',
      );
      expect(postScript).toContain('OCR_INCREMENTAL_OVERLAP_THRESHOLD');
    });

    it('implements IoU overlap functions in the posting step', () => {
      expectContainsAll(postScript, [
        'function lineSpan(',
        'function sameCommentSpan(',
        'function overlapsHistory(',
        'function resolveThreshold(',
      ]);
    });

    it('uses IoU intersection-over-union for multi-line overlap', () => {
      expect(postScript).toContain('overlap / union');
    });

    it('complements rather than replaces content-based dedup', () => {
      // Content-based dedup must still be present (deduplicationKey function)
      expect(postScript).toContain('function deduplicationKey(');
      expect(postScript).toContain('function deduplicateFindings(');
    });

    // ----- Behavioral tests: lineSpan via vm execution -----

    it('lineSpan: single-line comment returns { multiline: false }', () => {
      const lineSpan = loadFunctionFromScript(postScript, 'lineSpan');
      expect(lineSpan({ line: 5, start_line: 5 })).toEqual({
        start: 5,
        end: 5,
        multiline: false,
        lineless: false,
      });
    });

    it('lineSpan: multi-line comment returns { multiline: true }', () => {
      const lineSpan = loadFunctionFromScript(postScript, 'lineSpan');
      expect(lineSpan({ line: 10, start_line: 5 })).toEqual({
        start: 5,
        end: 10,
        multiline: true,
        lineless: false,
      });
    });

    it('lineSpan: reversed lines are normalized to ascending order', () => {
      const lineSpan = loadFunctionFromScript(postScript, 'lineSpan');
      expect(lineSpan({ line: 5, start_line: 10 })).toEqual({
        start: 5,
        end: 10,
        multiline: true,
        lineless: false,
      });
    });

    it('lineSpan: missing line numbers returns { lineless: true }', () => {
      const lineSpan = loadFunctionFromScript(postScript, 'lineSpan');
      expect(lineSpan({ line: 0, start_line: 0 })).toEqual({
        start: -1,
        end: -1,
        multiline: false,
        lineless: true,
      });
    });

    // ----- Behavioral tests: sameCommentSpan via vm execution -----

    it('sameCommentSpan: single-line same line returns true', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      const a = { start: 5, end: 5, multiline: false };
      const b = { start: 5, end: 5, multiline: false };
      expect(sameCommentSpan(a, b, 0.6)).toBe(true);
    });

    it('sameCommentSpan: single-line different line returns false', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      const a = { start: 5, end: 5, multiline: false };
      const b = { start: 7, end: 7, multiline: false };
      expect(sameCommentSpan(a, b, 0.6)).toBe(false);
    });

    it('sameCommentSpan: single-line vs multi-line returns false', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      const a = { start: 5, end: 5, multiline: false };
      const b = { start: 5, end: 10, multiline: true };
      expect(sameCommentSpan(a, b, 0.6)).toBe(false);
    });

    it('sameCommentSpan: multi-line identical spans returns true', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      const a = { start: 5, end: 10, multiline: true };
      const b = { start: 5, end: 10, multiline: true };
      expect(sameCommentSpan(a, b, 0.6)).toBe(true);
    });

    it('sameCommentSpan: multi-line no overlap returns false', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      const a = { start: 5, end: 10, multiline: true };
      const b = { start: 20, end: 30, multiline: true };
      expect(sameCommentSpan(a, b, 0.6)).toBe(false);
    });

    it('sameCommentSpan: multi-line partial overlap with IoU exactly at threshold returns false (strict >)', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      // [1,6] vs [1,10]: overlap = 6, union = 10, IoU = 0.6 exactly.
      // The comparison is strict (>) so equality must NOT match.
      const a = { start: 1, end: 6, multiline: true };
      const b = { start: 1, end: 10, multiline: true };
      expect(sameCommentSpan(a, b, 0.6)).toBe(false);
    });

    it('sameCommentSpan: multi-line partial overlap with IoU above threshold returns true', () => {
      const sameCommentSpan = loadFunctionFromScript(
        postScript,
        'sameCommentSpan',
      );
      // [1,7] vs [1,10]: overlap = 7, union = 10, IoU = 0.7 > 0.6.
      const a = { start: 1, end: 7, multiline: true };
      const b = { start: 1, end: 10, multiline: true };
      expect(sameCommentSpan(a, b, 0.6)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Feature 3 (cont.): resolveThreshold behavioral tests
  // -----------------------------------------------------------------------
  describe('Feature 3: resolveThreshold validation (issue #2670)', () => {
    const cases = [
      { input: undefined, expected: 0.6, label: 'default (no env)' },
      { input: '0.8', expected: 0.8, label: 'valid value' },
      { input: 'garbage', expected: 0.6, label: 'invalid garbage string' },
      { input: '-1', expected: 0.6, label: 'negative value' },
      { input: '0', expected: 0.6, label: 'zero' },
      { input: '2', expected: 0.6, label: 'greater than 1' },
      { input: '', expected: 0.6, label: 'empty string' },
    ];

    for (const { input, expected, label } of cases) {
      it(`resolveThreshold(${JSON.stringify(input)}) returns ${expected} (${label})`, () => {
        const resolveThreshold = loadFunctionFromScript(
          postScript,
          'resolveThreshold',
        );
        expect(resolveThreshold(input)).toBe(expected);
      });
    }

    it('uses resolveThreshold for overlapThreshold (not raw Number())', () => {
      // Issue 3: the overlapThreshold must be derived via resolveThreshold,
      // not the previous Number(process.env.X || '0.6') pattern.
      expect(postScript).toContain(
        'resolveThreshold(process.env.OCR_INCREMENTAL_OVERLAP_THRESHOLD)',
      );
      expect(postScript).not.toContain(
        "Number(process.env.OCR_INCREMENTAL_OVERLAP_THRESHOLD || '0.6')",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Feature 3 (cont.): bot identity validation
  // -----------------------------------------------------------------------
  describe('Feature 3: bot identity validation for history dedup (issue #2670)', () => {
    it('feeds the authenticated login into the canonical trusted set as an additional source (issue #2860)', () => {
      expectContainsAll(postScript, [
        'github.rest.users.getAuthenticated',
        'let apiLogin',
        'apiLogin = botUser.login',
        'resolveTrustedMarkerLogins(apiLogin, process.env.OCR_BOT_LOGIN)',
      ]);
    });

    it('existingReviewCommentSpans filters by trusted canonical author rule (issue #2860)', () => {
      const source = extractFunctionSource(
        postScript,
        'existingReviewCommentSpans',
      );
      // The canonical snippet's isTrustedMarkerComment replaces the old
      // exact-login predicate. side === 'RIGHT' is still required.
      expect(source).toContain('isTrustedMarkerComment(');
      expect(source).toContain('trustedLogins');
      expect(source).toContain('INLINE_MARKER');
      expect(source).toContain("comment.side === 'RIGHT'");
      // Must NOT restrict to the current head SHA (cross-revision dedup).
      expect(source).not.toContain('commit_id === headSha');
      // The old exact-login predicate must be gone.
      expect(source).not.toContain('botLogin !==');
      expect(source).not.toContain('comment.user.login === botLogin');
    });

    it('existingInlineCommentKeys filters by trusted canonical author rule (issue #2860)', () => {
      const source = extractFunctionSource(
        postScript,
        'existingInlineCommentKeys',
      );
      expect(source).toContain('isTrustedMarkerComment(');
      expect(source).toContain('trustedLogins');
      expect(source).toContain('INLINE_MARKER');
      expect(source).toContain("comment.side === 'RIGHT'");
      expect(source).not.toContain('commit_id === headSha');
      expect(source).not.toContain('botLogin !==');
      expect(source).not.toContain('comment.user.login === botLogin');
    });

    it('history dedup no longer depends on the current head SHA', () => {
      // Cross-revision dedup: removing the commit_id === headSha filter means
      // dedup fires across pushes, not just manual re-triggers.
      const spansSource = extractFunctionSource(
        postScript,
        'existingReviewCommentSpans',
      );
      const keysSource = extractFunctionSource(
        postScript,
        'existingInlineCommentKeys',
      );
      expect(spansSource).not.toContain('headSha');
      expect(keysSource).not.toContain('headSha');
    });
  });

  // -----------------------------------------------------------------------
  // Feature 4: Configurable LLM timeout
  // -----------------------------------------------------------------------
  describe('Feature 4: configurable LLM timeout', () => {
    it('uses OCR_REVIEW_TIMEOUT with default 30', () => {
      expect(reviewStep?.env?.OCR_REVIEW_TIMEOUT).toBe(
        '${{ vars.OCR_REVIEW_TIMEOUT }}',
      );
      expectContainsAll(reviewRun, ['OCR_REVIEW_TIMEOUT', ':-30']);
    });

    it('passes the configurable timeout to ocr review', () => {
      expect(reviewRun).toContain('--timeout "$REVIEW_TIMEOUT"');
    });

    it('does not hardcode --timeout 30 as a standalone value', () => {
      // The run script must use the $REVIEW_TIMEOUT variable, not a
      // hardcoded "--timeout 30" literal.
      expect(reviewRun).not.toContain('--timeout 30');
    });

    it('validates OCR_REVIEW_TIMEOUT as a positive integer (issue #2670)', () => {
      // Issue 6: the timeout must be validated as a positive integer with a
      // fallback to 30 for non-numeric, empty, or zero values.
      expectContainsAll(reviewRun, [
        'REVIEW_TIMEOUT="${OCR_REVIEW_TIMEOUT:-30}"',
        'case "$REVIEW_TIMEOUT" in',
        "''|*[!0-9]*|0)",
        'REVIEW_TIMEOUT=30',
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Feature 5: Structured step outputs
  // -----------------------------------------------------------------------
  describe('Feature 5: structured comment-count outputs', () => {
    it('exposes structured outputs on the code-review job', () => {
      const outputs = asRecord(codeReviewJob?.['outputs'] ?? {});
      expect(outputs['comments_total']).toBe(
        '${{ steps.post-ocr-results.outputs.comments_total }}',
      );
      expect(outputs['comments_inline']).toBe(
        '${{ steps.post-ocr-results.outputs.comments_inline }}',
      );
      expect(outputs['comments_skipped']).toBe(
        '${{ steps.post-ocr-results.outputs.comments_skipped }}',
      );
      expect(outputs['comments_failed']).toBe(
        '${{ steps.post-ocr-results.outputs.comments_failed }}',
      );
      expect(outputs['summary_comment_url']).toBe(
        '${{ steps.post-ocr-results.outputs.summary_comment_url }}',
      );
    });

    it('gives the post step an id for output propagation', () => {
      expect(postStep?.['id']).toBe('post-ocr-results');
    });

    it('sets structured outputs in the posting script', () => {
      expectContainsAll(postScript, [
        "core.setOutput('comments_total'",
        "core.setOutput('comments_inline'",
        "core.setOutput('comments_skipped'",
        "core.setOutput('comments_failed'",
        "core.setOutput('summary_comment_url'",
      ]);
    });

    it('comments_skipped counts only inline overlap + exact-history dedup (issue #2670)', () => {
      // Issue 4: comments_skipped must not include suppressedDuplicateCount
      // (which covers ALL findings, including lineless). It should count only
      // inline comments skipped by incremental overlap and exact-key history.
      expect(postScript).toContain(
        'const commentsSkipped = skippedOverlapCount + skippedExactHistoryCount;',
      );
      expect(postScript).toContain(
        "core.setOutput('already_resolved', String(skippedOverlapCount));",
      );
      expect(postScript).toContain('let skippedExactHistoryCount = 0;');
      expect(postScript).toContain('beforeExactFilter');
      // Phase 2 (#2649): the exact-history count is computed from the
      // pairsToPost array (now that inline comments carry finding refs).
      expect(postScript).toContain(
        'skippedExactHistoryCount = beforeExactFilter - pairsToPost.length;',
      );
      // The old mixing formula must be gone.
      expect(postScript).not.toContain(
        'const commentsSkipped = suppressedDuplicateCount + skippedOverlapCount;',
      );
    });

    it('still reports suppressedDuplicateCount in the summary text', () => {
      expect(postScript).toContain(
        'Suppressed ${suppressedDuplicateCount} exact duplicate finding(s).',
      );
    });

    it('re-fetches marker comments in fetchMarkerComments (issue #2670)', () => {
      // Issue 5: fetchMarkerComments must paginate issues.listComments and
      // delegate to trustedMarkerComments instead of reusing stale arrays.
      expect(postScript).toContain('function fetchMarkerComments()');
      const fetchSource = extractFunctionSource(
        postScript,
        'fetchMarkerComments',
      );
      expect(fetchSource).toContain('github.paginate');
      expect(fetchSource).toContain('trustedMarkerComments(');
    });

    it('counts rediscovered fallback duplicates as skipped, not posted (issue #2670)', () => {
      // CodeRabbit: fallback dedup over-reports comments_inline.
      // When a comment is rediscovered after batch uncertainty, it must
      // increment skippedExactHistoryCount, not postedInline.
      expect(postScript).toContain('skippedExactHistoryCount += 1;');
      // The rediscovery path must use skippedExactHistoryCount, not postedInline.
      // Check that "batch post uncertainty" is followed (within a few chars)
      // by skippedExactHistoryCount, not postedInline.
      const uncertaintyIdx = postScript.indexOf('after batch post uncertainty');
      expect(uncertaintyIdx).toBeGreaterThan(-1);
      const afterUncertainty = postScript.substring(
        uncertaintyIdx,
        uncertaintyIdx + 200,
      );
      expect(afterUncertainty).toContain('skippedExactHistoryCount');
      expect(afterUncertainty).not.toContain('postedInline');
    });

    it('reconciles marker comments after successful create (issue #2670)', () => {
      // CodeRabbit: successful concurrent creates can leave duplicate sticky
      // summaries. The createComment success path must also re-fetch and
      // reconcile via deleteDuplicateMarkerComments.
      const createFnSource = extractFunctionSource(
        postScript,
        'createOrUpdateMarkerComment',
      );
      // After createComment returns successfully, post-create reconciliation
      // must re-fetch and delete duplicates.
      expect(createFnSource).toContain('fetchMarkerComments()');
      expect(createFnSource).toContain('deleteDuplicateMarkerComments');
    });

    it('O5: createOrUpdateMarkerComment reconciles on the failed-create retry path', async () => {
      // The failed-create retry path is reached when:
      //   1. The initial fetch finds NO existing marker (existing is null)
      //   2. createComment throws
      //   3. The catch block re-fetches — and THIS time finds markers
      //      (simulating a race where another process posted a marker
      //      between the initial fetch and the create attempt)
      // The retry path must then select the canonical, update it, and
      // delete duplicates — proving reconciliation is not limited to the
      // success path.
      const store = createStore();
      // Markers are added lazily — the first fetch returns empty, then
      // they appear (simulating the race).
      const canonicalMarker: StoreComment = {
        id: 100,
        body: `${MARKER}\nold\n<!-- ocr-auto-count:1 -->`,
        user: trustedBot('github-actions[bot]'),
      };
      const duplicateMarker: StoreComment = {
        id: 200,
        body: `${MARKER}\nduplicate\n<!-- ocr-auto-count:0 -->`,
        user: trustedBot('github-actions[bot]'),
      };
      let raceTriggered = false;
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      // Override listComments to return empty on the first call (no existing
      // marker), then populate the store (simulating a concurrent create)
      // before createComment throws. Subsequent fetches return the markers.
      const issues = (github['rest'] as Record<string, unknown>)[
        'issues'
      ] as Record<string, unknown>;
      issues['listComments'] = async (
        opts: Record<string, unknown>,
      ): Promise<{ data: StoreComment[]; status: number }> => {
        if (!raceTriggered) {
          return { data: [], status: 200 };
        }
        // After the race is triggered, return the markers from the store
        const all = [...store.comments.values()].sort((a, b) => a.id - b.id);
        const pp = Math.max(1, Number(opts['per_page'] ?? 100) || 100);
        const page = Math.max(1, Number(opts['page'] ?? 1) || 1);
        const start = (page - 1) * pp;
        return { data: all.slice(start, start + pp), status: 200 };
      };
      issues['createComment'] = async (): Promise<never> => {
        // Simulate a race: markers appear between the initial fetch and
        // this create attempt. Then the create fails.
        raceTriggered = true;
        addToStore(store, canonicalMarker);
        addToStore(store, duplicateMarker);
        throw new Error('createComment failed');
      };
      const core = makeCore(warnings);
      const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };
      const env: Record<string, string> = {
        PR_NUMBER: '42',
        IS_AUTOMATIC: 'false',
      };
      const fns = loadFunctionsFromScriptWithGithub(
        postScript,
        [
          'fetchMarkerComments',
          'selectCanonicalMarker',
          'applyNonRegressingCount',
          'resolveNonRegressingCount',
          'deleteDuplicateMarkerComments',
          'createOrUpdateMarkerComment',
        ],
        github,
        core,
        context,
        env,
        warnings,
      );
      const summary = `${MARKER}\n## Updated\n<!-- ocr-auto-count:2 -->`;
      const result = asRecord(
        await asVmFunction(fns['createOrUpdateMarkerComment'])(summary, false),
      );
      // The retry path returned the canonical surviving comment
      expect(result['id']).toBe(100);
      // The store's surviving comment was updated by the retry path
      const surviving = store.comments.get(100);
      expect(surviving?.body).toContain('<!-- ocr-auto-count:2 -->');
      // The duplicate (id 200) must have been deleted by the retry path.
      // This assertion fails if the retry path stops calling cleanup.
      expect(store.deletedIds.has(200)).toBe(true);
      expect(store.comments.has(200)).toBe(false);
      // Only the canonical (id 100) survives
      const survivingMarkers = [...store.comments.values()].filter((c) =>
        c.body.includes(MARKER),
      );
      expect(survivingMarkers).toHaveLength(1);
      expect(survivingMarkers[0]?.id).toBe(100);
    });
  });
});

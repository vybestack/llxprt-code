/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.ts';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  asVmFunction,
} from './typed-test-helpers.ts';
import type { WorkflowJob } from './typed-test-helpers.ts';
import {
  MARKER,
  INLINE_MARKER,
  FULL_HEAD_SHA,
  FULL_BASE_SHA,
  checkpointMarkerBody,
  trustedBot,
  userAuthor,
  markerComment,
  type FakeComment,
  loadScripts,
  scriptOf,
  createStore,
  addToStore,
  makePaginatingOctokit,
  sandboxGlobals,
  runScript,
  makeCore,
  executeCheckpointReader,
  executeAutoGate,
  loadFunctionsFromScriptWithGithub,
} from './ocr-trusted-marker-test-helpers.ts';

describe('.github/workflows/ocr-review.yml — OCR trusted marker ownership (issue #2860) — part B', () => {
  let autoReviewJob: WorkflowJob | undefined;
  let postSuspensionJob: WorkflowJob | undefined;
  let codeReviewJob: WorkflowJob | undefined;
  let autoGateScript: string;
  let postSuspensionScript: string;
  let readCheckpointScript: string;
  let postResultsScript: string;
  let resolveRangeRun: string;

  beforeAll(() => {
    const loaded = loadScripts();
    autoReviewJob = loaded.jobs['auto-review-gate'];
    postSuspensionJob = loaded.jobs['post-suspension'];
    codeReviewJob = loaded.jobs['code-review'];
    if (!autoReviewJob || !postSuspensionJob || !codeReviewJob) {
      throw new Error('workflow should contain all three jobs');
    }
    autoGateScript = scriptOf(autoReviewJob, 'Decide auto-review limit');
    postSuspensionScript = scriptOf(
      postSuspensionJob,
      'Post OCR suspension message',
    );
    readCheckpointScript = scriptOf(codeReviewJob, 'Read OCR checkpoint');
    postResultsScript = scriptOf(codeReviewJob, 'Post OCR results');
    resolveRangeRun = commandText(
      stepNamed(codeReviewJob, 'Resolve review range'),
    );
  });

  // ---- AM8: duplicate trusted markers reconcile deterministically ----

  describe('AM8 — duplicate trusted markers reconcile: oldest retained, max count, newest checkpoint', () => {
    it('results-poster: real selectCanonicalMarker + deleteDuplicateMarkerComments — oldest survives, newer deleted, body has max count', async () => {
      const store = createStore();
      addToStore(store, {
        id: 100,
        body: `${MARKER}\n<!-- ocr-auto-count:2 -->`,
        user: trustedBot('github-actions[bot]'),
      });
      addToStore(store, {
        id: 200,
        body: `${MARKER}\n<!-- ocr-auto-count:0 -->`,
        user: trustedBot('github-actions[bot]'),
      });
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings);
      const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };
      const env: Record<string, string> = {
        PR_NUMBER: '42',
        IS_AUTOMATIC: 'false',
      };
      const fns = loadFunctionsFromScriptWithGithub(
        postResultsScript,
        [
          'fetchMarkerComments',
          'selectCanonicalMarker',
          'deleteDuplicateMarkerComments',
          'resolveHiddenAutoCount',
        ],
        github,
        core,
        context,
        env,
        warnings,
      );

      // Execute the real fetchMarkerComments against the store
      const markerComments = asArray(
        await asVmFunction(fns['fetchMarkerComments'])(),
      );
      expect(markerComments.length).toBe(2);

      // Real selectCanonicalMarker — picks oldest (id 100)
      const canonical = asRecord(
        asVmFunction(fns['selectCanonicalMarker'])(markerComments),
      );
      expect(canonical['id']).toBe(100);

      // Real resolveHiddenAutoCount — max count is 2
      const maxCount = asNumber(
        asVmFunction(fns['resolveHiddenAutoCount'])(
          markerComments,
          new Set(['github-actions[bot]']),
          MARKER,
        ),
      );
      expect(maxCount).toBe(2);

      // Real deleteDuplicateMarkerComments — deletes id 200, keeps id 100
      await asVmFunction(fns['deleteDuplicateMarkerComments'])(
        markerComments,
        100,
      );

      // Assert against the store: id 100 survives, id 200 is deleted
      expect(store.comments.has(100)).toBe(true);
      expect(store.comments.has(200)).toBe(false);
      expect(store.deletedIds.has(200)).toBe(true);
      expect(store.deletedIds.has(100)).toBe(false);
    });

    it('B3: real createOrUpdateMarkerComment — persists before deleting, never deletes canonical', async () => {
      const store = createStore();
      addToStore(store, {
        id: 100,
        body: `${MARKER}\nold\n<!-- ocr-auto-count:2 -->`,
        user: trustedBot('github-actions[bot]'),
      });
      addToStore(store, {
        id: 200,
        body: `${MARKER}\nduplicate\n<!-- ocr-auto-count:0 -->`,
        user: trustedBot('github-actions[bot]'),
      });
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings);
      const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };
      const env: Record<string, string> = {
        PR_NUMBER: '42',
        IS_AUTOMATIC: 'false',
      };
      const fns = loadFunctionsFromScriptWithGithub(
        postResultsScript,
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

      const summary = `${MARKER}\n## Updated\n<!-- ocr-auto-count:3 -->`;
      const result = asRecord(
        await asVmFunction(fns['createOrUpdateMarkerComment'])(summary, false),
      );
      // Must return the canonical (id 100), not a deleted comment
      expect(result['id']).toBe(100);
      // Store: id 100 survived with updated body, id 200 deleted
      expect(store.comments.has(100)).toBe(true);
      expect(store.comments.has(200)).toBe(false);
      const surviving = store.comments.get(100);
      expect(surviving?.body).toContain('<!-- ocr-auto-count:3 -->');
    });

    it('checkpoint reader: selects checkpoint from id 200 even though canonical is id 100', async () => {
      const result = await executeCheckpointReader({
        script: readCheckpointScript,
        listComments: [
          markerComment(100, `${MARKER}\n<!-- ocr-auto-count:2 -->`),
          markerComment(200, checkpointMarkerBody(FULL_HEAD_SHA)),
        ],
      });
      expect(result.outputs['CHECKPOINT_FOUND']).toBe('true');
      expect(result.outputs['CHECKPOINT_VALID']).toBe('true');
      expect(result.outputs['CHECKPOINT_HEAD']).toBe(FULL_HEAD_SHA);
    });

    it('I2: older marker with complete checkpoint selected over newer marker with {}', async () => {
      const emptyCheckpointBody = `${MARKER}\n<!-- ocr-checkpoint:e30= -->`;
      const result = await executeCheckpointReader({
        script: readCheckpointScript,
        listComments: [
          markerComment(100, checkpointMarkerBody(FULL_HEAD_SHA)),
          markerComment(200, emptyCheckpointBody),
        ],
      });
      expect(result.outputs['CHECKPOINT_FOUND']).toBe('true');
      expect(result.outputs['CHECKPOINT_VALID']).toBe('true');
      expect(result.outputs['CHECKPOINT_HEAD']).toBe(FULL_HEAD_SHA);
    });

    it('B2: post-suspension — real suspension path carries checkpoint from newer duplicate into surviving body', async () => {
      const store = createStore();
      const checkpointComment = `<!-- ocr-checkpoint:${Buffer.from(
        JSON.stringify({
          schema: 1,
          head_sha: FULL_HEAD_SHA,
          base_sha: FULL_BASE_SHA,
          completion_state: 'complete',
        }),
        'utf8',
      ).toString('base64')} -->`;
      addToStore(store, {
        id: 100,
        body: `${MARKER}\nold body\n<!-- ocr-auto-count:3 -->`,
        user: trustedBot('github-actions[bot]'),
      });
      addToStore(store, {
        id: 200,
        body: `${MARKER}\nduplicate\n<!-- ocr-auto-count:0 -->\n${checkpointComment}`,
        user: trustedBot('github-actions[bot]'),
      });
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings);
      const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };

      const env: Record<string, string> = {
        PR_NUMBER: '42',
        CURRENT_COUNT: '3',
        OCR_AUTO_REVIEW_LIMIT: '2',
        OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
        OCR_BOT_LOGIN: '',
      };
      // Run the real suspension script against the store
      await runScript(
        postSuspensionScript,
        github,
        core,
        context,
        env,
        warnings,
      );
      // Assert the surviving BODY (not just ids)
      expect(store.comments.has(100)).toBe(true);
      expect(store.comments.has(200)).toBe(false);
      const surviving = store.comments.get(100);
      // The checkpoint from id 200 must be carried into the surviving body
      expect(surviving?.body).toContain('ocr-checkpoint:');
      // The max count (3) must be preserved
      expect(surviving?.body).toContain('<!-- ocr-auto-count:3 -->');
    });
  });

  // ---- AM9: checkpoint rediscovered, resolveReviewRange selects incremental ----

  describe('AM9 — checkpoint reader outputs fed through real range-resolution glue', () => {
    /**
     * Execute the REAL checkpoint reader script to produce real outputs,
     * then feed those outputs into the REAL `resolveReviewRange` heredoc
     * JavaScript extracted from the `Resolve review range` step.
     */
    async function runReaderThenResolver(
      listComments: FakeComment[],
    ): Promise<Record<string, unknown>> {
      // Step 1: run the real checkpoint reader
      const readerResult = await executeCheckpointReader({
        script: readCheckpointScript,
        listComments,
        ocrBotLogin: '',
        getAuthenticatedThrows: new Error(
          'Resource not accessible by integration',
        ),
      });

      // Step 2: extract the heredoc JavaScript from the Resolve review range step
      // The step uses `node <<'NODE' ... NODE` — extract the JS between markers.
      const NL = String.fromCharCode(10);
      const nodeStart = resolveRangeRun.indexOf("node <<'NODE'");
      expect(nodeStart).toBeGreaterThanOrEqual(0);
      const heredocStart = resolveRangeRun.indexOf(NL, nodeStart) + 1;
      const nodeEnd = resolveRangeRun.indexOf(NL + 'NODE', heredocStart);
      expect(nodeEnd).toBeGreaterThan(heredocStart);
      const heredocJs = resolveRangeRun.slice(heredocStart, nodeEnd);

      // Step 3: execute the real heredoc JS with process.env populated
      // from the reader's outputs.
      const env: Record<string, string> = {
        EVENT_NAME: 'pull_request_target',
        EVENT_ACTION: 'synchronize',
        MERGE_BASE: 'merge-base-sha',
        HEAD_SHA: 'current-head-sha',
        API_BASE_SHA: FULL_BASE_SHA,
        OCR_VERSION: '1.7.17',
        CHECKPOINT_FOUND: readerResult.outputs['CHECKPOINT_FOUND'] || 'false',
        CHECKPOINT_VALID: readerResult.outputs['CHECKPOINT_VALID'] || 'false',
        CHECKPOINT_SCHEMA: readerResult.outputs['CHECKPOINT_SCHEMA'] || '',
        CHECKPOINT_HEAD: readerResult.outputs['CHECKPOINT_HEAD'] || '',
        CHECKPOINT_BASE_SHA: readerResult.outputs['CHECKPOINT_BASE_SHA'] || '',
        CHECKPOINT_COMPLETION:
          readerResult.outputs['CHECKPOINT_COMPLETION'] || '',
        CHECKPOINT_VERSION: readerResult.outputs['CHECKPOINT_VERSION'] || '',
        CHECKPOINT_MODEL: readerResult.outputs['CHECKPOINT_MODEL'] || '',
        CHECKPOINT_RULES_HASH:
          readerResult.outputs['CHECKPOINT_RULES_HASH'] || '',
        CHECKPOINT_POLICY_HASH:
          readerResult.outputs['CHECKPOINT_POLICY_HASH'] || '',
        CHECKPOINT_WORKFLOW_SCHEMA_HASH:
          readerResult.outputs['CHECKPOINT_WORKFLOW_SCHEMA_HASH'] || '',
        OCR_MODEL: '',
        OCR_RULES_HASH: '',
        OCR_POLICY_HASH: '',
        OCR_WORKFLOW_SCHEMA_HASH: '',
        IS_ANCESTOR: 'true',
      };
      const sandbox: Record<string, unknown> = {
        ...sandboxGlobals([]),
        process: { env },
        console: { log: (): void => {}, error: (): void => {} },
      };
      // The heredoc JS logs the result fields to stdout via console.log.
      // Capture them.
      const lines: string[] = [];
      sandbox['console'] = {
        log: (...args: unknown[]): void => {
          lines.push(args.map(String).join(' '));
        },
        error: (): void => {},
      };
      vm.runInNewContext(heredocJs, sandbox);
      // The heredoc outputs: FROM_SHA, RANGE_MODE, CHECKPOINT_HEAD,
      // FALLBACK_REASON, CHECKPOINT_FOUND, SAME_HEAD
      expect(lines.length).toBeGreaterThanOrEqual(6);
      return {
        FROM_SHA: lines[0],
        RANGE_MODE: lines[1],
        CHECKPOINT_HEAD: lines[2],
        FALLBACK_REASON: lines[3],
        CHECKPOINT_FOUND: lines[4],
        SAME_HEAD: lines[5],
      };
    }

    it('a real checkpoint reader + real resolver yields incremental selection', async () => {
      const checkpointHead = 'abcdef0123456789abcdef0123456789abcdef01';
      const result = await runReaderThenResolver([
        markerComment(100, checkpointMarkerBody(checkpointHead)),
      ]);
      expect(result['RANGE_MODE']).toBe('incremental');
      expect(result['FALLBACK_REASON']).toBe('');
    });

    it('a missing checkpoint produces full / checkpoint-missing', async () => {
      const result = await runReaderThenResolver([
        markerComment(
          100,
          `${MARKER}
no checkpoint here`,
        ),
      ]);
      expect(result['RANGE_MODE']).toBe('full');
      expect(result['FALLBACK_REASON']).toBe('checkpoint-missing');
    });
  });

  // ---- AM10: checkbox-reset targets canonical trusted marker only ----

  describe('AM10 — checkbox-reset resets count on canonical trusted marker only', () => {
    const oldBody = `${MARKER}\n## Suspended\n- [ ] Re-enable automatic reviews\n<!-- ocr-auto-count:2 -->`;
    const newBody = oldBody.replace('[ ]', '[x]');

    it('resets the count on the canonical trusted marker', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        eventName: 'issue_comment',
        eventAction: 'edited',
        commentBody: newBody,
        changesFrom: oldBody,
        commentUserType: 'Bot',
        commentUserLogin: 'github-actions[bot]',
        commentId: '999',
        listComments: [markerComment(999, newBody)],
      });
      expect(result.outputs['auto-should-run']).toBe('true');
      expect(result.outputs['is-manual']).toBe('true');
      expect(result.outputs['current-count']).toBe('0');
      expect(result.updateCalls).toHaveLength(1);
      expect(String(result.updateCalls[0]['body'])).toContain(
        '<!-- ocr-auto-count:0 -->',
      );
    });

    it('does not reset when only an untrusted marker is present', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        eventName: 'issue_comment',
        eventAction: 'edited',
        commentBody: newBody,
        changesFrom: oldBody,
        commentUserType: 'Bot',
        commentUserLogin: 'github-actions[bot]',
        commentId: '999',
        listComments: [markerComment(999, newBody, userAuthor('attacker'))],
      });
      expect(result.outputs['auto-should-run']).toBe('false');
      expect(result.updateCalls).toHaveLength(0);
    });

    it('B1: does not reset when the edited comment is not the canonical marker', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        eventName: 'issue_comment',
        eventAction: 'edited',
        commentBody: newBody,
        changesFrom: oldBody,
        commentUserType: 'Bot',
        commentUserLogin: 'github-actions[bot]',
        commentId: '999',
        listComments: [
          markerComment(888, newBody),
          markerComment(999, newBody),
        ],
      });
      expect(result.outputs['auto-should-run']).toBe('false');
      expect(result.outputs['is-manual']).toBe('false');
      expect(result.updateCalls).toHaveLength(0);
    });

    it('B1: rejects an unrelated bot editing a marker comment', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        eventName: 'issue_comment',
        eventAction: 'edited',
        commentBody: newBody,
        changesFrom: oldBody,
        commentUserType: 'Bot',
        commentUserLogin: 'coderabbitai[bot]',
        commentId: '999',
        listComments: [markerComment(999, newBody)],
      });
      expect(result.outputs['auto-should-run']).toBe('false');
      expect(result.updateCalls).toHaveLength(0);
    });
  });

  // ---- I3: Written auto-review count must never regress ----

  describe('I3 — written count never regresses when pre-fetch fails', () => {
    it('real applyNonRegressingCount: pre-fetch failure resolves 0 but reconciliation list has count 2 → written body carries 3', async () => {
      const store = createStore();
      addToStore(store, {
        id: 100,
        body: `${MARKER}
<!-- ocr-auto-count:2 -->`,
        user: trustedBot('github-actions[bot]'),
      });
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings);
      const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };
      const env: Record<string, string> = {
        PR_NUMBER: '42',
        OCR_BOT_LOGIN: '',
        IS_AUTOMATIC: 'true',
      };
      const fns = loadFunctionsFromScriptWithGithub(
        postResultsScript,
        ['applyNonRegressingCount', 'resolveNonRegressingCount'],
        github,
        core,
        context,
        env,
        warnings,
      );

      // The existing body has count 2, the summary has count 1 (from
      // failed pre-fetch resolving 0, then +1 for automatic).
      // The written body must carry at least 2+1=3.
      const existingBody = `${MARKER}
<!-- ocr-auto-count:2 -->`;
      const summaryWithLowCount = `${MARKER}
<!-- ocr-auto-count:1 -->`;
      const result = asString(
        asVmFunction(fns['applyNonRegressingCount'])(
          summaryWithLowCount,
          existingBody,
          true,
        ),
      );
      // Must carry count 3, never 1
      expect(result).toContain('<!-- ocr-auto-count:3 -->');
      expect(result).not.toContain('<!-- ocr-auto-count:1 -->');
    });
  });

  // ---- AM11: inline review-comment dedup still works with 403 + no OCR_BOT_LOGIN ----

  describe('AM11 — real inline dedup functions with 403 + no OCR_BOT_LOGIN', () => {
    it('real existingReviewCommentSpans + existingInlineCommentKeys: github-actions[bot] deduped, coderabbitai[bot] not', async () => {
      const store = createStore();
      // Add a github-actions[bot] inline comment (should be deduped)
      addToStore(store, {
        id: 1,
        body: `${INLINE_MARKER} finding`,
        user: trustedBot('github-actions[bot]'),
        path: 'src/file.ts',
        line: 10,
        side: 'RIGHT',
      });
      // Add a coderabbitai[bot] inline comment (should NOT be deduped)
      addToStore(store, {
        id: 2,
        body: `${INLINE_MARKER} finding`,
        user: trustedBot('coderabbitai[bot]'),
        path: 'src/file2.ts',
        line: 20,
        side: 'RIGHT',
      });
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings);
      const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };
      const env: Record<string, string> = {
        PR_NUMBER: '42',
        OCR_BOT_LOGIN: '',
      };
      const fns = loadFunctionsFromScriptWithGithub(
        postResultsScript,
        [
          'lineSpan',
          'inlineCommentKey',
          'existingReviewCommentSpans',
          'existingInlineCommentKeys',
        ],
        github,
        core,
        context,
        env,
        warnings,
      );

      // Real existingReviewCommentSpans: only the github-actions[bot] comment
      const spans = asArray(
        await asVmFunction(fns['existingReviewCommentSpans'])(),
      );
      expect(spans.length).toBe(1);
      const span0 = asRecord(spans[0]);
      expect(asString(span0['path'])).toBe('src/file.ts');

      // Real existingInlineCommentKeys: only the github-actions[bot] comment key
      const keysResult = await asVmFunction(fns['existingInlineCommentKeys'])();
      expect(keysResult).toBeInstanceOf(Set);
      const keySet = keysResult as Set<string>;
      expect(keySet.size).toBe(1);
      // The coderabbitai[bot] comment is NOT in the dedup set
      const hasCoderabbit = [...keySet].some((k) => k.includes('src/file2.ts'));
      expect(hasCoderabbit).toBe(false);
    });
  });
});

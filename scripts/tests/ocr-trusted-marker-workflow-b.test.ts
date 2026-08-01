/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  commandText,
  stepNamed,
  extractHeredocBody,
} from './ocr-review-workflow-helpers.ts';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  asStringSet,
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

/**
 * Extract the ordered list of output keys from the Resolve review range
 * heredoc JavaScript. The authoritative key order is defined by the
 * `for (const key of ['KEY1', 'KEY2', ...])` loop in the heredoc source.
 * Returns the keys in source order so the test can map logged lines to
 * keys by position instead of hardcoding positions. Throws if the key
 * array cannot be found.
 */
function extractRangeOutputKeys(heredocJs: string): string[] {
  const match = heredocJs.match(
    /for\s*\(\s*const\s+key\s+of\s*\[([^\]]*)\]\s*\)\s*\{[^}]*console\.log/,
  );
  if (!match) {
    throw new Error(
      'Could not find the output key array in the Resolve review range heredoc. ' +
        'The for...of console.log loop may have been changed.',
    );
  }
  const keys = match[1]
    .split(',')
    .map((k) => k.trim().replace(/['"]/g, ''))
    .filter((k) => k.length > 0);
  if (keys.length === 0) {
    throw new Error(
      'The output key array in the Resolve review range heredoc is empty.',
    );
  }
  return keys;
}

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

    it('O1: canonical marker carrying a checkpoint in its own body retains that exact checkpoint after suspension', async () => {
      const checkpointComment = `<!-- ocr-checkpoint:${Buffer.from(
        JSON.stringify({
          schema: 1,
          head_sha: FULL_HEAD_SHA,
          base_sha: FULL_BASE_SHA,
          completion_state: 'complete',
        }),
        'utf8',
      ).toString('base64')} -->`;
      const store = createStore();
      addToStore(store, {
        id: 100,
        body: `${MARKER}\n## Review\n<!-- ocr-auto-count:2 -->\n${checkpointComment}`,
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
        CURRENT_COUNT: '2',
        OCR_AUTO_REVIEW_LIMIT: '2',
        OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
        OCR_BOT_LOGIN: '',
      };
      await runScript(
        postSuspensionScript,
        github,
        core,
        context,
        env,
        warnings,
      );
      const surviving = store.comments.get(100);
      expect(surviving?.body).toContain(checkpointComment);
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
      // using a robust heredoc extractor that tolerates quoting-style changes,
      // variable whitespace, and different delimiters. The step contains
      // multiple heredocs, so we specify the NODE delimiter to select the
      // node-script heredoc unambiguously. Throws a clear error if the
      // expected heredoc is missing or duplicated.
      const heredocJs = extractHeredocBody(
        resolveRangeRun,
        'Resolve review range',
        'NODE',
      );

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
      // The heredoc JS logs the result fields to stdout via console.log,
      // one per key, in the order defined by the `for (const key of [...])`
      // loop in the heredoc source. Parse structurally by key: extract the
      // authoritative key list from the heredoc source, map each logged
      // line to its key by position, and fail loudly if the number of
      // logged lines does not match the number of expected keys.
      const expectedKeys = extractRangeOutputKeys(heredocJs);
      expect(
        lines.length,
        `heredoc logged ${lines.length} lines but expected ${expectedKeys.length} keys (${expectedKeys.join(', ')}). ` +
          'A debug log or extra console.log may have been added to the heredoc.',
      ).toBe(expectedKeys.length);
      const result: Record<string, unknown> = {};
      for (let i = 0; i < expectedKeys.length; i++) {
        result[expectedKeys[i]] = lines[i];
      }
      return result;
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

    it('resets the canonical marker when a trusted DUPLICATE is the edited comment', async () => {
      // Duplicates can exist transiently (a concurrent run not yet
      // reconciled) and the user checks whichever box they can see.
      // Requiring the edit to land on the canonical comment would silently
      // ignore a legitimate re-enable and leave the PR suspended.
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
      expect(result.outputs['auto-should-run']).toBe('true');
      expect(result.outputs['is-manual']).toBe('true');
      expect(result.outputs['current-count']).toBe('0');
      // The reset is still written to the CANONICAL (oldest) marker.
      expect(result.updateCalls).toHaveLength(1);
      expect(Number(result.updateCalls[0]['comment_id'])).toBe(888);
      expect(String(result.updateCalls[0]['body'])).toContain(
        '<!-- ocr-auto-count:0 -->',
      );
    });

    it('does not reset when the edited comment id is not a trusted marker', async () => {
      // Security guard: the edited comment must itself be one of the trusted
      // markers, so a stray id cannot drive a reset.
      const result = await executeAutoGate({
        script: autoGateScript,
        eventName: 'issue_comment',
        eventAction: 'edited',
        commentBody: newBody,
        changesFrom: oldBody,
        commentUserType: 'Bot',
        commentUserLogin: 'github-actions[bot]',
        commentId: '777',
        listComments: [markerComment(888, newBody)],
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
      const keySet = asStringSet(keysResult);
      expect(keySet.size).toBe(1);
      // The coderabbitai[bot] comment is NOT in the dedup set
      const hasCoderabbit = [...keySet].some((k) => k.includes('src/file2.ts'));
      expect(hasCoderabbit).toBe(false);
    });
  });

  // ---- P3: additive-allowlist contract pinned at the workflow level ----

  describe('P3 — additive allowlist: API login and OCR_BOT_LOGIN are ADDED, not SUBSTITUTED', () => {
    it('getAuthenticated succeeds returning some-app[bot], yet a github-actions[bot] marker is still discovered', async () => {
      // If the implementation OVERWRITES the allowlist with the API login,
      // the github-actions[bot] marker would no longer be trusted and the
      // checkpoint reader would report CHECKPOINT_FOUND=false. This test
      // proves the API login is ADDED alongside the built-in default.
      // Uses the FULL checkpoint reader script so the real
      // resolveTrustedMarkerLogins(apiLogin, ...) line executes end-to-end.
      const result = await executeCheckpointReader({
        script: readCheckpointScript,
        getAuthenticatedLogin: 'some-app[bot]',
        getAuthenticatedThrows: null,
        ocrBotLogin: '',
        listComments: [markerComment(100, checkpointMarkerBody(FULL_HEAD_SHA))],
      });
      // The github-actions[bot] marker must still be discovered despite
      // getAuthenticated returning a different login.
      expect(result.outputs['CHECKPOINT_FOUND']).toBe('true');
      expect(result.outputs['CHECKPOINT_VALID']).toBe('true');
      expect(result.outputs['CHECKPOINT_HEAD']).toBe(FULL_HEAD_SHA);
    });

    it('OCR_BOT_LOGIN set to a custom login trusts BOTH that login AND github-actions[bot]', async () => {
      // If the implementation OVERWRITES the allowlist with OCR_BOT_LOGIN,
      // only custom-app[bot] would be trusted and the github-actions[bot]
      // marker (the only one carrying a checkpoint) would be ignored —
      // yielding CHECKPOINT_FOUND=false. By placing the checkpoint ONLY on
      // the github-actions[bot] marker, this test fails if the allowlist is
      // overwritten instead of added to.
      const result = await executeCheckpointReader({
        script: readCheckpointScript,
        getAuthenticatedThrows: new Error(
          'Resource not accessible by integration',
        ),
        ocrBotLogin: 'custom-app[bot]',
        listComments: [
          markerComment(100, checkpointMarkerBody(FULL_HEAD_SHA)),
          markerComment(
            200,
            `${MARKER}
no checkpoint on this one`,
            trustedBot('custom-app[bot]'),
          ),
        ],
      });
      // The github-actions[bot] marker (id 100) must be trusted despite
      // OCR_BOT_LOGIN being set to a different login. If the allowlist were
      // overwritten, only custom-app[bot] would be trusted and no checkpoint
      // would be found.
      expect(result.outputs['CHECKPOINT_FOUND']).toBe('true');
      expect(result.outputs['CHECKPOINT_VALID']).toBe('true');
      expect(result.outputs['CHECKPOINT_HEAD']).toBe(FULL_HEAD_SHA);
    });
  });
});

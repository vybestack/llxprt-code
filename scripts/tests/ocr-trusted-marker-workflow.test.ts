/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import {
  asArray,
  asNumber,
  asRecord,
  asVmFunction,
} from './typed-test-helpers.ts';
import type { WorkflowJob } from './typed-test-helpers.ts';
import {
  MARKER,
  FULL_HEAD_SHA,
  FULL_BASE_SHA,
  UNTRUSTED_AUTHORS,
  checkpointMarkerBody,
  trustedBot,
  userAuthor,
  markerComment,
  readCanonicalSnippet,
  type FakeUser,
  loadScripts,
  scriptOf,
  createStore,
  addToStore,
  makePaginatingOctokit,
  runScript,
  makeCore,
  executeCheckpointReader,
  executeAutoGate,
  executePostSuspension,
  loadFunctionsFromScript,
  loadFunctionsFromScriptWithGithub,
} from './ocr-trusted-marker-test-helpers.ts';

describe('.github/workflows/ocr-review.yml — OCR trusted marker ownership (issue #2860)', () => {
  let autoReviewJob: WorkflowJob | undefined;
  let postSuspensionJob: WorkflowJob | undefined;
  let codeReviewJob: WorkflowJob | undefined;
  let autoGateScript: string;
  let postSuspensionScript: string;
  let readCheckpointScript: string;
  let postResultsScript: string;
  let canonicalSnippet: string;

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
    canonicalSnippet = readCanonicalSnippet();
  });

  // ---- AM1: verbatim embedding ----

  describe('AM1 — canonical snippet embedded verbatim in all four sites', () => {
    const sites: ReadonlyArray<readonly [string, () => string]> = [
      ['auto-review-gate / Decide auto-review limit', () => autoGateScript],
      [
        'post-suspension / Post OCR suspension message',
        () => postSuspensionScript,
      ],
      ['code-review / Read OCR checkpoint', () => readCheckpointScript],
      ['code-review / Post OCR results', () => postResultsScript],
    ];
    const msg =
      'must embed the canonical snippet from .github/scripts/ocr-trusted-marker.cjs verbatim. ' +
      'Re-embed: copy the text between (and including) the BEGIN/END sentinels, indent by 12 spaces.';
    for (const [label, getScript] of sites) {
      it(`${label} contains the snippet verbatim`, () => {
        expect(getScript(), `${label} ${msg}`).toContain(canonicalSnippet);
      });
    }
  });

  // ---- AM2/AM3: getAuthenticated failure or success, defaults always apply ----

  describe('AM2/AM3 — github-actions[bot] discovered regardless of getAuthenticated', () => {
    it.each([
      ['403', null, new Error('Resource not accessible by integration')],
      ['different login', 'some-app[bot]', null],
    ])(
      'checkpoint reader discovers github-actions[bot] marker (getAuthenticated: %s)',
      async (_label, login: string | null, err: Error | null) => {
        const result = await executeCheckpointReader({
          script: readCheckpointScript,
          getAuthenticatedLogin: login,
          getAuthenticatedThrows: err,
          ocrBotLogin: '',
          listComments: [
            markerComment(100, checkpointMarkerBody(FULL_HEAD_SHA)),
          ],
        });
        expect(result.outputs['CHECKPOINT_FOUND']).toBe('true');
        expect(result.outputs['CHECKPOINT_VALID']).toBe('true');
        expect(result.outputs['CHECKPOINT_HEAD']).toBe(FULL_HEAD_SHA);
      },
    );

    it('auto-review gate discovers count from github-actions[bot] marker with 403 + no OCR_BOT_LOGIN', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        ocrBotLogin: '',
        // Simulate the real production failure, not merely an empty login:
        // the workflow token cannot reach the authenticated-user endpoint.
        getAuthenticatedThrows: new Error(
          'Resource not accessible by integration',
        ),
        listComments: [
          markerComment(1, `${MARKER}\n<!-- ocr-auto-count:1 -->`),
        ],
      });
      expect(result.outputs['current-count']).toBe('1');
    });

    it('results-poster AM2: real poster discovers count from github-actions[bot] marker with 403 + no OCR_BOT_LOGIN', async () => {
      const store = createStore();
      addToStore(store, {
        id: 1,
        body: `${MARKER}\n<!-- ocr-auto-count:3 -->`,
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
        IS_AUTOMATIC: 'false',
      };
      const fns = loadFunctionsFromScriptWithGithub(
        postResultsScript,
        ['fetchMarkerComments', 'resolveHiddenAutoCount'],
        github,
        core,
        context,
        env,
        warnings,
      );
      // Real fetchMarkerComments against the store
      const markers = asArray(await asVmFunction(fns['fetchMarkerComments'])());
      // Real resolveHiddenAutoCount against the fetched markers
      const count = asNumber(
        asVmFunction(fns['resolveHiddenAutoCount'])(
          markers,
          new Set(['github-actions[bot]']),
          MARKER,
        ),
      );
      expect(count).toBe(3);
    });

    // Q1: gate and suspension poster must fold in apiLogin from
    // getAuthenticated() symmetrically with the checkpoint reader and
    // results poster. A marker authored by a login returned ONLY by
    // getAuthenticated (not github-actions[bot], OCR_BOT_LOGIN unset)
    // must be discovered at all four sites.
    it('Q1: auto-review gate discovers count from a some-app[bot] marker when getAuthenticated returns some-app[bot] and OCR_BOT_LOGIN is unset', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        ocrBotLogin: '',
        getAuthenticatedLogin: 'some-app[bot]',
        getAuthenticatedThrows: null,
        listComments: [
          markerComment(
            1,
            `${MARKER}
<!-- ocr-auto-count:2 -->`,
            {
              type: 'Bot',
              login: 'some-app[bot]',
            },
          ),
        ],
      });
      expect(result.outputs['current-count']).toBe('2');
    });

    it('Q1: auto-review gate warns and continues with defaults when getAuthenticated throws 403', async () => {
      const result = await executeAutoGate({
        script: autoGateScript,
        ocrBotLogin: '',
        getAuthenticatedLogin: null,
        getAuthenticatedThrows: new Error(
          'Resource not accessible by integration',
        ),
        listComments: [
          markerComment(
            1,
            `${MARKER}
<!-- ocr-auto-count:1 -->`,
          ),
        ],
      });
      expect(result.outputs['current-count']).toBe('1');
      expect(
        result.warnings.some((w) =>
          w.includes('Could not resolve authenticated bot login'),
        ),
      ).toBe(true);
    });

    it('Q1: post-suspension reconciles a some-app[bot] marker when getAuthenticated returns some-app[bot] and OCR_BOT_LOGIN is unset', async () => {
      const result = await executePostSuspension({
        script: postSuspensionScript,
        ocrBotLogin: '',
        getAuthenticatedLogin: 'some-app[bot]',
        getAuthenticatedThrows: null,
        currentCount: '2',
        listComments: [
          markerComment(
            10,
            `${MARKER}
suspension body`,
            {
              type: 'Bot',
              login: 'some-app[bot]',
            },
          ),
        ],
      });
      // The trusted some-app[bot] marker is recognised: it gets updated
      // (canonical) rather than creating a duplicate.
      expect(result.updateCalls).toHaveLength(1);
      expect(result.createCalls).toHaveLength(0);
    });

    it('Q1: post-suspension warns and continues with defaults when getAuthenticated throws 403', async () => {
      const result = await executePostSuspension({
        script: postSuspensionScript,
        ocrBotLogin: '',
        getAuthenticatedLogin: null,
        getAuthenticatedThrows: new Error(
          'Resource not accessible by integration',
        ),
        currentCount: '2',
        listComments: [
          markerComment(
            10,
            `${MARKER}
suspension body`,
          ),
        ],
      });
      // github-actions[bot] default still trusted: marker updated.
      expect(result.updateCalls).toHaveLength(1);
      expect(
        result.warnings.some((w) =>
          w.includes('Could not resolve authenticated bot login'),
        ),
      ).toBe(true);
    });
  });

  describe('AM5/AM6 — untrusted authors never adopted or deleted', () => {
    it.each(UNTRUSTED_AUTHORS)(
      'checkpoint reader ignores a %s-authored marker comment',
      async (_label, author: FakeUser) => {
        const result = await executeCheckpointReader({
          script: readCheckpointScript,
          listComments: [
            markerComment(1, checkpointMarkerBody(FULL_HEAD_SHA), author),
          ],
        });
        expect(result.outputs['CHECKPOINT_FOUND']).toBe('false');
        expect(result.outputs['CHECKPOINT_VALID']).toBe('false');
      },
    );

    it.each(UNTRUSTED_AUTHORS)(
      'post-suspension never deletes a %s-authored marker comment',
      async (_label, author: FakeUser) => {
        const result = await executePostSuspension({
          script: postSuspensionScript,
          listComments: [markerComment(1, `${MARKER} body`, author)],
        });
        expect(result.deleteCalls).toHaveLength(0);
        expect(result.createCalls.length).toBeGreaterThanOrEqual(1);
      },
    );

    it.each(UNTRUSTED_AUTHORS)(
      'auto-review gate ignores a %s-authored marker for count',
      async (_label, author: FakeUser) => {
        const result = await executeAutoGate({
          script: autoGateScript,
          listComments: [
            markerComment(1, `${MARKER}\n<!-- ocr-auto-count:5 -->`, author),
          ],
        });
        expect(result.outputs['current-count']).toBe('0');
      },
    );

    it('results-poster reconcileMarkerComment never deletes untrusted comments', () => {
      const fns = loadFunctionsFromScript(postResultsScript, [
        'trustedMarkerComments',
      ]);
      const logins = new Set(['github-actions[bot]']);
      const comments = [
        markerComment(1, MARKER, userAuthor('attacker')),
        markerComment(2, MARKER, trustedBot('coderabbitai[bot]')),
      ];
      const trusted = asArray(
        asVmFunction(fns['trustedMarkerComments'])(comments, logins, MARKER),
      );
      expect(trusted).toEqual([]);
    });
  });

  // ---- AM7: two sequential automatic runs progress count 1 -> 2 ----

  describe('AM7 — two sequential automatic runs progress count 1 => 2 against shared store', () => {
    it('real gate + real poster: two sequential automatic runs yield count 2 in the store', async () => {
      const store = createStore();
      const warnings: string[] = [];
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings);
      const context = {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        runId: 123,
        serverUrl: 'https://github.com',
      };

      // Run 1: automatic run with no existing marker
      const gateEnv1: Record<string, string> = {
        PR_NUMBER: '42',
        OCR_AUTO_REVIEW_LIMIT: '2',
        OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
        OCR_BOT_LOGIN: '',
        EVENT_NAME: 'pull_request_target',
        EVENT_ACTION: 'synchronize',
        IS_AUTOMATIC: 'true',
        HEAD_SHA: FULL_HEAD_SHA,
        BASE_SHA: FULL_BASE_SHA,
        MERGE_BASE_SHA: FULL_BASE_SHA,
        API_BASE_SHA: FULL_BASE_SHA,
        FROM_SHA: FULL_BASE_SHA,
        RANGE_MODE: 'full',
        FALLBACK_REASON: 'checkpoint-missing',
        OCR_VERSION: '1.8.4',
        CHECKPOINT_FOUND: 'false',
        CHECKPOINT_VALID: 'false',
        CHECKPOINT_BEFORE: '',
      };
      const gateOutputs1: Record<string, string> = {};
      const gateCore1 = makeCore(warnings, gateOutputs1);
      await runScript(
        autoGateScript,
        github,
        gateCore1,
        context,
        gateEnv1,
        warnings,
      );
      expect(gateOutputs1['current-count']).toBe('0');

      // Now run the REAL results-poster count-and-upsert function against
      // the same store. We extract the real functions and execute them
      // with the real paginating github object.
      const posterFns = loadFunctionsFromScriptWithGithub(
        postResultsScript,
        [
          'fetchMarkerComments',
          'selectCanonicalMarker',
          'applyNonRegressingCount',
          'resolveNonRegressingCount',
          'deleteDuplicateMarkerComments',
          'createOrUpdateMarkerComment',
          'resolveHiddenAutoCount',
        ],
        github,
        core,
        context,
        { ...gateEnv1, IS_AUTOMATIC: 'true' },
        warnings,
      );

      // Run 1: no marker → create with count 1
      const summary1 = `${MARKER}\n## Summary\n<!-- ocr-auto-count:1 -->`;
      const result1 = await asVmFunction(
        posterFns['createOrUpdateMarkerComment'],
      )(summary1, true);
      expect(asRecord(result1)['id']).toBeDefined();
      // Verify store has count 1
      const storeComments1 = [...store.comments.values()].filter((c) =>
        c.body.includes(MARKER),
      );
      expect(storeComments1).toHaveLength(1);
      expect(storeComments1[0].body).toContain('<!-- ocr-auto-count:1 -->');

      // Run 2: feed the store state back — the real function reads the
      // store via paginate, resolves count, and writes 2.
      const storeCommentsForCount2 = [...store.comments.values()].sort(
        (a, b) => a.id - b.id,
      );
      const resolvedCount2 = asNumber(
        asVmFunction(posterFns['resolveHiddenAutoCount'])(
          storeCommentsForCount2,
          new Set(['github-actions[bot]']),
          MARKER,
        ),
      );
      expect(resolvedCount2).toBe(1);
      const summary2 = `${MARKER}\n## Summary\n<!-- ocr-auto-count:${resolvedCount2 + 1} -->`;
      await asVmFunction(posterFns['createOrUpdateMarkerComment'])(
        summary2,
        true,
      );

      // Assert the store's final canonical comment body carries count 2
      const storeComments2 = [...store.comments.values()].filter((c) =>
        c.body.includes(MARKER),
      );
      expect(storeComments2).toHaveLength(1);
      expect(storeComments2[0].body).toContain('<!-- ocr-auto-count:2 -->');
      // "Reconcile without losing state" includes the comment's identity.
      // A delete-and-recreate would satisfy the count assertions above while
      // discarding reactions and edit history, so pin the id across runs.
      expect(storeComments2[0].id).toBe(storeComments1[0].id);
    });

    it('I6: marker on page 2 is still discovered via real pagination', async () => {
      const store = createStore();
      // Fill page 1 with 100 non-marker comments, put the marker on page 2
      for (let i = 1; i <= 100; i++) {
        addToStore(store, {
          id: i,
          body: 'some regular comment',
          user: trustedBot('dependabot[bot]'),
        });
      }
      addToStore(store, {
        id: 101,
        body: `${MARKER}\n<!-- ocr-auto-count:1 -->`,
        user: trustedBot('github-actions[bot]'),
      });

      // Drive the REAL auto-review gate script through the store-backed
      // paginating octokit. The gate uses github.paginate(
      // github.rest.issues.listComments, { per_page: 100 }). The marker is on
      // page 2, so this only works if paginate walks beyond page 1.
      const warnings: string[] = [];
      const gateOutputs: Record<string, string> = {};
      const github = makePaginatingOctokit(
        store,
        100,
        warnings,
        new Error('Resource not accessible by integration'),
        null,
      );
      const core = makeCore(warnings, gateOutputs);
      await runScript(
        autoGateScript,
        github,
        core,
        { repo: { owner: 'test-owner', repo: 'test-repo' } },
        {
          PR_NUMBER: '42',
          OCR_AUTO_REVIEW_LIMIT: '2',
          OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
          OCR_BOT_LOGIN: '',
          EVENT_NAME: 'pull_request_target',
          EVENT_ACTION: 'synchronize',
        },
        warnings,
      );
      expect(gateOutputs['current-count']).toBe('1');
    });

    // ---- Snippet-sentinel guard: fail fast with a real diagnostic ----

    describe('snippet loaders fail fast when the canonical sentinels are absent', () => {
      const scriptWithoutSnippet = 'const x = 1;';

      it('loadFunctionsFromScript names the missing snippet rather than throwing ReferenceError', () => {
        expect(() =>
          loadFunctionsFromScript(scriptWithoutSnippet, [
            'isTrustedMarkerComment',
          ]),
        ).toThrow(/could not locate the OCR trusted-marker snippet/);
      });

      it('loadFunctionsFromScriptWithGithub names the missing snippet too', () => {
        expect(() =>
          loadFunctionsFromScriptWithGithub(
            scriptWithoutSnippet,
            ['isTrustedMarkerComment'],
            {},
            {},
            { repo: { owner: 'o', repo: 'r' } },
            {},
            [],
          ),
        ).toThrow(/could not locate the OCR trusted-marker snippet/);
      });
    });
  });
});

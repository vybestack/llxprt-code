/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3064: every auto-created failure issue must carry the `ci/cd` label,
 * the milestone matching main's package.json version, and issue type `Bug`.
 *
 * These are behavioral tests. They extract the REAL `run:` script from each
 * workflow's notification step and execute it against a stateful fake `gh` on
 * PATH (see auto-issue-metadata-helpers.ts). Assertions are made against the
 * recorded gh argv and the resulting fake-API state — never against workflow
 * source strings.
 */

import { describe, expect, it } from 'bun:test';
import {
  notificationScript,
  runNotification,
  type FakeMetadataState,
} from './auto-issue-metadata-helpers.ts';

const REPO = 'vybestack/llxprt-code';

interface Site {
  name: string;
  workflowPath: string;
  jobId: string;
  stepName: string;
  existingIssue: boolean;
}

const SITES: Site[] = [
  {
    name: 'nightly',
    workflowPath: '.github/workflows/nightly.yml',
    jobId: 'notify_failure',
    stepName: 'Create Issue on Failure',
    existingIssue: true,
  },
  {
    name: 'evals-nightly',
    workflowPath: '.github/workflows/evals-nightly.yml',
    jobId: 'notify_failure',
    stepName: 'Create Issue on Failure',
    existingIssue: true,
  },
  {
    name: 'release',
    workflowPath: '.github/workflows/release.yml',
    jobId: 'release',
    stepName: 'Create Issue on Failure',
    existingIssue: false,
  },
  {
    name: 'smoke-test',
    workflowPath: '.github/workflows/smoke-test.yml',
    jobId: 'smoke-test',
    stepName: 'Create Issue on Failure',
    existingIssue: false,
  },
  {
    name: 'ocr-infrastructure-notifier',
    workflowPath: '.github/workflows/ocr-infrastructure-notifier.yml',
    jobId: 'notify-ocr-infrastructure-failure',
    stepName: 'Notify OCR infrastructure failure issue',
    existingIssue: true,
  },
];

const TITLES: Record<string, string> = {
  nightly: 'Nightly workflow failed',
  'evals-nightly': 'Evals Nightly workflow failed',
  release: 'Release Failed for N/A',
  'smoke-test': 'Smoke test failed on main',
  'ocr-infrastructure-notifier': 'OCR review infrastructure failure',
};

function baseFake(
  overrides: Partial<FakeMetadataState> = {},
): FakeMetadataState {
  return {
    repo: REPO,
    packageJson: '{\n  "name": "llxprt-code",\n  "version": "0.11.0"\n}\n',
    milestones: [{ title: '0.11.0', state: 'open' }],
    labels: { 'ci/cd': { name: 'ci/cd' } },
    issues: [],
    ...overrides,
  };
}

function run(
  site: Site,
  fake: FakeMetadataState,
): ReturnType<typeof runNotification> {
  const script = notificationScript(
    site.workflowPath,
    site.jobId,
    site.stepName,
  );
  return runNotification({ script: script.run, env: script.env, fake });
}

function createCalls(result: {
  ghCalls: Array<{ argv: string[] }>;
}): string[][] {
  return result.ghCalls
    .filter((call) => call.argv[0] === 'issue' && call.argv[1] === 'create')
    .map((call) => call.argv);
}

function patchCalls(result: { ghCalls: Array<{ argv: string[] }> }): number[] {
  return result.ghCalls
    .filter(
      (call) =>
        call.argv[0] === 'api' && call.argv.some((arg) => arg === 'PATCH'),
    )
    .map((call) => {
      const target = call.argv.find((arg) =>
        /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(arg),
      );
      if (target === undefined) {
        return -1;
      }
      // The path already matched the pattern above, so the trailing segment
      // is known to be digits; slicing avoids a second, backtracking regex.
      return Number(target.slice(target.lastIndexOf('/') + 1));
    });
}

function editCalls(result: { ghCalls: Array<{ argv: string[] }> }): string[][] {
  return result.ghCalls
    .filter((call) => call.argv[0] === 'issue' && call.argv[1] === 'edit')
    .map((call) => call.argv);
}

function commentCalls(result: {
  ghCalls: Array<{ argv: string[] }>;
}): string[][] {
  return result.ghCalls
    .filter((call) => call.argv[0] === 'issue' && call.argv[1] === 'comment')
    .map((call) => call.argv);
}

function milestoneArgv(calls: string[][]): string[] {
  for (const call of calls) {
    const index = call.indexOf('--milestone');
    if (index !== -1) {
      return [call[index], call[index + 1]];
    }
  }
  return [];
}

describe('auto-created failure issues carry label, milestone, and type', () => {
  for (const site of SITES) {
    describe(site.name, () => {
      it('passes --label ci/cd on gh issue create', () => {
        const result = run(site, baseFake());
        const calls = createCalls(result);
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          const index = call.indexOf('--label');
          expect(index).not.toBe(-1);
          expect(call[index + 1]).toBe('ci/cd');
        }
      });

      it('passes --milestone 0.11.0 matched from main package.json', () => {
        const result = run(site, baseFake());
        expect(milestoneArgv(createCalls(result))).toEqual([
          '--milestone',
          '0.11.0',
        ]);
      });

      it('PATCHes issue type Bug with the number parsed from the create URL', () => {
        const result = run(site, baseFake({ nextIssueNumber: 4242 }));
        expect(createCalls(result).length).toBeGreaterThan(0);
        expect(patchCalls(result)).toContain(4242);
      });

      it('skips --milestone and still creates when no open milestone matches', () => {
        const skipped = run(
          site,
          baseFake({
            packageJson:
              '{\n  "name": "llxprt-code",\n  "version": "0.99.0"\n}\n',
            milestones: [{ title: '1.0.0', state: 'open' }],
          }),
        );
        expect(milestoneArgv(createCalls(skipped))).toEqual([]);
        expect(createCalls(skipped).length).toBeGreaterThan(0);
        expect(skipped.stderr).toContain('no open milestone titled');
      });

      it('skips --milestone and still creates when package.json fetch fails', () => {
        const result = run(site, baseFake({ packageJsonFail: true }));
        expect(milestoneArgv(createCalls(result))).toEqual([]);
        expect(createCalls(result).length).toBeGreaterThan(0);
        expect(result.stderr).toContain(
          'could not read package.json from main',
        );
      });

      it('skips --milestone and still creates when package.json has no version', () => {
        const result = run(
          site,
          baseFake({ packageJson: '{\n  "name": "llxprt-code"\n}\n' }),
        );
        expect(milestoneArgv(createCalls(result))).toEqual([]);
        expect(createCalls(result).length).toBeGreaterThan(0);
        expect(result.stderr).toContain('no version field');
      });

      it('uses exact-title matching: 0.11.0-rc1 does not satisfy 0.11.0', () => {
        const result = run(
          site,
          baseFake({ milestones: [{ title: '0.11.0-rc1', state: 'open' }] }),
        );
        expect(milestoneArgv(createCalls(result))).toEqual([]);
        expect(result.stderr).toContain('no open milestone titled');
        expect(createCalls(result).length).toBeGreaterThan(0);
      });

      it('finds a milestone that appears only on the second page', () => {
        const result = run(
          site,
          baseFake({
            pageSize: 100,
            milestones: [
              ...Array.from({ length: 100 }, (_, i) => ({
                title: `stale-${i}`,
                state: 'open',
              })),
              { title: '0.11.0', state: 'open' },
            ],
          }),
        );
        expect(milestoneArgv(createCalls(result))).toEqual([
          '--milestone',
          '0.11.0',
        ]);
        expect(createCalls(result).length).toBeGreaterThan(0);
      });

      it('keeps exit status 0 when the type PATCH fails', () => {
        const result = run(
          site,
          baseFake({ failOn: [{ method: 'PATCH', path: 'issues/4242' }] }),
        );
        expect(result.status).toBe(0);
        expect(createCalls(result).length).toBeGreaterThan(0);
      });

      it('keeps exit status 0 when create output is not a parseable URL', () => {
        const result = run(
          site,
          baseFake({ issueCreateOutput: 'not an issue url' }),
        );
        expect(result.status).toBe(0);
        expect(patchCalls(result)).toHaveLength(0);
        expect(result.stderr).toContain('could not parse issue reference');
      });

      it('comments, edits milestone, and PATCHes type on the recurring-issue path', () => {
        const issue = {
          number: 42,
          title: TITLES[site.name],
          state: 'open',
          labels: ['ci/cd'],
        };
        const result = run(site, baseFake({ issues: [issue] }));
        if (site.existingIssue) {
          expect(commentCalls(result).length).toBeGreaterThan(0);
          expect(createCalls(result)).toHaveLength(0);
          expect(milestoneArgv(editCalls(result))).toEqual([
            '--milestone',
            '0.11.0',
          ]);
          expect(patchCalls(result)).toContain(42);
        } else {
          expect(createCalls(result).length).toBeGreaterThan(0);
        }
        expect(result.status).toBe(0);
      });

      it('never exits non-zero solely because metadata handling failed', () => {
        const result = run(site, baseFake({ packageJsonFail: true }));
        expect(result.status).toBe(0);
      });
    });
  }
});

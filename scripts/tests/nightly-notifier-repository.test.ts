/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  GH_REPO_PARAMETER,
  assertCreateArgsRepositoryTargeting,
  assertIssueCreateRepositoryTargeting,
  assertRepositoryTargeting,
  commandsFor,
  failureNotificationStep,
  logicalShellLines,
  notifyFailureJob,
} from './nightly-notifier-shell-helpers.ts';
import {
  asOptionalRecord,
  asRecord,
  asRecordArray,
} from './typed-test-helpers.ts';

describe('nightly failure notifier repository targeting', () => {
  it('returns every command invocation without mistaking comments for commands', () => {
    expect(
      commandsFor(
        [
          '# gh issue list is required by the notifier',
          '# $(gh issue list --repo "${COMMENT_REPO}")',
          'echo ignored # $(gh issue list --repo "${COMMENT_REPO}")',
          'helper() {',
          '  local existing="$(gh issue list --repo "${GH_REPO}")"',
          '}',
          'function other_helper {',
          '  gh issue list --repo "${GH_REPO}"',
          '}',
          'EXISTING_ISSUE="$(gh issue list --repo "${GH_REPO}")"',
          'pre$(printf suffix)#$(gh issue list --repo "${GH_REPO}")',
          '(printf subshell)# $(gh issue list --repo "${COMMENT_REPO}")',
          'printf separator;# $(gh issue list --repo "${COMMENT_REPO}")',
          'gh issue list --repo "${GH_REPO}"',
          'retry_gh gh issue list --repo "${GH_REPO}"',
        ],
        'gh issue list',
      ),
    ).toStrictEqual([
      'gh issue list --repo "${GH_REPO}"',
      'gh issue list --repo "${GH_REPO}"',
      'gh issue list --repo "${GH_REPO}"',
      'gh issue list --repo "${GH_REPO}"',
      'gh issue list --repo "${GH_REPO}"',
      'gh issue list --repo "${GH_REPO}"',
    ]);
  });

  it('returns separate occurrences when a logical line invokes an operation twice', () => {
    expect(
      commandsFor(
        ['gh issue list --repo "${GH_REPO}"; gh issue list --limit 1'],
        'gh issue list',
      ),
    ).toStrictEqual([
      'gh issue list --repo "${GH_REPO}"',
      'gh issue list --limit 1',
    ]);
  });

  it('rejects a later unscoped occurrence even when an earlier one is scoped', () => {
    expect(() =>
      assertRepositoryTargeting(
        ['gh issue list --repo "${GH_REPO}"; gh issue list --limit 1'],
        'gh issue list',
      ),
    ).toThrow('gh issue list must target GH_REPO: gh issue list --limit 1');
  });

  it('supports notifier command prefixes and expanding repository arguments', () => {
    expect(() =>
      assertRepositoryTargeting(
        [
          'if ! gh issue list --repo "${GH_REPO}"; then',
          'TOKEN=value retry_gh gh issue list --repo ${GH_REPO}',
        ],
        'gh issue list',
      ),
    ).not.toThrow();
  });

  it.each(
    [
      'gh label create',
      'gh label list',
      'gh issue list',
      'gh issue comment',
    ].flatMap((operation) => [
      [
        operation,
        `${operation} --repo "${GH_REPO_PARAMETER}" --repo other/repo`,
      ],
      [
        operation,
        `${operation} --repo other/repo --repo "${GH_REPO_PARAMETER}"`,
      ],
    ]),
  )('rejects duplicate repository options for %s: %s', (operation, command) => {
    expect(() => assertRepositoryTargeting([command], operation)).toThrow(
      `${operation} must target GH_REPO: ${command}`,
    );
  });

  it.each([
    ['a single-quoted literal', "gh issue list --repo '${GH_REPO}'"],
    ['an escaped literal', 'gh issue list --repo \\${GH_REPO}'],
    [
      'a literal escaped inside double quotes',
      'gh issue list --repo "\\${GH_REPO}"',
    ],
  ])('rejects %s repository argument', (_description, command) => {
    expect(() => assertRepositoryTargeting([command], 'gh issue list')).toThrow(
      `gh issue list must target GH_REPO: ${command}`,
    );
  });

  it('rejects an unscoped outer invocation containing a scoped command substitution', () => {
    const command = 'gh issue list "$(gh issue list --repo "${GH_REPO}")"';

    expect(() => assertRepositoryTargeting([command], 'gh issue list')).toThrow(
      `gh issue list must target GH_REPO: ${command}`,
    );
  });

  it('rejects a repo option embedded in a quoted search value', () => {
    const command =
      'gh issue list --search \'open --repo "${GH_REPO}" issues\'';

    expect(() => assertRepositoryTargeting([command], 'gh issue list')).toThrow(
      `gh issue list must target GH_REPO: ${command}`,
    );
  });

  it('discovers and rejects an unscoped assignment-prefixed invocation', () => {
    expect(() =>
      assertRepositoryTargeting(
        ['TOKEN=value gh issue list --limit 1'],
        'gh issue list',
      ),
    ).toThrow(
      'gh issue list must target GH_REPO: TOKEN=value gh issue list --limit 1',
    );
  });

  it('finds invocations followed immediately by shell delimiters', () => {
    const lines = [
      'EXISTING_ISSUE="$(gh issue list)"',
      'gh issue list;',
      'gh issue list|cat',
      'gh issue list& wait',
      'gh issue list>/dev/null',
      'gh issue list</dev/null',
    ];

    expect(commandsFor(lines, 'gh issue list')).toStrictEqual(
      lines.map(() => 'gh issue list'),
    );
  });

  it('does not treat helper declarations as helper invocations', () => {
    expect(
      commandsFor(
        ['helper() {', 'helper () {', 'function helper {', 'helper "argument"'],
        'helper',
      ),
    ).toStrictEqual(['helper "argument"']);
  });

  it('accepts the current CREATE_ARGS repository target', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'CREATE_ARGS=(--repo "${GH_REPO}" --title "${ISSUE_TITLE}" --body-file "${BODY_FILE}")',
      ]),
    ).not.toThrow();
  });

  it('accepts a comment after a CREATE_ARGS assignment', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'CREATE_ARGS=(--repo "${GH_REPO}") # valid comment',
      ]),
    ).not.toThrow();
  });

  it('accepts a comment after a CREATE_ARGS append', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'CREATE_ARGS=(--title title)',
        'CREATE_ARGS+=(--repo "${GH_REPO}") # valid comment',
      ]),
    ).not.toThrow();
  });

  it('rejects non-comment content after a CREATE_ARGS assignment', () => {
    const assignment = 'CREATE_ARGS=(--repo "${GH_REPO}") unexpected';

    expect(() => assertCreateArgsRepositoryTargeting([assignment])).toThrow(
      `CREATE_ARGS must target GH_REPO: ${assignment}`,
    );
  });

  it.each([
    'CREATE_ARGS=(--repo "${GH_REPO}" --repo other/repo --title title)',
    'CREATE_ARGS=(--repo other/repo --repo "${GH_REPO}" --title title)',
  ])('rejects duplicate repository options in %s', (assignment) => {
    expect(() => assertCreateArgsRepositoryTargeting([assignment])).toThrow(
      `CREATE_ARGS must target GH_REPO: ${assignment}`,
    );
  });

  it('rejects a repository option appended directly to CREATE_ARGS', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
        'CREATE_ARGS+=(--repo other/repo)',
      ]),
    ).toThrow('CREATE_ARGS must target GH_REPO');
  });

  it('rejects a repository option appended through LABEL_ARGS', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'LABEL_ARGS=()',
        'LABEL_ARGS+=(--repo other/repo)',
        'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
        'CREATE_ARGS+=("${LABEL_ARGS[@]}")',
      ]),
    ).toThrow('CREATE_ARGS must target GH_REPO');
  });

  it.each([
    'CREATE_ARGS+=("${REPOSITORY_ARGS[@]}")',
    'CREATE_ARGS+=(${REPOSITORY_ARGS[@]})',
  ])('preserves repository expansion provenance through %s', (append) => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'REPOSITORY_ARGS=(--repo "${GH_REPO}")',
        'CREATE_ARGS=(--title title)',
        append,
      ]),
    ).not.toThrow();
  });

  it('accepts the current LABEL_ARGS label mutation', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'LABEL_ARGS=()',
        'LABEL_ARGS+=(--label "ci/cd")',
        'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
        'CREATE_ARGS+=("${LABEL_ARGS[@]}")',
      ]),
    ).not.toThrow();
  });

  it('fails closed on an unresolved CREATE_ARGS array expansion', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
        'CREATE_ARGS+=("${UNKNOWN_ARGS[@]}")',
      ]),
    ).toThrow('CREATE_ARGS must target GH_REPO');
  });

  it('resets unresolved array state before evaluating later appends', () => {
    expect(() =>
      assertCreateArgsRepositoryTargeting([
        'REPOSITORY_ARGS+=("${UNKNOWN_ARGS[@]}")',
        'REPOSITORY_ARGS=()',
        'REPOSITORY_ARGS+=(--repo "${GH_REPO}")',
        'CREATE_ARGS=(--title title)',
        'CREATE_ARGS+=("${REPOSITORY_ARGS[@]}")',
      ]),
    ).not.toThrow();
  });

  it('accepts an issue-create invocation using only CREATE_ARGS', () => {
    expect(() =>
      assertIssueCreateRepositoryTargeting([
        'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
        'retry_gh gh issue create "${CREATE_ARGS[@]}"',
      ]),
    ).not.toThrow();
  });

  it.each([
    'retry_gh gh issue create "${CREATE_ARGS[@]}" --repo other/repo',
    'retry_gh gh issue create --repo other/repo "${CREATE_ARGS[@]}"',
  ])(
    'rejects an extra repository option at the issue-create invocation: %s',
    (invocation) => {
      expect(() =>
        assertIssueCreateRepositoryTargeting([
          'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
          invocation,
        ]),
      ).toThrow('gh issue create must target GH_REPO');
    },
  );

  it('includes top-level arguments in the effective issue-create argv', () => {
    expect(() =>
      assertIssueCreateRepositoryTargeting([
        'CREATE_ARGS=(--title title)',
        'retry_gh gh issue create "${CREATE_ARGS[@]}" --repo "${GH_REPO}"',
      ]),
    ).not.toThrow();
  });

  it('evaluates CREATE_ARGS as it exists at the issue-create invocation', () => {
    expect(() =>
      assertIssueCreateRepositoryTargeting([
        'CREATE_ARGS=(--repo other/repo --title title)',
        'retry_gh gh issue create "${CREATE_ARGS[@]}"',
        'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
      ]),
    ).toThrow('gh issue create must target GH_REPO');
  });

  it.each([
    'retry_gh gh issue create "${CREATE_ARGS[@]}" "${UNKNOWN_ARGS[@]}"',
    'retry_gh gh issue create "${CREATE_ARGS[@]}" "${LABEL_ARGS[@]}"',
    'retry_gh gh issue create "${CREATE_ARGS[@]}" "${CREATE_ARGS[@]}"',
    'retry_gh gh issue create "prefix${CREATE_ARGS[@]}"',
  ])(
    'fails closed on unresolved or extra invocation array expansion: %s',
    (invocation) => {
      expect(() =>
        assertIssueCreateRepositoryTargeting([
          'LABEL_ARGS=(--label "ci/cd")',
          'CREATE_ARGS=(--repo "${GH_REPO}" --title title)',
          invocation,
        ]),
      ).toThrow('gh issue create must target GH_REPO');
    },
  );

  it('targets every checkout-free notification operation at github.repository', () => {
    const notifyFailureStep = failureNotificationStep();
    const run = String(notifyFailureStep.run);
    const logicalLines = logicalShellLines(run);

    const stepEnv = asOptionalRecord(notifyFailureStep.env);
    expect(stepEnv?.GH_REPO).toBe('${{ github.repository }}');
    for (const operation of [
      'gh label create',
      'gh label list',
      'gh issue list',
      'gh issue comment',
    ]) {
      assertRepositoryTargeting(logicalLines, operation);
    }
    assertIssueCreateRepositoryTargeting(logicalLines);
    const steps = notifyFailureJob?.steps;
    expect(
      asRecordArray(steps)?.some((step: unknown) =>
        String(asRecord(step).uses ?? '').startsWith('actions/checkout@'),
      ),
    ).toBe(false);

    expect(notifyFailureJob?.permissions).toEqual({ issues: 'write' });
  });
});

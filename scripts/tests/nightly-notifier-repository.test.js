/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const nightlyWorkflow = yaml.load(
  readFileSync(resolve(root, '.github/workflows/nightly.yml'), 'utf8'),
);
let notifyFailureJob;

beforeAll(() => {
  expect(
    nightlyWorkflow,
    'nightly workflow must parse as an object',
  ).toBeTypeOf('object');
  expect(nightlyWorkflow?.jobs, 'workflow must define jobs').toBeDefined();
  expect(
    nightlyWorkflow?.jobs?.notify_failure,
    'workflow must define job: notify_failure',
  ).toBeDefined();
  notifyFailureJob = nightlyWorkflow.jobs.notify_failure;
});

function failureNotificationStep() {
  expect(
    notifyFailureJob?.steps,
    'notify_failure must define steps',
  ).toBeTypeOf('object');
  const step = notifyFailureJob.steps.find(
    (candidate) => candidate.name === 'Create Issue on Failure',
  );
  expect(
    step,
    'workflow must define step named: Create Issue on Failure',
  ).toBeDefined();
  return step;
}

function logicalShellLines(script) {
  return String(script)
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// This intentionally models only the notifier's shell grammar; discovered argv
// operations remain visible so unsupported prefixes fail closed instead of masking gh.
const COMMAND_SUBSTITUTION_VALUE = '\u0000command-substitution\u0000';
const GH_REPO_PARAMETER = '${GH_REPO}';
const SHELL_COMMAND_DELIMITERS = ';|&<>()';

function startShellToken(state) {
  state.token ??= {
    value: '',
    expandsGhRepo: false,
    arrayExpansions: [],
    start: state.index,
    end: state.index,
  };
  state.wordStart = false;
}

function finishShellToken(state, end) {
  if (state.token === null) {
    return;
  }
  state.token.end = end;
  state.tokens.push(state.token);
  state.token = null;
}

function finishShellCommand(state, end) {
  finishShellToken(state, end);
  if (state.tokens.length > 0) {
    state.commands.push({
      start: state.segmentStart,
      end,
      tokens: state.tokens,
    });
  }
  state.tokens = [];
}

function consumeSingleQuotedCharacter(state, character) {
  if (state.quote !== "'") {
    return false;
  }
  if (character === "'") {
    state.quote = null;
  } else {
    state.token.value += character;
  }
  state.index += 1;
  return true;
}

function consumeCommandSubstitution(state) {
  if (state.line[state.index] !== '$' || state.line[state.index + 1] !== '(') {
    return false;
  }
  startShellToken(state);
  state.token.value += COMMAND_SUBSTITUTION_VALUE;
  const nested = scanShellContext(state.line, state.index + 2, true);
  state.commands.push(...nested.commands);
  state.index = nested.index;
  return true;
}

function consumeGhRepoExpansion(state) {
  if (!state.line.startsWith(GH_REPO_PARAMETER, state.index)) {
    return false;
  }
  startShellToken(state);
  state.token.value += GH_REPO_PARAMETER;
  state.token.expandsGhRepo = true;
  state.index += GH_REPO_PARAMETER.length;
  return true;
}

function consumeArrayExpansion(state) {
  const expansion = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}/.exec(
    state.line.slice(state.index),
  );
  if (expansion === null) {
    return false;
  }
  startShellToken(state);
  state.token.value += expansion[0];
  state.token.arrayExpansions.push({
    name: expansion[1],
    parameter: expansion[0],
  });
  state.index += expansion[0].length;
  return true;
}

function consumeDoubleQuotedCharacter(state, character) {
  if (state.quote !== '"') {
    return false;
  }
  if (character === '"') {
    state.quote = null;
    state.index += 1;
    return true;
  }
  if (character === '\\' && state.index + 1 < state.line.length) {
    state.token.value += state.line[state.index + 1];
    state.index += 2;
    return true;
  }
  state.token.value += character;
  state.index += 1;
  return true;
}

function consumeShellQuote(state, character) {
  if (character !== '"' && character !== "'") {
    return false;
  }
  startShellToken(state);
  state.quote = character;
  state.index += 1;
  return true;
}

function consumeShellEscape(state, character) {
  if (character !== '\\') {
    return false;
  }
  startShellToken(state);
  if (state.index + 1 < state.line.length) {
    state.token.value += state.line[state.index + 1];
    state.index += 2;
  } else {
    state.token.value += character;
    state.index += 1;
  }
  return true;
}

function consumeShellWhitespace(state, character) {
  if (!/\s/.test(character)) {
    return false;
  }
  finishShellToken(state, state.index);
  state.wordStart = true;
  state.index += 1;
  return true;
}

function consumeShellDelimiter(state, character) {
  if (!SHELL_COMMAND_DELIMITERS.includes(character)) {
    return false;
  }
  finishShellCommand(state, state.index);
  state.segmentStart = state.index + 1;
  state.wordStart = true;
  state.index += 1;
  return true;
}

function consumeShellCharacter(state, stopAtClosingParenthesis) {
  const character = state.line[state.index];
  if (consumeSingleQuotedCharacter(state, character)) {
    return;
  }
  if (consumeCommandSubstitution(state)) {
    return;
  }
  if (consumeGhRepoExpansion(state)) {
    return;
  }
  if (consumeArrayExpansion(state)) {
    return;
  }
  if (consumeDoubleQuotedCharacter(state, character)) {
    return;
  }
  if (character === ')' && stopAtClosingParenthesis) {
    finishShellCommand(state, state.index);
    state.index += 1;
    state.done = true;
    return;
  }
  if (character === '#' && state.wordStart) {
    finishShellCommand(state, state.index);
    state.index = state.line.length;
    state.done = true;
    return;
  }
  if (
    consumeShellQuote(state, character) ||
    consumeShellEscape(state, character) ||
    consumeShellWhitespace(state, character) ||
    consumeShellDelimiter(state, character)
  ) {
    return;
  }
  startShellToken(state);
  state.token.value += character;
  state.index += 1;
}

function scanShellContext(line, start, stopAtClosingParenthesis) {
  const state = {
    line,
    commands: [],
    segmentStart: start,
    tokens: [],
    token: null,
    quote: null,
    wordStart: true,
    index: start,
    done: false,
  };
  while (!state.done && state.index < line.length) {
    consumeShellCharacter(state, stopAtClosingParenthesis);
  }
  if (!state.done) {
    finishShellCommand(state, state.index);
  }
  return { commands: state.commands, index: state.index };
}

function shellCommands(line) {
  return scanShellContext(line, 0, false).commands.sort(
    (left, right) => left.start - right.start,
  );
}

function isHelperDeclaration(line, operationToken) {
  const remainder = line.slice(operationToken.end).trimStart();
  if (remainder.startsWith('{')) {
    return true;
  }
  if (!remainder.startsWith('(')) {
    return false;
  }
  const closeParenthesis = remainder.indexOf(')');
  return (
    closeParenthesis !== -1 &&
    remainder.slice(1, closeParenthesis).trim() === '' &&
    remainder
      .slice(closeParenthesis + 1)
      .trimStart()
      .startsWith('{')
  );
}

function operationIndexes(tokens, operationTokens) {
  const indexes = [];
  for (
    let index = 0;
    index <= tokens.length - operationTokens.length;
    index += 1
  ) {
    if (
      operationTokens.every(
        (operationToken, offset) =>
          tokens[index + offset].value === operationToken,
      )
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

function occurrenceForCommand(line, command, operationTokens, operationIndex) {
  const operationToken = command.tokens[operationIndex];
  if (
    operationTokens.length === 1 &&
    isHelperDeclaration(line, operationToken)
  ) {
    return null;
  }
  const assignmentPrefix = command.tokens
    .slice(0, operationIndex)
    .every((candidate) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate.value));
  const sourceStart = assignmentPrefix
    ? command.tokens[0].start
    : operationToken.start;
  return {
    source: line.slice(sourceStart, command.end).trim(),
    argv: command.tokens.slice(operationIndex),
  };
}

function occurrencesInCommand(line, command, operationTokens) {
  return operationIndexes(command.tokens, operationTokens)
    .map((operationIndex) =>
      occurrenceForCommand(line, command, operationTokens, operationIndex),
    )
    .filter(Boolean);
}

function commandOccurrencesFor(lines, operation) {
  const operationTokens = operation.trim().split(/\s+/);
  const occurrences = lines.flatMap((line, lineIndex) =>
    shellCommands(line).flatMap((command) =>
      occurrencesInCommand(line, command, operationTokens).map(
        (occurrence) => ({
          ...occurrence,
          lineIndex,
        }),
      ),
    ),
  );

  expect(occurrences, `${operation} should be present`).not.toHaveLength(0);
  return occurrences;
}

function commandsFor(lines, operation) {
  return commandOccurrencesFor(lines, operation).map(({ source }) => source);
}

function targetsExactlyOneRepository(argv) {
  const repositoryOptionIndexes = argv
    .map((argument, index) => (argument.value === '--repo' ? index : -1))
    .filter((index) => index !== -1);
  if (repositoryOptionIndexes.length !== 1) {
    return false;
  }
  const repositoryArgument = argv[repositoryOptionIndexes[0] + 1];
  return (
    repositoryArgument?.value === GH_REPO_PARAMETER &&
    repositoryArgument.expandsGhRepo
  );
}

function assertRepositoryTargeting(lines, operation) {
  for (const command of commandOccurrencesFor(lines, operation)) {
    if (!targetsExactlyOneRepository(command.argv)) {
      throw new Error(`${operation} must target GH_REPO: ${command.source}`);
    }
  }
}

function arrayAssignment(line) {
  const prefix = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\+?=)\s*\(/.exec(line);
  if (prefix === null) {
    return undefined;
  }

  const scanned = scanShellContext(line, prefix[0].length, true);
  const closingParenthesis = scanned.index - 1;
  const isComplete =
    line[closingParenthesis] === ')' &&
    /^(?:[ \t]*|[ \t]+#[^\r\n]*)$/.test(line.slice(scanned.index));
  const arrayCommand = scanned.commands.find(
    (command) =>
      command.start === prefix[0].length && command.end === closingParenthesis,
  );
  let tokens;
  if (scanned.commands.length === 0) {
    tokens = [];
  } else if (scanned.commands.length === 1) {
    tokens = arrayCommand?.tokens;
  }

  return {
    name: prefix[1],
    append: prefix[2] === '+=',
    source: line,
    tokens: isComplete ? tokens : undefined,
  };
}

function evaluateArrayTokens(tokens, arrays) {
  if (tokens === undefined) {
    return { argv: [], unresolvedExpansion: true };
  }

  const argv = [];
  let unresolvedExpansion = false;
  for (const token of tokens) {
    if (token.arrayExpansions.length === 0) {
      argv.push(token);
    } else {
      const [expansion] = token.arrayExpansions;
      const expandedArray = arrays.get(expansion.name);
      if (
        token.arrayExpansions.length !== 1 ||
        token.value !== expansion.parameter ||
        expandedArray === undefined ||
        expandedArray.unresolvedExpansion
      ) {
        unresolvedExpansion = true;
      } else {
        argv.push(...expandedArray.argv);
      }
    }
  }
  return { argv, unresolvedExpansion };
}

function evaluateShellArrays(lines) {
  const arrays = new Map();
  for (const line of lines) {
    const assignment = arrayAssignment(line);
    if (assignment === undefined) {
      continue;
    }

    const evaluated = evaluateArrayTokens(assignment.tokens, arrays);
    const previous = assignment.append
      ? arrays.get(assignment.name)
      : undefined;
    arrays.set(assignment.name, {
      source: assignment.source,
      argv: [...(previous?.argv ?? []), ...evaluated.argv],
      unresolvedExpansion:
        (previous?.unresolvedExpansion ?? false) ||
        evaluated.unresolvedExpansion,
    });
  }
  return arrays;
}

function assertCreateArgsRepositoryTargeting(lines) {
  const createArgs = evaluateShellArrays(lines).get('CREATE_ARGS');
  if (
    createArgs === undefined ||
    createArgs.unresolvedExpansion ||
    !targetsExactlyOneRepository(createArgs.argv)
  ) {
    throw new Error(
      `CREATE_ARGS must target GH_REPO: ${createArgs?.source ?? 'assignment missing'}`,
    );
  }
}

function effectiveIssueCreateArgv(command, arrays) {
  const invocationArgv = command.argv.slice(3);
  const arrayExpansions = invocationArgv.flatMap(
    (argument) => argument.arrayExpansions,
  );
  if (
    arrayExpansions.length !== 1 ||
    arrayExpansions[0].name !== 'CREATE_ARGS'
  ) {
    return undefined;
  }

  const evaluated = evaluateArrayTokens(invocationArgv, arrays);
  return evaluated.unresolvedExpansion ? undefined : evaluated.argv;
}

function assertIssueCreateRepositoryTargeting(lines) {
  for (const command of commandOccurrencesFor(lines, 'gh issue create')) {
    const arraysAtInvocation = evaluateShellArrays(
      lines.slice(0, command.lineIndex + 1),
    );
    const effectiveArgv = effectiveIssueCreateArgv(command, arraysAtInvocation);
    if (
      effectiveArgv === undefined ||
      !targetsExactlyOneRepository(effectiveArgv)
    ) {
      throw new Error(`gh issue create must target GH_REPO: ${command.source}`);
    }
  }
}

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

    expect(notifyFailureStep.env?.GH_REPO).toBe('${{ github.repository }}');
    for (const operation of [
      'gh label create',
      'gh label list',
      'gh issue list',
      'gh issue comment',
    ]) {
      assertRepositoryTargeting(logicalLines, operation);
    }
    assertIssueCreateRepositoryTargeting(logicalLines);
    expect(
      notifyFailureJob.steps.some((step) =>
        String(step.uses ?? '').startsWith('actions/checkout@'),
      ),
    ).toBe(false);

    expect(notifyFailureJob.permissions).toEqual({ issues: 'write' });
  });
});

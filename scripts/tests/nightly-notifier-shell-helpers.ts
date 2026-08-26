/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect } from 'bun:test';
import {
  asRecord,
  asRecordArray,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';

export type WorkflowJob = Record<string, unknown>;
export type WorkflowStep = Record<string, unknown>;
export type ShellToken = {
  value: string;
  expandsGhRepo: boolean;
  arrayExpansions: Array<{ name: string; parameter: string }>;
  start: number;
  end: number;
};
export type ShellCommand = {
  start: number;
  end: number;
  tokens: ShellToken[];
};
export type ShellState = {
  line: string;
  commands: ShellCommand[];
  segmentStart: number;
  tokens: ShellToken[];
  token: ShellToken | null;
  quote: string | null;
  wordStart: boolean;
  index: number;
  done: boolean;
};
export type ScanResult = { commands: ShellCommand[]; index: number };
export type ArrayAssignment = {
  name: string;
  append: boolean;
  source: string | string[];
  tokens: ShellToken[] | undefined;
};
export type EvaluatedArray = {
  argv: ShellToken[];
  unresolvedExpansion: boolean;
};
export type ArrayMap = Map<
  string,
  {
    source: string | string[];
    argv: ShellToken[];
    unresolvedExpansion: boolean;
  }
>;
export type Occurrence = {
  source: string;
  argv: ShellToken[];
  lineIndex: number;
};

export const root = resolve(import.meta.dirname, '../..');
export const nightlyWorkflow = parseWorkflowYaml(
  readFileSync(resolve(root, '.github/workflows/nightly.yml'), 'utf8'),
);
export let notifyFailureJob: WorkflowJob | undefined;

beforeAll(() => {
  expect(
    nightlyWorkflow,
    'nightly workflow must parse as an object',
  ).toBeTypeOf('object');
  const jobs = nightlyWorkflow?.jobs;
  expect(jobs, 'workflow must define jobs').toBeDefined();
  if (!jobs) throw new Error('workflow must define jobs');
  expect(
    jobs['notify_failure'],
    'workflow must define job: notify_failure',
  ).toBeDefined();
  notifyFailureJob = jobs['notify_failure'];
});

export function failureNotificationStep(): WorkflowStep {
  const steps = notifyFailureJob?.steps;
  expect(steps, 'notify_failure must define steps').toBeTypeOf('object');
  if (!steps) throw new Error('notify_failure must define steps');
  const step = asRecordArray(steps)?.find(
    (candidate) => asRecord(candidate).name === 'Create Issue on Failure',
  );
  expect(
    step,
    'workflow must define step named: Create Issue on Failure',
  ).toBeDefined();
  if (!step)
    throw new Error('workflow must define step named: Create Issue on Failure');
  return step;
}

export function logicalShellLines(script: string): string[] {
  return String(script)
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// This intentionally models only the notifier's shell grammar; discovered argv
// operations remain visible so unsupported prefixes fail closed instead of masking gh.
export const COMMAND_SUBSTITUTION_VALUE = '\u0000command-substitution\u0000';
export const GH_REPO_PARAMETER = '${GH_REPO}';
export const SHELL_COMMAND_DELIMITERS = ';|&<>()';

function currentToken(state: ShellState): ShellToken {
  if (state.token === null) {
    throw new Error('Shell token accessed before initialization');
  }
  return state.token;
}

function startShellToken(state: ShellState): void {
  state.token ??= {
    value: '',
    expandsGhRepo: false,
    arrayExpansions: [],
    start: state.index,
    end: state.index,
  };
  state.wordStart = false;
}

function finishShellToken(state: ShellState, end: number): void {
  if (state.token === null) {
    return;
  }
  state.token.end = end;
  state.tokens.push(state.token);
  state.token = null;
}

function finishShellCommand(state: ShellState, end: number): void {
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

function consumeSingleQuotedCharacter(
  state: ShellState,
  character: string,
): boolean {
  if (state.quote !== "'") {
    return false;
  }
  if (character === "'") {
    state.quote = null;
  } else {
    currentToken(state).value += character;
  }
  state.index += 1;
  return true;
}

function consumeCommandSubstitution(state: ShellState): boolean {
  if (state.line[state.index] !== '$' || state.line[state.index + 1] !== '(') {
    return false;
  }
  startShellToken(state);
  currentToken(state).value += COMMAND_SUBSTITUTION_VALUE;
  const nested = scanShellContext(state.line, state.index + 2, true);
  state.commands.push(...nested.commands);
  state.index = nested.index;
  return true;
}

function consumeGhRepoExpansion(state: ShellState): boolean {
  if (!state.line.startsWith(GH_REPO_PARAMETER, state.index)) {
    return false;
  }
  startShellToken(state);
  currentToken(state).value += GH_REPO_PARAMETER;
  currentToken(state).expandsGhRepo = true;
  state.index += GH_REPO_PARAMETER.length;
  return true;
}

/**
 * Array expansions the scanner resolves back to their source array.
 *
 * The guarded form comes first because it is a strict extension of the plain
 * one. Expanding an EMPTY array as `"${NAME[@]}"` is an "unbound variable"
 * error under `set -u` on bash 3.2 (still the /bin/bash on macOS), so the
 * notifier workflows write `${NAME[@]+"${NAME[@]}"}` instead. Both forms must
 * resolve identically here, otherwise the repository-targeting assertions
 * below would silently stop covering the guarded call sites.
 */
const ARRAY_EXPANSION_PATTERNS: RegExp[] = [
  /^\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\+"\$\{\1\[@\]\}"\}/,
  /^\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}/,
];

function consumeArrayExpansion(state: ShellState): boolean {
  const remainder = state.line.slice(state.index);
  let expansion: RegExpExecArray | null = null;
  for (const pattern of ARRAY_EXPANSION_PATTERNS) {
    expansion = pattern.exec(remainder);
    if (expansion !== null) {
      break;
    }
  }
  if (expansion === null) {
    return false;
  }
  startShellToken(state);
  currentToken(state).value += expansion[0];
  currentToken(state).arrayExpansions.push({
    name: expansion[1],
    parameter: expansion[0],
  });
  state.index += expansion[0].length;
  return true;
}

function consumeDoubleQuotedCharacter(
  state: ShellState,
  character: string,
): boolean {
  if (state.quote !== '"') {
    return false;
  }
  if (character === '"') {
    state.quote = null;
    state.index += 1;
    return true;
  }
  if (character === '\\' && state.index + 1 < state.line.length) {
    currentToken(state).value += state.line[state.index + 1];
    state.index += 2;
    return true;
  }
  currentToken(state).value += character;
  state.index += 1;
  return true;
}

function consumeShellQuote(state: ShellState, character: string): boolean {
  if (character !== '"' && character !== "'") {
    return false;
  }
  startShellToken(state);
  state.quote = character;
  state.index += 1;
  return true;
}

function consumeShellEscape(state: ShellState, character: string): boolean {
  if (character !== '\\') {
    return false;
  }
  startShellToken(state);
  if (state.index + 1 < state.line.length) {
    currentToken(state).value += state.line[state.index + 1];
    state.index += 2;
  } else {
    currentToken(state).value += character;
    state.index += 1;
  }
  return true;
}

function consumeShellWhitespace(state: ShellState, character: string): boolean {
  if (!/\s/.test(character)) {
    return false;
  }
  finishShellToken(state, state.index);
  state.wordStart = true;
  state.index += 1;
  return true;
}

function consumeShellDelimiter(state: ShellState, character: string): boolean {
  if (!SHELL_COMMAND_DELIMITERS.includes(character)) {
    return false;
  }
  finishShellCommand(state, state.index);
  state.segmentStart = state.index + 1;
  state.wordStart = true;
  state.index += 1;
  return true;
}

function consumeShellCharacter(
  state: ShellState,
  stopAtClosingParenthesis: boolean,
): void {
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
  currentToken(state).value += character;
  state.index += 1;
}

function scanShellContext(
  line: string,
  start: number,
  stopAtClosingParenthesis: boolean,
): ScanResult {
  const state: ShellState = {
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

function shellCommands(line: string): ShellCommand[] {
  return scanShellContext(line, 0, false).commands.sort(
    (left, right) => left.start - right.start,
  );
}

function isHelperDeclaration(
  line: string,
  operationToken: ShellToken,
): boolean {
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

function operationIndexes(
  tokens: ShellToken[],
  operationTokens: string[],
): number[] {
  const indexes: number[] = [];
  for (
    let index = 0;
    index <= tokens.length - operationTokens.length;
    index += 1
  ) {
    if (
      operationTokens.every(
        (operationToken, offset: number) =>
          tokens[index + offset].value === operationToken,
      )
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

function occurrenceForCommand(
  line: string,
  command: ShellCommand,
  operationTokens: string[],
  operationIndex: number,
): Occurrence | null {
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
    lineIndex: 0,
  };
}

function occurrencesInCommand(
  line: string,
  command: ShellCommand,
  operationTokens: string[],
): Occurrence[] {
  return operationIndexes(command.tokens, operationTokens)
    .map((operationIndex) =>
      occurrenceForCommand(line, command, operationTokens, operationIndex),
    )
    .filter((o): o is Occurrence => o !== null);
}

export function commandOccurrencesFor(
  lines: string[],
  operation: string,
): Occurrence[] {
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

export function commandsFor(lines: string[], operation: string): string[] {
  return commandOccurrencesFor(lines, operation).map(({ source }) => source);
}

export function targetsExactlyOneRepository(argv: ShellToken[]): boolean {
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

export function assertRepositoryTargeting(
  lines: string[],
  operation: string,
): void {
  for (const command of commandOccurrencesFor(lines, operation)) {
    if (!targetsExactlyOneRepository(command.argv)) {
      throw new Error(`${operation} must target GH_REPO: ${command.source}`);
    }
  }
}

function arrayAssignment(line: string): ArrayAssignment | undefined {
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
  let tokens: ShellToken[] | undefined;
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

export function evaluateArrayTokens(
  tokens: ShellToken[] | undefined,
  arrays: ArrayMap,
): EvaluatedArray {
  if (tokens === undefined) {
    return { argv: [], unresolvedExpansion: true };
  }

  const argv: ShellToken[] = [];
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

export function evaluateShellArrays(lines: string[]): ArrayMap {
  const arrays: ArrayMap = new Map();
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

export function assertCreateArgsRepositoryTargeting(lines: string[]): void {
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

export function effectiveIssueCreateArgv(
  command: Occurrence,
  arrays: ArrayMap,
): ShellToken[] | undefined {
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

export function assertIssueCreateRepositoryTargeting(lines: string[]): void {
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

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stepNamed } from './ocr-review-workflow-helpers.ts';
import {
  asRecordArray,
  asString,
  asStringArray,
  parseJsonObject,
  workflowJob,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const RELEASE_TAG = 'v1.2.3';
const RELEASE_VERSION = '1.2.3';
const RELEASE_BRANCH = `release/${RELEASE_TAG}`;
const CLI_TARBALL = 'packages/cli/dist/vybestack-llxprt-code-1.2.3.tgz';
const VSIX_PATH = 'packages/vscode/llxprt-code.vsix';
const REPOSITORY = 'vybestack/llxprt-code';

type TargetMode = 'branch' | 'head';
type ExistingTag = 'lightweight' | 'annotated' | 'different' | 'near-miss';

interface ScenarioOptions {
  targetMode: TargetMode;
  includeCliTarball?: boolean;
  includeVsix?: boolean;
  existingTag?: ExistingTag;
  failLookup?: boolean;
}

interface ScenarioResult {
  status: number;
  stdout: string;
  stderr: string;
  events: Array<Record<string, unknown>>;
  refs: Array<Record<string, unknown>>;
  targetSha: string;
}

const FAKE_GH_SOURCE = `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined) throw new Error('missing environment variable ' + name);
  return value;
}

const args = process.argv.slice(2);
const eventLog = requiredEnv('GH_EVENT_LOG');
const statePath = requiredEnv('GH_REF_STORE');
const state = JSON.parse(readFileSync(statePath, 'utf8'));

function record(kind, details = {}) {
  appendFileSync(eventLog, JSON.stringify({ kind, args, ...details }) + '\\n');
}

function argumentValue(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function formValue(name) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === '-f' && args[index + 1].startsWith(name + '=')) {
      return args[index + 1].slice(name.length + 1);
    }
  }
  return undefined;
}

function saveState(nextState) {
  writeFileSync(statePath, JSON.stringify(nextState));
}

function commitForRef(ref) {
  const found = state.refs.find((candidate) => candidate.ref === ref);
  if (found === undefined) return undefined;
  if (found.type === 'commit') return found.sha;
  return state.tags.find((tag) => tag.sha === found.sha)?.targetSha;
}

record('invocation');

if (args[0] === 'api') {
  const endpoint = args[1];
  const matchingMarker = '/git/matching-refs/tags/';
  if (endpoint.includes(matchingMarker)) {
    const prefix = decodeURIComponent(endpoint.split(matchingMarker)[1]);
    const candidates = state.refs.filter((candidate) =>
      candidate.ref.startsWith('refs/tags/' + prefix),
    );
    const exactJq = '.[] | select(.ref == "refs/tags/" + $ENV.RELEASE_TAG) | .object.type + " " + .object.sha';
    const selected = argumentValue('--jq') === exactJq
      ? candidates.filter((candidate) =>
          candidate.ref === 'refs/tags/' + process.env.RELEASE_TAG,
        )
      : candidates;
    record('matching-response', {
      candidateRefs: candidates.map((candidate) => candidate.ref),
      selectedRefs: selected.map((candidate) => candidate.ref),
    });
    if (process.env.FAIL_API_LOOKUP === 'true') process.exit(42);
    for (const ref of selected) console.log(ref.type + ' ' + ref.sha);
    process.exit(0);
  }

  const tagMarker = '/git/tags/';
  if (endpoint.includes(tagMarker)) {
    const objectSha = endpoint.split(tagMarker)[1];
    const tag = state.tags.find((candidate) => candidate.sha === objectSha);
    if (tag === undefined) process.exit(43);
    record('tag-response', { objectSha, targetSha: tag.targetSha });
    console.log(tag.targetSha);
    process.exit(0);
  }

  if (endpoint.endsWith('/git/refs')) {
    const ref = formValue('ref');
    const sha = formValue('sha');
    if (ref === undefined || sha === undefined) process.exit(44);
    if (state.refs.some((candidate) => candidate.ref === ref)) process.exit(45);
    saveState({
      ...state,
      refs: [...state.refs, { ref, type: 'commit', sha }],
    });
    record('ref-created', { ref, sha });
    process.exit(0);
  }
}

if (args[0] === 'release' && args[1] === 'create') {
  const ref = 'refs/tags/' + process.env.RELEASE_TAG;
  const actualSha = commitForRef(ref);
  const expectedSha = requiredEnv('EXPECTED_TARGET_SHA');
  const correctTagExists = actualSha === expectedSha;
  record('release-observation', { ref, actualSha, expectedSha, correctTagExists });
  process.exit(correctTagExists ? 0 : 46);
}

process.exit(47);
`;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function releaseScript(): string {
  const source = readFileSync(
    join(ROOT, '.github/workflows/release.yml'),
    'utf8',
  );
  const workflow = parseWorkflowYaml(source);
  return (
    stepNamed(workflowJob(workflow, 'release'), 'Create GitHub Release and Tag')
      .run ?? ''
  );
}

function createCommit(
  repository: string,
  contents: string,
  message: string,
): string {
  writeFileSync(join(repository, 'tracked.txt'), contents);
  git(repository, ['add', 'tracked.txt']);
  git(repository, ['commit', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
}

function initialState(
  existingTag: ExistingTag | undefined,
  targetSha: string,
  differentSha: string,
): Record<string, unknown> {
  if (existingTag === 'annotated') {
    return {
      refs: [
        { ref: `refs/tags/${RELEASE_TAG}`, type: 'tag', sha: 'tag-object' },
      ],
      tags: [{ sha: 'tag-object', targetSha }],
    };
  }
  if (existingTag === 'near-miss') {
    return {
      refs: [{ ref: 'refs/tags/v1.2.30', type: 'commit', sha: differentSha }],
      tags: [],
    };
  }
  if (existingTag !== undefined) {
    return {
      refs: [
        {
          ref: `refs/tags/${RELEASE_TAG}`,
          type: 'commit',
          sha: existingTag === 'different' ? differentSha : targetSha,
        },
      ],
      tags: [],
    };
  }
  return { refs: [], tags: [] };
}

function readEvents(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseJsonObject);
}

function runWorkflow(
  repository: string,
  fakeBin: string,
  statePath: string,
  eventLog: string,
  options: ScenarioOptions,
  targetSha: string,
) {
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-c', releaseScript()],
    {
      cwd: repository,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        GH_EVENT_LOG: eventLog,
        GH_REF_STORE: statePath,
        GITHUB_REPOSITORY: REPOSITORY,
        EXPECTED_TARGET_SHA: targetSha,
        FAIL_API_LOOKUP: options.failLookup === true ? 'true' : 'false',
        RELEASE_TAG,
        RELEASE_VERSION,
        RELEASE_BRANCH: options.targetMode === 'branch' ? RELEASE_BRANCH : '',
        SHOULD_CREATE_BRANCH:
          options.targetMode === 'branch' ? 'true' : 'false',
        VSIX_PATH: options.includeVsix === true ? VSIX_PATH : '',
      },
    },
  );
}

function runScenario(options: ScenarioOptions): ScenarioResult {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'release-tag-creation-'));
  const repository = join(temporaryRoot, 'work');
  const fakeBin = join(temporaryRoot, 'bin');
  const statePath = join(temporaryRoot, 'refs.json');
  const eventLog = join(temporaryRoot, 'events.jsonl');

  try {
    mkdirSync(repository);
    mkdirSync(fakeBin);
    git(repository, ['init', '--initial-branch=main']);
    git(repository, ['config', 'user.name', 'Release Test']);
    git(repository, ['config', 'user.email', 'release-test@example.com']);
    const baseSha = createCommit(repository, 'base\n', 'base');
    const releaseSha = createCommit(repository, 'release\n', 'release');
    git(repository, ['branch', RELEASE_BRANCH, releaseSha]);
    const headSha = createCommit(repository, 'nightly\n', 'nightly');
    const targetSha = options.targetMode === 'branch' ? releaseSha : headSha;

    mkdirSync(join(repository, 'packages/cli/dist'), { recursive: true });
    if (options.includeCliTarball !== false) {
      writeFileSync(join(repository, CLI_TARBALL), 'cli tarball');
    }
    mkdirSync(join(repository, 'packages/vscode'), { recursive: true });
    if (options.includeVsix === true) {
      writeFileSync(join(repository, VSIX_PATH), 'vsix');
    }
    writeFileSync(join(repository, 'release-notes.md'), 'Release notes\n');
    writeFileSync(
      statePath,
      JSON.stringify(initialState(options.existingTag, targetSha, baseSha)),
    );
    const fakeGh = join(fakeBin, 'gh');
    writeFileSync(fakeGh, FAKE_GH_SOURCE);
    chmodSync(fakeGh, 0o755);

    const result = runWorkflow(
      repository,
      fakeBin,
      statePath,
      eventLog,
      options,
      targetSha,
    );
    const state = parseJsonObject(readFileSync(statePath, 'utf8'));
    return {
      status: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      events: readEvents(eventLog),
      refs: asRecordArray(state['refs']),
      targetSha,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function eventsNamed(
  result: ScenarioResult,
  kind: string,
): Array<Record<string, unknown>> {
  return result.events.filter((event) => event['kind'] === kind);
}

function invocationArguments(
  result: ScenarioResult,
  predicate: (args: string[]) => boolean,
): string[][] {
  return eventsNamed(result, 'invocation')
    .map((event) => asStringArray(event['args']))
    .filter(predicate);
}

function refCreationInvocations(result: ScenarioResult): string[][] {
  return invocationArguments(
    result,
    (args) => args[0] === 'api' && args[1] === `repos/${REPOSITORY}/git/refs`,
  );
}

function releaseInvocations(result: ScenarioResult): string[][] {
  return invocationArguments(
    result,
    (args) => args[0] === 'release' && args[1] === 'create',
  );
}

function releaseArguments(result: ScenarioResult): string[] {
  const invocation = releaseInvocations(result)[0];
  if (invocation === undefined)
    throw new Error('release create was not invoked');
  return invocation;
}

function releaseRef(
  result: ScenarioResult,
): Record<string, unknown> | undefined {
  return result.refs.find(
    (candidate) => candidate['ref'] === `refs/tags/${RELEASE_TAG}`,
  );
}

function exactReleaseRef(result: ScenarioResult): Record<string, unknown> {
  const ref = releaseRef(result);
  if (ref === undefined) throw new Error('release tag ref was not found');
  return ref;
}

function releaseObservation(result: ScenarioResult): Record<string, unknown> {
  const event = eventsNamed(result, 'release-observation')[0];
  if (event === undefined)
    throw new Error('release observation was not recorded');
  return event;
}

function expectSuccessfulRelease(
  result: ScenarioResult,
  expectedArguments: string[],
): void {
  expect(result.status).toBe(0);
  expect(releaseArguments(result)).toEqual(expectedArguments);
  expect(releaseArguments(result)).not.toContain('--target');
  expect(releaseObservation(result)).toMatchObject({
    ref: `refs/tags/${RELEASE_TAG}`,
    actualSha: result.targetSha,
    expectedSha: result.targetSha,
    correctTagExists: true,
  });
}

const NON_VSIX_RELEASE_ARGUMENTS = [
  'release',
  'create',
  RELEASE_TAG,
  CLI_TARBALL,
  '--title',
  `Release ${RELEASE_TAG}`,
  '--notes-file',
  'release-notes.md',
];

const VSIX_RELEASE_ARGUMENTS = [
  'release',
  'create',
  RELEASE_TAG,
  CLI_TARBALL,
  VSIX_PATH,
  '--title',
  `Release ${RELEASE_TAG}`,
  '--notes-file',
  'release-notes.md',
];

describe('Create GitHub Release and Tag workflow step', () => {
  it('tags the exact release-branch head through the API before creating a non-VSIX release', () => {
    const result = runScenario({ targetMode: 'branch' });

    expectSuccessfulRelease(result, NON_VSIX_RELEASE_ARGUMENTS);
    expect(exactReleaseRef(result)).toMatchObject({
      ref: `refs/tags/${RELEASE_TAG}`,
      type: 'commit',
      sha: result.targetSha,
    });
    expect(refCreationInvocations(result)).toHaveLength(1);
  });

  it('tags the exact nightly HEAD through the API before creating a VSIX release', () => {
    const result = runScenario({ targetMode: 'head', includeVsix: true });

    expectSuccessfulRelease(result, VSIX_RELEASE_ARGUMENTS);
    expect(asString(exactReleaseRef(result)['sha'])).toBe(result.targetSha);
  });

  it('reuses a lightweight tag at the release commit', () => {
    const result = runScenario({
      targetMode: 'branch',
      existingTag: 'lightweight',
    });

    expectSuccessfulRelease(result, NON_VSIX_RELEASE_ARGUMENTS);
    expect(refCreationInvocations(result)).toHaveLength(0);
    expect(result.stdout).toContain('Reusing existing tag');
  });

  it('peels and reuses an annotated tag at the release commit', () => {
    const result = runScenario({
      targetMode: 'branch',
      existingTag: 'annotated',
    });

    expectSuccessfulRelease(result, NON_VSIX_RELEASE_ARGUMENTS);
    expect(eventsNamed(result, 'tag-response')).toHaveLength(1);
    expect(refCreationInvocations(result)).toHaveLength(0);
  });

  it('rejects a tag at a different commit before ref or release creation', () => {
    const result = runScenario({
      targetMode: 'branch',
      existingTag: 'different',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match target commit');
    expect(refCreationInvocations(result)).toHaveLength(0);
    expect(releaseInvocations(result)).toHaveLength(0);
  });

  it('does not treat a prefix-matching tag as the release tag', () => {
    const result = runScenario({
      targetMode: 'branch',
      existingTag: 'near-miss',
    });

    expectSuccessfulRelease(result, NON_VSIX_RELEASE_ARGUMENTS);
    expect(eventsNamed(result, 'matching-response')[0]).toMatchObject({
      candidateRefs: ['refs/tags/v1.2.30'],
      selectedRefs: [],
    });
    expect(asString(exactReleaseRef(result)['sha'])).toBe(result.targetSha);
  });

  it('fails fast when the matching-refs lookup fails', () => {
    const result = runScenario({ targetMode: 'head', failLookup: true });

    expect(result.status).not.toBe(0);
    expect(eventsNamed(result, 'matching-response')).toHaveLength(1);
    expect(refCreationInvocations(result)).toHaveLength(0);
    expect(releaseInvocations(result)).toHaveLength(0);
  });

  it('fails on a missing CLI tarball before any GitHub API call', () => {
    const result = runScenario({
      targetMode: 'head',
      includeCliTarball: false,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `CLI tarball not found at ${CLI_TARBALL}; cannot create release`,
    );
    expect(result.events).toHaveLength(0);
    expect(releaseRef(result)).toBeUndefined();
  });
});

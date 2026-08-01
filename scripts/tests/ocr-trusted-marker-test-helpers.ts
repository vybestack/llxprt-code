/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import vm from 'node:vm';
import { expect } from 'vitest';
import {
  WORKFLOW_PATH,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';
import { asRecord, parseWorkflowYaml, stepWith } from './typed-test-helpers.ts';
import type { WorkflowJob } from './typed-test-helpers.ts';

export const MARKER = '<!-- llxprt-code-ocr-review -->';
export const INLINE_MARKER = '<!-- llxprt-code-ocr-inline -->';

export const FULL_HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
export const FULL_BASE_SHA = '0000000000000000000000000000000000000001';

/**
 * Build a marker comment body containing a valid OCR checkpoint with the
 * given head SHA. Shared across AM2/AM3/AM5/AM6/AM8/AM9 tests.
 */
export function checkpointMarkerBody(headSha: string): string {
  const checkpoint = {
    schema: 1,
    head_sha: headSha,
    base_sha: FULL_BASE_SHA,
    completion_state: 'complete',
    ocr_version: '1.7.17',
    ocr_model: '',
    rules_hash: '',
    policy_hash: '',
    workflow_schema_hash: '',
  };
  const encoded = Buffer.from(JSON.stringify(checkpoint), 'utf8').toString(
    'base64',
  );
  return `${MARKER}\n<!-- ocr-checkpoint:${encoded} -->`;
}
// ---------------------------------------------------------------------------
// Canonical snippet extraction from the .cjs module
// ---------------------------------------------------------------------------

/**
 * Read the canonical snippet text (including sentinel lines) from the
 * .github/scripts/ocr-trusted-marker.cjs module.
 */
export function readCanonicalSnippet(): string {
  const content = readRootFile('.github/scripts/ocr-trusted-marker.cjs');
  const beginLine = '// --- BEGIN OCR TRUSTED MARKER SNIPPET ---';
  const endLine = '// --- END OCR TRUSTED MARKER SNIPPET ---';
  const beginIdx = content.indexOf(beginLine);
  const endIdx = content.indexOf(endLine);
  expect(
    beginIdx,
    'snippet BEGIN sentinel should exist in the module',
  ).toBeGreaterThanOrEqual(0);
  expect(
    endIdx,
    'snippet END sentinel should exist in the module',
  ).toBeGreaterThan(beginIdx);
  return content.slice(beginIdx, endIdx + endLine.length);
}

// ---------------------------------------------------------------------------
// VM harness builders
// ---------------------------------------------------------------------------

export interface FakeUser {
  type: string;
  login: string;
}

export interface FakeComment {
  id: number;
  body: string;
  user: FakeUser;
}

export function trustedBot(login: string): FakeUser {
  return { type: 'Bot', login };
}
export function userAuthor(login: string): FakeUser {
  return { type: 'User', login };
}
export function markerComment(
  id: number,
  body: string,
  user: FakeUser = trustedBot('github-actions[bot]'),
): FakeComment {
  return { id, body, user };
}

export const UNTRUSTED_AUTHORS: ReadonlyArray<readonly [string, FakeUser]> = [
  ['User', userAuthor('attacker')],
  ['coderabbitai[bot]', trustedBot('coderabbitai[bot]')],
] as const;

// ---------------------------------------------------------------------------
// Script loaders
// ---------------------------------------------------------------------------

export function loadScripts() {
  const source = readRootFile(WORKFLOW_PATH);
  const workflow = parseWorkflowYaml(source);
  const jobs = workflow.jobs;
  if (!jobs) throw new Error('workflow should have jobs');
  return { source, workflow, jobs };
}

export function scriptOf(
  job: WorkflowJob | undefined,
  stepName: string,
): string {
  const step = stepNamed(job, stepName);
  const script = stepWith(step)?.['script'];
  if (typeof script !== 'string' || script.trim().length === 0) {
    throw new Error(`${stepName} should have a non-empty github-script body`);
  }
  return script;
}

export function makePaginate() {
  return async <T>(
    fn: (options: unknown) => Promise<{ data: T }>,
    options: unknown,
  ): Promise<T> => {
    const result = await fn(options);
    return result.data;
  };
}

// ---------------------------------------------------------------------------
// In-memory comment store with real pagination
// ---------------------------------------------------------------------------

export interface StoreComment {
  id: number;
  body: string;
  user: FakeUser;
  path?: string;
  line?: number;
  original_line?: number;
  start_line?: number;
  original_start_line?: number;
  side?: string;
  html_url?: string;
}

export interface CommentStore {
  comments: Map<number, StoreComment>;
  nextId: number;
  deletedIds: Set<number>;
}

export function createStore(): CommentStore {
  return {
    comments: new Map(),
    nextId: 1,
    deletedIds: new Set(),
  };
}

export function addToStore(store: CommentStore, comment: StoreComment): void {
  store.comments.set(comment.id, comment);
  if (comment.id >= store.nextId) {
    store.nextId = comment.id + 1;
  }
}

export function makePaginatingOctokit(
  store: CommentStore,
  perPage: number,
  warnings: string[],
  getAuthenticatedThrows: Error | null = null,
  getAuthenticatedLogin: string | null = null,
): Record<string, unknown> {
  return {
    paginate: async <T>(
      fn: (options: unknown) => Promise<{ data: T[] }>,
      options: unknown,
    ): Promise<T[]> => {
      const opts = asRecord(options);
      const perPageNum = Math.max(
        1,
        Number(opts['per_page'] ?? perPage) || perPage,
      );
      const collected: T[] = [];
      let currentPage = 1;
      while (true) {
        const result = await fn({
          ...opts,
          per_page: perPageNum,
          page: currentPage,
        });
        const pageData = result.data;
        collected.push(...pageData);
        if (pageData.length < perPageNum) {
          break;
        }
        currentPage += 1;
      }
      return collected;
    },
    rest: {
      issues: {
        listComments: async (
          opts: Record<string, unknown>,
        ): Promise<{ data: StoreComment[]; status: number }> => {
          const all = [...store.comments.values()].sort((a, b) => a.id - b.id);
          const pp = Math.max(
            1,
            Number(opts['per_page'] ?? perPage) || perPage,
          );
          const page = Math.max(1, Number(opts['page'] ?? 1) || 1);
          const start = (page - 1) * pp;
          const slice = all.slice(start, start + pp);
          return { data: slice, status: 200 };
        },
        createComment: async (
          opts: Record<string, unknown>,
        ): Promise<{ data: StoreComment; status: number }> => {
          const id = store.nextId++;
          const comment: StoreComment = {
            id,
            body: String(opts['body'] ?? ''),
            user: trustedBot('github-actions[bot]'),
            html_url: `https://github.com/test/test/issues/${issueNumberFromOpts(opts)}#issuecomment-${id}`,
          };
          store.comments.set(id, comment);
          return { data: comment, status: 201 };
        },
        updateComment: async (
          opts: Record<string, unknown>,
        ): Promise<{ data: StoreComment; status: number }> => {
          const id = Number(opts['comment_id']);
          const existing = store.comments.get(id);
          if (!existing) throw new Error(`comment ${id} not found`);
          existing.body = String(opts['body'] ?? '');
          return { data: existing, status: 200 };
        },
        deleteComment: async (
          opts: Record<string, unknown>,
        ): Promise<{ status: number }> => {
          const id = Number(opts['comment_id']);
          if (!store.comments.has(id)) {
            warnings.push(`deleteComment: comment ${id} not found`);
          }
          store.comments.delete(id);
          store.deletedIds.add(id);
          return { status: 204 };
        },
      },
      pulls: {
        listReviewComments: async (
          _opts: Record<string, unknown>,
        ): Promise<{ data: StoreComment[]; status: number }> => {
          const all = [...store.comments.values()]
            .filter((c) => c.path !== undefined)
            .sort((a, b) => a.id - b.id);
          return { data: all, status: 200 };
        },
      },
      users: {
        getAuthenticated: async (): Promise<{ data: { login: string } }> => {
          if (getAuthenticatedThrows instanceof Error)
            throw getAuthenticatedThrows;
          return { data: { login: getAuthenticatedLogin ?? '' } };
        },
      },
    },
  };
}

function issueNumberFromOpts(opts: Record<string, unknown>): number {
  return Number(opts['issue_number'] ?? 0);
}

export function sandboxGlobals(warnings: string[]): Record<string, unknown> {
  return {
    setTimeout: (fn: () => void): number => {
      if (fn) fn();
      return 0;
    },
    clearTimeout: (): void => {},
    console: {
      log: (): void => {},
      warn: (m: unknown): void => {
        warnings.push(String(m));
      },
      error: (): void => {},
    },
    Buffer,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    Error,
    Promise,
    Date,
    Array,
    Object,
    Set,
    parseInt,
    RegExp,
  };
}

export async function runScript(
  script: string,
  github: Record<string, unknown>,
  core: Record<string, unknown>,
  context: Record<string, unknown>,
  env: Record<string, string>,
  warnings: string[],
): Promise<string | null> {
  const sandbox = {
    github,
    core,
    context,
    process: { env },
    ...sandboxGlobals(warnings),
    fs: {
      readFileSync: (): string => '',
      writeFileSync: (): void => {},
      existsSync: (): boolean => false,
    },
    require: (mod: string): unknown => {
      if (mod === 'fs') {
        return {
          readFileSync: (): string => '',
          writeFileSync: (): void => {},
          existsSync: (): boolean => false,
        };
      }
      return undefined;
    },
    crypto: {
      createHash: (): { update(): { digest(): string } } => ({
        update: () => ({ digest: () => 'deadbeef' }),
      }),
    },
  };
  try {
    await vm.runInNewContext(
      `(async () => { ${script} })()`,
      asRecord(sandbox),
    );
    return null;
  } catch (error) {
    return String(error);
  }
}

export function makeCore(
  warnings: string[],
  outputs?: Record<string, string>,
): Record<string, unknown> & { _getFailure: () => string | null } {
  let failure: string | null = null;
  return {
    setOutput: (name: string | number, value: unknown): void => {
      if (outputs) outputs[name] = String(value);
    },
    warning: (message: unknown): void => {
      warnings.push(String(message));
    },
    info: (): void => {},
    setFailed: (message: unknown): void => {
      failure = String(message);
    },
    _getFailure: (): string | null => failure,
  };
}

export interface CheckpointReaderParams {
  script: string;
  prNumber?: string;
  ocrBotLogin?: string;
  getAuthenticatedLogin?: string | null;
  getAuthenticatedThrows?: Error | null;
  listComments?: FakeComment[];
}

export interface CheckpointReaderResult {
  outputs: Record<string, string>;
  warnings: string[];
  failure: string | null;
}

export async function executeCheckpointReader({
  script,
  prNumber = '42',
  ocrBotLogin = '',
  getAuthenticatedLogin = null,
  getAuthenticatedThrows = null,
  listComments = [],
}: CheckpointReaderParams): Promise<CheckpointReaderResult> {
  const outputs: Record<string, string> = {};
  const warnings: string[] = [];
  const github = {
    paginate: makePaginate(),
    rest: {
      users: {
        getAuthenticated: async (): Promise<{ data: { login: string } }> => {
          if (getAuthenticatedThrows instanceof Error)
            throw getAuthenticatedThrows;
          return { data: { login: getAuthenticatedLogin ?? '' } };
        },
      },
      issues: {
        listComments: async (): Promise<{ data: FakeComment[] }> => ({
          data: listComments,
        }),
      },
    },
  };
  const core = makeCore(warnings, outputs);
  const failure = await runScript(
    script,
    asRecord(github),
    core,
    { repo: { owner: 'test-owner', repo: 'test-repo' } },
    { PR_NUMBER: prNumber, OCR_BOT_LOGIN: ocrBotLogin },
    warnings,
  );
  return {
    outputs,
    warnings,
    failure: failure ?? core._getFailure(),
  };
}

// ---------------------------------------------------------------------------
// Auto-review gate VM harness
// ---------------------------------------------------------------------------

export interface AutoGateParams {
  script: string;
  eventName?: string;
  eventAction?: string;
  prNumber?: string;
  autoReviewLimit?: string;
  ocrBotLogin?: string;
  commentBody?: string;
  changesFrom?: string;
  commentUserType?: string;
  commentUserLogin?: string;
  commentId?: string;
  listComments?: FakeComment[];
  getAuthenticatedLogin?: string | null;
  getAuthenticatedThrows?: Error | null;
}

export interface AutoGateResult {
  outputs: Record<string, string>;
  warnings: string[];
  updateCalls: Array<Record<string, unknown>>;
  failure: string | null;
}

export async function executeAutoGate({
  script,
  eventName = 'pull_request_target',
  eventAction = 'synchronize',
  prNumber = '42',
  autoReviewLimit = '',
  ocrBotLogin = '',
  commentBody = '',
  changesFrom = '',
  commentUserType = 'Bot',
  commentUserLogin = 'github-actions[bot]',
  commentId = '999',
  listComments = [],
  getAuthenticatedLogin = null,
  getAuthenticatedThrows = null,
}: AutoGateParams): Promise<AutoGateResult> {
  const outputs: Record<string, string> = {};
  const warnings: string[] = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const github = {
    paginate: makePaginate(),
    rest: {
      users: {
        getAuthenticated: async (): Promise<{ data: { login: string } }> => {
          if (getAuthenticatedThrows instanceof Error)
            throw getAuthenticatedThrows;
          return { data: { login: getAuthenticatedLogin ?? '' } };
        },
      },
      issues: {
        listComments: async (): Promise<{ data: FakeComment[] }> => ({
          data: listComments,
        }),
        updateComment: async (
          opts: Record<string, unknown>,
        ): Promise<{ status: number }> => {
          updateCalls.push(opts);
          return { status: 200 };
        },
      },
    },
  };
  const core = makeCore(warnings, outputs);
  const context = {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    eventName,
    payload: {
      action: eventAction,
      issue: { number: Number(prNumber), pull_request: {} },
      comment: commentBody
        ? {
            body: commentBody,
            user: { type: commentUserType, login: commentUserLogin },
            id: Number(commentId),
          }
        : undefined,
      changes: changesFrom ? { body: { from: changesFrom } } : undefined,
    },
  };
  const failure = await runScript(
    script,
    asRecord(github),
    core,
    context,
    {
      PR_NUMBER: prNumber,
      OCR_AUTO_REVIEW_LIMIT: autoReviewLimit,
      OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
      OCR_BOT_LOGIN: ocrBotLogin,
      EVENT_NAME: eventName,
      EVENT_ACTION: eventAction,
      COMMENT_BODY: commentBody,
      COMMENT_USER_TYPE: commentUserType,
      COMMENT_USER_LOGIN: commentUserLogin,
      COMMENT_ID: commentId,
      CHANGES_FROM: changesFrom,
    },
    warnings,
  );
  return {
    outputs,
    warnings,
    updateCalls,
    failure: failure ?? core._getFailure(),
  };
}

// ---------------------------------------------------------------------------
// Post-suspension VM harness
// ---------------------------------------------------------------------------

export interface PostSuspensionParams {
  script: string;
  prNumber?: string;
  currentCount?: string;
  ocrBotLogin?: string;
  listComments?: FakeComment[];
  getAuthenticatedLogin?: string | null;
  getAuthenticatedThrows?: Error | null;
}

export interface PostSuspensionResult {
  warnings: string[];
  deleteCalls: number[];
  updateCalls: Array<Record<string, unknown>>;
  createCalls: Array<Record<string, unknown>>;
  failure: string | null;
}

export async function executePostSuspension({
  script,
  prNumber = '42',
  currentCount = '2',
  ocrBotLogin = '',
  listComments = [],
  getAuthenticatedLogin = null,
  getAuthenticatedThrows = null,
}: PostSuspensionParams): Promise<PostSuspensionResult> {
  const warnings: string[] = [];
  const deleteCalls: number[] = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const createCalls: Array<Record<string, unknown>> = [];
  const github = {
    paginate: makePaginate(),
    rest: {
      users: {
        getAuthenticated: async (): Promise<{ data: { login: string } }> => {
          if (getAuthenticatedThrows instanceof Error)
            throw getAuthenticatedThrows;
          return { data: { login: getAuthenticatedLogin ?? '' } };
        },
      },
      issues: {
        listComments: async (): Promise<{ data: FakeComment[] }> => ({
          data: listComments,
        }),
        deleteComment: async (opts: Record<string, unknown>): Promise<void> => {
          deleteCalls.push(Number(opts['comment_id']));
        },
        updateComment: async (opts: Record<string, unknown>): Promise<void> => {
          updateCalls.push(opts);
        },
        createComment: async (opts: Record<string, unknown>): Promise<void> => {
          createCalls.push(opts);
        },
      },
    },
  };
  const core = makeCore(warnings);
  const failure = await runScript(
    script,
    asRecord(github),
    core,
    { repo: { owner: 'test-owner', repo: 'test-repo' } },
    {
      PR_NUMBER: prNumber,
      CURRENT_COUNT: currentCount,
      OCR_AUTO_REVIEW_LIMIT: '2',
      OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
      OCR_BOT_LOGIN: ocrBotLogin,
    },
    warnings,
  );
  return {
    warnings,
    deleteCalls,
    updateCalls,
    createCalls,
    failure: failure ?? core._getFailure(),
  };
}

// ---------------------------------------------------------------------------
// Post-OCR-results count logic
// ---------------------------------------------------------------------------

export type LoadedFunctions = Record<string, (...args: unknown[]) => unknown>;

export function extractLoadedFunctions(
  sandbox: Record<string, unknown>,
): LoadedFunctions {
  const raw = sandbox['__FUNCTIONS__'];
  if (!raw || typeof raw !== 'object') {
    throw new Error('Failed to load functions: __FUNCTIONS__ not defined');
  }
  const result: LoadedFunctions = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'function') {
      const fn = (...args: unknown[]) => val(...args);
      result[key] = fn;
    }
  }
  return result;
}

export interface SnippetContext {
  snippetText: string;
  requestedSnippetFuncs: string[];
  extraFuncs: string[];
  extraSources: string[];
  allNames: string[];
}

/**
 * Shared extraction of the canonical trusted-marker snippet text and
 * the requested/extra function partitioning from a workflow script.
 * Used by both loadFunctionsFromScript and loadFunctionsFromScriptWithGithub
 * to avoid duplicating sentinel detection and source extraction.
 */
function loadSnippetContext(
  script: string,
  functionNames: string[],
): SnippetContext {
  const snippetFuncNames = [
    'OCR_DEFAULT_TRUSTED_MARKER_LOGINS',
    'normalizeTrustedMarkerLogin',
    'resolveTrustedMarkerLogins',
    'isTrustedMarkerAuthor',
    'isTrustedMarkerComment',
    'trustedMarkerComments',
    'canonicalMarkerComment',
    'newestTrustedMarkerMatching',
    'parseHiddenAutoCount',
    'resolveHiddenAutoCount',
  ];
  const beginLine = '// --- BEGIN OCR TRUSTED MARKER SNIPPET ---';
  const endLine = '// --- END OCR TRUSTED MARKER SNIPPET ---';
  const beginIdx = script.indexOf(beginLine);
  const endIdx = script.indexOf(endLine);
  const snippetText =
    beginIdx >= 0 && endIdx >= 0
      ? script.slice(beginIdx, endIdx + endLine.length)
      : '';
  const requestedSnippetFuncs = functionNames.filter((name) =>
    snippetFuncNames.includes(name),
  );
  const extraFuncs = functionNames.filter(
    (name) => !snippetFuncNames.includes(name),
  );
  const extraSources = extraFuncs.map((name) =>
    extractFunctionSource(script, name),
  );
  const allNames = [...requestedSnippetFuncs, ...extraFuncs];
  return {
    snippetText,
    requestedSnippetFuncs,
    extraFuncs,
    extraSources,
    allNames,
  };
}

export function loadFunctionsFromScript(
  script: string,
  functionNames: string[],
): LoadedFunctions {
  const { snippetText, extraSources, allNames } = loadSnippetContext(
    script,
    functionNames,
  );
  const sandbox = sandboxGlobals([]);
  vm.runInNewContext(
    `${snippetText}\n${extraSources.join('\n')}\n__FUNCTIONS__ = { ${allNames.join(', ')} };`,
    sandbox,
  );
  return extractLoadedFunctions(sandbox);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Resolve a field (owner or repo) from the context.repo object with
 * explicit boundary validation. Throws a clear error naming the missing
 * field when it is absent or not a non-empty string — no type assertions.
 */
function resolveRepoField(
  context: Record<string, unknown>,
  field: string,
): string {
  const repo = asRecord(context)['repo'];
  if (!isRecordLike(repo)) {
    throw new Error(
      `context.repo is missing or not a record (cannot resolve ${field})`,
    );
  }
  const value = repo[field];
  if (!isNonEmptyString(value)) {
    throw new Error(
      `context.repo.${field} is missing or not a non-empty string`,
    );
  }
  return value;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Load and execute functions from the workflow script that depend on
 * `github`, `core`, `context`, and `process.env` being available in the
 * sandbox. The functions are defined in a context where these globals
 * are pre-populated, so they can be called directly.
 */
export function loadFunctionsFromScriptWithGithub(
  script: string,
  functionNames: string[],
  github: Record<string, unknown>,
  core: Record<string, unknown>,
  context: Record<string, unknown>,
  env: Record<string, string>,
  warnings: string[],
): LoadedFunctions {
  const { snippetText, extraSources, allNames } = loadSnippetContext(
    script,
    functionNames,
  );
  const globals = sandboxGlobals(warnings);
  const sandbox: Record<string, unknown> = {
    ...globals,
    github,
    core,
    context,
    process: { env },
    fs: {
      readFileSync: (): string => '',
      writeFileSync: (): void => {},
      existsSync: (): boolean => false,
    },
    require: (mod: string): unknown => {
      if (mod === 'fs') {
        return {
          readFileSync: (): string => '',
          writeFileSync: (): void => {},
          existsSync: (): boolean => false,
        };
      }
      return undefined;
    },
    crypto: {
      createHash: (): { update(): { digest(): string } } => ({
        update: () => ({ digest: () => 'deadbeef' }),
      }),
    },
  };
  const envPrNumber = env['PR_NUMBER'] || '42';
  const ctxOwner = resolveRepoField(context, 'owner');
  const ctxRepo = resolveRepoField(context, 'repo');
  const helperFuncNames = [
    'escapeRegExp',
    'redactSecretDiagnostics',
    'unrenderFindingText',
  ];
  const helperSources = helperFuncNames
    .map((name) => {
      try {
        return extractFunctionSource(script, name);
      } catch {
        return '';
      }
    })
    .filter((s) => s.length > 0);
  const varSetup = `var MARKER = '<!-- llxprt-code-ocr-review -->'; var INLINE_MARKER = '<!-- llxprt-code-ocr-inline -->'; var trustedLogins = resolveTrustedMarkerLogins('', ''); var owner = ${JSON.stringify(ctxOwner)}; var repo = ${JSON.stringify(ctxRepo)}; var number = Number(${JSON.stringify(envPrNumber)}); var ocrTokenForRedaction = ''; var ocrUrlForRedaction = '';`;
  vm.runInNewContext(
    `${snippetText}\n${varSetup}\n${helperSources.join('\n')}\n${extraSources.join('\n')}\n__FUNCTIONS__ = { ${allNames.join(', ')} };`,
    sandbox,
  );
  return extractLoadedFunctions(sandbox);
}

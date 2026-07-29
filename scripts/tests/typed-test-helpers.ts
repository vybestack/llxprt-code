/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Typed test helpers that eliminate type assertions (`as`, `!`) from
 * converted test files.
 *
 * These helpers provide runtime-validated access to:
 * - FakeState issue/comment/label structures (from assign-helpers fake gh)
 * - GitHub Actions workflow YAML documents
 * - VM sandbox function return values
 * - Error objects from child_process / execFileSync
 * - JSON.parse results
 *
 * Every accessor either returns a typed value or throws with a clear
 * diagnostic — never silently coerces via `as`.
 */

import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Primitive runtime narrowing helpers
// ---------------------------------------------------------------------------

export function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new Error(`expected string, got ${typeof value}`);
}

export function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value);
}

export function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  throw new Error(`expected number, got ${typeof value}`);
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`expected boolean, got ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Record / Array narrowing helpers
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(
    `expected object/record, got ${value === null ? 'null' : typeof value}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asOptionalRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return asRecord(value);
}

export function asStringArray(value: unknown): string[] {
  if (!isStringArray(value)) throw new Error('expected array of strings');
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Narrow unknown to an array without element-type validation. Returns an
 * empty array for non-array values. The element type is `unknown` — callers
 * must narrow elements themselves (e.g. via asRecord).
 */
export function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value;
}

/**
 * Narrow unknown to an array of records with runtime validation.
 */
export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!isRecordArray(value)) throw new Error('expected array of records');
  return value;
}

function isRecordArray(
  value: unknown,
): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord);
}

/**
 * Narrow unknown to an optional array of records.
 */
export function asOptionalRecordArray(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) return undefined;
  return asRecordArray(value);
}

/**
 * Narrow unknown to a function type for VM sandbox results.
 */
export function asVmFunction(value: unknown): (...args: unknown[]) => unknown {
  if (!isVmFunction(value)) throw new Error('expected function');
  return value;
}

function isVmFunction(
  value: unknown,
): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

export function asRecordMap(
  value: unknown,
): Record<string, Record<string, unknown>> {
  if (!isRecordMap(value)) {
    throw new Error('expected Record<string, Record<string, unknown>>');
  }
  return value;
}

/**
 * Type predicate that validates each value of an object is itself a record.
 * Returns the original reference (no copy) for mutation-sensitive tests.
 */
function isRecordMap(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return false;
  for (const val of Object.values(value)) {
    if (!isRecord(val)) return false;
  }
  return true;
}

export function asNumberRecord(value: unknown): Record<string, number> {
  if (!isNumberRecord(value)) throw new Error('expected record of numbers');
  return value;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'number')
  );
}

// ---------------------------------------------------------------------------
// FakeState typed accessors
// ---------------------------------------------------------------------------

export interface FakeIssue {
  number: number;
  _assignees: string[];
  _label_names: string[];
  [key: string]: unknown;
}

export interface FakeComment {
  id: number;
  issue_number?: number;
  body: string | string[];
  user: { login: string; type: string };
  created_at?: string;
  updated_at?: string;
  hiddenLists?: number;
  [key: string]: unknown;
}

function parseFakeIssue(raw: unknown): FakeIssue {
  const rec = asRecord(raw);
  const assignees = rec['_assignees'];
  const labelNames = rec['_label_names'];
  if (!Array.isArray(assignees))
    throw new Error('issue should have _assignees array');
  if (!Array.isArray(labelNames))
    throw new Error('issue should have _label_names array');
  return {
    ...rec,
    number: asNumber(rec['number']),
    _assignees: assignees.map((a) => asString(a)),
    _label_names: labelNames.map((a) => asString(a)),
  };
}

function parseFakeComment(raw: unknown): FakeComment {
  const rec = asRecord(raw);
  const body = rec['body'];
  const userRec = asRecord(rec['user']);
  return {
    id: asNumber(rec['id']),
    issue_number: asNumber(rec['issue_number']),
    body:
      typeof body === 'string' || Array.isArray(body)
        ? body
        : String(body ?? ''),
    user: {
      login: asString(userRec['login']),
      type: asString(userRec['type']),
    },
    created_at: asString(rec['created_at']),
    updated_at: asString(rec['updated_at']),
  };
}

/**
 * Extract typed issues map from a fake-gh state object.
 */
export function stateIssues(
  state: Record<string, unknown>,
): Record<string, FakeIssue> {
  const raw = asRecord(state['issues']);
  const result: Record<string, FakeIssue> = {};
  for (const [key, val] of Object.entries(raw)) {
    result[key] = parseFakeIssue(val);
  }
  return result;
}

/**
 * Get a single typed issue from fake-gh state by number.
 */
export function stateIssue(
  state: Record<string, unknown>,
  issueNumber: string | number,
): FakeIssue {
  const issues = stateIssues(state);
  const key = String(issueNumber);
  if (!(key in issues)) {
    throw new Error(`issue ${issueNumber} should exist in state`);
  }
  return issues[key];
}

/**
 * Get all PRs from fake-gh state, typed as FakeIssue records.
 */
export function statePrs(
  state: Record<string, unknown>,
): Record<string, FakeIssue> {
  const raw = asRecord(state['prs']);
  const result: Record<string, FakeIssue> = {};
  for (const [key, val] of Object.entries(raw)) {
    result[key] = parseFakeIssue(val);
  }
  return result;
}

/**
 * Get a single typed PR from fake-gh state by number.
 */
export function statePr(
  state: Record<string, unknown>,
  prNumber: string | number,
): FakeIssue {
  const prs = statePrs(state);
  const key = String(prNumber);
  if (!(key in prs)) {
    throw new Error(`PR ${prNumber} should exist in state`);
  }
  return prs[key];
}

/**
 * Extract typed comments array from a fake-gh state object.
 */
export function stateComments(state: Record<string, unknown>): FakeComment[] {
  const comments = state['comments'];
  if (!Array.isArray(comments)) {
    throw new Error('state should have comments array');
  }
  return comments.map(parseFakeComment);
}

/**
 * Extract typed labels map from a fake-gh state object.
 */
export function stateLabels(
  state: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  return asRecordMap(state['labels']);
}

/**
 * Extract the operation log from fake-gh state.
 */
export function stateOpLog(
  state: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const log = state['_op_log'];
  if (!Array.isArray(log)) {
    throw new Error('state should have _op_log array');
  }
  return log.map(asRecord);
}

// ---------------------------------------------------------------------------
// Workflow YAML typed accessors
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  id?: string;
  if?: string;
  [key: string]: unknown;
}

export interface WorkflowJob {
  name?: string;
  'runs-on'?: string | string[];
  steps?: WorkflowStep[];
  if?: string;
  env?: Record<string, unknown>;
  concurrency?: Record<string, unknown> | string;
  permissions?: Record<string, unknown>;
  needs?: string | string[];
  strategy?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkflowDocument {
  name?: string;
  on?: Record<string, unknown>;
  true?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  env?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
  concurrency?: Record<string, unknown> | string;
  [key: string]: unknown;
}

function parseStep(raw: unknown): WorkflowStep {
  const rec = asRecord(raw);
  const step: WorkflowStep = { ...rec };
  if (typeof rec['name'] === 'string') step.name = rec['name'];
  if (typeof rec['run'] === 'string') step.run = rec['run'];
  if (typeof rec['id'] === 'string') step.id = rec['id'];
  if (typeof rec['if'] === 'string') step.if = rec['if'];
  if (rec['with'] !== undefined) step.with = asRecord(rec['with']);
  if (rec['env'] !== undefined) step.env = asRecord(rec['env']);
  return step;
}

function parseJob(raw: unknown): WorkflowJob {
  const rec = asRecord(raw);
  const job: WorkflowJob = { ...rec };
  if (typeof rec['name'] === 'string') job.name = rec['name'];
  if (typeof rec['if'] === 'string') job.if = rec['if'];
  if (rec['env'] !== undefined) job.env = asRecord(rec['env']);
  if (rec['permissions'] !== undefined)
    job.permissions = asRecord(rec['permissions']);
  if (Array.isArray(rec['steps'])) {
    job.steps = rec['steps'].map(parseStep);
  }
  if (rec['concurrency'] !== undefined) {
    if (typeof rec['concurrency'] === 'string') {
      job.concurrency = rec['concurrency'];
    } else {
      job.concurrency = asRecord(rec['concurrency']);
    }
  }
  return job;
}

/**
 * Parse a GitHub Actions workflow YAML document into a typed structure.
 * Replaces `yaml.load(source) as Record<string, unknown>`.
 */
export function parseWorkflowYaml(source: string): WorkflowDocument {
  const loaded = yaml.load(source);
  const rec = asRecord(loaded);
  const doc: WorkflowDocument = { ...rec };
  if (rec['on'] !== undefined) doc.on = asRecord(rec['on']);
  if (rec['true'] !== undefined) doc.true = asRecord(rec['true']);
  if (rec['permissions'] !== undefined)
    doc.permissions = asRecord(rec['permissions']);
  if (rec['env'] !== undefined) doc.env = asRecord(rec['env']);
  if (rec['jobs'] !== undefined) {
    const jobsRaw = asRecord(rec['jobs']);
    const jobs: Record<string, WorkflowJob> = {};
    for (const [key, val] of Object.entries(jobsRaw)) {
      jobs[key] = parseJob(val);
    }
    doc.jobs = jobs;
  }
  if (rec['concurrency'] !== undefined) {
    if (typeof rec['concurrency'] === 'string') {
      doc.concurrency = rec['concurrency'];
    } else {
      doc.concurrency = asRecord(rec['concurrency']);
    }
  }
  return doc;
}

/**
 * Get a job from a workflow document by name.
 * Throws if the job does not exist.
 */
export function workflowJob(
  workflow: WorkflowDocument,
  name: string,
): WorkflowJob {
  const jobs = workflow.jobs;
  if (!jobs) throw new Error('workflow should have jobs');
  const job = jobs[name];
  if (!job) throw new Error(`workflow should contain job: ${name}`);
  return job;
}

/**
 * Get a job from a workflow document by name, or undefined.
 */
export function workflowJobOptional(
  workflow: WorkflowDocument,
  name: string,
): WorkflowJob | undefined {
  return workflow.jobs?.[name];
}

/**
 * Get the `on` section of a workflow (handles `on` vs reserved `true` key).
 */
export function workflowOn(
  workflow: WorkflowDocument,
): Record<string, unknown> {
  return workflow.on ?? workflow.true ?? {};
}

/**
 * Get steps from a workflow job.
 */
export function jobSteps(job: WorkflowJob | undefined): WorkflowStep[] {
  return job?.steps ?? [];
}

/**
 * Find a step by name in a workflow job.
 */
export function findStep(
  job: WorkflowJob | undefined,
  name: string,
): WorkflowStep | undefined {
  return jobSteps(job).find((s) => s.name === name);
}

/**
 * Find a step by name in a steps array.
 */
export function findStepInArray(
  steps: WorkflowStep[],
  name: string,
): WorkflowStep | undefined {
  return steps.find((s) => s.name === name);
}

/**
 * Get a field value from a step (returns unknown — narrow with asString etc.).
 */
export function stepFieldValue(
  step: WorkflowStep | undefined,
  field: string,
): unknown {
  if (!step) throw new Error('step should be defined');
  const val = step[field];
  if (val === undefined) throw new Error(`step.${field} should be defined`);
  return val;
}

/**
 * Get `with` input from a workflow step.
 */
export function stepWith(
  step: WorkflowStep | undefined,
): Record<string, unknown> {
  if (!step || !step.with) throw new Error('step should have a `with` section');
  return step.with;
}

/**
 * Get `env` from a workflow step.
 */
export function stepEnv(
  step: WorkflowStep | undefined,
): Record<string, unknown> | undefined {
  return step?.env;
}

/**
 * Get `if` condition from a workflow step or job.
 */
export function jobIf(job: { if?: string } | undefined): string | undefined {
  return job?.if;
}

// ---------------------------------------------------------------------------
// VM sandbox function result helpers
// ---------------------------------------------------------------------------

/**
 * Call a VM-loaded function and return the result as a Record.
 */
export function vmResultRecord(
  fn: (...args: unknown[]) => unknown,
  ...args: unknown[]
): Record<string, unknown> {
  return asRecord(fn(...args));
}

/**
 * Call a VM-loaded function and return the result as a string.
 */
export function vmResultString(
  fn: (...args: unknown[]) => unknown,
  ...args: unknown[]
): string {
  return asString(fn(...args));
}

/**
 * Call a VM-loaded function and return the result as a string array.
 */
export function vmResultStringArray(
  fn: (...args: unknown[]) => unknown,
  ...args: unknown[]
): string[] {
  return asStringArray(fn(...args));
}

/**
 * Get a typed sub-record from a VM result record.
 */
export function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return asRecord(record[field]);
}

/**
 * Get an optional typed sub-record from a VM result record.
 */
export function optionalRecordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  return asOptionalRecord(record[field]);
}

/**
 * Get a typed number record (Record<string, number>) from a VM result field.
 */
export function numberRecordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, number> {
  return asNumberRecord(record[field]);
}

/**
 * Get a typed string array from a VM result record field.
 */
export function stringArrayField(
  record: Record<string, unknown>,
  field: string,
): string[] {
  return asStringArray(record[field]);
}

// ---------------------------------------------------------------------------
// Error / child_process result helpers
// ---------------------------------------------------------------------------

export interface ExecError {
  stderr?: string;
  stdout?: string;
  status?: number;
  code?: string | number;
  signal?: string;
  message?: string;
}

/**
 * Narrow an unknown caught value to an ExecError-like object.
 * Validates shape at runtime without type assertions.
 */
export function asExecError(error: unknown): ExecError {
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const rec: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(error)) {
      rec[key] = val;
    }
    return {
      stderr: typeof rec['stderr'] === 'string' ? rec['stderr'] : undefined,
      stdout: typeof rec['stdout'] === 'string' ? rec['stdout'] : undefined,
      status: typeof rec['status'] === 'number' ? rec['status'] : undefined,
      code:
        typeof rec['code'] === 'string' || typeof rec['code'] === 'number'
          ? rec['code']
          : undefined,
      signal: typeof rec['signal'] === 'string' ? rec['signal'] : undefined,
      message: typeof rec['message'] === 'string' ? rec['message'] : undefined,
    };
  }
  return { message: String(error) };
}

/**
 * Extract a string field from an unknown error object.
 */
export function errorField(error: unknown, field: string): string {
  if (
    error !== null &&
    error !== undefined &&
    typeof error === 'object' &&
    Object.prototype.hasOwnProperty.call(error, field)
  ) {
    const rec: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(error)) {
      rec[key] = val;
    }
    const value = rec[field];
    return value === undefined || value === null ? 'none' : String(value);
  }
  return 'none';
}

// ---------------------------------------------------------------------------
// JSON.parse typed helpers
// ---------------------------------------------------------------------------

/**
 * Parse JSON and return a typed Record.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  return asRecord(JSON.parse(text));
}

/**
 * Parse JSON and return a typed array of records.
 */
export function parseJsonRecords(text: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('expected JSON array');
  return parsed.map(asRecord);
}

// ---------------------------------------------------------------------------
// Process env helpers
// ---------------------------------------------------------------------------

/**
 * Get a required environment variable as string, throwing if undefined.
 * Replaces `process.env.X!`.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`environment variable ${name} should be defined`);
  }
  return value;
}

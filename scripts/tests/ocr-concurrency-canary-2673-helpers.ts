/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync, spawn } from 'node:child_process';

/**
 * The embedded monitor and metrics scripts are CommonJS files designed for
 * Node's HTTP implementation. Under Bun, process.execPath points to the Bun
 * binary, whose HTTP error/abort event ordering differs from Node's, causing
 * monitor tests to fail or hang. Use Node to run these subprocess scripts so
 * the monitor's HTTP behavior matches what the test assertions expect.
 */
const nodeExecutable: string =
  typeof Bun !== 'undefined' ? 'node' : process.execPath;
import type { ChildProcessByStdio } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import type { Readable } from 'node:stream';
import {
  asOptionalRecord,
  asRecord,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

const requireFromModule = createRequire(import.meta.url);
const canaryModule = requireFromModule(
  '../../.github/scripts/ocr-canary-metrics.cjs',
) as {
  buildCanaryMetrics: (input: unknown) => Record<string, unknown>;
};

export const REPRESENTATIVE_RESULT = {
  status: 'success',
  summary: {
    files_reviewed: 2,
    comments: 3,
    total_tokens: 5000,
    input_tokens: 4000,
    output_tokens: 1000,
    cache_read_tokens: 2000,
    cache_write_tokens: 300,
    elapsed: '25s',
  },
  comments: [
    { category: 'security', severity: 'critical' },
    { category: '', severity: 'undocumented-severity' },
    {},
  ],
};

export const REPRESENTATIVE_TELEMETRY = {
  schema_version: 1,
  monitor_sha256: '1'.repeat(64),
  bind_address: '127.0.0.1',
  target_protocol: 'https:',
  shutdown_signal: 'SIGTERM',
  shutdown_complete: true,
  total_requests: 3,
  upstream_errors: 0,
  responses_by_status: { 200: 2, 429: 1 },
  http_429_responses: 1,
  retry_events: 1,
  retry_count_header_missing: 0,
  retry_count_header_malformed: 0,
};

export const REPRESENTATIVE_TIMING = {
  schema_version: 1,
  command_wall_seconds: 25.25,
  exit_code: 0,
};

export const OBSERVED_OCR_VERSION_OUTPUT =
  'open-code-review v1.7.16 (a0b49d5b) linux/amd64\n' +
  'built at: 2026-07-24T15:49:28Z\n' +
  'https://github.com/alibaba/open-code-review\n';

export function completeMetadata(overrides = {}) {
  return {
    runUrl: 'https://github.com/owner/repo/actions/runs/123',
    runId: '123',
    prNumber: '2610',
    trustedBaseSha: 'a'.repeat(40),
    mergeBaseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    concurrency: '3',
    expectedOcrVersion: '1.7.16',
    actualOcrVersion: '1.7.16',
    workflowSha: 'c'.repeat(40),
    endpointResolutionSource: 'environment',
    normalizedModel: 'stepfun/step-3.5-flash',
    protocol: 'openai',
    language: 'English',
    useAnthropic: false,
    reviewTimeoutMinutes: '30',
    ruleJsonSha256: 'd'.repeat(64),
    providerUrlSha256: 'e'.repeat(64),
    configuredOcrSettingsSha256: 'f'.repeat(64),
    ocrConfigFileSha256: '3'.repeat(64),
    backgroundEnabled: false,
    backgroundContextSha256: null,
    monitorSha256: '1'.repeat(64),
    audience: 'agent',
    format: 'json',
    canonicalConfigFingerprint: '2'.repeat(64),
    ...overrides,
  };
}

export function buildInput(overrides = {}) {
  return {
    resultText: JSON.stringify(REPRESENTATIVE_RESULT),
    exitCodeText: '0\n',
    commandTiming: REPRESENTATIVE_TIMING,
    transportTelemetry: REPRESENTATIVE_TELEMETRY,
    metadata: completeMetadata(),
    ...overrides,
  };
}

export function evaluateOcrConcurrency(
  expression: string,
  { eventName, concurrency = '' }: { eventName: string; concurrency?: string },
) {
  const body = expression
    .trim()
    .replace(/^\$\{\{/, '')
    .replace(/\}\}$/, '')
    .trim();
  return vm.runInNewContext(body, {
    github: { event_name: eventName },
    inputs: { concurrency },
  });
}

export function extractEmbeddedSource(
  run: string,
  fileName: string,
  delimiter: string,
): string {
  const opening = `cat > ${fileName} <<'${delimiter}'\n`;
  const start = run.indexOf(opening);
  const end = run.indexOf(`\n${delimiter}\n`, start + opening.length);
  if (start < 0) {
    throw new Error(`${fileName} should have embedded source`);
  }
  if (!(end > start)) {
    throw new Error(`${fileName} source should be terminated`);
  }
  return run.slice(start + opening.length, end);
}

export function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started >= timeoutMs) {
        reject(new Error('Timed out waiting for transport monitor state'));
      } else {
        setTimeout(poll, 20);
      }
    };
    poll();
  });
}

export function listen(
  server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const addr = server.address();
      if (addr !== null && typeof addr !== 'string') {
        resolve(addr.port);
      } else {
        reject(new Error('Could not determine listen port'));
      }
    });
  });
}

export function closeServer(
  server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const closeAll = server as unknown as {
      closeAllConnections?: () => void;
    };
    if (typeof closeAll.closeAllConnections === 'function') {
      closeAll.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

export interface ProxyRequestOptions {
  retryCount: string | null;
  body: string;
  authorization: string;
  pathSuffix?: string;
  headers?: Record<string, string>;
  onRequest?: (request: http.ClientRequest) => void;
  onResponse?: (response: http.IncomingMessage) => void;
}

export interface ProxyResponse {
  statusCode: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function proxyRequest(
  proxyUrl: string | URL,
  {
    body,
    authorization,
    pathSuffix = '',
    retryCount = '0',
    headers = {},
    onRequest,
    onResponse,
  }: ProxyRequestOptions,
): Promise<ProxyResponse> {
  const url = new URL(proxyUrl);
  url.pathname += pathSuffix;
  const retryHeaders =
    retryCount === null ? {} : { 'x-stainless-retry-count': retryCount };
  return new Promise<ProxyResponse>((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        timeout: 3000,
        headers: {
          authorization,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          ...retryHeaders,
          ...headers,
        },
      },
      (response) => {
        onResponse?.(response);
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    onRequest?.(request);
    request.once('timeout', () => {
      request.destroy(new Error('proxy request timed out'));
    });
    request.once('error', reject);
    request.end(body);
  });
}

export function withTempDirectory<T>(
  prefix: string,
  callback: (directory: string) => T,
): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

let cachedWorkflow: { yml: string; parsed: Record<string, unknown> };
let activeResources: MonitorResource[] = [];

interface MonitorChild {
  get exitCode(): number | null;
  get signalCode(): NodeJS.Signals | null;
  kill(signal: string): void;
  stderr: { on(event: string, cb: (chunk: Buffer) => void): void };
}

function toMonitorChild(
  child: ChildProcessByStdio<null, Readable, Readable>,
): MonitorChild {
  return {
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    kill(signal: string) {
      // The Node.js child.kill() accepts Signals or numbers, but our
      // MonitorChild interface types it as string for simplicity.
      // We narrow at runtime to avoid a type assertion.
      const knownSignals: Record<string, NodeJS.Signals> = {
        SIGTERM: 'SIGTERM',
        SIGKILL: 'SIGKILL',
        SIGHUP: 'SIGHUP',
        SIGINT: 'SIGINT',
        SIGQUIT: 'SIGQUIT',
      };
      const narrowed: NodeJS.Signals | undefined = knownSignals[signal];
      child.kill(narrowed);
    },
    stderr: child.stderr,
  };
}

export interface MonitorResource {
  child: MonitorChild;
  directory: string;
  telemetryPath: string;
  ready: Record<string, unknown>;
  monitorSha256: string;
}

function childHasExited(child: MonitorChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function terminateAndReap(child: MonitorChild): Promise<void> {
  if (childHasExited(child)) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitFor(() => childHasExited(child), 1000);
  } catch {
    child.kill('SIGKILL');
    await waitFor(() => childHasExited(child));
  }
}

async function cleanupMonitorStartup(
  child: MonitorChild | undefined,
  directory: fs.PathLike,
): Promise<void> {
  const failures: unknown[] = [];
  if (child) {
    try {
      await terminateAndReap(child);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'monitor startup cleanup failed');
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function loadWorkflow(): {
  yml: string;
  parsed: Record<string, unknown>;
} {
  if (cachedWorkflow) {
    return cachedWorkflow;
  }
  const yml = readRootFile(WORKFLOW_PATH);
  const parsed = parseWorkflowYaml(yml);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
  }
  cachedWorkflow = { yml, parsed };
  return cachedWorkflow;
}

interface CanaryMetadata {
  runUrl: string;
  runId: string;
  prNumber: string;
  trustedBaseSha: string;
  mergeBaseSha: string;
  headSha: string;
  concurrency: string;
  expectedOcrVersion: string;
  actualOcrVersion: string;
  workflowSha: string;
  endpointResolutionSource: string;
  normalizedModel: string;
  protocol: string;
  language: string;
  useAnthropic: boolean;
  reviewTimeoutMinutes: string;
  ruleJsonSha256: string;
  providerUrlSha256: string;
  configuredOcrSettingsSha256: string;
  ocrConfigFileSha256: string;
  backgroundEnabled: boolean;
  backgroundContextSha256: string | null;
  monitorSha256: string;
  audience: string;
  format: string;
  canonicalConfigFingerprint: string;
}

interface CanaryTiming {
  schema_version: number;
  command_wall_seconds: number;
  exit_code: number;
}

interface CanaryTelemetry {
  schema_version: number;
  monitor_sha256: string;
  bind_address: string;
  target_protocol: string;
  shutdown_signal: string;
  shutdown_complete: boolean;
  total_requests: number;
  upstream_errors: number;
  responses_by_status: Record<string, number>;
  http_429_responses: number;
  retry_events: number;
  retry_count_header_missing: number;
  retry_count_header_malformed: number;
}

interface RunBuildInput {
  resultText: string;
  exitCodeText: string;
  commandTiming: CanaryTiming;
  transportTelemetry: CanaryTelemetry;
  metadata: CanaryMetadata;
}

interface StartMonitorOptions {
  startupTimeoutMs?: number;
  monitorReadyFileName?: string;
  onSpawn?: (info: { child: MonitorChild; directory: string }) => void;
}

export function metricsScript(): string {
  const parsed = loadWorkflow().parsed;
  const jobs = asOptionalRecord(asRecord(parsed)['jobs']);
  const job = asOptionalRecord(jobs?.['code-review']);
  if (!job) throw new Error('workflow should define code-review job');
  return commandText(stepNamed(job, 'Build OCR canary metrics'));
}

export function runBuild(input: RunBuildInput): Record<string, unknown> {
  return asRecord(canaryModule.buildCanaryMetrics(input));
}

export interface EmbeddedMetricsResult {
  [key: string]: unknown;
  _failed: boolean;
  _failureMessage: string | null;
}

export function runEmbeddedMetricsScript(
  versionOutput: string | NodeJS.ArrayBufferView<ArrayBufferLike>,
): EmbeddedMetricsResult {
  const metadata = completeMetadata();
  return withTempDirectory('ocr-metrics-2673-', (directory: string) => {
    const homeDirectory = path.join(directory, 'home');
    const ocrDirectory = path.join(homeDirectory, '.opencodereview');
    fs.mkdirSync(ocrDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'ocr-result.json'),
      JSON.stringify(REPRESENTATIVE_RESULT),
    );
    fs.writeFileSync(path.join(directory, 'ocr-exit-code.txt'), '0\n');
    fs.writeFileSync(path.join(directory, 'ocr-version.txt'), versionOutput);
    fs.writeFileSync(
      path.join(directory, 'ocr-review-runtime.json'),
      JSON.stringify({
        review_timeout_minutes: 30,
        background_enabled: false,
        background_context_sha256: null,
      }),
    );
    fs.writeFileSync(
      path.join(directory, 'ocr-configured-settings.json'),
      JSON.stringify({ extra_body: '{}', language: 'English' }),
    );
    fs.writeFileSync(
      path.join(directory, 'ocr-command-timing.json'),
      JSON.stringify(REPRESENTATIVE_TIMING),
    );
    fs.writeFileSync(
      path.join(directory, 'ocr-transport-telemetry.json'),
      JSON.stringify(REPRESENTATIVE_TELEMETRY),
    );
    fs.writeFileSync(
      path.join(directory, 'ocr-transport-monitor-ready.json'),
      JSON.stringify({
        monitor_sha256: REPRESENTATIVE_TELEMETRY.monitor_sha256,
      }),
    );
    fs.writeFileSync(path.join(ocrDirectory, 'rule.json'), '{}\n');
    fs.writeFileSync(path.join(ocrDirectory, 'config.json'), '{}\n');

    const failureMarkerPath = path.join(directory, 'ocr-driver-failed.txt');
    const scriptPath = path.join(directory, 'metrics.cjs');
    fs.writeFileSync(
      scriptPath,
      [
        "const context = { serverUrl: 'https://github.com', repo: { owner: 'owner', repo: 'repo' }, runId: 123 };",
        `const __failureMarkerPath = ${JSON.stringify(failureMarkerPath)};`,
        'const core = { setFailed(message) { fs.writeFileSync(__failureMarkerPath, String(message)); process.exitCode = 1; } };',
        metricsScript(),
      ].join('\n'),
    );
    let execError = null;
    try {
      execFileSync(nodeExecutable, [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          HOME: homeDirectory,
          TRUSTED_BASE_SHA: metadata.trustedBaseSha,
          MERGE_BASE_SHA: metadata.mergeBaseSha,
          HEAD_SHA: metadata.headSha,
          PR_NUMBER: metadata.prNumber,
          OCR_CONCURRENCY: metadata.concurrency,
          EXPECTED_OCR_VERSION: metadata.expectedOcrVersion,
          OCR_LLM_MODEL: metadata.normalizedModel,
          OCR_LLM_URL: 'https://provider.invalid/v1',
          OCR_USE_ANTHROPIC: String(metadata.useAnthropic),
          WORKFLOW_SHA: metadata.workflowSha,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      execError = error;
    }
    const artifactPath = path.join(directory, 'ocr-canary-metrics.json');
    if (!fs.existsSync(artifactPath)) {
      const stderr =
        execError && typeof execError === 'object' && 'stderr' in execError
          ? String(execError.stderr)
          : '';
      throw new Error(
        `Embedded metrics script failed without writing artifact: ${stderr.trim()}`,
        { cause: execError },
      );
    }
    const metrics: Record<string, unknown> = JSON.parse(
      fs.readFileSync(artifactPath, 'utf8'),
    );
    const failed = fs.existsSync(failureMarkerPath);
    const failureMessage = failed
      ? fs.readFileSync(failureMarkerPath, 'utf8')
      : null;
    return { ...metrics, _failed: failed, _failureMessage: failureMessage };
  });
}

export async function startEmbeddedMonitor(
  targetUrl: string,
  {
    startupTimeoutMs = 5000,
    monitorReadyFileName = 'ready.json',
    onSpawn,
  }: StartMonitorOptions = {},
): Promise<MonitorResource> {
  const parsed = loadWorkflow().parsed;
  const jobs = asOptionalRecord(asRecord(parsed)['jobs']);
  const job = asOptionalRecord(jobs?.['code-review']);
  if (!job) throw new Error('workflow should define code-review job');
  const run = commandText(stepNamed(job, 'Start OCR transport monitor'));
  const source = extractEmbeddedSource(
    run,
    'ocr-transport-monitor.cjs',
    'MONITOR',
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-monitor-2673-'));
  let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
  const stderr: Buffer[] = [];
  try {
    const scriptPath = path.join(directory, 'monitor.cjs');
    const readyPath = path.join(directory, 'ready.json');
    const monitorReadyPath = path.join(directory, monitorReadyFileName);
    const telemetryPath = path.join(directory, 'telemetry.json');
    const monitorSha256 = crypto
      .createHash('sha256')
      .update(source)
      .digest('hex');
    fs.writeFileSync(scriptPath, source);
    child = spawn(nodeExecutable, [scriptPath], {
      env: {
        PATH: process.env.PATH,
        TARGET_URL: targetUrl,
        READY_PATH: monitorReadyPath,
        TELEMETRY_PATH: telemetryPath,
        MONITOR_SHA256: monitorSha256,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    if (!child) throw new Error('child not spawned');
    const monitorChild = toMonitorChild(child);
    onSpawn?.({ child: monitorChild, directory });
    await waitFor(
      () => fs.existsSync(readyPath) || childHasExited(monitorChild),
      startupTimeoutMs,
    );
    if (!fs.existsSync(readyPath)) {
      throw new Error('monitor exited before publishing readiness');
    }
    const ready = asRecord(JSON.parse(fs.readFileSync(readyPath, 'utf8')));
    if (!child) throw new Error('monitor child not spawned');
    const resource: MonitorResource = {
      child: monitorChild,
      directory,
      telemetryPath,
      ready,
      monitorSha256,
    };
    activeResources.push(resource);
    return resource;
  } catch (startupError) {
    const diagnostic = Buffer.concat(stderr).toString().trim();
    let cleanupError: unknown;
    try {
      await cleanupMonitorStartup(
        child ? toMonitorChild(child) : undefined,
        directory,
      );
    } catch (error) {
      cleanupError = error;
    }
    const diagnosticSuffix = diagnostic ? `; stderr: ${diagnostic}` : '';
    const message = `monitor failed to start: ${errorMessage(startupError)}${diagnosticSuffix}`;
    if (cleanupError) {
      throw new AggregateError(
        [
          startupError instanceof Error
            ? startupError
            : new Error(errorMessage(startupError)),
          cleanupError,
        ],
        `${message}; cleanup failed: ${errorMessage(cleanupError)}`,
      );
    }
    throw new Error(message, {
      cause:
        startupError instanceof Error
          ? startupError
          : new Error(errorMessage(startupError)),
    });
  }
}

export async function stopEmbeddedMonitor(
  resource: MonitorResource,
): Promise<Record<string, unknown>> {
  await terminateAndReap(resource.child);
  try {
    return asRecord(
      JSON.parse(fs.readFileSync(resource.telemetryPath, 'utf8')),
    );
  } finally {
    fs.rmSync(resource.directory, { recursive: true, force: true });
    activeResources = activeResources.filter((item) => item !== resource);
  }
}

export async function cleanEmbeddedMonitors(): Promise<void> {
  const failures: unknown[] = [];
  const remainingResources: MonitorResource[] = [];
  for (const resource of activeResources) {
    try {
      await terminateAndReap(resource.child);
      fs.rmSync(resource.directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
      remainingResources.push(resource);
    }
  }
  activeResources = remainingResources;
  if (failures.length > 0) {
    throw new AggregateError(failures, 'monitor cleanup failed');
  }
}

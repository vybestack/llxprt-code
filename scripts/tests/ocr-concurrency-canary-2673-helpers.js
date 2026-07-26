/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { expect } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

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
    concurrency: '2',
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
  expression,
  { eventName, concurrency = '' },
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

export function extractEmbeddedSource(run, fileName, delimiter) {
  const opening = `cat > ${fileName} <<'${delimiter}'\n`;
  const start = run.indexOf(opening);
  const end = run.indexOf(`\n${delimiter}\n`, start + opening.length);
  expect(
    start,
    `${fileName} should have embedded source`,
  ).toBeGreaterThanOrEqual(0);
  expect(end, `${fileName} source should be terminated`).toBeGreaterThan(start);
  return run.slice(start + opening.length, end);
}

export function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
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

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

export function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function proxyRequest(
  proxyUrl,
  { body, authorization, pathSuffix = '', retryCount = '0', headers = {} },
) {
  const url = new URL(proxyUrl);
  url.pathname += pathSuffix;
  const retryHeaders =
    retryCount === null ? {} : { 'x-stainless-retry-count': retryCount };
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...retryHeaders,
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

export function withTempDirectory(prefix, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

let cachedWorkflow;
let activeResources = [];

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function terminateAndReap(child) {
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

async function cleanupMonitorStartup(child, directory) {
  const failures = [];
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function loadWorkflow() {
  if (cachedWorkflow) {
    return cachedWorkflow;
  }
  const yml = readRootFile(WORKFLOW_PATH);
  const parsed = yaml.load(yml);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
  }
  cachedWorkflow = { yml, parsed };
  return cachedWorkflow;
}

export function metricsScript() {
  const job = loadWorkflow().parsed.jobs?.['code-review'];
  return commandText(stepNamed(job, 'Build OCR canary metrics'));
}

export function runBuild(input) {
  const source = extractFunctionSource(metricsScript(), 'buildCanaryMetrics');
  const sandbox = {
    JSON,
    Number,
    String,
    Object,
    Array,
    Map,
    Set,
    Math,
    Error,
    RegExp,
    Boolean,
    __INPUT__: input,
  };
  vm.runInNewContext(
    `${source}\n__RESULT__ = buildCanaryMetrics(__INPUT__);`,
    sandbox,
  );
  return sandbox.__RESULT__;
}

export function runEmbeddedMetricsScript(versionOutput) {
  return withTempDirectory('ocr-metrics-2673-', (directory) => {
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

    const scriptPath = path.join(directory, 'metrics.cjs');
    fs.writeFileSync(
      scriptPath,
      [
        "const context = { serverUrl: 'https://github.com', repo: { owner: 'owner', repo: 'repo' }, runId: 123 };",
        'const core = { setFailed(message) { throw new Error(message); } };',
        metricsScript(),
      ].join('\n'),
    );
    try {
      execFileSync(process.execPath, [scriptPath], {
        cwd: directory,
        env: {
          ...process.env,
          HOME: homeDirectory,
          TRUSTED_BASE_SHA: 'a'.repeat(40),
          MERGE_BASE_SHA: 'a'.repeat(40),
          HEAD_SHA: 'b'.repeat(40),
          PR_NUMBER: '2610',
          OCR_CONCURRENCY: '2',
          EXPECTED_OCR_VERSION: '1.7.16',
          OCR_LLM_MODEL: 'stepfun/step-3.5-flash',
          OCR_LLM_URL: 'https://provider.invalid/v1',
          OCR_USE_ANTHROPIC: 'false',
          WORKFLOW_SHA: 'c'.repeat(40),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String(error.stderr)
          : '';
      throw new Error(`Embedded metrics script failed: ${stderr.trim()}`, {
        cause: error,
      });
    }
    return JSON.parse(
      fs.readFileSync(path.join(directory, 'ocr-canary-metrics.json'), 'utf8'),
    );
  });
}

export async function startEmbeddedMonitor(
  targetUrl,
  {
    startupTimeoutMs = 5000,
    monitorReadyFileName = 'ready.json',
    onSpawn,
  } = {},
) {
  const job = loadWorkflow().parsed.jobs?.['code-review'];
  const run = commandText(stepNamed(job, 'Start OCR transport monitor'));
  const source = extractEmbeddedSource(
    run,
    'ocr-transport-monitor.cjs',
    'MONITOR',
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-monitor-2673-'));
  let child;
  const stderr = [];
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
    child = spawn(process.execPath, [scriptPath], {
      env: {
        PATH: process.env.PATH,
        TARGET_URL: targetUrl,
        READY_PATH: monitorReadyPath,
        TELEMETRY_PATH: telemetryPath,
        MONITOR_SHA256: monitorSha256,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    onSpawn?.({ child, directory });
    await waitFor(
      () => fs.existsSync(readyPath) || childHasExited(child),
      startupTimeoutMs,
    );
    if (!fs.existsSync(readyPath)) {
      throw new Error('monitor exited before publishing readiness');
    }
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
    const resource = { child, directory, telemetryPath };
    activeResources.push(resource);
    return { ...resource, ready, monitorSha256 };
  } catch (startupError) {
    const diagnostic = Buffer.concat(stderr).toString().trim();
    let cleanupError;
    try {
      await cleanupMonitorStartup(child, directory);
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

export async function stopEmbeddedMonitor(resource) {
  resource.child.kill('SIGTERM');
  await waitFor(() => childHasExited(resource.child));
  const telemetry = JSON.parse(fs.readFileSync(resource.telemetryPath, 'utf8'));
  activeResources = activeResources.filter((item) => item !== resource);
  fs.rmSync(resource.directory, { recursive: true, force: true });
  return telemetry;
}

export async function cleanEmbeddedMonitors() {
  for (const resource of activeResources) {
    resource.child.kill('SIGKILL');
    await waitFor(() => childHasExited(resource.child)).catch(() => undefined);
    fs.rmSync(resource.directory, { recursive: true, force: true });
  }
  activeResources = [];
}

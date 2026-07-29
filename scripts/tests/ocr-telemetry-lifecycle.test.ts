/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { asRecord, asRecordArray, asRecordMap } from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

let workflow;
let codeReviewJob: Record<string, unknown> | undefined;
const temporaryDirectories: fs.PathLike[] = [];

function temporaryDirectory(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function runShell(script: string, cwd: string, env = {}) {
  return spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      RUNNER_TEMP: cwd,
      ...env,
    },
  });
}

function substituteExpressions(script: string, values: Record<string, string>) {
  let substituted = script;
  for (const [expression, value] of Object.entries(values)) {
    substituted = substituted.replaceAll(
      `\${{ ${expression} }}`,
      String(value),
    );
  }
  if (substituted.includes('${{')) {
    throw new Error('Not all workflow expressions were substituted');
  }
  return substituted;
}

beforeAll(() => {
  const parsed = yaml.load(readRootFile(WORKFLOW_PATH));
  workflow = asRecord(parsed);
  const jobs = asRecordMap(workflow['jobs'] ?? {});
  codeReviewJob = jobs['code-review'];
});

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('OCR workflow shell lifecycle behavior', () => {
  it('keeps action input keys out of every run block', () => {
    const actionInputKeys = [
      'if-no-files-found',
      'retention-days',
      'compression-level',
      'overwrite',
      'include-hidden-files',
    ];
    for (const step of asRecordArray(codeReviewJob?.['steps'])?.map(asRecord) ??
      []) {
      const runText = step['run'];
      if (typeof runText !== 'string') continue;
      for (const input of actionInputKeys) {
        expect(
          runText,
          `${input} must not occur in ${step['name']}`,
        ).not.toMatch(new RegExp(`^\\s*${input}:`, 'm'));
      }
    }
  });

  it('executes final classification cleanly and reports post, telemetry, hash, and upload outcomes', () => {
    const directory = temporaryDirectory('ocr-final-classification-');
    fs.writeFileSync(path.join(directory, 'ocr-policy-failure.txt'), '');
    fs.writeFileSync(
      path.join(directory, 'ocr-infrastructure-failure.txt'),
      '',
    );
    const output = path.join(directory, 'github-output.txt');
    const script = substituteExpressions(
      commandText(stepNamed(codeReviewJob, 'Resolve final OCR classification')),
      {
        'steps.post-ocr-results.outcome': 'success',
        'steps.post-ocr-results.outputs.post_state': 'posted',
        'steps.redact-ocr-artifacts.outcome': 'success',
        'steps.ocr-telemetry-validation.outputs.valid': 'true',
        'steps.ocr-manifest-hashes.outputs.valid': 'true',
        'steps.upload-ocr-artifacts.outcome': 'success',
        'steps.ocr-classification.outputs.completeness': 'complete',
      },
    );
    const result = runShell(script, directory, { GITHUB_OUTPUT: output });
    expect(result.status, result.stderr).toBe(0);
    const outputs = fs.readFileSync(output, 'utf8');
    expect(outputs).toContain('infrastructure_failure=false');
    expect(outputs).toContain('post_state=posted');
    expect(outputs).toContain('telemetry_state=complete');
    expect(outputs).toContain('hash_state=prepared');
    expect(outputs).toContain('upload_state=uploaded');
  });

  it.each(['read', 'write', 'rename'])(
    'fails closed when source diagnostic %s fails',
    (mode) => {
      const directory = temporaryDirectory(`ocr-redaction-${mode}-`);
      const sentinel = 'SENTINEL-UNREDACTED-CREDENTIAL';
      fs.writeFileSync(path.join(directory, 'ocr-result.json'), sentinel);
      const preload = path.join(directory, 'inject-fs-failure.cjs');
      fs.writeFileSync(
        preload,
        `const fs = require('node:fs');
const target = 'ocr-result.json';
let injected = false;
const originalRead = fs.readFileSync;
const originalWrite = fs.writeFileSync;
const originalRename = fs.renameSync;
if (${JSON.stringify(mode)} === 'read') fs.readFileSync = function (name, ...args) {
  if (!injected && require('node:path').basename(String(name)) === target) { injected = true; const error = new Error('injected read'); error.code = 'EIO'; throw error; }
  return originalRead.call(this, name, ...args);
};
if (${JSON.stringify(mode)} === 'write') fs.writeFileSync = function (name, ...args) {
  if (!injected && require('node:path').basename(String(name)) === target) { injected = true; const error = new Error('injected write'); error.code = 'EIO'; throw error; }
  return originalWrite.call(this, name, ...args);
};
if (${JSON.stringify(mode)} === 'rename') fs.renameSync = function (from, to, ...args) {
  if (!injected && require('node:path').basename(String(to)) === target) { injected = true; const error = new Error('injected rename'); error.code = 'EIO'; throw error; }
  return originalRename.call(this, from, to, ...args);
};
`,
      );
      const script = commandText(
        stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts'),
      );
      const result = runShell(script, directory, {
        NODE_OPTIONS: `--require=${preload}`,
      });
      expect(result.status).not.toBe(0);
      const remaining = fs.existsSync(path.join(directory, 'ocr-result.json'))
        ? fs.readFileSync(path.join(directory, 'ocr-result.json'), 'utf8')
        : '';
      expect(remaining).not.toContain(sentinel);
      expect(remaining === '' || remaining.includes('redaction failed')).toBe(
        true,
      );
    },
  );

  it('redacts all supported credential forms and exact token/URL values', () => {
    const directory = temporaryDirectory('ocr-redaction-patterns-');
    const token = 'exact-token-value-123456';
    const url = 'https://secret.example.test/v1?token=exact';
    const credentials = [
      `Authorization: Bearer bearer-secret-value`,
      `x-api-key: x-api-secret-value`,
      `api-key=api-key-secret-value`,
      `https://example.test/?key=query-key-secret&token=query-token-secret`,
      `access_token=access-token-secret`,
      `refresh_token=refresh-token-secret`,
      `id_token=id-token-secret-value`,
      `token=long-token-secret-value`,
      `secret=long-secret-secret-value`,
      token,
      url,
    ].join('\n');
    fs.writeFileSync(path.join(directory, 'ocr-result.json'), credentials);
    const result = runShell(
      commandText(stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts')),
      directory,
      { OCR_LLM_TOKEN: token, OCR_LLM_URL: url },
    );
    expect(result.status, result.stderr).toBe(0);
    const redacted = fs.readFileSync(
      path.join(directory, 'ocr-result.json'),
      'utf8',
    );
    expect(redacted).not.toContain('secret-value');
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain(url);
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('emits independently valid failure telemetry when the trusted producer module is absent', () => {
    const directory = temporaryDirectory('ocr-missing-producer-');
    const output = path.join(directory, 'github-output.txt');
    const result = runShell(
      commandText(stepNamed(codeReviewJob, 'Emit OCR telemetry (issue #2676)')),
      directory,
      {
        GITHUB_OUTPUT: output,
        OCR_RUN_ID: '123',
        OCR_RUN_ATTEMPT: '1',
        OCR_PR_NUMBER: '2676',
        OCR_SHA: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
        OCR_GENERATED_AT: '2026-07-25T23:09:35.000Z',
        OCR_POST_STATE: 'failed',
        OCR_ARTIFACT_STATE: 'failed',
        OCR_HASH_STATE: 'unavailable',
        OCR_INFRASTRUCTURE_FAILURE: 'true',
        OCR_POLICY_FAILURE: 'false',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const record = JSON.parse(
      fs.readFileSync(path.join(directory, 'ocr-telemetry.json'), 'utf8'),
    );
    expect(record.schema_name).toBe('ocr-telemetry');
    expect(record.telemetry_state).toBe('failed');
    expect(record.infrastructure_failure).toBe(true);
    expect(record.errors).toContain('OCR telemetry producer unavailable');
    expect(fs.readFileSync(output, 'utf8')).toContain('generated=true');
  });

  it('preserves independent late failure reasons in the marker', () => {
    const directory = temporaryDirectory('ocr-late-failures-');
    const output = path.join(directory, 'github-output.txt');
    const placeholderResult = runShell(
      commandText(
        stepNamed(codeReviewJob, 'Ensure OCR artifact placeholders exist'),
      ),
      directory,
      { GITHUB_OUTPUT: output },
    );
    expect(placeholderResult.status, placeholderResult.stderr).toBe(0);

    const evidenceResult = runShell(
      commandText(stepNamed(codeReviewJob, 'Resolve OCR production evidence')),
      directory,
      { GITHUB_OUTPUT: output },
    );
    expect(evidenceResult.status, evidenceResult.stderr).toBe(0);
    const marker = fs.readFileSync(
      path.join(directory, 'ocr-infrastructure-failure.txt'),
      'utf8',
    );
    expect(marker).toContain('OCR artifact placeholders were missing');
    expect(marker).toContain('OCR preview evidence was unavailable');
  });

  it('fails closed and records a marker/output when manifest hashing fails', () => {
    const directory = temporaryDirectory('ocr-hash-failure-');
    fs.writeFileSync(
      path.join(directory, 'ocr-reviewed-range-manifest.json'),
      '{malformed',
    );
    for (const name of [
      'ocr-result.json',
      'ocr-stdout.raw',
      'ocr-stderr.log',
      'ocr-preflight.txt',
      'ocr-version.txt',
      'ocr-preview.txt',
      'ocr-preview-stderr.log',
      'ocr-exit-code.txt',
      'ocr-phase.txt',
      'ocr-selected-files.txt',
      'ocr-status.txt',
      'ocr-infrastructure-failure.txt',
      'ocr-policy-failure.txt',
      'ocr-telemetry.json',
    ]) {
      if (!fs.existsSync(path.join(directory, name))) {
        fs.writeFileSync(path.join(directory, name), '{}');
      }
    }
    const output = path.join(directory, 'github-output.txt');
    const result = runShell(
      commandText(
        stepNamed(codeReviewJob, 'Compute reviewed-range manifest hashes'),
      ),
      directory,
      { GITHUB_OUTPUT: output },
    );
    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(output, 'utf8')).toContain('valid=false');
    expect(
      fs.readFileSync(
        path.join(directory, 'ocr-infrastructure-failure.txt'),
        'utf8',
      ),
    ).toContain('manifest hash preparation failed');
  });

  it.each([
    ['abc123', null],
    ['123 trailing', null],
    ['', null],
  ])('rejects corrupt wall-clock marker %j', (marker, expected) => {
    const directory = temporaryDirectory('ocr-wall-clock-');
    if (marker !== '') {
      fs.writeFileSync(
        path.join(directory, 'ocr_wall_clock_start.txt'),
        marker,
      );
    }
    const output = path.join(directory, 'github-output.txt');
    const result = runShell(
      commandText(stepNamed(codeReviewJob, 'Capture OCR wall-clock')),
      directory,
      { GITHUB_OUTPUT: output },
    );
    expect(result.status).toBe(0);
    const value = fs
      .readFileSync(output, 'utf8')
      .match(/^wall_clock_seconds=(.*)$/m)?.[1];
    expect(value || null).toBe(expected);
  });
});

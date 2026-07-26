/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANARY_2673_EXPECTED_TARGET,
  buildComparison,
} from './ocr-concurrency-canary-2673-comparator.js';
import { withTempDirectory } from './ocr-concurrency-canary-2673-helpers.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_PATH = path.join(REPO_ROOT, 'scripts', 'ocr-canary-compare-2673.cjs');
const BASE_PROVENANCE = Object.freeze({
  expected_ocr_version: '1.7.16',
  actual_ocr_version: '1.7.16',
  workflow_sha: '620f1bacf2228eb0789c43c2a38c71068e1afc52',
  effective_endpoint: {
    resolution_source: 'environment',
    normalized_model: 'step-3.7-flash',
    protocol: 'openai',
    provider_url_sha256: '9'.repeat(64),
    language: 'English',
  },
  configured_ocr_settings_sha256: 'a'.repeat(64),
  ocr_config_file_sha256: 'b'.repeat(64),
  use_anthropic: false,
  review_timeout_minutes: 30,
  rule_json_sha256: '7'.repeat(64),
  background_enabled: true,
  background_context_sha256: 'e'.repeat(64),
  monitor_sha256: '5'.repeat(64),
  audience: 'agent',
  format: 'json',
  canonical_config_fingerprint: '0'.repeat(64),
});

function makeArtifact(concurrency, commandWallSeconds) {
  return {
    schema_version: 1,
    valid: true,
    validation_errors: [],
    run: {
      url: `https://github.com/vybestack/llxprt-code/actions/runs/${concurrency}`,
      id: String(concurrency),
    },
    pull_request: CANARY_2673_EXPECTED_TARGET.pullRequest,
    trusted_checkout_base_sha: 'be8f36c6e1c7f7d3a90a5955e7eab80906d695d6',
    merge_base_sha: 'be8f36c6e1c7f7d3a90a5955e7eab80906d695d6',
    head_sha: CANARY_2673_EXPECTED_TARGET.headSha,
    concurrency,
    result: { status: 'success', warning_count: 0, exit_code: 0 },
    timing: {
      command_wall_seconds: commandWallSeconds,
      ocr_internal_elapsed_seconds: Math.round(commandWallSeconds),
    },
    provenance: JSON.parse(JSON.stringify(BASE_PROVENANCE)),
    summary: {
      files_reviewed: 63,
      tokens: { total: 3_000_000 + concurrency },
    },
    findings: { total: 60 + concurrency },
    transport: {
      schema_version: 1,
      monitor_sha256: BASE_PROVENANCE.monitor_sha256,
      bind_address: '127.0.0.1',
      target_protocol: 'https:',
      shutdown_signal: 'SIGTERM',
      shutdown_complete: true,
      total_requests: 100,
      upstream_errors: 0,
      responses_by_status: { 200: 100 },
      http_429_responses: 0,
      retry_events: 0,
      retry_count_header_missing: 0,
      retry_count_header_malformed: 0,
    },
  };
}

function writeArtifacts(directory) {
  const artifacts = [
    makeArtifact(2, 2616.549257183),
    makeArtifact(3, 1491.986057633),
    makeArtifact(4, 1156.843271737),
  ];
  return artifacts.map((artifact) => {
    const artifactPath = path.join(
      directory,
      `canary-${artifact.concurrency}.json`,
    );
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));
    return artifactPath;
  });
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

describe('ocr-canary-compare-2673 CLI', () => {
  it('emits valid JSON and exits zero for comparable canary evidence', () =>
    withTempDirectory('ocr-compare-cli-2673-', (directory) => {
      const artifactPaths = writeArtifacts(directory);
      const expected = buildComparison(
        artifactPaths.map((artifactPath) =>
          JSON.parse(fs.readFileSync(artifactPath, 'utf8')),
        ),
      );

      const result = runCli(artifactPaths);

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(expected);
    }));

  it('emits structured invalid JSON and exits nonzero for invalid evidence', () =>
    withTempDirectory('ocr-compare-cli-invalid-2673-', (directory) => {
      const artifactPaths = writeArtifacts(directory);
      const invalidArtifact = JSON.parse(
        fs.readFileSync(artifactPaths[1], 'utf8'),
      );
      invalidArtifact.transport.http_429_responses = 1;
      fs.writeFileSync(artifactPaths[1], JSON.stringify(invalidArtifact));

      const result = runCli(artifactPaths);
      const output = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(output.valid).toBe(false);
      expect(output.errors.join(' ')).toMatch(/http_429_responses/i);
    }));

  it('emits structured invalid JSON when an artifact cannot be read', () =>
    withTempDirectory('ocr-compare-cli-read-error-2673-', (directory) => {
      const artifactPaths = writeArtifacts(directory);
      artifactPaths[1] = path.join(directory, 'missing.json');

      const result = runCli(artifactPaths);
      const output = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(output).toEqual({
        valid: false,
        errors: [
          expect.stringMatching(/Failed to read artifact.*missing\.json/i),
        ],
      });
    }));

  it('rejects the wrong argument count with usage and exit code two', () => {
    const result = runCli([]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Usage: ocr-canary-compare-2673\.cjs /);
  });
});

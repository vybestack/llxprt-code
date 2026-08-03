/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type {
  WorkflowDocument,
  WorkflowJob,
  WorkflowStep,
} from './typed-test-helpers.ts';
import {
  parseWorkflowYaml,
  asRecord,
  asRecordArray,
  asOptionalRecord,
} from './typed-test-helpers.ts';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.ts';

type WorkflowObject = WorkflowDocument;
type MatrixRow = Record<string, string>;

function loadCiWorkflow(): WorkflowObject {
  const source = readRootFile('.github/workflows/ci.yml');
  return parseWorkflowYaml(source);
}

function jobsOf(workflow: WorkflowObject): Record<string, WorkflowJob> {
  const jobs = workflow['jobs'];
  if (!jobs) {
    throw new Error('ci.yml must define a jobs map');
  }
  return jobs;
}

function matrixInclude(job: WorkflowJob | undefined): MatrixRow[] {
  const strategy = job?.strategy;
  const matrix = strategy?.matrix;
  const include = matrix ? asRecord(matrix)['include'] : undefined;
  expect(include, 'job must define a matrix include list').toBeInstanceOf(
    Array,
  );
  const rows = asRecordArray(include) ?? [];
  return rows.map((r: Record<string, unknown>): MatrixRow => {
    const result: Record<string, string> = {};
    for (const key of Object.keys(r)) {
      const val = r[key];
      result[key] = typeof val === 'string' ? val : String(val ?? '');
    }
    return result;
  });
}

function allRunCommands(job: WorkflowJob | undefined): string {
  return (job?.steps ?? [])
    .map((step: WorkflowStep) => step.run)
    .filter((run: unknown): run is string => typeof run === 'string')
    .join('\n');
}

describe('Issue #2147: SecureStore backend coverage is separated from full CI suite', () => {
  let jobs: Record<string, WorkflowJob>;
  let testShardJob: WorkflowJob | undefined;
  let testAggregatorJob: WorkflowJob | undefined;
  let secureStoreJob: WorkflowJob | undefined;

  beforeAll(() => {
    const workflow = loadCiWorkflow();
    jobs = jobsOf(workflow);
    // Issue #2707: the old single `test` job is now a `test_shard` matrix job
    // plus a virtual `test` aggregator that gates branch protection.
    testShardJob = jobs['test_shard'];
    testAggregatorJob = jobs['test'];
    secureStoreJob = jobs['secure_store_backend'];
  });

  it('runs the full test suite once per OS per shard under normal keyring behavior', () => {
    expect(
      testShardJob,
      'ci.yml must contain the test_shard matrix job',
    ).toBeTruthy();
    expect(testShardJob?.name).toBe(
      'Test (${{ matrix.os }}) [${{ matrix.shard }}]',
    );
    const matrix = asOptionalRecord(
      asOptionalRecord(testShardJob?.strategy)?.['matrix'],
    );
    const include = matrix ? asRecord(matrix)['include'] : undefined;
    expect(
      include,
      'test_shard must use dynamic matrix from shard_selector',
    ).toContain('${{ fromJSON(needs.shard_selector.outputs.matrix) }}');
    expect(testShardJob?.['runs-on']).toBe('${{ matrix.os }}');
    expect(matrix).not.toHaveProperty('secure-store-mode');

    const runTests = stepNamed(testShardJob, 'Run shard tests (issue #2707)');
    expect(runTests.run).toContain('bun scripts/test.ts --shard');
    expect(runTests.env ?? {}).not.toHaveProperty(
      'LLXPRT_SECURE_STORE_FORCE_FALLBACK',
    );

    // The virtual aggregator job preserves the `Test` required-check name.
    expect(
      testAggregatorJob,
      'ci.yml must contain the virtual Test aggregator job',
    ).toBeTruthy();
    expect(testAggregatorJob?.name).toBe('Test');

    const forkArtifact = stepNamed(
      testShardJob,
      'Upload Test Results Artifact (for forks)',
    );
    expect(forkArtifact.with?.['name']).toBe(
      'test-results-fork-${{ matrix.shard }}-${{ matrix.node-version }}-${{ matrix.os }}',
    );

    // Coverage is uploaded only from cli and core shards (issue #2707).
    const coverageArtifact = stepNamed(testShardJob, 'Upload coverage reports');
    expect(coverageArtifact.if).toContain("matrix.shard == 'cli'");
    expect(coverageArtifact.if).toContain("matrix.shard == 'core'");
    expect(coverageArtifact.with?.['name']).toBe(
      'coverage-${{ matrix.shard }}-${{ matrix.node-version }}-${{ matrix.os }}',
    );

    const report = stepNamed(
      testShardJob,
      'Publish Test Report (for non-forks)',
    );
    expect(report.if).toContain("matrix.shard != 'scripts'");
    expect(report.with?.['name']).toContain('${{ matrix.shard }}');
  });

  it('keeps coverage comment downloads aligned to the per-shard artifact names', () => {
    const postCoverage = jobs['post_coverage_comment'];
    expect(
      postCoverage,
      'ci.yml must contain post_coverage_comment',
    ).toBeTruthy();

    // Issue #2707: coverage is now per-shard. post_coverage_comment downloads
    // the cli and core shard artifacts separately.
    const downloadCli = stepNamed(
      postCoverage,
      'Download CLI coverage (cli shard)',
    );
    expect(downloadCli.with?.['name']).toBe(
      'coverage-cli-${{ matrix.node-version }}-${{ matrix.os }}',
    );

    const downloadCore = stepNamed(
      postCoverage,
      'Download core coverage (core shard)',
    );
    expect(downloadCore.with?.['name']).toBe(
      'coverage-core-${{ matrix.node-version }}-${{ matrix.os }}',
    );
  });

  it('defines a secure_store_backend job with keyring and fallback modes', () => {
    expect(
      secureStoreJob,
      'ci.yml must contain a separate secure_store_backend job',
    ).toBeTruthy();
    expect(secureStoreJob?.name).toBe(
      'SecureStore Backend (${{ matrix.os }}, ${{ matrix.secure-store-mode }})',
    );
    expect(secureStoreJob?.['timeout-minutes']).toBe(15);
  });

  it('keyring rows select the native-keyring vitest config on Ubuntu only (issue #2876)', () => {
    // Issue #2876: macOS keyring coverage moved to the nightly workflow.
    // The PR secure_store_backend matrix is ubuntu-only.
    const includes = matrixInclude(secureStoreJob);

    const keyringRows = includes.filter(
      (row: MatrixRow) => row['secure-store-mode'] === 'keyring',
    );
    expect(keyringRows.length).toBe(1);
    expect(keyringRows.map((r: MatrixRow) => r.os).sort()).toEqual([
      'ubuntu-latest',
    ]);

    for (const row of keyringRows) {
      expect(row['test-config']).toBe('vitest.config.native-keyring.ts');
    }

    const nativeConfig = readRootFile(
      'packages/storage/vitest.config.native-keyring.ts',
    );
    expect(nativeConfig).toContain(
      "'src/secure-store/secure-store.native-keyring.test.ts'",
    );
  });

  it('runs the focused encrypted fallback and ProviderKeyStorage persistence suite on Ubuntu', () => {
    const includes = matrixInclude(secureStoreJob);
    const fallbackRows = includes.filter(
      (row: MatrixRow) => row['secure-store-mode'] === 'fallback',
    );

    expect(fallbackRows).toEqual([
      {
        os: 'ubuntu-latest',
        'node-version': '24.x',
        'secure-store-mode': 'fallback',
        'test-config': 'vitest.config.fallback-behavior.ts',
      },
    ]);

    const fallbackConfig = readRootFile(
      'packages/storage/vitest.config.fallback-behavior.ts',
    );
    expect(fallbackConfig).toContain(
      "'src/secure-store/secure-store.fallback-behavior.test.ts'",
    );
    expect(fallbackConfig).toContain(
      "'src/secure-store/provider-key-storage.fallback.test.ts'",
    );
  });

  it('does not use force-fallback matrix key or LLXPRT_SECURE_STORE_FORCE_FALLBACK env var', () => {
    const includes = matrixInclude(secureStoreJob);
    for (const row of includes) {
      expect(row).not.toHaveProperty('force-fallback');
    }

    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    expect(backendStep.env ?? {}).not.toHaveProperty(
      'LLXPRT_SECURE_STORE_FORCE_FALLBACK',
    );
  });

  it('installs Secret Service dependencies and the readiness-probe tool for the Ubuntu keyring row', () => {
    const setup = stepNamed(
      secureStoreJob,
      'Install Linux Secret Service dependencies',
    );
    expect(setup.if).toBe(
      "matrix.os == 'ubuntu-latest' && matrix.secure-store-mode == 'keyring'",
    );
    expect(setup.run).toContain('dbus-x11');
    expect(setup.run).toContain('gnome-keyring');
    expect(setup.run).toContain('libglib2.0-bin');
    expect(setup.run).toContain('libsecret-1-0');
  });

  it('isolates runtime and keyring data before starting the private D-Bus session', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    const runText = backendStep.run ?? '';
    const runtimeCreate = runText.indexOf('XDG_RUNTIME_DIR="$(mktemp -d');
    const runtimePermissions = runText.indexOf(
      'chmod 700 "$XDG_RUNTIME_DIR"',
      runtimeCreate,
    );
    const cleanup = runText.indexOf(
      'trap \'rm -rf "$XDG_RUNTIME_DIR"\' EXIT',
      runtimePermissions,
    );
    const sessionStart = runText.indexOf('dbus-run-session', cleanup);
    const privateData = runText.indexOf(
      'export XDG_DATA_HOME="$XDG_RUNTIME_DIR/data"',
      sessionStart,
    );
    const privateDataCreate = runText.indexOf(
      'install -d -m 700 "$XDG_DATA_HOME"',
      privateData,
    );

    expect(runText).toContain('export XDG_RUNTIME_DIR');
    expect(runtimeCreate).toBeGreaterThanOrEqual(0);
    expect(runtimePermissions).toBeGreaterThan(runtimeCreate);
    expect(cleanup).toBeGreaterThan(runtimePermissions);
    expect(sessionStart).toBeGreaterThan(cleanup);
    expect(privateData).toBeGreaterThan(sessionStart);
    expect(privateDataCreate).toBeGreaterThan(privateData);
  });

  it('safely imports only expected keyring environment assignments', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    const runText = backendStep.run ?? '';

    expect(runText).not.toMatch(/\beval\b/);
    expect(runText).toContain('while IFS= read -r assignment');
    expect(runText).toContain(
      'GNOME_KEYRING_CONTROL=*|GNOME_KEYRING_PID=*|GPG_AGENT_INFO=*|SSH_AUTH_SOCK=*',
    );
    expect(runText).toContain('export "$variable_name=$variable_value"');
    expect(runText).toContain('Unexpected gnome-keyring-daemon output');
    expect(runText).toContain('Unsafe gnome-keyring-daemon assignment');
  });

  it('initializes and unlocks GNOME keyring before running tests in the same D-Bus session', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    const runText = backendStep.run ?? '';
    expect(runText).not.toContain(
      'gnome-keyring-daemon --unlock --components=secrets',
    );
    expect(runText).toContain('DBUS_SESSION_BUS_ADDRESS');
    const sessionStart = runText.indexOf('dbus-run-session');
    const loginStart = runText.indexOf(
      'gnome-keyring-daemon --login',
      sessionStart,
    );
    const loginPassword = runText.lastIndexOf(
      'printf "%s" "$KEYRING_PASSWORD"',
      loginStart,
    );
    const daemonStart = runText.indexOf(
      'gnome-keyring-daemon --start --components=secrets',
      loginStart,
    );
    const readinessProbe = runText.indexOf(
      'org.freedesktop.DBus.NameHasOwner',
      daemonStart,
    );
    const secretServiceName = runText.indexOf(
      'org.freedesktop.secrets',
      readinessProbe,
    );
    const ownerCheck = runText.indexOf(
      'if [[ "$secret_service_owner" != "(true,)" ]]',
      secretServiceName,
    );
    const collectionProbe = runText.indexOf(
      '/org/freedesktop/secrets/collection/login',
      ownerCheck,
    );
    const unlockedCheck = runText.indexOf(
      'if [[ "$login_collection_locked" != "(<false>,)" ]]',
      collectionProbe,
    );
    const nativeTestStart = runText.indexOf(
      'npm run test:vitest --workspace @vybestack/llxprt-code-storage',
      unlockedCheck,
    );
    const sessionEnd = runText.indexOf("\n  '\nelse", nativeTestStart);

    expect(sessionStart).toBeGreaterThanOrEqual(0);
    expect(loginPassword).toBeGreaterThan(sessionStart);
    expect(loginStart).toBeGreaterThan(loginPassword);
    expect(daemonStart).toBeGreaterThan(loginStart);
    expect(readinessProbe).toBeGreaterThan(daemonStart);
    expect(secretServiceName).toBeGreaterThan(readinessProbe);
    expect(ownerCheck).toBeGreaterThan(secretServiceName);
    expect(collectionProbe).toBeGreaterThan(ownerCheck);
    expect(unlockedCheck).toBeGreaterThan(collectionProbe);
    expect(nativeTestStart).toBeGreaterThan(unlockedCheck);
    expect(sessionEnd).toBeGreaterThan(nativeTestStart);
  });

  it('backend test step uses the per-row vitest config (semantic selection, not a static glob)', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    expect(backendStep.env?.['TEST_CONFIG']).toBe('${{ matrix.test-config }}');
    expect(backendStep.run).toContain('--config "$TEST_CONFIG"');
    expect(backendStep.run).not.toContain('src/secure-store');
    expect(backendStep.run).not.toContain('--reporter=');
    expect(backendStep.run).not.toContain('--outputFile.junit=');
  });

  it('does not duplicate full workspace tests, script harnesses, smoke tests, builds, or coverage uploads in the focused job', () => {
    const commands = allRunCommands(secureStoreJob);
    const commandLines = commands
      .split('\n')
      .map((command: string) => command.trim());
    expect(commandLines).not.toContain('npm run test');
    expect(commands).not.toContain('npm run test:scripts');
    expect(commands).not.toContain(
      'node ./packages/cli/bin/llxprt.cjs --version',
    );
    expect(commands).not.toContain('npm run build');

    const stepNames = (secureStoreJob?.steps ?? []).map(
      (step: WorkflowStep) => step.name,
    );
    expect(stepNames).not.toContain('Upload coverage reports');
  });

  it('publishes focused SecureStore reports with backend mode in report and artifact names', () => {
    const report = stepNamed(secureStoreJob, 'Publish SecureStore Test Report');
    expect(report.with?.['name']).toBe(
      'SecureStore Backend Results (Node ${{ matrix.node-version }}, ${{ matrix.os }}, ${{ matrix.secure-store-mode }})',
    );
    expect(report.with?.['path']).toBe(
      'packages/storage/junit.secure-store.xml',
    );

    const artifact = stepNamed(
      secureStoreJob,
      'Upload SecureStore Test Results Artifact (for forks)',
    );
    expect(artifact.with?.['name']).toBe(
      'secure-store-results-fork-${{ matrix.node-version }}-${{ matrix.os }}-${{ matrix.secure-store-mode }}',
    );
    expect(artifact.with?.['path']).toBe(
      'packages/storage/junit.secure-store.xml',
    );
  });
});

describe('Issue #2709: shard_selector and Test aggregator wiring', () => {
  let workflow: WorkflowObject;
  let shardSelectorJob: WorkflowJob | undefined;
  let testAggregatorJob: WorkflowJob | undefined;

  beforeAll(() => {
    workflow = loadCiWorkflow();
    const jobs = jobsOf(workflow);
    shardSelectorJob = jobs['shard_selector'];
    testAggregatorJob = jobs['test'];
  });

  it('shard_selector is least-privilege, self-contained, and does not suppress gh failures', () => {
    expect(shardSelectorJob).toBeTruthy();
    // Least-privilege permissions.
    expect(shardSelectorJob?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
    // Unused doc_change_filter dependency removed.
    expect(shardSelectorJob?.needs).not.toContain('doc_change_filter');
    expect(shardSelectorJob?.needs).toContain('skip_check');
    // Bounded timeout.
    expect(shardSelectorJob?.['timeout-minutes']).toBeGreaterThan(0);
    // Checkout does not persist credentials.
    const checkout = stepNamed(shardSelectorJob, 'Checkout');
    expect(checkout.with?.['persist-credentials']).toBe(false);
    // Pinned setup-node with .nvmrc; no dependency install.
    const setupNode = stepNamed(shardSelectorJob, 'Set up Node.js');
    expect(setupNode.uses).toContain('actions/setup-node@');
    expect(setupNode.with?.['node-version-file']).toBe('.nvmrc');
    const stepNames = (shardSelectorJob?.steps ?? []).map(
      (s: WorkflowStep) => s.name,
    );
    expect(stepNames).not.toContain('Install dependencies');
    expect(stepNames).not.toContain('Setup Bun');
    // gh api pagination failures must not be suppressed (no `|| true`).
    const changed = stepNamed(shardSelectorJob, 'Determine changed files');
    expect(changed.run).not.toContain('|| true');
  });

  it('Test aggregator honors explicit skip_check but stays red for selector failure', () => {
    expect(testAggregatorJob).toBeTruthy();
    expect(testAggregatorJob?.needs).toContain('skip_check');
    expect(testAggregatorJob?.needs).toContain('shard_selector');
    const check = stepNamed(testAggregatorJob, 'Check shard results');
    const checkRun = check.run ?? '';
    // The should_skip=true branch runs before the selector-result check.
    const skipIdx = checkRun.indexOf('should_skip');
    const selectorIdx = checkRun.indexOf('selector_result');
    expect(skipIdx).toBeGreaterThanOrEqual(0);
    expect(selectorIdx).toBeGreaterThan(skipIdx);
    // Non-skip selector failure stays red.
    expect(checkRun).toContain('Shard selector did not succeed');
  });
});

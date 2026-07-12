/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import yaml from 'js-yaml';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.js';

function loadCiWorkflow() {
  const source = readRootFile('.github/workflows/ci.yml');
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('.github/workflows/ci.yml did not parse to a YAML object');
  }
  return parsed;
}

function matrixInclude(job) {
  const include = job?.strategy?.matrix?.include;
  expect(include, 'job must define a matrix include list').toBeInstanceOf(
    Array,
  );
  return include;
}

function allRunCommands(job) {
  return (job?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string')
    .join('\n');
}

describe('Issue #2147: SecureStore backend coverage is separated from full CI suite', () => {
  let workflow;
  let testJob;
  let secureStoreJob;

  beforeAll(() => {
    workflow = loadCiWorkflow();
    testJob = workflow.jobs?.test;
    secureStoreJob = workflow.jobs?.secure_store_backend;
  });

  it('runs the full test suite once per OS under normal keyring behavior', () => {
    expect(testJob, 'ci.yml must contain the full-suite test job').toBeTruthy();
    expect(testJob.name).toBe('Test (${{ matrix.os }})');
    expect(testJob.strategy?.matrix?.os).toEqual([
      'ubuntu-latest',
      'macos-latest',
    ]);
    expect(testJob.strategy?.matrix?.['node-version']).toEqual(['24.x']);
    expect(testJob.strategy?.matrix).not.toHaveProperty('secure-store-mode');

    const runTests = stepNamed(testJob, 'Run tests and generate reports');
    expect(runTests.run).toBe('npm run test');
    expect(runTests.env ?? {}).not.toHaveProperty(
      'LLXPRT_SECURE_STORE_FORCE_FALLBACK',
    );

    const forkArtifact = stepNamed(
      testJob,
      'Upload Test Results Artifact (for forks)',
    );
    expect(forkArtifact.with?.name).toBe(
      'test-results-fork-${{ matrix.node-version }}-${{ matrix.os }}',
    );

    const coverageArtifact = stepNamed(testJob, 'Upload coverage reports');
    expect(coverageArtifact.with?.name).toBe(
      'coverage-reports-${{ matrix.node-version }}-${{ matrix.os }}',
    );

    const report = stepNamed(testJob, 'Publish Test Report (for non-forks)');
    expect(report.with?.name).toBe(
      'Test Results (Node ${{ matrix.node-version }}, ${{ matrix.os }})',
    );
  });

  it('keeps coverage comment downloads aligned to the full-suite artifact name', () => {
    const postCoverage = workflow.jobs?.post_coverage_comment;
    expect(
      postCoverage,
      'ci.yml must contain post_coverage_comment',
    ).toBeTruthy();

    const download = stepNamed(
      postCoverage,
      'Download coverage reports artifact',
    );
    expect(download.with?.name).toBe(
      'coverage-reports-${{ matrix.node-version }}-${{ matrix.os }}',
    );
  });

  it('defines a secure_store_backend job with keyring and fallback modes', () => {
    expect(
      secureStoreJob,
      'ci.yml must contain a separate secure_store_backend job',
    ).toBeTruthy();
    expect(secureStoreJob.name).toBe(
      'SecureStore Backend (${{ matrix.os }}, ${{ matrix.secure-store-mode }})',
    );
  });

  it('keyring rows select the native-keyring vitest config on both Ubuntu and macOS', () => {
    const includes = matrixInclude(secureStoreJob);

    const keyringRows = includes.filter(
      (row) => row['secure-store-mode'] === 'keyring',
    );
    expect(keyringRows.length).toBe(2);
    expect(keyringRows.map((r) => r.os).sort()).toEqual([
      'macos-latest',
      'ubuntu-latest',
    ]);

    for (const row of keyringRows) {
      expect(row['test-config']).toBe('vitest.config.native-keyring.ts');
    }
  });

  it('runs the focused encrypted fallback and ProviderKeyStorage persistence suite on Ubuntu', () => {
    const includes = matrixInclude(secureStoreJob);
    const fallbackRows = includes.filter(
      (row) => row['secure-store-mode'] === 'fallback',
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

  it('creates and cleans up a private runtime directory before starting D-Bus', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    const runtimeCreate = backendStep.run.indexOf(
      'XDG_RUNTIME_DIR="$(mktemp -d',
    );
    const runtimePermissions = backendStep.run.indexOf(
      'chmod 700 "$XDG_RUNTIME_DIR"',
      runtimeCreate,
    );
    const cleanup = backendStep.run.indexOf(
      'trap \'rm -rf "$XDG_RUNTIME_DIR"\' EXIT',
      runtimePermissions,
    );
    const sessionStart = backendStep.run.indexOf('dbus-run-session', cleanup);

    expect(backendStep.run).toContain('export XDG_RUNTIME_DIR');
    expect(runtimeCreate).toBeGreaterThanOrEqual(0);
    expect(runtimePermissions).toBeGreaterThan(runtimeCreate);
    expect(cleanup).toBeGreaterThan(runtimePermissions);
    expect(sessionStart).toBeGreaterThan(cleanup);
  });

  it('safely imports only expected keyring environment assignments', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );

    expect(backendStep.run).not.toMatch(/\beval\b/);
    expect(backendStep.run).toContain('while IFS= read -r assignment');
    expect(backendStep.run).toContain(
      'GNOME_KEYRING_CONTROL=*|GNOME_KEYRING_PID=*|GPG_AGENT_INFO=*|SSH_AUTH_SOCK=*',
    );
    expect(backendStep.run).toContain(
      'export "$variable_name=$variable_value"',
    );
    expect(backendStep.run).toContain('Unexpected gnome-keyring-daemon output');
    expect(backendStep.run).toContain('Unsafe gnome-keyring-daemon assignment');
  });

  it('runs Ubuntu tests after Secret Service is ready inside the shared D-Bus session', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    expect(backendStep.run).toContain('gnome-keyring-daemon');
    expect(backendStep.run).toContain('--unlock');
    expect(backendStep.run).toContain('--components=secrets');
    expect(backendStep.run).toContain('DBUS_SESSION_BUS_ADDRESS');
    const sessionStart = backendStep.run.indexOf('dbus-run-session');
    const daemonStart = backendStep.run.indexOf(
      'gnome-keyring-daemon',
      sessionStart,
    );
    const readinessProbe = backendStep.run.indexOf(
      'org.freedesktop.DBus.NameHasOwner',
      daemonStart,
    );
    const secretServiceName = backendStep.run.indexOf(
      'org.freedesktop.secrets',
      readinessProbe,
    );
    const ownerCheck = backendStep.run.indexOf(
      '[[ "$secret_service_owner" == "(true,)" ]]',
      secretServiceName,
    );
    const nativeTestStart = backendStep.run.indexOf(
      'npm run test:ci --workspace @vybestack/llxprt-code-storage',
      ownerCheck,
    );
    const sessionEnd = backendStep.run.indexOf("\n  '\nelse", nativeTestStart);
    expect(sessionStart).toBeGreaterThanOrEqual(0);
    expect(daemonStart).toBeGreaterThan(sessionStart);
    expect(readinessProbe).toBeGreaterThan(daemonStart);
    expect(secretServiceName).toBeGreaterThan(readinessProbe);
    expect(ownerCheck).toBeGreaterThan(secretServiceName);
    expect(nativeTestStart).toBeGreaterThan(ownerCheck);
    expect(sessionEnd).toBeGreaterThan(nativeTestStart);
  });

  it('backend test step uses the per-row vitest config (semantic selection, not a static glob)', () => {
    const backendStep = stepNamed(
      secureStoreJob,
      'Run SecureStore backend tests',
    );
    expect(backendStep.env?.TEST_CONFIG).toBe('${{ matrix.test-config }}');
    expect(backendStep.run).toContain('--config "$TEST_CONFIG"');
    expect(backendStep.run).not.toContain('src/secure-store');
    expect(backendStep.run).not.toContain('--reporter=');
    expect(backendStep.run).not.toContain('--outputFile.junit=');
  });

  it('does not duplicate full workspace tests, script harnesses, smoke tests, builds, or coverage uploads in the focused job', () => {
    const commands = allRunCommands(secureStoreJob);
    const commandLines = commands.split('\n').map((command) => command.trim());
    expect(commandLines).not.toContain('npm run test');
    expect(commands).not.toContain('npm run test:scripts');
    expect(commands).not.toContain(
      'node ./packages/cli/bin/llxprt.cjs --version',
    );
    expect(commands).not.toContain('npm run build');

    const stepNames = (secureStoreJob.steps ?? []).map((step) => step.name);
    expect(stepNames).not.toContain('Upload coverage reports');
  });

  it('publishes focused SecureStore reports with backend mode in report and artifact names', () => {
    const report = stepNamed(secureStoreJob, 'Publish SecureStore Test Report');
    expect(report.with?.name).toBe(
      'SecureStore Backend Results (Node ${{ matrix.node-version }}, ${{ matrix.os }}, ${{ matrix.secure-store-mode }})',
    );
    expect(report.with?.path).toBe('packages/storage/junit.secure-store.xml');

    const artifact = stepNamed(
      secureStoreJob,
      'Upload SecureStore Test Results Artifact (for forks)',
    );
    expect(artifact.with?.name).toBe(
      'secure-store-results-fork-${{ matrix.node-version }}-${{ matrix.os }}-${{ matrix.secure-store-mode }}',
    );
    expect(artifact.with?.path).toBe('packages/storage/junit.secure-store.xml');
  });
});

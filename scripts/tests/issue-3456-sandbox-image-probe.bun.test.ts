/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const bunExecutable = process.execPath;
const temporaryDirectories: string[] = [];

interface ExecutedProcess {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function execute(
  script: string,
  args: readonly string[] = [],
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): ExecutedProcess {
  return spawnSync(bunExecutable, [join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
  });
}

function fakeEngineEnvironment(mode: 'success' | 'failure'): NodeJS.ProcessEnv {
  const directory = mkdtempSync(join(tmpdir(), 'llxprt-image-probe-'));
  temporaryDirectories.push(directory);
  const engineScript = join(directory, 'fake-engine.ts');
  writeFileSync(
    engineScript,
    `const args = process.argv.slice(2);
const command = args[0];
if (command === 'run' && args.includes('--entrypoint')) {
  console.log('aarch64');
  process.exit(0);
}
if (command === 'run') {
  if (process.env.FAKE_ENGINE_MODE === 'success') {
    console.log('0.11.0');
    console.log('sandbox_runtime_dependencies=ok platform=linux architecture=arm64');
    console.log('dependency_tree_sha256=abc123');
    process.exit(0);
  }
  console.error("Cannot find module '@ast-grep/napi'");
  process.exit(37);
}
if (command === 'image' && args[1] === 'inspect') {
  console.log('image_id=sha256:config repo_digests=["sandbox@sha256:manifest"] image_platform=linux/arm64');
  process.exit(0);
}
if (command === 'version') {
  console.log('client=29.1.3 server=29.1.3');
  process.exit(0);
}
console.error('unexpected fake engine invocation: ' + args.join(' '));
process.exit(64);
`,
    'utf8',
  );

  const launcherName = process.platform === 'win32' ? 'docker.cmd' : 'docker';
  const launcher = join(directory, launcherName);
  if (process.platform === 'win32') {
    writeFileSync(
      launcher,
      '@echo off\r\n"%BUN_EXECUTABLE%" "%FAKE_ENGINE_SCRIPT%" %*\r\n',
      'utf8',
    );
  } else {
    writeFileSync(
      launcher,
      '#!/bin/sh\nexec "$BUN_EXECUTABLE" "$FAKE_ENGINE_SCRIPT" "$@"\n',
      'utf8',
    );
    chmodSync(launcher, 0o755);
  }

  return {
    ...process.env,
    BUN_EXECUTABLE: bunExecutable,
    FAKE_ENGINE_MODE: mode,
    FAKE_ENGINE_SCRIPT: engineScript,
    PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('issue #3456 sandbox runtime verification', () => {
  it('loads the real architecture-specific production modules and reports the runtime platform', () => {
    const result = execute('packages/cli/scripts/verify-sandbox-runtime.ts');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `sandbox_runtime_dependencies=ok platform=${process.platform} architecture=${process.arch}`,
    );
    expect(result.stdout).toContain('@ast-grep/napi');
    expect(result.stdout).toContain('sharp');
    expect(result.stdout).toContain('@napi-rs/keyring');
    expect(result.stdout).toContain('@lydell/node-pty');
  });
});

describe('issue #3456 sandbox image probe', () => {
  it('runs the image-global CLI and reports comparable digest, platform, and dependency output', () => {
    const result = execute(
      'scripts/sandbox-image-probe.ts',
      [
        '--engine',
        'docker',
        '--image',
        'registry.example/sandbox:mutable',
        '--platform',
        'linux/arm64',
      ],
      fakeEngineEnvironment('success'),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('0.11.0');
    expect(result.stdout).toContain('dependency_tree_sha256=abc123');
    expect(result.stdout).toContain('engine=docker');
    expect(result.stdout).toContain('image_id=sha256:config');
    expect(result.stdout).toContain('sandbox@sha256:manifest');
    expect(result.stdout).toContain('image_platform=linux/arm64');
    expect(result.stdout).toContain('requested_platform=linux/arm64');
  });

  it('reports engine, image identity, digest, image platform, and runtime architecture when startup fails', () => {
    const result = execute(
      'scripts/sandbox-image-probe.ts',
      ['--engine', 'docker', '--image', 'registry.example/sandbox:mutable'],
      fakeEngineEnvironment('failure'),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot find module '@ast-grep/napi'");
    expect(result.stderr).toContain('engine=docker');
    expect(result.stderr).toContain('image=registry.example/sandbox:mutable');
    expect(result.stderr).toContain('image_id=sha256:config');
    expect(result.stderr).toContain('sandbox@sha256:manifest');
    expect(result.stderr).toContain('image_platform=linux/arm64');
    expect(result.stderr).toContain('runtime_architecture=aarch64');
    expect(result.stderr).toContain('client=29.1.3 server=29.1.3');
  });
});

describe('issue #3456 completed-image release contract', () => {
  it('verifies the completed image after all installs and packages the runtime verifier', () => {
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
    const cliPackage = readFileSync(
      join(repoRoot, 'packages/cli/package.json'),
      'utf8',
    );
    const uiInstall = dockerfile.lastIndexOf(
      'npm install -g @vybestack/llxprt-ui',
    );
    const runtimeVerification = dockerfile.indexOf(
      'scripts/verify-sandbox-runtime.ts',
    );

    expect(uiInstall).toBeGreaterThan(0);
    expect(runtimeVerification).toBeGreaterThan(uiInstall);
    expect(dockerfile.slice(runtimeVerification)).toContain('llxprt --version');
    expect(dockerfile.slice(runtimeVerification)).toContain(
      'npm ls --global --omit=dev --all',
    );
    expect(cliPackage).toContain('scripts/verify-sandbox-runtime.ts');
  });

  it('uses the diagnostic probe for every loaded release candidate', () => {
    const releaseWorkflow = readFileSync(
      join(repoRoot, '.github/workflows/release.yml'),
      'utf8',
    );
    const sandboxWorkflow = readFileSync(
      join(repoRoot, '.github/workflows/build-sandbox.yml'),
      'utf8',
    );
    const probeCommand = 'bun scripts/sandbox-image-probe.ts';

    expect(
      releaseWorkflow.split(probeCommand).length - 1,
    ).toBeGreaterThanOrEqual(2);
    expect(
      sandboxWorkflow.split(probeCommand).length - 1,
    ).toBeGreaterThanOrEqual(1);
  });

  it('packs every Dockerfile workspace tarball with release dependency versions in the manual image workflow', () => {
    const sandboxWorkflow = readFileSync(
      join(repoRoot, '.github/workflows/build-sandbox.yml'),
      'utf8',
    );
    const releasePackages = [
      'tools',
      'storage',
      'auth',
      'settings',
      'telemetry',
      'ide-integration',
      'policy',
      'mcp',
      'core',
      'providers',
      'agents',
    ];

    for (const packageName of releasePackages) {
      expect(sandboxWorkflow).toContain(
        `npm pack -w @vybestack/llxprt-code-${packageName} --pack-destination`,
      );
    }
    expect(sandboxWorkflow).toContain(
      'npm pack -w @vybestack/llxprt-code --pack-destination',
    );
    expect(sandboxWorkflow).toContain('bind-release-deps.ts --backup');
    expect(sandboxWorkflow).toContain('bind-release-deps.ts --restore');
  });
});

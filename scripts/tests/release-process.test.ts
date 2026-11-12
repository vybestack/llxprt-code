/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  asString,
  asStringArray,
  asRecord,
  jobSteps,
  parseWorkflowYaml,
  workflowJobOptional,
} from './typed-test-helpers.ts';
import type { WorkflowStep } from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NON_NPM_RELEASE_PACKAGES = new Set([
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  'llxprt-code-vscode-ide-companion',
]);

function readRootFile(relPath: string) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

function readRootJson(relPath: string): Record<string, unknown> {
  return asRecord(JSON.parse(readRootFile(relPath)));
}

function workspacePackages() {
  const rootPkg = readRootJson('package.json');
  const workspaces = asStringArray(rootPkg.workspaces);
  return workspaces.flatMap((workspacePath: string) => {
    const packageJsonPath = path.join(ROOT, workspacePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return [];
    }

    return [
      {
        workspacePath,
        packageJson: asRecord(readRootJson(`${workspacePath}/package.json`)),
      },
    ];
  });
}

function versionedReleasePackages() {
  return workspacePackages()
    .filter(({ packageJson }) => !packageJson.private)
    .filter(({ packageJson }) => {
      const name = asString(packageJson.name);
      return (
        !NON_NPM_RELEASE_PACKAGES.has(name) ||
        name === 'llxprt-code-vscode-ide-companion'
      );
    })
    .map(({ packageJson }) => asString(packageJson.name));
}

function npmReleasePackages() {
  return workspacePackages()
    .filter(({ packageJson }) => !packageJson.private)
    .filter(
      ({ packageJson }) =>
        !NON_NPM_RELEASE_PACKAGES.has(asString(packageJson.name)),
    )
    .map(({ packageJson }) => asString(packageJson.name));
}

/** Bun's `expect` has no `fail`; throw so the expression stays `never`. */
function raiseMissing(message: string): never {
  throw new Error(message);
}

describe('release package derivation', () => {
  it('derives npm-published packages from workspace package metadata', () => {
    expect(npmReleasePackages()).toEqual([
      '@vybestack/llxprt-code-tools',
      '@vybestack/llxprt-code-storage',
      '@vybestack/llxprt-code-auth',
      '@vybestack/llxprt-code-settings',
      '@vybestack/llxprt-code-telemetry',
      '@vybestack/llxprt-code-ide-integration',
      '@vybestack/llxprt-code-policy',
      '@vybestack/llxprt-code-mcp',
      '@vybestack/llxprt-code-core',
      '@vybestack/llxprt-code-lsp',
      '@vybestack/llxprt-code-providers',
      '@vybestack/llxprt-code-agents',
      '@vybestack/llxprt-code-zed-acp',
      '@vybestack/llxprt-code',
    ]);
  });

  it('includes @vybestack/llxprt-code-tools as a publishable package in correct order', () => {
    const packages = npmReleasePackages();
    const toolsIndex = packages.indexOf('@vybestack/llxprt-code-tools');
    const coreIndex = packages.indexOf('@vybestack/llxprt-code-core');
    const providersIndex = packages.indexOf('@vybestack/llxprt-code-providers');
    const cliIndex = packages.indexOf('@vybestack/llxprt-code');
    expect(toolsIndex).toBeGreaterThan(-1);
    // Tools must come before core, providers, and CLI in publish order because
    // those packages depend on the tools package tarball/version.
    expect(toolsIndex).toBeLessThan(coreIndex);
    expect(toolsIndex).toBeLessThan(providersIndex);
    expect(toolsIndex).toBeLessThan(cliIndex);
  });

  it('publishes the ACP client before the CLI that depends on it', () => {
    const packages = npmReleasePackages();
    const zedAcpIndex = packages.indexOf('@vybestack/llxprt-code-zed-acp');
    const cliIndex = packages.indexOf('@vybestack/llxprt-code');
    expect(zedAcpIndex).toBeGreaterThan(-1);
    expect(zedAcpIndex).toBeLessThan(cliIndex);
  });

  it('keeps VS Code extension versioned but outside npm package publishing', () => {
    expect(versionedReleasePackages()).toContain(
      'llxprt-code-vscode-ide-companion',
    );
    expect(npmReleasePackages()).not.toContain(
      'llxprt-code-vscode-ide-companion',
    );
  });
});

describe('scripts/version.ts', () => {
  const versionTs = readRootFile('scripts/version.ts');

  it('derives workspace packages from root package.json instead of a hardcoded copy', () => {
    expect(versionTs).toContain('workspacePathsFromRootWorkspaces');
    expect(versionTs).toContain('workspaces.filter');
    expect(versionTs).not.toContain('const actualWorkspaces');
  });

  it('versions release packages while excluding internal non-release workspaces', () => {
    expect(versionedReleasePackages()).toEqual([
      ...npmReleasePackages(),
      'llxprt-code-vscode-ide-companion',
    ]);
    expect(versionedReleasePackages()).not.toContain(
      '@vybestack/llxprt-code-test-utils',
    );
    expect(versionedReleasePackages()).not.toContain(
      '@vybestack/llxprt-code-a2a-server',
    );
    expect(versionTs).toContain('versionedWorkspacePathsFromRootWorkspaces');
    expect(versionTs).toContain('isVersionedReleasePackage');
    expect(versionTs).toContain('--workspace');
  });

  it('keeps the default lockfile install timeout for existing runNpm callers', () => {
    expect(versionTs).toContain('timeoutMs ?? 120_000');
  });

  it('raises the timeout and allows a single ETIMEDOUT retry for the lockfile-only install', () => {
    expect(versionTs).toContain("runNpm(['install', '--package-lock-only'], {");
    expect(versionTs).toContain('timeoutMs: 600_000');
    expect(versionTs).toContain('retries: 1');
    expect(versionTs).toContain(
      `(error as { code?: unknown }).code === 'ETIMEDOUT'`,
    );
    expect(versionTs).toContain('(attempt ');
    expect(versionTs).toContain('retrying.');
  });
});

describe('.github/workflows/release.yml', () => {
  const releaseYml = readRootFile('.github/workflows/release.yml');
  const releaseParsed = parseWorkflowYaml(releaseYml);
  const releaseSteps = jobSteps(workflowJobOptional(releaseParsed, 'release'));
  const prepareSteps = jobSteps(
    workflowJobOptional(releaseParsed, 'prepare_artifact'),
  );
  const integrationSteps = jobSteps(
    workflowJobOptional(releaseParsed, 'integration'),
  );
  const verifyShardSteps = jobSteps(
    workflowJobOptional(releaseParsed, 'verify_shards'),
  );
  const integrationStepByName = (name: string): WorkflowStep =>
    integrationSteps.find((step) => step.name === name) ??
    raiseMissing(`missing integration step: ${name}`);
  const prepareStepByName = (name: string): WorkflowStep =>
    prepareSteps.find((step) => step.name === name) ??
    raiseMissing(`missing preparation step: ${name}`);
  const stepById = (id: string): WorkflowStep =>
    releaseSteps.find((s) => s.id === id) ??
    raiseMissing(`missing step id: ${id}`);
  const stepByName = (name: string): WorkflowStep =>
    releaseSteps.find((s) => s.name === name) ??
    raiseMissing(`missing step: ${name}`);

  it('gates every npm publish on scripts-disabled consumer proof and publishes the proven tarballs', () => {
    const gate = prepareStepByName('Build and prove prepared release packages');
    const publishes = releaseSteps.filter((step) =>
      npmReleasePackages().some((name) => step.name === `Publish ${name}`),
    );
    expect(publishes.length).toBeGreaterThan(0);
    for (const step of publishes) {
      expect(step.run).toContain('--ignore-scripts');
      expect(asString(step.run)).toContain('release-artifacts/');
    }
    expect(asString(gate.if)).toContain('inputs.publish_vscode_only != true');
    expect(asString(gate.if)).not.toContain('is_dry_run');
    expect(asString(gate.run)).toContain('release-bound-artifact-helpers.ts');
    expect(prepareSteps.indexOf(gate)).toBeLessThan(
      prepareSteps.findIndex(
        (step) => step.name === 'Upload prepared release artifacts',
      ),
    );
  });

  it('routes integration and release-note model requests through local Gemma', () => {
    const releaseNotes = prepareStepByName('Write release notes');
    const integrations = integrationStepByName('Run Integration Tests');
    const modelSetup = integrationSteps.find(
      (step) => step.name === 'Set up local Gemma model',
    );

    expect(modelSetup).toBeDefined();
    expect(asString(modelSetup?.uses)).toBe(
      './.github/actions/setup-local-gemma',
    );
    expect(asString(integrations.run)).toContain(
      'npm run test:integration:sandbox:none',
    );
    expect(asString(integrations.run)).not.toContain('--exclude');
    expect(asString(asRecord(integrations.env).LLXPRT_E2E_MODEL_LEDGER)).toBe(
      '${{ runner.temp }}/release-model-ledger.jsonl',
    );

    const releaseNotesSetup = prepareStepByName('Generate release notes');
    expect(prepareSteps.indexOf(releaseNotesSetup)).toBeLessThan(
      prepareSteps.indexOf(releaseNotes),
    );
    const releaseNotesEnv = asRecord(releaseNotes.env);
    expect(releaseNotesEnv.OPENAI_BASE_URL).toBe('http://127.0.0.1:12644/v1');
    expect(releaseNotesEnv.OPENAI_API_KEY).toBe('ollama-local-only');
    expect(releaseNotesEnv.LLXPRT_DEFAULT_PROVIDER).toBe('openai');
    expect(releaseNotesEnv.LLXPRT_DEFAULT_MODEL).toBe('gemma4:e2b-it-qat');
    expect(JSON.stringify([releaseSteps, integrationSteps])).not.toContain(
      'secrets[vars.KEY_VAR_NAME',
    );
  });

  it('captures and uploads local-model diagnostics after integration failures', () => {
    const capture = integrationStepByName('Capture release model diagnostics');
    const upload = integrationStepByName('Upload release model diagnostics');
    const integrations = integrationStepByName('Run Integration Tests');
    expect(asString(capture['if'])).toContain('always()');
    expect(asString(upload['if'])).toContain('always()');
    expect(asString(capture.run)).toContain('release-model-ledger.jsonl');
    expect(asString(capture.run)).toContain('ollama-server.log');
    expect(asString(capture.run)).toContain('/proc/loadavg');
    expect(asString(capture.run)).toContain('/sys/fs/cgroup/cpu.stat');
    expect(asString(upload.with?.path)).toBe(
      '${{ runner.temp }}/release-diagnostics/',
    );
    expect(asString(upload.with?.['if-no-files-found'])).toBe('error');
    expect(integrationSteps.indexOf(capture)).toBeGreaterThan(
      integrationSteps.indexOf(integrations),
    );
    expect(integrationSteps.indexOf(upload)).toBeGreaterThan(
      integrationSteps.indexOf(capture),
    );
  });

  it('skips release publication for scheduled nightlies when the version is already published', () => {
    const duplicateCheck = stepById('duplicate_check');
    expect(asString(duplicateCheck['if'])).toBe(
      "github.event_name == 'schedule'",
    );
    expect(asString(duplicateCheck.run)).toBe(
      'bun scripts/check-nightly-release.ts',
    );

    for (const step of [
      stepByName('Push release branch after all release gates'),
      stepByName('Publish @vybestack/llxprt-code-tools'),
      stepByName('Publish @vybestack/llxprt-code'),
      stepByName('Publish tested sandbox candidates'),
      stepByName('Create GitHub Release and Tag'),
    ]) {
      expect(
        asString(step['if']),
        `${step.name ?? '<unnamed>'} should respect the duplicate-nightly skip`,
      ).toContain("steps.duplicate_check.outputs.is_duplicate != 'true'");
    }
    expect(
      String(prepareStepByName('Version and bind release packages').if ?? ''),
    ).not.toContain('dry_run');

    expect(asString(stepByName('Create Issue on Failure')['if'])).toBe(
      'failure()',
    );
    const gateFailure = workflowJobOptional(
      releaseParsed,
      'report_gate_failure',
    );
    expect(gateFailure).toBeDefined();
    expect(asString(gateFailure?.['if'])).toContain(
      "needs.verify_shards.result == 'failure'",
    );
  });

  it('installs runtime plugins in shard and integration runners', () => {
    const shardPluginInstall = verifyShardSteps.find(
      (step) => step.name === 'Install runtime plugin dependencies',
    );
    const integrationPluginInstall = integrationStepByName(
      'Install runtime plugin dependencies',
    );

    expect(shardPluginInstall).toBeDefined();
    expect(asString(shardPluginInstall?.run)).toContain(
      'plugins/google-gemini plugins/google-mcp-auth',
    );
    expect(asString(shardPluginInstall?.run)).toContain(
      'bun install --omit=peer',
    );
    expect(asString(integrationPluginInstall.run)).toContain(
      'plugins/google-gemini plugins/google-mcp-auth',
    );
    expect(asString(integrationPluginInstall.run)).toContain(
      'bun install --omit=peer',
    );
  });

  it('executes plugin installation in each plugin directory with peer omission and stops on either install failure', () => {
    const shell = asString(
      verifyShardSteps.find(
        (step) => step.name === 'Install runtime plugin dependencies',
      )?.run,
    );
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), 'release-plugin-install-'),
    );
    const bin = path.join(fixture, 'bin');
    fs.mkdirSync(bin);
    for (const plugin of ['google-gemini', 'google-mcp-auth']) {
      fs.mkdirSync(path.join(fixture, 'plugins', plugin), { recursive: true });
    }
    const log = path.join(fixture, 'installs.log');
    const installer = path.join(bin, 'bun');
    fs.writeFileSync(
      installer,
      `#!/bin/sh
plugin_dir="$(pwd -P)"
printf "%s|%s\n" "$plugin_dir" "$*" >> "$INSTALL_LOG"
if [ -n "$FAIL_PLUGIN" ]; then case "$plugin_dir" in */"$FAIL_PLUGIN") exit 17 ;; esac; fi
`,
    );
    fs.chmodSync(installer, 0o755);
    const run = (failPlugin: string): string => {
      try {
        execFileSync(
          'bash',
          [
            '-e',
            '-c',
            `export PATH="$PWD/bin:$PATH" INSTALL_LOG="$PWD/installs.log"
${shell}`,
          ],
          {
            cwd: fixture,
            env: {
              ...process.env,
              FAIL_PLUGIN: failPlugin,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        return 'success';
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'status' in error)
          return String(error.status);
        return 'unknown failure';
      }
    };

    try {
      expect(run('')).toBe('success');
      const realFixture = execFileSync('bash', ['-c', 'pwd -P'], {
        cwd: fixture,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      expect(fs.readFileSync(log, 'utf8')).toBe(
        `${path.posix.join(realFixture, 'plugins/google-gemini')}|install --omit=peer
${path.posix.join(realFixture, 'plugins/google-mcp-auth')}|install --omit=peer
`,
      );
      for (const plugin of ['google-gemini', 'google-mcp-auth']) {
        fs.writeFileSync(log, '');
        expect(run(plugin)).toBe('17');
        expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(
          plugin === 'google-gemini' ? 1 : 2,
        );
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('publishes every npm release package', () => {
    for (const packageName of npmReleasePackages()) {
      expect(releaseYml, `release.yml should publish ${packageName}`).toContain(
        `release-artifacts/${packageName.replace('@', '').replace('/', '-')}-`,
      );
    }
  });

  it('publishes tools before core, providers, and CLI', () => {
    const toolsIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-tools\n',
    );
    const providersIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-providers\n',
    );
    const cliIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code\n',
    );

    expect(
      toolsIndex,
      'release.yml should publish @vybestack/llxprt-code-tools',
    ).toBeGreaterThan(0);
    expect(
      providersIndex,
      'release.yml should publish @vybestack/llxprt-code-providers',
    ).toBeGreaterThan(toolsIndex);
    expect(
      cliIndex,
      'release.yml should publish @vybestack/llxprt-code after tools',
    ).toBeGreaterThan(toolsIndex);
  });

  it('publishes storage, auth, settings, telemetry, ide-integration, and policy before MCP, core, providers, agents, and CLI', () => {
    const storageIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-storage\n',
    );
    const authIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-auth\n',
    );
    const settingsIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-settings\n',
    );
    const telemetryIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-telemetry\n',
    );
    const ideIntegrationIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-ide-integration\n',
    );
    const policyIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-policy\n',
    );
    const mcpIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-mcp\n',
    );
    const coreIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-core\n',
    );
    const providersIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-providers\n',
    );
    const agentsIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code-agents\n',
    );
    const cliIndex = releaseYml.indexOf(
      'name: Publish @vybestack/llxprt-code\n',
    );

    expect(storageIndex).toBeGreaterThan(0);
    expect(authIndex).toBeGreaterThan(storageIndex);
    expect(settingsIndex).toBeGreaterThan(authIndex);
    expect(telemetryIndex).toBeGreaterThan(settingsIndex);
    expect(ideIntegrationIndex).toBeGreaterThan(telemetryIndex);
    expect(policyIndex).toBeGreaterThan(ideIntegrationIndex);
    expect(mcpIndex).toBeGreaterThan(policyIndex);
    expect(coreIndex).toBeGreaterThan(mcpIndex);
    expect(providersIndex).toBeGreaterThan(coreIndex);
    expect(agentsIndex).toBeGreaterThan(providersIndex);
    expect(cliIndex).toBeGreaterThan(agentsIndex);
  });

  it('binds and versions release dependencies before building and committing prepared artifacts', () => {
    const versionStep = prepareSteps.findIndex(
      (step) => step.name === 'Version and bind release packages',
    );
    const commitStep = prepareSteps.findIndex(
      (step) => step.name === 'Create prepared release commit',
    );
    const buildStep = prepareSteps.findIndex(
      (step) => step.name === 'Build versioned sandbox inputs',
    );
    const versionCommand = asString(prepareSteps[versionStep]?.run);
    const commitCommand = asString(prepareSteps[commitStep]?.run);

    expect(versionStep).toBeGreaterThanOrEqual(0);
    expect(commitStep).toBeGreaterThan(versionStep);
    expect(buildStep).toBeGreaterThan(commitStep);
    expect(versionCommand).toContain('npm run release:version');
    expect(versionCommand).toContain('bun scripts/bind-release-deps.ts');
    expect(versionCommand).toContain('bun scripts/bind-plugin-peers.ts');
    expect(versionCommand).toContain('npm version "$RELEASE_VERSION"');
    expect(commitCommand).toContain('git commit -m');
    expect(commitCommand).toContain('git rev-parse HEAD');
    expect(releaseYml).not.toContain(
      'bun scripts/bind-release-deps.ts --backup',
    );
  });

  it('does not skip release package preparation during dry-run releases', () => {
    const preparation = prepareSteps.map((step) => step.run ?? '').join('\n');
    expect(preparation).toContain('npm run release:version');
    expect(preparation).toContain('release-bound-artifact-helpers.ts');
    expect(
      asString(
        prepareStepByName('Build and prove prepared release packages').if,
      ),
    ).not.toContain('dry_run');
  });

  it('uses prepared tools tarballs as sandbox image inputs', () => {
    expect(releaseYml).toContain('packages/*/dist/*.tgz');
    expect(releaseYml).toContain(
      'scripts/tests/release-bound-artifact-helpers.ts',
    );
    expect(releaseYml).toContain('release-package-tarballs.sha256');
    expect(releaseYml).toContain('cp "$tarball" "$package_dir/dist/"');
  });

  it('uses prepared settings, providers, and agents tarballs as sandbox image inputs', () => {
    expect(releaseYml).toContain('for package_dir in packages/*');
    expect(releaseYml).toContain('packages/*/dist/*.tgz');
    expect(releaseYml).toContain(
      'npm pack --ignore-scripts --pack-destination',
    );
  });

  it('does not claim create_nightly_release ignores the version input', () => {
    expect(releaseYml).not.toContain('input version is ignored');
  });

  it('documents that create_nightly_release distinguishes manual from scheduled dispatch', () => {
    expect(releaseYml).toContain('create_nightly_release');
    const nightlyInput = releaseYml.slice(
      releaseYml.indexOf('create_nightly_release'),
      releaseYml.indexOf('force_skip_tests'),
    );
    expect(nightlyInput).toContain('manual');
    expect(nightlyInput).toContain('scheduled');
  });
});

describe('scripts/build_sandbox.ts', () => {
  const buildSandbox = readRootFile('scripts/build_sandbox.ts');

  it('packs tools, auth, settings, telemetry, MCP, providers, and agents alongside core and CLI', () => {
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code-tools');
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code');
    expect(buildSandbox).toContain(
      'npm pack -w @vybestack/llxprt-code-storage',
    );
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code-auth');
    expect(buildSandbox).toContain(
      'npm pack -w @vybestack/llxprt-code-settings',
    );
    expect(buildSandbox).toContain(
      'npm pack -w @vybestack/llxprt-code-telemetry',
    );
    expect(buildSandbox).toContain(
      'npm pack -w @vybestack/llxprt-code-ide-integration',
    );
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code-policy');
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code-mcp');
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code-core');
    expect(buildSandbox).toContain(
      'npm pack -w @vybestack/llxprt-code-providers',
    );
    expect(buildSandbox).toContain('npm pack -w @vybestack/llxprt-code-agents');
  });

  it('temporarily binds and restores workspace dependencies for local sandbox packing', () => {
    expect(buildSandbox).toContain('bind-release-deps.ts --backup');
    expect(buildSandbox).toContain('bind-release-deps.ts --restore');
  });

  it('clears stale dist tarballs by enumerating dist entries instead of a glob rmSync (#3334)', () => {
    // rmSync does not expand globs, so any literal `-*.tgz` path is a silent
    // no-op that leaves stale tarballs for the Dockerfile COPY glob.
    expect(buildSandbox).toMatch(/removeTarballs\(/);
    expect(buildSandbox).not.toMatch(/-\*\.tgz/);
  });
});

describe('.github/workflows/build-sandbox.yml', () => {
  const buildSandboxYml = readRootFile('.github/workflows/build-sandbox.yml');

  it('packs sandbox tarballs in tools, core, providers, CLI order', () => {
    const toolsPack = buildSandboxYml.indexOf(
      'npm pack -w @vybestack/llxprt-code-tools',
    );
    const corePack = buildSandboxYml.indexOf(
      'npm pack -w @vybestack/llxprt-code-core',
    );
    const providersPack = buildSandboxYml.indexOf(
      'npm pack -w @vybestack/llxprt-code-providers',
    );
    const cliPack = buildSandboxYml.indexOf(
      'npm pack -w @vybestack/llxprt-code --pack-destination',
    );

    expect(toolsPack).toBeGreaterThan(0);
    expect(corePack).toBeGreaterThan(toolsPack);
    expect(providersPack).toBeGreaterThan(corePack);
    expect(cliPack).toBeGreaterThan(providersPack);
  });
});

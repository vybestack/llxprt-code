/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
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
  const stepById = (id: string): WorkflowStep =>
    releaseSteps.find((s) => s.id === id) ??
    raiseMissing(`missing step id: ${id}`);
  const stepByName = (name: string): WorkflowStep =>
    releaseSteps.find((s) => s.name === name) ??
    raiseMissing(`missing step: ${name}`);

  it('selects keys before standard release notes without blocking skipped-test fallback', () => {
    const quota = stepById('quota');
    const releaseNotes = stepByName('Generate Release Notes');
    const quotaIndex = releaseSteps.indexOf(quota);
    const releaseNotesIndex = releaseSteps.indexOf(releaseNotes);
    expect(asString(quota['if']).replace(/\s+/g, ' ').trim()).toBe(
      "( github.event.inputs.force_skip_tests != 'true' || (github.event.inputs.dry_run != 'true' && github.event.inputs.publish_vscode_only != 'true') ) && steps.duplicate_check.outputs.is_duplicate != 'true'",
    );
    expect(quotaIndex >= 0 && releaseNotesIndex > quotaIndex).toBe(true);
    expect(asString(quota['continue-on-error'])).toBe(
      "${{ github.event.inputs.force_skip_tests == 'true' }}",
    );
    expect(asString(quota.run)).toBe('bun scripts/ci-quota-check.ts');
    expect(asRecord(releaseNotes.env).OPENAI_API_KEY).toContain(
      "steps.quota.outputs.selected_key == 'secondary'",
    );
    expect(asRecord(quota.env).OPENAI_API_KEY).toBe(
      '${{ secrets[vars.KEY_VAR_NAME] }}',
    );
  });

  it('skips the release pipeline for scheduled nightlies when the version is already published', () => {
    const duplicateCheck = stepById('duplicate_check');
    expect(asString(duplicateCheck['if'])).toBe(
      "github.event_name == 'schedule'",
    );
    expect(asString(duplicateCheck.run)).toContain('npm view');
    expect(asString(duplicateCheck.run)).toContain(
      '@vybestack/llxprt-code-tools@',
    );

    const guardedSteps = [
      stepById('quota'),
      stepByName('Run Preflight Checks'),
      stepByName('Run Integration Tests'),
      stepByName('Update package versions'),
      stepByName('Bind release dependencies'),
      stepByName('Build and Prepare Packages'),
      stepByName('Generate Release Notes'),
      stepByName('Publish @vybestack/llxprt-code-tools'),
      stepByName('Publish @vybestack/llxprt-code'),
      stepByName('Prepare sandbox package tarballs'),
      stepByName('Build and push sandbox image'),
      stepByName('Create GitHub Release and Tag'),
    ];
    for (const step of guardedSteps) {
      expect(
        asString(step['if']),
        `${step.name ?? '<unnamed>'} should respect the duplicate-nightly skip`,
      ).toContain("steps.duplicate_check.outputs.is_duplicate != 'true'");
    }

    expect(asString(stepByName('Create Issue on Failure')['if'])).toBe(
      'failure()',
    );
  });

  it('publishes every npm release package', () => {
    for (const packageName of npmReleasePackages()) {
      expect(releaseYml, `release.yml should publish ${packageName}`).toContain(
        `npm publish --workspace=${packageName}`,
      );
    }
  });

  it('publishes tools before core, providers, and CLI', () => {
    const toolsIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-tools',
    );
    const providersIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-providers',
    );
    const cliIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code ',
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
      'npm publish --workspace=@vybestack/llxprt-code-storage',
    );
    const authIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-auth',
    );
    const settingsIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-settings',
    );
    const telemetryIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-telemetry',
    );
    const ideIntegrationIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-ide-integration',
    );
    const policyIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-policy',
    );
    const mcpIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-mcp',
    );
    const coreIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-core',
    );
    const providersIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-providers',
    );
    const agentsIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code-agents',
    );
    const cliIndex = releaseYml.indexOf(
      'npm publish --workspace=@vybestack/llxprt-code ',
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

  it('binds release dependencies before committing or publishing', () => {
    const versionStep = releaseYml.indexOf('Update package versions');
    const bindStep = releaseYml.indexOf('Bind release dependencies');
    const commitStep = releaseYml.indexOf('Commit and Conditionally Push');
    const publishStep = releaseYml.indexOf(
      'Publish @vybestack/llxprt-code-core',
    );

    expect(bindStep).toBeGreaterThan(versionStep);
    expect(commitStep).toBeGreaterThan(bindStep);
    expect(publishStep).toBeGreaterThan(bindStep);
    expect(releaseYml).toContain('bun scripts/bind-release-deps.ts');
    expect(releaseYml).not.toContain(
      'bun scripts/bind-release-deps.ts --backup',
    );
  });

  it('does not skip dependency binding during dry-run releases', () => {
    const bindStep = releaseYml.slice(
      releaseYml.indexOf('Bind release dependencies'),
      releaseYml.indexOf('Commit and Conditionally Push'),
    );

    expect(bindStep).toContain(
      "steps.vars.outputs.should_run_standard_release == 'true'",
    );
    expect(bindStep).not.toContain('is_dry_run');
  });

  it('prepares tools tarballs for sandbox images', () => {
    expect(releaseYml).toContain('packages/tools/dist');
    expect(releaseYml).toContain('npm pack -w @vybestack/llxprt-code-tools');
  });

  it('prepares settings, providers, and agents tarballs for sandbox images', () => {
    expect(releaseYml).toContain('packages/settings/dist');
    expect(releaseYml).toContain('packages/providers/dist');
    expect(releaseYml).toContain('packages/agents/dist');
    expect(releaseYml).toContain('npm pack -w @vybestack/llxprt-code-settings');
    expect(releaseYml).toContain(
      'npm pack -w @vybestack/llxprt-code-providers',
    );
    expect(releaseYml).toContain('npm pack -w @vybestack/llxprt-code-agents');
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

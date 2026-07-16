/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NON_NPM_RELEASE_PACKAGES = new Set([
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  'llxprt-code-vscode-ide-companion',
]);

function readRootFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

function readRootJson(relPath) {
  return JSON.parse(readRootFile(relPath));
}

function workspacePackages() {
  return readRootJson('package.json').workspaces.flatMap((workspacePath) => {
    const packageJsonPath = path.join(ROOT, workspacePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return [];
    }

    return [
      {
        workspacePath,
        packageJson: readRootJson(`${workspacePath}/package.json`),
      },
    ];
  });
}

function versionedReleasePackages() {
  return workspacePackages()
    .filter(({ packageJson }) => !packageJson.private)
    .filter(
      ({ packageJson }) =>
        !NON_NPM_RELEASE_PACKAGES.has(packageJson.name) ||
        packageJson.name === 'llxprt-code-vscode-ide-companion',
    )
    .map(({ packageJson }) => packageJson.name);
}

function npmReleasePackages() {
  return workspacePackages()
    .filter(({ packageJson }) => !packageJson.private)
    .filter(
      ({ packageJson }) => !NON_NPM_RELEASE_PACKAGES.has(packageJson.name),
    )
    .map(({ packageJson }) => packageJson.name);
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
});

describe('.github/workflows/release.yml', () => {
  const releaseYml = readRootFile('.github/workflows/release.yml');

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

describe('Dockerfile', () => {
  const dockerfile = readRootFile('Dockerfile');

  it('copies tools, storage, auth, settings, telemetry, MCP, core, providers, agents, and CLI tarballs in dependency order', () => {
    const storageCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/storage/dist/vybestack-llxprt-code-storage-*.tgz',
    );
    const authCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/auth/dist/vybestack-llxprt-code-auth-*.tgz',
    );
    const settingsCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/settings/dist/vybestack-llxprt-code-settings-*.tgz',
    );
    const telemetryCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/telemetry/dist/vybestack-llxprt-code-telemetry-*.tgz',
    );
    const policyCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/policy/dist/vybestack-llxprt-code-policy-*.tgz',
    );
    const mcpCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/mcp/dist/vybestack-llxprt-code-mcp-*.tgz',
    );
    const coreCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz',
    );
    const toolsCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz',
    );
    const providersCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz',
    );
    const agentsCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/agents/dist/vybestack-llxprt-code-agents-*.tgz',
    );
    const cliCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz',
    );

    expect(toolsCopy, 'Dockerfile should COPY tools tarball').toBeGreaterThan(
      0,
    );
    expect(storageCopy).toBeGreaterThan(toolsCopy);
    expect(authCopy).toBeGreaterThan(storageCopy);
    expect(settingsCopy).toBeGreaterThan(authCopy);
    expect(telemetryCopy).toBeGreaterThan(settingsCopy);
    expect(policyCopy).toBeGreaterThan(telemetryCopy);
    expect(mcpCopy).toBeGreaterThan(policyCopy);
    expect(coreCopy).toBeGreaterThan(mcpCopy);
    expect(
      toolsCopy,
      'tools should come before core in Dockerfile COPY order',
    ).toBeLessThan(coreCopy);
    expect(providersCopy).toBeGreaterThan(coreCopy);
    expect(agentsCopy).toBeGreaterThan(providersCopy);
    expect(cliCopy).toBeGreaterThan(agentsCopy);
  });

  it('installs local tarballs in one npm transaction for unpublished versions', () => {
    const installCommand = dockerfile.slice(
      dockerfile.indexOf('RUN npm install -g'),
      dockerfile.indexOf('npm cache clean --force'),
    );

    expect(installCommand).toContain('vybestack-llxprt-code-tools-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-storage-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-auth-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-settings-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-telemetry-*.tgz');
    expect(installCommand).toContain(
      'vybestack-llxprt-code-ide-integration-*.tgz',
    );
    expect(installCommand).toContain('vybestack-llxprt-code-policy-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-mcp-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-core-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-providers-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-agents-*.tgz');
    expect(installCommand).toContain('vybestack-llxprt-code-*.tgz');
    expect(installCommand).not.toContain('&& \\\n    npm install -g');
  });

  it('copies core tarball, tools tarball, providers tarball, and CLI tarball', () => {
    expect(dockerfile).toContain(
      'COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz',
    );
    expect(dockerfile).toContain(
      'COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz',
    );
    expect(dockerfile).toContain(
      'COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz',
    );
    expect(dockerfile).toContain(
      'COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz',
    );
  });
});

describe('scripts/bind-release-deps.ts', () => {
  it('derives npm release packages from the same metadata as the tests', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );

    expect(bindModule.deriveNpmReleasePackages()).toEqual(npmReleasePackages());
  });

  it('derives npm release packages in canonical publish order', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );

    expect(bindModule.deriveNpmReleasePackages()).toEqual([
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
      '@vybestack/llxprt-code',
    ]);
  });

  it('rewrites publishable workspace file dependencies to exact versions', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );
    const workspaceInfo = new Map([
      [
        '@vybestack/llxprt-code-core',
        {
          pkgJsonPath: 'packages/core/package.json',
          version: '1.2.3',
          workspacePath: 'packages/core',
        },
      ],
      [
        '@vybestack/llxprt-code-tools',
        {
          pkgJsonPath: 'packages/tools/package.json',
          version: '1.2.3',
          workspacePath: 'packages/tools',
        },
      ],
      [
        '@vybestack/llxprt-code-providers',
        {
          pkgJsonPath: 'packages/providers/package.json',
          version: '1.2.3',
          workspacePath: 'packages/providers',
        },
      ],
      [
        '@vybestack/llxprt-code-agents',
        {
          pkgJsonPath: 'packages/agents/package.json',
          version: '1.2.3',
          workspacePath: 'packages/agents',
        },
      ],
      [
        '@vybestack/llxprt-code-test-utils',
        {
          pkgJsonPath: 'packages/test-utils/package.json',
          version: '1.2.3',
          workspacePath: 'packages/test-utils',
        },
      ],
    ]);
    const deps = {
      '@vybestack/llxprt-code-core': 'file:../core',
      '@vybestack/llxprt-code-tools': 'file:../tools',
      '@vybestack/llxprt-code-providers': 'file:../providers',
      '@vybestack/llxprt-code-agents': 'file:../agents',
      '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      chalk: '^5.3.0',
    };

    const releasePackages = new Set([
      '@vybestack/llxprt-code-core',
      '@vybestack/llxprt-code-tools',
      '@vybestack/llxprt-code-providers',
      '@vybestack/llxprt-code-agents',
    ]);
    expect(bindModule.rewriteDeps(deps, workspaceInfo, releasePackages)).toBe(
      true,
    );
    expect(deps).toEqual({
      '@vybestack/llxprt-code-core': '1.2.3',
      '@vybestack/llxprt-code-tools': '1.2.3',
      '@vybestack/llxprt-code-providers': '1.2.3',
      '@vybestack/llxprt-code-agents': '1.2.3',
      '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      chalk: '^5.3.0',
    });
  });

  it('fails verification when npm release packages keep workspace file dependencies', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );
    const readPackage = () => ({
      name: '@vybestack/llxprt-code',
      dependencies: {
        '@vybestack/llxprt-code-providers': 'file:../providers',
        '@vybestack/llxprt-code-agents': 'file:../agents',
      },
    });
    const workspaceInfo = new Map([
      [
        '@vybestack/llxprt-code-providers',
        {
          pkgJsonPath: 'packages/providers/package.json',
          version: '1.2.3',
          workspacePath: 'packages/providers',
        },
      ],
      [
        '@vybestack/llxprt-code-agents',
        {
          pkgJsonPath: 'packages/agents/package.json',
          version: '1.2.3',
          workspacePath: 'packages/agents',
        },
      ],
    ]);

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        new Set(['@vybestack/llxprt-code', '@vybestack/llxprt-code-providers']),
        workspaceInfo,
        readPackage,
      ),
    ).toThrow('workspace file: dependencies');
  });

  it('passes verification when release packages have no workspace file dependencies', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );
    const readPackage = () => ({
      name: '@vybestack/llxprt-code',
      dependencies: {
        '@vybestack/llxprt-code-core': '1.2.3',
        chalk: '^5.3.0',
      },
    });

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        new Set(['@vybestack/llxprt-code']),
        new Map(),
        readPackage,
      ),
    ).not.toThrow();
  });

  it('ignores workspace file dependencies in non-release packages', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );
    const readPackage = () => ({
      name: '@vybestack/llxprt-code-test-utils',
      dependencies: {
        '@vybestack/llxprt-code-core': 'file:../core',
      },
    });

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/test-utils'],
        new Set(['@vybestack/llxprt-code']),
        new Map(),
        readPackage,
      ),
    ).not.toThrow();
  });

  it('allows release packages to keep non-NPM release workspaces as dev-only file dependencies', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );
    const readPackage = () => ({
      name: '@vybestack/llxprt-code',
      devDependencies: {
        '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      },
    });
    const workspaceInfo = new Map([
      [
        '@vybestack/llxprt-code-test-utils',
        {
          pkgJsonPath: 'packages/test-utils/package.json',
          version: '1.2.3',
          workspacePath: 'packages/test-utils',
        },
      ],
    ]);

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        new Set(['@vybestack/llxprt-code']),
        workspaceInfo,
        readPackage,
      ),
    ).not.toThrow();
  });

  it('rejects non-NPM release workspaces as production file dependencies in release packages', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.ts')
    );
    const readPackage = () => ({
      name: '@vybestack/llxprt-code',
      dependencies: {
        '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      },
    });
    const workspaceInfo = new Map([
      [
        '@vybestack/llxprt-code-test-utils',
        {
          pkgJsonPath: 'packages/test-utils/package.json',
          version: '1.2.3',
          workspacePath: 'packages/test-utils',
        },
      ],
    ]);

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        new Set(['@vybestack/llxprt-code']),
        workspaceInfo,
        readPackage,
      ),
    ).toThrow(
      '@vybestack/llxprt-code dependencies.@vybestack/llxprt-code-test-utils=file:../test-utils',
    );
  });
});

/**
 * Issue #2323: Behavioral regression tests for nightly workflow invariants.
 *
 * The nightly release preflight failed because tests ran before the agents
 * API-surface report existed. The same gap existed in .github/workflows/nightly.yml,
 * which ran `npm run test` without first generating the report via
 * `npm run lint:agents-api-surface`. Additionally, unlike release.yml, the
 * nightly workflow lacked a failure-notification step. These tests lock the
 * nightly workflow contract: report generation precedes tests, the failure
 * notification job has issues:write permission, and it opens or updates a gh
 * issue with the ci/cd label linking to the workflow run.
 */
describe('.github/workflows/nightly.yml', () => {
  let nightlyWorkflow;
  let windowsCiJob;
  let notifyFailureJob;

  function stepNamed(job, name) {
    expect(job?.steps, 'job should have a steps array').toBeDefined();
    const step = job?.steps.find((candidate) => candidate.name === name);
    expect(step, `job should contain step: ${name}`).toBeTruthy();
    return step;
  }

  function failureNotificationStep() {
    const step = stepNamed(notifyFailureJob, 'Create Issue on Failure');
    expect(
      step.run,
      "'Create Issue on Failure' step should have a run script",
    ).toBeTruthy();
    return step;
  }

  function failureNotificationRun() {
    return failureNotificationStep().run;
  }

  beforeAll(() => {
    const nightlyYml = readRootFile('.github/workflows/nightly.yml');
    expect(
      nightlyYml.trim(),
      '.github/workflows/nightly.yml should have content',
    ).toBeTruthy();
    try {
      nightlyWorkflow = yaml.load(nightlyYml);
    } catch (error) {
      throw new Error(
        `Failed to parse .github/workflows/nightly.yml: ${error.message}`,
        { cause: error },
      );
    }
    expect(
      nightlyWorkflow && typeof nightlyWorkflow === 'object',
      '.github/workflows/nightly.yml should parse to a YAML mapping',
    ).toBeTruthy();
    windowsCiJob = nightlyWorkflow.jobs?.windows_ci;
    notifyFailureJob = nightlyWorkflow.jobs?.notify_failure;
  });

  it('defines the expected nightly workflow structure', () => {
    expect(
      windowsCiJob,
      'nightly.yml should contain job: windows_ci',
    ).toBeTruthy();
    expect(
      notifyFailureJob,
      'nightly.yml should contain job: notify_failure',
    ).toBeTruthy();
    failureNotificationStep();
    expect(nightlyWorkflow.concurrency?.group).toBe(
      'nightly-${{ github.ref }}',
    );
    expect(nightlyWorkflow.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('runs lint:agents-api-surface before npm run test in the Windows CI job', () => {
    const surfaceIndex = windowsCiJob.steps.findIndex((step) =>
      String(step.run ?? '').includes('npm run lint:agents-api-surface'),
    );
    const testRunIndex = windowsCiJob.steps.findIndex((step) =>
      // Match npm run test exactly, not npm run test:scripts or similar.
      /(?:^|\s)npm run test(?:\s|$)/.test(String(step.run ?? '')),
    );
    expect(
      surfaceIndex,
      'windows_ci should run npm run lint:agents-api-surface',
    ).toBeGreaterThan(-1);
    expect(testRunIndex, 'windows_ci should run npm run test').toBeGreaterThan(
      -1,
    );
    expect(surfaceIndex).toBeLessThan(testRunIndex);
  });

  it('grants bounded issues: write access in the failure notification job', () => {
    const notifyFailureStep = failureNotificationStep();
    const notifyFailureRun = failureNotificationRun();
    expect(notifyFailureJob.permissions?.issues).toBe('write');
    expect(notifyFailureJob['timeout-minutes']).toBeGreaterThanOrEqual(5);
    expect(notifyFailureStep.shell).toBe('bash');
    expect(notifyFailureRun).toContain('set -euo pipefail');
  });

  it('creates a failure issue with the ci/cd label linking to the workflow run', () => {
    const notifyFailureStep = failureNotificationStep();
    const normalizedRun = failureNotificationRun().replace(/\s+/g, ' ').trim();
    expect(notifyFailureStep.env?.RUN_URL).toBe(
      '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    );
    expect(normalizedRun).toContain('ensure_label "ci/cd"');
    // The plain "bug" label was removed: it was recreated on every failed
    // nightly and is not part of this repo's label taxonomy. Guard against it
    // being reintroduced here.
    expect(normalizedRun).not.toContain('ensure_label "bug"');
    expect(notifyFailureStep.env?.WINDOWS_CI_RESULT).toBe(
      '${{ needs.windows_ci.result }}',
    );
    expect(notifyFailureStep.env?.E2E_FULL_RESULT).toBe(
      '${{ needs.e2e_full.result }}',
    );
    expect(notifyFailureStep.env?.BEHAVIORAL_EVALS_RESULT).toBe(
      '${{ needs.behavioral_evals.result }}',
    );
    expect(normalizedRun).toContain('LABEL_ARGS+=(--label "ci/cd")');
    expect(normalizedRun).not.toContain('LABEL_ARGS+=(--label "bug")');
    expect(normalizedRun).toContain('windows_ci=${WINDOWS_CI_RESULT}');
    expect(normalizedRun).toContain('e2e_full=${E2E_FULL_RESULT}');
    expect(normalizedRun).toContain(
      'behavioral_evals=${BEHAVIORAL_EVALS_RESULT}',
    );
    expect(normalizedRun).toContain('if [[ ${#FAILED_JOBS[@]} -eq 0 ]]');
    expect(normalizedRun).toContain('No failed or cancelled jobs detected');
    expect(normalizedRun).toContain('retry_gh gh issue create');
    expect(normalizedRun).toContain('--title "${ISSUE_TITLE}"');
    expect(normalizedRun).toContain('--body-file "${BODY_FILE}"');
    expect(normalizedRun).toContain('${FAILED_JOBS_TEXT}');
    expect(normalizedRun).toContain('${RUN_URL}');
    expect(normalizedRun).toContain('CREATE_ARGS+=("${LABEL_ARGS[@]}")');
  });

  it('updates an existing open nightly failure issue instead of duplicating it', () => {
    const normalizedRun = failureNotificationRun().replace(/\s+/g, ' ').trim();
    expect(normalizedRun).toContain('for attempt in 1 2 3 4');
    expect(normalizedRun).toContain('All retries exhausted for: $*');
    expect(normalizedRun).toContain('return 1');
    expect(normalizedRun).toContain('if ! EXISTING_ISSUE=');
    expect(normalizedRun).toContain('retry_gh gh issue list');
    const searchMatch = normalizedRun.match(
      /retry_gh gh issue list.*?--search\s+"((?:\\.|[^"\\])*)"/,
    );
    expect(
      searchMatch,
      'gh issue list should contain a --search argument',
    ).toBeTruthy();
    const searchQuery = (searchMatch?.[1] ?? '').replace(/\\(.)/g, '$1');
    expect(
      searchQuery,
      'gh issue list --search argument should be parseable',
    ).not.toBe('');
    expect(searchQuery).toContain('${ISSUE_TITLE}');
    expect(searchQuery).toContain('in:title');
    expect(searchQuery).toContain('is:issue');
    expect(searchQuery).toContain('state:open');
    expect(searchQuery).toContain('sort:created-desc');
    expect(normalizedRun).not.toContain('--state open');
    expect(normalizedRun).toContain('--limit 30');
    expect(normalizedRun).toContain('--json number,title');
    expect(normalizedRun).not.toContain('| true');
    expect(normalizedRun).not.toContain('|| true');
    expect(normalizedRun).toContain('if [[ -n "${EXISTING_ISSUE}" ]]');
    expect(normalizedRun).toContain(
      'retry_gh gh issue comment "${EXISTING_ISSUE}"',
    );
    expect(normalizedRun).toContain("$(date +'%Y-%m-%d')");
    expect(normalizedRun).toContain('printf \'Full run: %s\\n\' "${RUN_URL}"');
  });

  it('runs the failure notification job when a dependency fails or is cancelled', () => {
    expect(notifyFailureJob.if).toContain('always()');
    expect(notifyFailureJob.if).toContain(
      "contains(needs.*.result, 'failure')",
    );
    expect(notifyFailureJob.if).toContain(
      "contains(needs.*.result, 'cancelled')",
    );
  });

  it('makes the failure notification job depend on all nightly test jobs', () => {
    // Keep in sync with .github/workflows/nightly.yml — every non-notify job
    // MUST be listed here, otherwise notify_failure won't fire on its failure.
    const expectedNeeds = [
      'windows_ci',
      'e2e_full',
      'behavioral_evals',
      'windows_bun_native_smoke',
    ];
    const actualNeeds = Array.isArray(notifyFailureJob.needs)
      ? notifyFailureJob.needs
      : [notifyFailureJob.needs];
    expect([...actualNeeds].sort()).toEqual([...expectedNeeds].sort());
  });
});

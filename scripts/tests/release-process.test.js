/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
      '@vybestack/llxprt-code-storage',
      '@vybestack/llxprt-code-auth',
      '@vybestack/llxprt-code-settings',
      '@vybestack/llxprt-code-telemetry',
      '@vybestack/llxprt-code-ide-integration',
      '@vybestack/llxprt-code-policy',
      '@vybestack/llxprt-code-mcp',
      '@vybestack/llxprt-code-core',
      '@vybestack/llxprt-code-providers',
      '@vybestack/llxprt-code',
      '@vybestack/llxprt-code-lsp',
    ]);
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

describe('scripts/version.js', () => {
  const versionJs = readRootFile('scripts/version.js');

  it('versions every release package', () => {
    for (const packageName of versionedReleasePackages()) {
      expect(versionJs, `version.js should reference ${packageName}`).toContain(
        packageName,
      );
    }
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

  it('publishes storage, auth, settings, telemetry, ide-integration, and policy before MCP, core, providers, and CLI', () => {
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
    expect(cliIndex).toBeGreaterThan(providersIndex);
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

  it('prepares settings and providers tarballs for sandbox images', () => {
    expect(releaseYml).toContain('packages/settings/dist');
    expect(releaseYml).toContain('packages/providers/dist');
    expect(releaseYml).toContain('npm pack -w @vybestack/llxprt-code-settings');
    expect(releaseYml).toContain(
      'npm pack -w @vybestack/llxprt-code-providers',
    );
  });
});

describe('scripts/build_sandbox.js', () => {
  const buildSandbox = readRootFile('scripts/build_sandbox.js');

  it('packs auth, settings, telemetry, MCP, and providers alongside core and CLI', () => {
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
  });

  it('temporarily binds and restores workspace dependencies for local sandbox packing', () => {
    expect(buildSandbox).toContain('bind-release-deps.js --backup');
    expect(buildSandbox).toContain('bind-release-deps.js --restore');
  });
});

describe('Dockerfile', () => {
  const dockerfile = readRootFile('Dockerfile');

  it('copies auth, settings, telemetry, MCP, core, providers, and CLI tarballs in dependency order', () => {
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
    const providersCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz',
    );
    const cliCopy = dockerfile.indexOf(
      'COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz',
    );

    expect(storageCopy).toBeGreaterThan(0);
    expect(authCopy).toBeGreaterThan(storageCopy);
    expect(settingsCopy).toBeGreaterThan(authCopy);
    expect(telemetryCopy).toBeGreaterThan(settingsCopy);
    expect(policyCopy).toBeGreaterThan(telemetryCopy);
    expect(mcpCopy).toBeGreaterThan(policyCopy);
    expect(coreCopy).toBeGreaterThan(mcpCopy);
    expect(providersCopy).toBeGreaterThan(coreCopy);
    expect(cliCopy).toBeGreaterThan(providersCopy);
  });

  it('installs local tarballs in one npm transaction for unpublished versions', () => {
    const installCommand = dockerfile.slice(
      dockerfile.indexOf('RUN npm install -g'),
      dockerfile.indexOf('npm cache clean --force'),
    );

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
    expect(installCommand).toContain('vybestack-llxprt-code-*.tgz');
    expect(installCommand).not.toContain('&& \\\n    npm install -g');
  });
});

describe('scripts/bind-release-deps.js', () => {
  it('derives npm release packages from the same metadata as the tests', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.js')
    );

    expect(bindModule.deriveNpmReleasePackages()).toEqual(npmReleasePackages());
  });

  it('rewrites publishable workspace file dependencies to exact versions', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.js')
    );
    const workspaceInfo = new Map([
      ['@vybestack/llxprt-code-core', { version: '1.2.3' }],
      ['@vybestack/llxprt-code-providers', { version: '1.2.3' }],
    ]);
    const releasePackages = new Set([
      '@vybestack/llxprt-code-core',
      '@vybestack/llxprt-code-providers',
    ]);
    const deps = {
      '@vybestack/llxprt-code-core': 'file:../core',
      '@vybestack/llxprt-code-providers': 'file:../providers',
      '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      chalk: '^5.3.0',
    };

    expect(bindModule.rewriteDeps(deps, workspaceInfo, releasePackages)).toBe(
      true,
    );
    expect(deps).toEqual({
      '@vybestack/llxprt-code-core': '1.2.3',
      '@vybestack/llxprt-code-providers': '1.2.3',
      '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      chalk: '^5.3.0',
    });
  });

  it('fails verification when npm release packages keep workspace file dependencies', async () => {
    const bindModule = await import(
      path.join(ROOT, 'scripts/bind-release-deps.js')
    );
    const packagesByPath = new Map([
      [
        'packages/cli',
        {
          name: '@vybestack/llxprt-code',
          dependencies: {
            '@vybestack/llxprt-code-providers': 'file:../providers',
          },
        },
      ],
    ]);

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        new Set(['@vybestack/llxprt-code', '@vybestack/llxprt-code-providers']),
        packagesByPath,
      ),
    ).toThrow('workspace file: dependencies');
  });
});

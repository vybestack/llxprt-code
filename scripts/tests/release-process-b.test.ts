/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Release process tests (Part B) — Dockerfile, bind-release-deps, nightly.yml.
 * Split from release-process.test.ts to satisfy the 800line limit.
 */

import { beforeAll, describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  asNumber,
  asOptionalRecord,
  asRecord,
  asString,
  asStringArray,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NON_NPM_RELEASE_PACKAGES = new Set([
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  'llxprt-code-vscode-ide-companion',
]);

const CLI_RELEASE_PACKAGES = new Set(['@vybestack/llxprt-code']);

function workspaceInfoEntry(workspacePath: string) {
  return {
    pkgJsonPath: `${workspacePath}/package.json`,
    version: '1.2.3',
    workspacePath,
  };
}

function testUtilsWorkspaceInfo() {
  return new Map([
    [
      '@vybestack/llxprt-code-test-utils',
      workspaceInfoEntry('packages/test-utils'),
    ],
  ]);
}

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

function npmReleasePackages() {
  return workspacePackages()
    .filter(({ packageJson }) => !packageJson.private)
    .filter(
      ({ packageJson }) =>
        !NON_NPM_RELEASE_PACKAGES.has(asString(packageJson.name)),
    )
    .map(({ packageJson }) => asString(packageJson.name));
}

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
  let bindModule: {
    deriveNpmReleasePackages: () => string[];
    rewriteDeps: (
      deps: Record<string, string>,
      workspaceInfo: Map<
        string,
        { pkgJsonPath: string; version: string; workspacePath: string }
      >,
      releasePackages: Set<string>,
    ) => boolean;
    verifyNoFileDeps: (
      workspacePaths: string[],
      releasePackages: Set<string>,
      workspaceInfo: Map<
        string,
        { pkgJsonPath: string; version: string; workspacePath: string }
      >,
      readPackage: () => {
        name: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      },
    ) => void;
  };

  beforeAll(async () => {
    bindModule = await import(path.join(ROOT, 'scripts/bind-release-deps.ts'));
  });

  it('derives npm release packages from the same metadata as the tests', () => {
    expect(bindModule.deriveNpmReleasePackages()).toEqual(npmReleasePackages());
  });

  it('derives npm release packages in canonical publish order', () => {
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

  it('rewrites publishable workspace file dependencies to exact versions', () => {
    const workspaceInfo = new Map([
      ['@vybestack/llxprt-code-core', workspaceInfoEntry('packages/core')],
      ['@vybestack/llxprt-code-tools', workspaceInfoEntry('packages/tools')],
      [
        '@vybestack/llxprt-code-providers',
        workspaceInfoEntry('packages/providers'),
      ],
      ['@vybestack/llxprt-code-agents', workspaceInfoEntry('packages/agents')],
      [
        '@vybestack/llxprt-code-test-utils',
        workspaceInfoEntry('packages/test-utils'),
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

  it('fails verification when npm release packages keep workspace file dependencies', () => {
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
        workspaceInfoEntry('packages/providers'),
      ],
      ['@vybestack/llxprt-code-agents', workspaceInfoEntry('packages/agents')],
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

  it('passes verification when release packages have no workspace file dependencies', () => {
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
        CLI_RELEASE_PACKAGES,
        new Map(),
        readPackage,
      ),
    ).not.toThrow();
  });

  it('ignores workspace file dependencies in non-release packages', () => {
    const readPackage = () => ({
      name: '@vybestack/llxprt-code-test-utils',
      dependencies: {
        '@vybestack/llxprt-code-core': 'file:../core',
      },
    });

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/test-utils'],
        CLI_RELEASE_PACKAGES,
        new Map(),
        readPackage,
      ),
    ).not.toThrow();
  });

  it('allows release packages to keep non-NPM release workspaces as dev-only file dependencies', () => {
    const readPackage = () => ({
      name: '@vybestack/llxprt-code',
      devDependencies: {
        '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      },
    });

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        CLI_RELEASE_PACKAGES,
        testUtilsWorkspaceInfo(),
        readPackage,
      ),
    ).not.toThrow();
  });

  it('rejects non-NPM release workspaces as production file dependencies in release packages', () => {
    const readPackage = () => ({
      name: '@vybestack/llxprt-code',
      dependencies: {
        '@vybestack/llxprt-code-test-utils': 'file:../test-utils',
      },
    });

    expect(() =>
      bindModule.verifyNoFileDeps(
        ['packages/cli'],
        CLI_RELEASE_PACKAGES,
        testUtilsWorkspaceInfo(),
        readPackage,
      ),
    ).toThrow(
      '@vybestack/llxprt-code dependencies.@vybestack/llxprt-code-test-utils=file:../test-utils',
    );
  });
});

/**
 * Issue #2323: Behavioral regression tests for nightly workflow invariants.
 */
describe('.github/workflows/nightly.yml', () => {
  let nightlyParsed: Record<string, unknown> | undefined;
  let windowsCiJob: Record<string, unknown> | undefined;
  let notifyFailureJob: Record<string, unknown> | undefined;

  function stepNamed(
    job: Record<string, unknown> | undefined,
    name: string,
  ): Record<string, unknown> {
    const rawSteps = job?.steps;
    if (!Array.isArray(rawSteps)) {
      throw new Error('job should have a steps array');
    }
    const steps = rawSteps.map(asRecord);
    const step = steps.find((candidate) => candidate.name === name);
    if (!step) {
      throw new Error(`job should contain step: ${name}`);
    }
    return step;
  }

  function failureNotificationStep(): Record<string, unknown> {
    const step = stepNamed(notifyFailureJob, 'Create Issue on Failure');
    expect(
      step.run,
      "'Create Issue on Failure' step should have a run script",
    ).toBeTruthy();
    return step;
  }

  function failureNotificationRun(): string {
    return asString(failureNotificationStep().run);
  }

  beforeAll(() => {
    const nightlyYml = readRootFile('.github/workflows/nightly.yml');
    expect(
      nightlyYml.trim(),
      '.github/workflows/nightly.yml should have content',
    ).toBeTruthy();
    nightlyParsed = asRecord(parseWorkflowYaml(nightlyYml));
    const jobs = asOptionalRecord(nightlyParsed.jobs);
    windowsCiJob = asOptionalRecord(jobs?.windows_ci);
    notifyFailureJob = asOptionalRecord(jobs?.notify_failure);
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
    expect(asOptionalRecord(nightlyParsed?.concurrency)?.group).toBe(
      'nightly-${{ github.ref }}',
    );
    expect(
      asOptionalRecord(nightlyParsed?.concurrency)?.['cancel-in-progress'],
    ).toBe(true);
  });

  it('runs lint:agents-api-surface before npm run test in the Windows CI job', () => {
    const rawSteps = windowsCiJob?.steps;
    const steps = Array.isArray(rawSteps) ? rawSteps.map(asRecord) : [];
    const surfaceIndex = steps.findIndex((step: Record<string, unknown>) =>
      String(step.run ?? '').includes('npm run lint:agents-api-surface'),
    );
    const testRunIndex = steps.findIndex((step: Record<string, unknown>) =>
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
    expect(asOptionalRecord(notifyFailureJob?.permissions)?.issues).toBe(
      'write',
    );
    expect(
      asNumber(notifyFailureJob?.['timeout-minutes']),
    ).toBeGreaterThanOrEqual(5);
    expect(asString(notifyFailureStep.shell)).toBe('bash');
    expect(notifyFailureRun).toContain('set -euo pipefail');
  });

  it('creates a failure issue with the ci/cd label linking to the workflow run', () => {
    const notifyFailureStep = failureNotificationStep();
    const normalizedRun = failureNotificationRun().replace(/\s+/g, ' ').trim();
    expect(asOptionalRecord(notifyFailureStep.env)?.RUN_URL).toBe(
      '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    );
    expect(normalizedRun).toContain('ensure_label "ci/cd"');
    expect(normalizedRun).not.toContain('ensure_label "bug"');
    expect(asOptionalRecord(notifyFailureStep.env)?.WINDOWS_CI_RESULT).toBe(
      '${{ needs.windows_ci.result }}',
    );
    expect(asOptionalRecord(notifyFailureStep.env)?.E2E_FULL_RESULT).toBe(
      '${{ needs.e2e_full.result }}',
    );
    expect(
      asOptionalRecord(notifyFailureStep.env)?.BEHAVIORAL_EVALS_RESULT,
    ).toBe('${{ needs.behavioral_evals.result }}');
    expect(
      asOptionalRecord(notifyFailureStep.env)?.CLI_BUNDLE_LAUNCH_RESULT,
    ).toBe('${{ needs.cli_bundle_launch.result }}');
    expect(normalizedRun).toContain('LABEL_ARGS+=(--label "ci/cd")');
    expect(normalizedRun).not.toContain('LABEL_ARGS+=(--label "bug")');
    expect(normalizedRun).toContain('windows_ci=${WINDOWS_CI_RESULT}');
    expect(normalizedRun).toContain('e2e_full=${E2E_FULL_RESULT}');
    expect(normalizedRun).toContain(
      'behavioral_evals=${BEHAVIORAL_EVALS_RESULT}',
    );
    expect(normalizedRun).toContain(
      'cli_bundle_launch=${CLI_BUNDLE_LAUNCH_RESULT}',
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
    expect(asString(notifyFailureJob?.if)).toContain('always()');
    expect(asString(notifyFailureJob?.if)).toContain(
      "contains(needs.*.result, 'failure')",
    );
    expect(asString(notifyFailureJob?.if)).toContain(
      "contains(needs.*.result, 'cancelled')",
    );
  });

  it('makes the failure notification job depend on all nightly test jobs', () => {
    const expectedNeeds = [
      'windows_ci',
      'macos_ci',
      'macos_secure_store',
      'e2e_full',
      'behavioral_evals',
      'windows_bun_native_smoke',
      'cli_bundle_launch',
    ];
    const actualNeeds = Array.isArray(notifyFailureJob?.needs)
      ? asStringArray(notifyFailureJob.needs)
      : [asString(notifyFailureJob?.needs)];
    expect([...actualNeeds].sort()).toEqual([...expectedNeeds].sort());
  });
});

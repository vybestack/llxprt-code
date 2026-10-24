/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supply-chain configuration contract (issue #3930).
 *
 * These tests read the real repository configuration (bunfig.toml, .npmrc,
 * manifests, Dockerfile, workflows) and assert the invariants that keep the
 * runtime pins and the dependency cooldown coherent:
 *
 * - the dependency cooldown never blocks the Bun runtime or our own packages,
 * - Node and Bun pins agree across `.nvmrc`, `.bun-version`, the Dockerfile
 *   and the manifests,
 * - no workflow floats on an unpinned Node line.
 */

import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import yaml from 'js-yaml';
import semver from 'semver';
import {
  asArray,
  asOptionalRecord,
  asRecord,
  asString,
} from './typed-test-helpers.ts';

const repoRoot = resolve(__dirname, '..', '..');

function readText(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), 'utf8');
}

function readManifest(...segments: string[]): Record<string, unknown> {
  return asRecord(JSON.parse(readText(...segments, 'package.json')));
}

function manifestDirs(): string[] {
  const dirs = ['.'];
  for (const parent of ['packages', 'plugins']) {
    for (const entry of readdirSync(join(repoRoot, parent))) {
      if (existsSync(join(repoRoot, parent, entry, 'package.json'))) {
        dirs.push(join(parent, entry));
      }
    }
  }
  return dirs;
}

function npmrcValues(key: string): string[] {
  return readText('.npmrc')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));
}

describe('dependency cooldown', () => {
  const bunInstall = asRecord(
    asRecord(TOML.parse(readText('bunfig.toml')))['install'],
  );
  const bunExcludes = bunInstall['minimumReleaseAgeExcludes'];

  it('bunfig.toml holds back versions younger than 3 days (seconds)', () => {
    expect(bunInstall['minimumReleaseAge']).toBe(3 * 24 * 60 * 60);
  });

  it('.npmrc holds back versions younger than 3 days (days)', () => {
    expect(npmrcValues('min-release-age')).toStrictEqual(['3']);
  });

  it('bunfig.toml exempts the Bun runtime and every @oven/bun-* package', () => {
    expect(Array.isArray(bunExcludes)).toBe(true);
    const excludes = new Set(bunExcludes as string[]);
    expect(excludes.has('bun')).toBe(true);

    const cli = readManifest('packages', 'cli');
    const ovenPackages = Object.keys(
      asRecord(cli['optionalDependencies']),
    ).filter((name) => name.startsWith('@oven/'));
    expect(ovenPackages.length).toBeGreaterThan(0);
    for (const name of ovenPackages) {
      expect(excludes.has(name), `${name} must bypass the cooldown`).toBe(true);
    }
  });

  it('bunfig.toml exempts every first-party package name', () => {
    const excludes = new Set(bunExcludes as string[]);
    for (const dir of manifestDirs()) {
      const name = asString(readManifest(dir)['name']);
      if (name.startsWith('@vybestack/')) {
        expect(excludes.has(name), `${name} must bypass the cooldown`).toBe(
          true,
        );
      }
    }
  });

  it('.npmrc exempts the Bun runtime and our own scope', () => {
    const excludes = npmrcValues('min-release-age-exclude[]');
    expect(excludes).toContain('bun');
    expect(excludes).toContain('@oven/bun-*');
    expect(excludes).toContain('@vybestack/*');
  });
});

describe('runtime pins agree', () => {
  const nvmrc = readText('.nvmrc').trim();
  const bunVersion = readText('.bun-version').trim();

  it('.nvmrc is an exact Node version', () => {
    expect(semver.valid(nvmrc)).toBe(nvmrc);
  });

  it('every manifest requires at least the pinned Node version', () => {
    const nodeRanges = manifestDirs()
      .map((dir) => ({
        dir,
        range: asRecord(readManifest(dir)['engines'] ?? {})['node'],
      }))
      .filter(
        (entry): entry is { dir: string; range: string } =>
          typeof entry.range === 'string' && entry.range.startsWith('>='),
      );
    expect(nodeRanges.length).toBeGreaterThan(0);
    for (const { dir, range } of nodeRanges) {
      expect(
        semver.gte(range.slice(2), nvmrc),
        `${dir}/package.json engines.node ${range} must not admit a Node below ${nvmrc}`,
      ).toBe(true);
    }
  });

  it('the Dockerfile base image is the pinned Node version', () => {
    const firstLine = readText('Dockerfile').split('\n')[0];
    expect(firstLine).toBe(`FROM docker.io/library/node:${nvmrc}-slim`);
  });

  it('.bun-version matches the bun dependency in the root and CLI manifests', () => {
    expect(semver.valid(bunVersion)).toBe(bunVersion);
    for (const dir of ['.', 'packages/cli']) {
      const dependencies = asRecord(readManifest(dir)['dependencies']);
      expect(dependencies['bun']).toBe(bunVersion);
    }
  });

  it('root engines.bun floor is the pinned Bun version', () => {
    const engines = asRecord(readManifest('.')['engines']);
    expect(engines['bun']).toBe(`>=${bunVersion}`);
  });

  it('plugin engines.bun floors do not admit a Bun below the pin', () => {
    for (const dir of manifestDirs().filter((d) => d.startsWith('plugins/'))) {
      const engines = asRecord(readManifest(dir)['engines']);
      const range = asString(engines['bun']);
      expect(semver.gte(range.replace('>=', ''), bunVersion)).toBe(true);
    }
  });
});

describe('workflows do not float on an unpinned runtime', () => {
  const workflowsDir = join(repoRoot, '.github', 'workflows');
  const workflows = readdirSync(workflowsDir).filter((file) =>
    file.endsWith('.yml'),
  );

  it('no workflow pins Node to a bare major line outside a matrix', () => {
    for (const file of workflows) {
      const lines = readFileSync(join(workflowsDir, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        // Matrix definitions sit deeper than step `with:` inputs; the matrix
        // consumers are required to set check-latest instead.
        if (/^ {10}node-version: '24(\.x)?'$/.test(line)) {
          throw new Error(
            `${file}:${index + 1} pins Node to a floating line; use node-version-file: .nvmrc`,
          );
        }
      });
    }
  });

  it('every matrix-driven setup-node step resolves the newest matching Node', () => {
    for (const file of workflows) {
      const text = readFileSync(join(workflowsDir, file), 'utf8');
      const steps = text.split(/\n(?= {6}- name:)/);
      for (const step of steps) {
        if (
          step.includes('actions/setup-node@') &&
          step.includes("node-version: '${{ matrix.node-version }}'")
        ) {
          expect(
            step,
            `${file} matrix setup-node needs check-latest`,
          ).toContain('check-latest: true');
        }
      }
    }
  });

  it('no workflow bootstraps a hardcoded Bun version', () => {
    for (const file of workflows) {
      const text = readFileSync(join(workflowsDir, file), 'utf8');
      expect(
        text,
        `${file} must read the Bun version from .bun-version`,
      ).not.toMatch(/bun-version: '[0-9]/);
      expect(
        text,
        `${file} must read the Bun version from .bun-version`,
      ).not.toMatch(/bash -s "bun-v[0-9]/);
    }
  });
});

const EXPLICITLY_PRIVILEGED_WORKFLOWS = [
  'release.yml',
  'build-sandbox.yml',
  'luther.yml',
  'e2e.yml',
];

interface WorkflowJob {
  readonly file: string;
  readonly name: string;
  readonly privileged: boolean;
  readonly runScripts: readonly string[];
}

const PRIVILEGE_MARKERS = [
  /id-token:\s*write/,
  /docker\/login-action@/,
  /registry-url\s*:/,
  /\bNODE_AUTH_TOKEN\b/,
  /\bNPM_TOKEN\b/,
  /\bnpm\s+(?:publish|login|adduser)\b/,
  // Any secret other than the per-run GITHUB_TOKEN, including indexed
  // lookups such as `secrets[vars.KEY_VAR_NAME]`.
  /\bsecrets\s*(?:\[|\.(?!GITHUB_TOKEN\b))/,
  /^secrets:\s*inherit\b/m,
];

/**
 * A job's effective permissions: a job-level `permissions` block replaces the
 * workflow-level one entirely, and the workflow-level block is inherited when
 * the job declares none.
 */
function effectivePermissions(
  workflowPermissions: unknown,
  job: Record<string, unknown>,
): unknown {
  return 'permissions' in job ? job['permissions'] : workflowPermissions;
}

function grantsWriteAccess(permissions: unknown): boolean {
  if (permissions === 'write-all') {
    return true;
  }
  if (typeof permissions !== 'object' || permissions === null) {
    return false;
  }
  return Object.values(permissions).some((level) => level === 'write');
}

/**
 * A job is privileged when its effective permissions grant any write scope
 * (including `id-token: write`), when it passes or reads secrets other than
 * GITHUB_TOKEN, when it logs in to a registry, or when it handles publish
 * credentials. Detection looks at the parsed job, so a new job gains the
 * protection without being listed here.
 */
function isPrivilegedJob(
  workflowPermissions: unknown,
  job: Record<string, unknown>,
): boolean {
  if (grantsWriteAccess(effectivePermissions(workflowPermissions, job))) {
    return true;
  }
  // A job-level `permissions` block replaces the workflow-level one, so only
  // the job text is searched for the remaining markers.
  const serialized = yaml.dump(job);
  return PRIVILEGE_MARKERS.some((marker) => marker.test(serialized));
}

function workflowJobsFrom(file: string, workflowText: string): WorkflowJob[] {
  const workflow = asRecord(yaml.load(workflowText));
  const jobs = asOptionalRecord(workflow['jobs']) ?? {};
  return Object.entries(jobs).map(([name, value]) => {
    const job = asRecord(value);
    const steps = asArray(job['steps'] ?? []).map((step) => asRecord(step));
    return {
      file,
      name,
      privileged:
        EXPLICITLY_PRIVILEGED_WORKFLOWS.includes(file) ||
        isPrivilegedJob(workflow['permissions'], job),
      runScripts: steps
        .map((step) => step['run'])
        .filter((run): run is string => typeof run === 'string'),
    };
  });
}

function loadWorkflowJobs(file: string): WorkflowJob[] {
  return workflowJobsFrom(file, readText('.github', 'workflows', file));
}

/** Joins shell line continuations and drops comment lines. */
function shellCommandLines(script: string): string[] {
  return script
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Commands that execute dependency lifecycle scripts (third-party code that
 * bypasses the lockfile's integrity guarantees once it falls back to the
 * network) when run in a privileged job.
 */
function findLifecycleScriptViolations(script: string): string[] {
  const violations: string[] = [];
  for (const line of shellCommandLines(script)) {
    if (/\bnpm\s+rebuild\b/.test(line)) {
      violations.push(line);
      continue;
    }
    const installs = /\bnpm\s+(?:ci|install|i|add)\b[^;&|]*/g;
    for (const match of line.matchAll(installs)) {
      if (!match[0].includes('--ignore-scripts')) {
        violations.push(line);
      }
    }
  }
  return violations;
}

describe('findLifecycleScriptViolations', () => {
  it('rejects npm rebuild', () => {
    expect(findLifecycleScriptViolations('npm rebuild bun')).toHaveLength(1);
  });

  it('rejects npm ci and npm install without --ignore-scripts', () => {
    expect(findLifecycleScriptViolations('npm ci')).toHaveLength(1);
    expect(findLifecycleScriptViolations('npm install -g foo@1')).toHaveLength(
      1,
    );
  });

  it('accepts installs that skip lifecycle scripts, even across continuations', () => {
    expect(findLifecycleScriptViolations('npm ci --ignore-scripts')).toEqual(
      [],
    );
    expect(
      findLifecycleScriptViolations(
        'npm install -g \\\n  --prefix p \\\n  --ignore-scripts \\\n  foo@1',
      ),
    ).toEqual([]);
  });

  it('ignores commented-out commands', () => {
    expect(findLifecycleScriptViolations('# npm rebuild bun')).toEqual([]);
  });
});

describe('isPrivilegedJob', () => {
  it('flags OIDC, registry login and publish-credential jobs', () => {
    expect(
      isPrivilegedJob(undefined, { permissions: { 'id-token': 'write' } }),
    ).toBe(true);
    expect(
      isPrivilegedJob({ 'id-token': 'write' }, { steps: [{ run: 'true' }] }),
    ).toBe(true);
    expect(
      isPrivilegedJob(undefined, {
        steps: [{ uses: 'docker/login-action@abc' }],
      }),
    ).toBe(true);
    expect(
      isPrivilegedJob(undefined, {
        steps: [{ env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' } }],
      }),
    ).toBe(true);
  });

  it('leaves read-only jobs alone', () => {
    expect(
      isPrivilegedJob(
        { contents: 'read' },
        { steps: [{ run: 'npm ci --ignore-scripts' }] },
      ),
    ).toBe(false);
  });

  it('inherits workflow-level write permissions when the job declares none', () => {
    const workflowPermissions = { checks: 'write', contents: 'read' };
    expect(
      isPrivilegedJob(workflowPermissions, { steps: [{ run: 'true' }] }),
    ).toBe(true);
  });

  it('lets a job-level permissions block replace the workflow-level one', () => {
    const workflowPermissions = { checks: 'write', statuses: 'write' };
    expect(
      isPrivilegedJob(workflowPermissions, {
        permissions: { contents: 'read' },
      }),
    ).toBe(false);
    expect(isPrivilegedJob(workflowPermissions, { permissions: {} })).toBe(
      false,
    );
    expect(
      isPrivilegedJob(
        { contents: 'read' },
        { permissions: { issues: 'write', contents: 'read' } },
      ),
    ).toBe(true);
  });

  it('treats write-all as privileged and read-all as not', () => {
    expect(isPrivilegedJob('write-all', {})).toBe(true);
    expect(isPrivilegedJob(undefined, { permissions: 'write-all' })).toBe(true);
    expect(isPrivilegedJob('read-all', {})).toBe(false);
  });

  it('flags secrets other than GITHUB_TOKEN, however they are referenced', () => {
    const withSecret = (value: string) => ({
      permissions: { contents: 'read' },
      steps: [{ env: { KEY: value } }],
    });
    expect(
      isPrivilegedJob(undefined, withSecret('${{ secrets.PROVIDER_KEY }}')),
    ).toBe(true);
    expect(
      isPrivilegedJob(
        undefined,
        withSecret('${{ secrets[vars.KEY_VAR_NAME] }}'),
      ),
    ).toBe(true);
    expect(
      isPrivilegedJob(undefined, {
        permissions: { contents: 'read' },
        uses: './.github/workflows/reusable.yml',
        secrets: 'inherit',
      }),
    ).toBe(true);
    expect(
      isPrivilegedJob(undefined, withSecret('${{ secrets.GITHUB_TOKEN }}')),
    ).toBe(false);
  });
});

/** Returns the text of one top-level job, from its key to the next job. */
function jobSection(workflowText: string, jobName: string): string {
  const start = workflowText.indexOf(`\n  ${jobName}:\n`);
  expect(start, `job ${jobName} exists`).toBeGreaterThanOrEqual(0);
  const rest = workflowText.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Applies `mutate` to one job's text without touching the file on disk. */
function mutateJob(
  workflowText: string,
  jobName: string,
  mutate: (section: string) => string,
): string {
  const section = jobSection(workflowText, jobName);
  const mutated = mutate(section);
  expect(mutated, `mutation changes ${jobName}`).not.toBe(section);
  return workflowText.replace(section, mutated);
}

function lifecycleViolations(
  file: string,
  workflowText: string,
  jobName: string,
): string[] {
  const job = workflowJobsFrom(file, workflowText).find(
    (candidate) => candidate.name === jobName,
  );
  expect(job, `${file} defines ${jobName}`).toBeDefined();
  expect(job?.privileged, `${file} job ${jobName} is privileged`).toBe(true);
  return (job?.runScripts ?? []).flatMap((script) =>
    findLifecycleScriptViolations(script),
  );
}

describe('nightly.yml privileged jobs', () => {
  const nightly = readText('.github', 'workflows', 'nightly.yml');
  const nightlyJobs = workflowJobsFrom('nightly.yml', nightly);
  const hardenedJobs = ['windows_ci', 'macos_ci', 'e2e_full'];
  const installFlag = 'npm ci --ignore-scripts';

  it('classifies jobs inheriting checks/statuses write as privileged', () => {
    const privileged = nightlyJobs
      .filter((job) => job.privileged)
      .map((job) => job.name);
    for (const name of [...hardenedJobs, 'macos_secure_store']) {
      expect(privileged, `${name} inherits workflow write scopes`).toContain(
        name,
      );
    }
  });

  it('keeps the read-only install-behavior jobs unprivileged by their own permissions', () => {
    const workflow = asRecord(yaml.load(nightly));
    const jobs = asRecord(workflow['jobs']);
    for (const name of ['windows_bun_native_smoke', 'cli_bundle_launch']) {
      const job = asRecord(jobs[name]);
      expect(job['permissions'], `${name} permissions`).toEqual({
        contents: 'read',
      });
      expect(yaml.dump(job), `${name} secrets`).not.toMatch(/\bsecrets\b/);
      const classified = nightlyJobs.find(
        (candidate) => candidate.name === name,
      );
      expect(classified?.privileged, `${name} is unprivileged`).toBe(false);
    }
  });

  it('has no lifecycle-script violations in the checked-in workflow', () => {
    for (const name of hardenedJobs) {
      expect(lifecycleViolations('nightly.yml', nightly, name)).toEqual([]);
    }
  });

  for (const name of hardenedJobs) {
    it(`detects npm rebuild restored in ${name}`, () => {
      const mutated = mutateJob(nightly, name, (section) =>
        section.replace(installFlag, `${installFlag} && npm rebuild bun`),
      );
      expect(lifecycleViolations('nightly.yml', mutated, name)).toEqual([
        expect.stringContaining('npm rebuild bun'),
      ]);
    });

    it(`detects --ignore-scripts dropped from the install in ${name}`, () => {
      const mutated = mutateJob(nightly, name, (section) =>
        section.replace(installFlag, 'npm ci'),
      );
      expect(lifecycleViolations('nightly.yml', mutated, name)).toEqual([
        'npm ci',
      ]);
    });
  }
});

describe('privileged workflows do not run third-party install scripts', () => {
  const workflowsDir = join(repoRoot, '.github', 'workflows');
  const jobs = readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml'))
    .flatMap((file) => loadWorkflowJobs(file));
  const privilegedJobs = jobs.filter((job) => job.privileged);

  it('detects the release, sandbox, Luther and E2E jobs as privileged', () => {
    const files = new Set(privilegedJobs.map((job) => job.file));
    for (const file of EXPLICITLY_PRIVILEGED_WORKFLOWS) {
      expect(files.has(file), `${file} has a privileged job`).toBe(true);
    }
  });

  it('privileged jobs never rebuild or install with lifecycle scripts enabled', () => {
    const violations = privilegedJobs.flatMap((job) =>
      job.runScripts
        .flatMap((script) => findLifecycleScriptViolations(script))
        .map((command) => `${job.file} job ${job.name}: ${command}`),
    );
    expect(violations).toEqual([]);
  });

  it('privileged dependency installs run the repository Bun linker', () => {
    for (const file of EXPLICITLY_PRIVILEGED_WORKFLOWS) {
      const text = readText('.github', 'workflows', file);
      expect(/npm ci\b/.test(text), `${file} installs with npm ci`).toBe(true);
      expect(
        text.includes('node scripts/link-bun-runtime.ts'),
        `${file} links the lockfile-installed Bun`,
      ).toBe(true);
    }
  });

  it('npm ci always skips lifecycle scripts', () => {
    for (const file of EXPLICITLY_PRIVILEGED_WORKFLOWS) {
      const text = readText('.github', 'workflows', file);
      const installs = text.match(/npm ci\b[^\n]*/g) ?? [];
      expect(installs.length, `${file} installs with npm ci`).toBeGreaterThan(
        0,
      );
      for (const install of installs) {
        expect(install, `${file}: ${install}`).toContain('--ignore-scripts');
      }
    }
  });

  it('rollup platform packages are pinned to an exact version', () => {
    const workflowsDir = join(repoRoot, '.github', 'workflows');
    for (const file of readdirSync(workflowsDir)) {
      const text = readFileSync(join(workflowsDir, file), 'utf8');
      for (const match of text.match(/npm install @rollup\/rollup-[^\s]*/g) ??
        []) {
        expect(match, `${file}: ${match}`).toMatch(/@\d+\.\d+\.\d+$/);
      }
    }
  });
});

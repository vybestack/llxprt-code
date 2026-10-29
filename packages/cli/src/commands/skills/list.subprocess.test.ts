/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs the real CLI entry for `llxprt skills list` in a temporary workspace.
 * Listing skills is declarative: it must not need a provider preflight or a
 * credential authority, so it has to work with no profile, no credentials and
 * no network.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface BunSubprocessLike {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
}

type BunSpawnFn = (
  cmds: string[],
  options: {
    cwd?: string;
    stdin?: 'ignore';
    stdout?: 'pipe';
    stderr?: 'pipe';
    env?: Record<string, string | undefined>;
  },
) => BunSubprocessLike;

function getBunSpawn(): BunSpawnFn {
  const bun = (globalThis as { Bun?: { spawn?: unknown } }).Bun;
  if (bun === undefined || typeof bun.spawn !== 'function') {
    throw new Error('Bun.spawn is unavailable; this test must run under bun');
  }
  return bun.spawn as unknown as BunSpawnFn;
}

async function readAll(stream: ReadableStream<Uint8Array> | null) {
  if (stream === null) {
    throw new Error('subprocess pipe unavailable');
  }
  return new Response(stream).text();
}

const tempRoots: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

interface SkillsListRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function writeProjectSkill(workspace: string, name: string): void {
  const skillDir = path.join(workspace, '.llxprt', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: Description of ${name}`,
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  );
}

interface InstalledExtension {
  readonly name: string;
  readonly skillName: string;
}

function installUserExtensionWithSkill(
  dataHome: string,
  { name: extensionName, skillName }: InstalledExtension,
): void {
  const extensionDir = path.join(dataHome, 'extensions', extensionName);
  const skillDir = path.join(extensionDir, 'skills', skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(extensionDir, 'llxprt-extension.json'),
    JSON.stringify({ name: extensionName, version: '1.0.0' }),
  );
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${skillName}`,
      `description: Description of ${skillName}`,
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  );
}

async function runSkillsList(
  workspace: string,
  userSettings: Record<string, unknown>,
  installedExtension?: InstalledExtension,
): Promise<SkillsListRun> {
  const home = makeTempDir('skills-list-home-');
  const configHome = makeTempDir('skills-list-cfg-');
  const dataHome = makeTempDir('skills-list-data-');
  const cacheHome = makeTempDir('skills-list-cache-');
  const logHome = makeTempDir('skills-list-log-');
  if (installedExtension !== undefined) {
    installUserExtensionWithSkill(dataHome, installedExtension);
  }
  // The `skills` subcommand is only registered when experimental skills are on.
  writeFileSync(
    path.join(configHome, 'settings.json'),
    JSON.stringify({ experimental: { skills: true }, ...userSettings }),
  );

  const env: Record<string, string | undefined> = { ...process.env };
  delete env['SANDBOX'];
  delete env['LLXPRT_SANDBOX'];
  env['HOME'] = home;
  env['LLXPRT_CONFIG_HOME'] = configHome;
  env['LLXPRT_DATA_HOME'] = dataHome;
  env['LLXPRT_CACHE_HOME'] = cacheHome;
  env['LLXPRT_LOG_HOME'] = logHome;
  env['NO_COLOR'] = '1';

  const entryPath = path.join(import.meta.dir, '..', '..', '..', 'index.ts');
  const proc = getBunSpawn()([process.execPath, entryPath, 'skills', 'list'], {
    cwd: workspace,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readAll(proc.stdout),
    readAll(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const ALPHA_EXTENSION: InstalledExtension = {
  name: 'alpha',
  skillName: 'alpha-skill',
};

function describeRun(run: SkillsListRun): string {
  return `exit ${run.exitCode}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
}

describe('llxprt skills list (real CLI entry)', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists a project skill without a credential authority or provider preflight', async () => {
    const workspace = realpathSync(makeTempDir('skills-list-ws-'));
    writeProjectSkill(workspace, 'demo-skill');

    const run = await runSkillsList(workspace, {});

    expect(describeRun(run)).not.toContain('credential authority');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Discovered Skills:');
    expect(run.stdout).toContain('demo-skill');
    expect(run.stdout).toContain('[Enabled]');
    expect(run.stdout).toContain('Description of demo-skill');
    expect(run.stdout).toContain(
      path.join(workspace, '.llxprt', 'skills', 'demo-skill', 'SKILL.md'),
    );
  }, 120_000);

  it('marks a skill disabled by the skills.disabled setting', async () => {
    const workspace = realpathSync(makeTempDir('skills-list-ws-'));
    writeProjectSkill(workspace, 'demo-skill');

    const run = await runSkillsList(workspace, {
      skills: { disabled: ['demo-skill'] },
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('demo-skill');
    expect(run.stdout).toContain('[Disabled]');
  }, 120_000);

  it('reports that nothing was discovered in a workspace without skills', async () => {
    const workspace = realpathSync(makeTempDir('skills-list-ws-'));

    const run = await runSkillsList(workspace, {});

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('No skills discovered.');
  }, 120_000);

  it('lists a skill that belongs to an enabled extension', async () => {
    const workspace = realpathSync(makeTempDir('skills-list-ws-'));

    const run = await runSkillsList(workspace, {}, ALPHA_EXTENSION);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('alpha-skill');
    expect(run.stdout).toContain('[Extension]');
  }, 120_000);

  it('omits the skills of an extension named in extensions.disabled', async () => {
    const workspace = realpathSync(makeTempDir('skills-list-ws-'));

    const run = await runSkillsList(
      workspace,
      { extensions: { disabled: ['alpha'] } },
      ALPHA_EXTENSION,
    );

    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain('alpha-skill');
    expect(run.stdout).toContain('No skills discovered.');
  }, 120_000);
});

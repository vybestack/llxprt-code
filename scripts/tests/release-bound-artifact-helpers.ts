/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { z } from 'zod';
import { NON_NPM_RELEASE_PACKAGES } from '../utils/release-packages.ts';

const manifestSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    private: z.boolean().optional(),
    workspaces: z.array(z.string()).optional(),
    dependencies: z.record(z.string()).optional(),
    optionalDependencies: z.record(z.string()).optional(),
    peerDependencies: z.record(z.string()).optional(),
  })
  .passthrough();
type Manifest = z.infer<typeof manifestSchema>;

export interface ReleaseArtifact {
  readonly directory: string;
  readonly tarball: string;
  readonly manifest: Manifest;
}

export function readReleaseManifest(path: string): Manifest {
  return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function runtimeDependencies(
  manifest: Manifest,
): Readonly<Record<string, string>> {
  return {
    ...manifest.peerDependencies,
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
}

export function assertReleaseGraph(
  manifests: readonly Manifest[],
  workspaceNames: ReadonlySet<string>,
): void {
  const versions = new Map(manifests.map((pkg) => [pkg.name, pkg.version]));
  for (const pkg of manifests) {
    for (const [name, declared] of Object.entries(runtimeDependencies(pkg))) {
      if (!workspaceNames.has(name)) continue;
      const version = versions.get(name);
      if (version === undefined || declared !== version) {
        throw new Error(
          `${pkg.name} -> ${name}: declared ${declared}, expected release version ${version ?? '(not published)'}`,
        );
      }
    }
  }
}

async function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: string,
): Promise<string> {
  const fd = openSync(log, 'w');
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(executable, [...args], {
        cwd,
        env,
        stdio: ['ignore', fd, fd],
        timeout: 180_000,
      });
      child.once('error', reject);
      child.once('close', (status, signal) => {
        if (status === 0) resolvePromise();
        else {
          reject(
            new Error(
              `${executable} ${args.join(' ')} failed (${status}, ${signal}): ${readFileSync(log, 'utf8')}`,
            ),
          );
        }
      });
    });
  } finally {
    closeSync(fd);
  }
  return readFileSync(log, 'utf8');
}

export async function packReleaseArtifacts(
  builtRoot: string,
  sourceRoot: string,
  evidence: string,
): Promise<readonly ReleaseArtifact[]> {
  const work = join(evidence, 'release-copy');
  mkdirSync(work, { recursive: true });
  for (const entry of [
    'package.json',
    'package-lock.json',
    'packages',
    'scripts',
  ]) {
    cpSync(join(builtRoot, entry), join(work, entry), {
      recursive: true,
      filter: (path) => !path.split(/[\\/]/).includes('node_modules'),
    });
  }
  for (const entry of [
    'README.md',
    'LICENSE',
    'scripts/bind-release-deps.ts',
    'scripts/utils/error-guards.ts',
    'scripts/utils/release-packages.ts',
  ]) {
    cpSync(join(sourceRoot, entry), join(work, entry));
  }
  const env = {
    ...process.env,
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const version = `0.0.0-release-proof.${Date.now()}.${randomUUID().replaceAll('-', '')}`;
  await command(
    npm,
    [
      'version',
      version,
      '--workspaces',
      '--include-workspace-root',
      '--no-git-tag-version',
      '--workspaces-update=false',
      '--ignore-scripts',
    ],
    work,
    env,
    join(evidence, 'version.log'),
  );
  await command(
    'bun',
    ['scripts/bind-release-deps.ts'],
    work,
    env,
    join(evidence, 'bind.log'),
  );
  const root = readReleaseManifest(join(work, 'package.json'));
  const workspaces = (root.workspaces ?? []).map((path) => ({
    directory: join(work, path),
    manifest: readReleaseManifest(join(work, path, 'package.json')),
  }));
  const workspaceNames = new Set(workspaces.map((pkg) => pkg.manifest.name));
  const published = workspaces.filter(
    (pkg) =>
      pkg.manifest.private !== true &&
      !NON_NPM_RELEASE_PACKAGES.has(pkg.manifest.name),
  );
  const closure = new Set(['@vybestack/llxprt-code']);
  for (const name of closure) {
    const pkg = published.find((entry) => entry.manifest.name === name);
    if (pkg === undefined)
      throw new Error(`Unpublished runtime dependency ${name}`);
    for (const dependency of Object.keys(runtimeDependencies(pkg.manifest))) {
      if (workspaceNames.has(dependency)) closure.add(dependency);
    }
  }
  const artifacts: ReleaseArtifact[] = [];
  for (const pkg of published.filter((entry) =>
    closure.has(entry.manifest.name),
  )) {
    const output = await command(
      npm,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', evidence],
      pkg.directory,
      env,
      join(evidence, `pack-${pkg.manifest.name.replaceAll('/', '-')}.log`),
    );
    const packed = z
      .array(z.object({ filename: z.string() }))
      .nonempty()
      .parse(JSON.parse(output));
    const tarball = join(evidence, packed[0].filename);
    const metadata = await command(
      'tar',
      ['-xOf', tarball, 'package/package.json'],
      work,
      env,
      join(evidence, `metadata-${pkg.manifest.name.replaceAll('/', '-')}.json`),
    );
    artifacts.push({
      directory: pkg.directory,
      tarball,
      manifest: manifestSchema.parse(JSON.parse(metadata)),
    });
  }
  assertReleaseGraph(
    artifacts.map((pkg) => pkg.manifest),
    workspaceNames,
  );
  return artifacts;
}

export async function installReleaseArtifacts(
  artifacts: readonly ReleaseArtifact[],
  evidence: string,
): Promise<string> {
  const cli = artifacts.find(
    (pkg) => pkg.manifest.name === '@vybestack/llxprt-code',
  );
  if (cli === undefined) throw new Error('Missing CLI release artifact');
  const server = createServer((request, response) => {
    const path = decodeURIComponent(
      new URL(request.url ?? '/', 'http://localhost').pathname,
    );
    const tarball = artifacts.find(
      (pkg) =>
        path === `/tarballs/${pkg.manifest.name.replaceAll('/', '-')}.tgz`,
    );
    if (tarball !== undefined) {
      response.end(readFileSync(tarball.tarball));
      return;
    }
    const pkg = artifacts.find((entry) => path === `/${entry.manifest.name}`);
    if (pkg === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Registry has no TCP port');
    const manifest = pkg.manifest;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        name: manifest.name,
        'dist-tags': { latest: manifest.version },
        versions: {
          [manifest.version]: {
            ...manifest,
            dist: {
              tarball: `http://127.0.0.1:${address.port}/tarballs/${manifest.name.replaceAll('/', '-')}.tgz`,
              integrity: `sha512-${createHash('sha512').update(readFileSync(pkg.tarball)).digest('base64')}`,
            },
          },
        },
      }),
    );
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Registry has no TCP port');
  const registry = `http://127.0.0.1:${address.port}`;
  const consumer = join(evidence, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'release-proof-consumer', private: true }),
  );
  writeFileSync(join(consumer, '.npmrc'), `@vybestack:registry=${registry}\n`);
  const home = join(evidence, 'home');
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    LLXPRT_CONFIG_HOME: join(home, 'config'),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    TMPDIR: join(home, 'tmp'),
    npm_config_cache: process.env.npm_config_cache ?? join(homedir(), '.npm'),
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    for (const pkg of artifacts) {
      await command(
        npm,
        [
          'cache',
          'add',
          `${pkg.manifest.name}@${pkg.manifest.version}`,
          '--offline=false',
          `--registry=${registry}`,
        ],
        consumer,
        env,
        join(evidence, `cache-${pkg.manifest.name.replaceAll('/', '-')}.log`),
      );
    }
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
  }
  await command(
    npm,
    [
      'install',
      cli.tarball,
      '--offline',
      '--ignore-scripts=false',
      '--foreground-scripts',
      '--package-lock=false',
    ],
    consumer,
    env,
    join(evidence, 'install.log'),
  );
  const workspaceNames = new Set(artifacts.map((pkg) => pkg.manifest.name));
  const installed = artifacts.map((pkg) => {
    const path = join(
      consumer,
      'node_modules',
      pkg.manifest.name,
      'package.json',
    );
    if (!existsSync(path))
      throw new Error(`Missing installed package ${pkg.manifest.name}`);
    const actual = readReleaseManifest(path);
    if (actual.version !== pkg.manifest.version)
      throw new Error(
        `Wrong installed version for ${actual.name}: ${actual.version}`,
      );
    if (relative(consumer, realpathSync(path)).startsWith('..'))
      throw new Error(`Package escaped consumer: ${path}`);
    return actual;
  });
  assertReleaseGraph(installed, workspaceNames);
  for (const pkg of installed) {
    const names = Object.keys(runtimeDependencies(pkg)).filter((name) =>
      workspaceNames.has(name),
    );
    const parent = pathToFileURL(
      join(consumer, 'node_modules', pkg.name, 'index.js'),
    ).href;
    const script = `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name => [name, import.meta.resolve(name, ${JSON.stringify(parent)})]))));`;
    const output = await command(
      'node',
      [
        '--experimental-import-meta-resolve',
        '--input-type=module',
        '-e',
        script,
      ],
      consumer,
      env,
      join(evidence, `resolve-${pkg.name.replaceAll('/', '-')}.log`),
    );
    const resolutions = z.record(z.string()).parse(JSON.parse(output));
    for (const [name, url] of Object.entries(resolutions)) {
      const expected = realpathSync(join(consumer, 'node_modules', name));
      const actual = realpathSync(fileURLToPath(url));
      if (relative(expected, actual).startsWith('..'))
        throw new Error(`Release edge escaped package: ${pkg.name} -> ${name}`);
    }
  }
  writeFileSync(
    join(evidence, 'installed-graph.json'),
    JSON.stringify(
      installed.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        dependencies: runtimeDependencies(pkg),
      })),
      null,
      2,
    ),
  );
  return command(
    resolve(consumer, 'node_modules/.bin/llxprt'),
    ['--help'],
    consumer,
    {
      ...env,
      HOME: home,
      LLXPRT_CONFIG_HOME: join(home, 'config'),
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      NO_COLOR: '1',
    },
    join(evidence, 'installed-help.log'),
  );
}

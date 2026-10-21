/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { NON_NPM_RELEASE_PACKAGES } from '../utils/release-packages.ts';
import { invokeConsumer } from './release-consumer-invocation.ts';

const {
  npmInvocation,
}: {
  npmInvocation: (
    args: readonly string[],
    options: { execPath: string },
  ) => { command: string; args: string[] };
} = createRequire(import.meta.url)('../lib/npm-command.cjs');

const nodeExecutable = spawnSync('node', ['-p', 'process.execPath'], {
  encoding: 'utf8',
}).stdout.trim();

export function prepareNodeOnlyRuntime(directory: string): void {
  mkdirSync(directory, { recursive: true });
  if (process.platform === 'win32') {
    copyFileSync(nodeExecutable, join(directory, 'node.exe'));
  } else {
    // Keep loader-relative libraries beside the physical host executable.
    symlinkSync(nodeExecutable, join(directory, 'node'));
  }
}

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
  let stdout = '';
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const invocation =
        executable === 'npm'
          ? npmInvocation(args, { execPath: nodeExecutable })
          : { command: executable, args: [...args] };
      const child = spawn(invocation.command, invocation.args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', fd],
        timeout: 600_000,
        windowsVerbatimArguments: executable.toLowerCase().endsWith('cmd.exe'),
      });
      if (child.stdout === null) {
        child.kill();
        reject(new Error('Command stdout pipe was not created'));
        return;
      }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        writeSync(fd, chunk);
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
  return stdout;
}

export async function packReleaseArtifacts(
  builtRoot: string,
  sourceRoot: string,
  evidence: string,
  releaseVersion?: string,
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
    npm_config_offline: 'false',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
  const npm = 'npm';
  if (
    releaseVersion !== undefined &&
    readReleaseManifest(join(work, 'package.json')).version !== releaseVersion
  ) {
    throw new Error(
      'Built release version differs from the requested candidate',
    );
  }
  await command(
    process.execPath,
    ['run', join(work, 'scripts/bind-release-deps.ts')],
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
  const artifacts: ReleaseArtifact[] = [];
  for (const pkg of published) {
    const output = await command(
      npm,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', evidence],
      pkg.directory,
      env,
      join(evidence, `pack-${pkg.manifest.name.replaceAll('/', '-')}.log`),
    );
    const entrySchema = z.object({ filename: z.string() });
    const packed = z
      .union([
        z.array(entrySchema),
        z.record(entrySchema).transform((entries) => Object.values(entries)),
      ])
      .pipe(z.array(entrySchema).nonempty())
      .parse(JSON.parse(output));
    const tarball = join(evidence, packed[0].filename);
    const metadata = await command(
      'tar',
      ['-xOf', basename(tarball), 'package/package.json'],
      evidence,
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

function releaseRuntimeClosure(
  artifacts: readonly ReleaseArtifact[],
  cli: ReleaseArtifact,
): readonly ReleaseArtifact[] {
  const closure = new Set([cli.manifest.name]);
  for (const name of closure) {
    const pkg = artifacts.find((artifact) => artifact.manifest.name === name);
    if (pkg === undefined) throw new Error(`Missing release artifact ${name}`);
    for (const dependency of Object.keys(runtimeDependencies(pkg.manifest))) {
      if (artifacts.some((artifact) => artifact.manifest.name === dependency))
        closure.add(dependency);
    }
  }
  return artifacts.filter((pkg) => closure.has(pkg.manifest.name));
}

export async function installReleaseArtifacts(
  artifacts: readonly ReleaseArtifact[],
  evidence: string,
): Promise<string> {
  const cli = artifacts.find(
    (pkg) => pkg.manifest.name === '@vybestack/llxprt-code',
  );
  if (cli === undefined) throw new Error('Missing CLI release artifact');
  const runtimeArtifacts = releaseRuntimeClosure(artifacts, cli);
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
  const home = join(evidence, 'home');
  const seed = join(evidence, 'seed');
  mkdirSync(join(home, 'tmp'), { recursive: true });
  mkdirSync(seed, { recursive: true });
  writeFileSync(join(seed, '.npmrc'), `@vybestack:registry=${registry}\n`);
  const userconfig = join(home, 'npmrc');
  writeFileSync(
    userconfig,
    `@vybestack:registry=${registry}\nregistry=https://registry.npmjs.org/\n`,
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LLXPRT_CONFIG_HOME: join(home, 'config'),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    TMPDIR: join(home, 'tmp'),
    npm_config_userconfig: userconfig,
    npm_config_cache: join(evidence, 'npm-cache'),
    npm_config_ignore_scripts: 'true',
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
  };
  const npm = 'npm';
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
        seed,
        env,
        join(evidence, `cache-${pkg.manifest.name.replaceAll('/', '-')}.log`),
      );
    }
    writeFileSync(
      join(seed, 'package.json'),
      JSON.stringify({ name: 'release-proof-seed', private: true }),
    );
    await command(
      npm,
      [
        'install',
        cli.tarball,
        '--offline=false',
        '--ignore-scripts',
        '--package-lock=false',
      ],
      seed,
      env,
      join(evidence, 'seed.log'),
    );
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
  }
  const nodeOnly = join(evidence, 'node-only');
  prepareNodeOnlyRuntime(nodeOnly);
  const launchEnv = {
    ...env,
    PATH:
      process.platform === 'win32'
        ? `${nodeOnly};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
        : nodeOnly,
  };
  let help = '';
  for (const mode of ['local', 'global']) {
    const directory = join(evidence, mode);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'release-proof-consumer', private: true }),
    );
    writeFileSync(
      join(directory, '.npmrc'),
      `@vybestack:registry=${registry}\n`,
    );
    const prefix = join(directory, 'prefix');
    const globalArgs =
      mode === 'global' ? ['--global', '--prefix', prefix] : [];
    await command(
      npm,
      [
        'install',
        ...globalArgs,
        cli.tarball,
        '--offline',
        '--ignore-scripts',
        '--package-lock=false',
      ],
      directory,
      env,
      join(directory, 'install.log'),
    );
    let consumer = directory;
    if (mode === 'global')
      consumer = process.platform === 'win32' ? prefix : join(prefix, 'lib');
    await verifyInstalledGraph(runtimeArtifacts, consumer, directory, env);
    let bin = join(directory, 'node_modules/.bin/llxprt');
    if (mode === 'global')
      bin = join(
        prefix,
        process.platform === 'win32' ? 'llxprt' : 'bin/llxprt',
      );
    const executable =
      process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : bin;
    const argsFor = (arg: string): string[] =>
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `""${bin}.cmd" ${arg}"`]
        : [arg];
    const version = await command(
      executable,
      argsFor('--version'),
      directory,
      launchEnv,
      join(directory, 'installed-version.log'),
    );
    if (version.trim() !== cli.manifest.version)
      throw new Error(`Installed ${mode} version mismatch: ${version}`);
    help = await command(
      executable,
      argsFor('--help'),
      directory,
      launchEnv,
      join(directory, 'installed-help.log'),
    );
    if (!help.includes('--help') || !help.includes('llxprt'))
      throw new Error(`Installed ${mode} help is invalid`);
    if (process.platform === 'win32')
      await probeWindowsConsumer(bin, consumer, cli, directory, launchEnv);
  }
  return help;
}

async function probeWindowsConsumer(
  bin: string,
  consumer: string,
  cli: ReleaseArtifact,
  directory: string,
  launchEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const powershell =
    process.env.PWSH_PATH ??
    join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
  for (const arg of ['--version', '--help']) {
    const output = await command(
      powershell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${bin}.ps1`, arg],
      directory,
      launchEnv,
      join(directory, `installed-powershell-${arg.slice(2)}.log`),
    );
    if (
      arg === '--version'
        ? output.trim() !== cli.manifest.version
        : !output.includes('--help')
    )
      throw new Error(`PowerShell ${arg} output is invalid`);
  }

  if (cli.manifest.dependencies?.bun !== undefined) {
    await probeWindowsForwarding(
      join(consumer, 'node_modules', cli.manifest.name, 'bundle/llxprt.js'),
      bin,
      directory,
      launchEnv,
      powershell,
    );
  }
}

async function probeWindowsForwarding(
  bundle: string,
  bin: string,
  directory: string,
  launchEnv: NodeJS.ProcessEnv,
  powershell: string,
): Promise<void> {
  const wrappers: {
    probeArg: (request: {
      stdin: boolean;
      stderr: string;
      exit: number;
    }) => string;
    cmdInvocationArgs: (path: string, args: string[]) => string[];
    powershellInvocationScript: (path: string, args: string[]) => string;
    powershellEncodedCommand: (script: string) => string;
  } = createRequire(import.meta.url)(
    '../windows-installed-command-smoke/launcher-invocation.cjs',
  );
  const original = readFileSync(bundle);
  const probe = readFileSync(
    fileURLToPath(new URL('./issue-2603-windows-probe.ts', import.meta.url)),
    'utf8',
  );
  try {
    writeFileSync(
      bundle,
      new Bun.Transpiler({ loader: 'ts' }).transformSync(probe),
    );
    const request = wrappers.probeArg({
      stdin: true,
      stderr: 'probe stderr',
      exit: 17,
    });
    const argv = ['space value', 'amp&pipe|caret^bang!', 'unicode-雪'];
    const args = [request, ...argv];
    for (const { extension, executable, invocationArgs } of [
      {
        extension: 'cmd',
        executable: process.env.ComSpec ?? 'cmd.exe',
        invocationArgs: wrappers.cmdInvocationArgs(`${bin}.cmd`, args),
      },
      {
        extension: 'ps1',
        executable: powershell,
        invocationArgs: [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          wrappers.powershellEncodedCommand(
            wrappers.powershellInvocationScript(`${bin}.ps1`, args),
          ),
        ],
      },
    ]) {
      const result = await invokeConsumer(executable, invocationArgs, {
        env: launchEnv,
        input: 'stdin payload\n',
        timeout: 30_000,
      });
      const line = result.stdout
        .split(/\r?\n/)
        .find((value) => value.startsWith('LLXPRT_PROBE:'));
      if (!line) throw new Error(`Missing ${extension} runtime probe`);
      const actual = z
        .object({
          argv: z.array(z.string()),
          stdin: z.string(),
          bunVersion: z.string().min(1),
          execPath: z.string(),
        })
        .parse(JSON.parse(line.slice('LLXPRT_PROBE:'.length)));
      const observed = {
        status: result.status,
        stderr: result.stderr,
        stdin: actual.stdin,
        argv: actual.argv.slice(2),
      };
      const expected = {
        status: 17,
        stderr: 'probe stderr',
        stdin: 'stdin payload\n',
        argv: [request, ...argv],
      };
      if (JSON.stringify(observed) !== JSON.stringify(expected))
        throw new Error(
          `Installed ${extension} forwarding probe failed: ${JSON.stringify(observed)}`,
        );
      if (!actual.execPath.includes('@oven'))
        throw new Error(`Expected packaged @oven runtime: ${actual.execPath}`);
      writeFileSync(
        join(directory, `installed-${extension}-probe.json`),
        JSON.stringify(actual, null, 2),
      );
    }
  } finally {
    writeFileSync(bundle, original);
  }
}

function installedPackageRoot(name: string, cliRoot: string): string {
  if (name === '@vybestack/llxprt-code') return cliRoot;
  for (
    let directory = cliRoot;
    directory !== dirname(directory);
    directory = dirname(directory)
  ) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`Missing installed package ${name}`);
}

export async function verifyInstalledGraph(
  artifacts: readonly ReleaseArtifact[],
  consumer: string,
  evidence: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const consumerRoot = realpathSync(consumer);
  const workspaceNames = new Set(artifacts.map((pkg) => pkg.manifest.name));
  const cliRoot = join(consumer, 'node_modules', '@vybestack/llxprt-code');
  const roots = new Map(
    artifacts.map((pkg) => [
      pkg.manifest.name,
      installedPackageRoot(pkg.manifest.name, cliRoot),
    ]),
  );
  const installed = artifacts.map((pkg) => {
    const root = roots.get(pkg.manifest.name);
    if (root === undefined)
      throw new Error(`Missing installed package ${pkg.manifest.name}`);
    const path = join(root, 'package.json');
    const actual = readReleaseManifest(path);
    if (actual.version !== pkg.manifest.version)
      throw new Error(
        `Wrong installed version for ${actual.name}: ${actual.version}`,
      );
    if (relative(consumerRoot, realpathSync(path)).startsWith('..'))
      throw new Error(`Package escaped consumer: ${path}`);
    return actual;
  });
  assertReleaseGraph(installed, workspaceNames);
  for (const pkg of installed) {
    const names = Object.keys(runtimeDependencies(pkg)).filter((name) =>
      workspaceNames.has(name),
    );
    const parent = pathToFileURL(
      join(roots.get(pkg.name) ?? cliRoot, 'index.js'),
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
      const root = roots.get(name);
      if (root === undefined) throw new Error(`Missing release root ${name}`);
      const expected = realpathSync(root);
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
}

if (import.meta.main) {
  const builtRoot = process.env.LLXPRT_RELEASE_BUILT_ROOT ?? process.cwd();
  const evidence = process.env.LLXPRT_RELEASE_PROOF_DIR;
  if (!evidence) throw new Error('LLXPRT_RELEASE_PROOF_DIR is required');
  if (!existsSync(join(builtRoot, 'packages/cli/bundle/llxprt.js'))) {
    throw new Error(
      'Publisher must build the CLI bundle before consumer proof',
    );
  }
  const artifacts = await packReleaseArtifacts(
    builtRoot,
    builtRoot,
    evidence,
    process.env.RELEASE_VERSION,
  );
  await installReleaseArtifacts(artifacts, evidence);
  writeFileSync(
    join(evidence, 'artifacts.json'),
    JSON.stringify(
      artifacts.map(({ tarball, manifest }) => ({
        tarball,
        name: manifest.name,
        version: manifest.version,
      })),
      null,
      2,
    ),
  );
  console.log(
    'Scripts-disabled release consumers passed (local + global, --version + --help).',
  );
}

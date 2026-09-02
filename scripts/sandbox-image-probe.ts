/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';

type ContainerEngine = 'docker' | 'podman';

interface ProbeOptions {
  readonly engine: ContainerEngine;
  readonly image: string;
  readonly platform?: string;
}

interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

const IMAGE_INSPECT_FORMAT =
  'image_id={{.Id}} repo_digests={{json .RepoDigests}} image_platform={{.Os}}/{{.Architecture}}';
const RUNTIME_PROBE = [
  'set -eu',
  'llxprt --version',
  'cd "$NPM_CONFIG_PREFIX/lib/node_modules/@vybestack/llxprt-code"',
  'bun scripts/verify-sandbox-runtime.ts',
  'npm ls --global --omit=dev --all --json > /tmp/llxprt-sandbox-dependencies.json',
  'printf "dependency_tree_sha256="',
  'sha256sum /tmp/llxprt-sandbox-dependencies.json | cut -d" " -f1',
].join('; ');

function usage(message?: string): never {
  if (message !== undefined) {
    console.error(message);
  }
  console.error(
    'Usage: bun scripts/sandbox-image-probe.ts --engine <docker|podman> --image <reference> [--platform <os/arch>]',
  );
  process.exit(2);
}

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    usage(`Missing value for ${name}`);
  }
  return value;
}

function parseOptions(args: readonly string[]): ProbeOptions {
  const engineValue = optionValue(args, '--engine');
  const image = optionValue(args, '--image');
  const platform = optionValue(args, '--platform');

  if (engineValue !== 'docker' && engineValue !== 'podman') {
    usage('--engine must be docker or podman');
  }
  if (image === undefined || image.trim() === '') {
    usage('--image must be a non-empty image reference');
  }
  if (
    platform !== undefined &&
    !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(platform)
  ) {
    usage('--platform must use os/architecture form, such as linux/arm64');
  }

  return platform === undefined
    ? { engine: engineValue, image }
    : { engine: engineValue, image, platform };
}

function run(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const error = result.error;
  return error === undefined
    ? {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      }
    : {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error,
      };
}

function containerArgs(
  options: ProbeOptions,
  command: readonly string[],
): string[] {
  const args = ['run', '--rm'];
  if (options.platform !== undefined) {
    args.push('--platform', options.platform);
  }
  args.push(options.image, ...command);
  return args;
}

function runtimeArchitectureArgs(options: ProbeOptions): string[] {
  const args = ['run', '--rm'];
  if (options.platform !== undefined) {
    args.push('--platform', options.platform);
  }
  args.push('--entrypoint', '/bin/uname', options.image, '-m');
  return args;
}

function resultDetails(result: CommandResult): string {
  return [
    result.error === undefined ? '' : `spawn_error=${result.error.message}`,
    result.stdout.trim() === '' ? '' : `stdout:\n${result.stdout.trimEnd()}`,
    result.stderr.trim() === '' ? '' : `stderr:\n${result.stderr.trimEnd()}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function imageMetadata(options: ProbeOptions): CommandResult {
  return run(options.engine, [
    'image',
    'inspect',
    '--format',
    IMAGE_INSPECT_FORMAT,
    options.image,
  ]);
}

function printFailureDiagnostics(
  options: ProbeOptions,
  probe: CommandResult,
  metadata: CommandResult,
): void {
  const engineVersion = run(options.engine, ['version']);
  const runtimeArchitecture = run(
    options.engine,
    runtimeArchitectureArgs(options),
  );
  const requestedPlatform = options.platform ?? 'engine-default';

  console.error('sandbox_image_probe=failed');
  console.error(`engine=${options.engine}`);
  console.error(`image=${options.image}`);
  console.error(`requested_platform=${requestedPlatform}`);
  if (metadata.status === 0) {
    console.error(metadata.stdout.trim());
  } else {
    console.error(`image_inspect_status=${metadata.status}`);
    console.error(resultDetails(metadata));
  }
  if (runtimeArchitecture.status === 0) {
    console.error(`runtime_architecture=${runtimeArchitecture.stdout.trim()}`);
  } else {
    console.error(`runtime_architecture_status=${runtimeArchitecture.status}`);
    console.error(resultDetails(runtimeArchitecture));
  }
  console.error(`engine_version_status=${engineVersion.status}`);
  console.error(resultDetails(engineVersion));
  console.error(`runtime_probe_status=${probe.status}`);
  console.error(resultDetails(probe));
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const probe = run(
    options.engine,
    containerArgs(options, ['/bin/sh', '-c', RUNTIME_PROBE]),
  );
  const metadata = imageMetadata(options);

  if (probe.status !== 0 || metadata.status !== 0) {
    printFailureDiagnostics(options, probe, metadata);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(probe.stdout);
  if (probe.stderr !== '') {
    process.stderr.write(probe.stderr);
  }
  console.log(
    `sandbox_image_probe=ok engine=${options.engine} image=${options.image} requested_platform=${options.platform ?? 'engine-default'}`,
  );
  console.log(metadata.stdout.trim());
}

main();

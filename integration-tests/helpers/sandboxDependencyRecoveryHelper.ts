/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  addSandboxDependencyRunLabel,
  buildDependencyVolumeCreateArgs,
  buildVolumeMountFlagArg,
} from '../../packages/cli/src/utils/sandbox-dependency-volumes.js';
import { addSandboxOwnershipLabels } from '../../packages/cli/src/utils/sandbox-owner-labels.js';

const OPERATION_TIMEOUT_MS = 60_000;

interface HelperArguments {
  readonly engine: 'docker' | 'podman';
  readonly image: string;
  readonly runId: string;
  readonly volumeName: string;
  readonly containerName: string;
}

function parseArguments(argv: readonly string[]): HelperArguments {
  const [engine, image, runId, volumeName, containerName] = argv;
  if (engine !== 'docker' && engine !== 'podman') {
    throw new Error(`Unsupported engine '${engine ?? ''}'`);
  }
  if (
    image === undefined ||
    runId === undefined ||
    volumeName === undefined ||
    containerName === undefined
  ) {
    throw new Error(
      'Expected engine, image, run ID, volume name, and container name',
    );
  }
  return { engine, image, runId, volumeName, containerName };
}

function runChecked(
  engine: 'docker' | 'podman',
  args: readonly string[],
): void {
  const result = spawnSync(engine, args, {
    encoding: 'utf8',
    timeout: OPERATION_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: process.env,
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(
      `${engine} ${args.join(' ')} failed with status ${String(result.status)}: ` +
        `${result.stderr}${result.error?.message ?? ''}`,
    );
  }
}

function main(): void {
  const args = parseArguments(process.argv.slice(2));
  runChecked(
    args.engine,
    buildDependencyVolumeCreateArgs(args.volumeName, args.runId),
  );
  const runArgs: string[] = ['run', '--init', '-i'];
  addSandboxOwnershipLabels(runArgs);
  addSandboxDependencyRunLabel(runArgs, args.runId);
  runArgs.push(
    '--name',
    args.containerName,
    '--network',
    'none',
    '--mount',
    buildVolumeMountFlagArg(args.volumeName, '/issue3470-dependencies'),
    args.image,
    'sh',
    '-c',
    'printf "issue3470-container-ready\\n"; read issue3470_release',
  );
  const container = spawn(args.engine, runArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let stdout = '';
  let stderr = '';
  let announced = false;
  container.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    if (!announced && stdout.includes('issue3470-container-ready\n')) {
      announced = true;
      process.stdout.write(
        `${JSON.stringify({
          runId: args.runId,
          volumeName: args.volumeName,
          containerName: args.containerName,
        })}\n`,
      );
    }
  });
  container.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  container.once('error', (error) => {
    throw error;
  });
  container.once('close', (status) => {
    if (!announced || status !== 0) {
      process.stderr.write(
        `Container exited with status ${String(status)} before helper release: ${stderr}\n`,
      );
      process.exitCode = 1;
    }
  });
  process.stdin.on('data', (chunk: Buffer) => {
    container.stdin.write(chunk);
  });
  process.stdin.once('end', () => container.stdin.end());
}

main();

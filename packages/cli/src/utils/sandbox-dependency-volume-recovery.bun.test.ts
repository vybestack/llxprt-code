/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { runContainerSandbox } from './sandbox-exec.js';

const MANAGED_LABEL = 'com.vybestack.llxprt.sandbox-managed';
const OWNER_LABEL = 'com.vybestack.llxprt.sandbox-owner';
const RUN_LABEL = 'com.vybestack.llxprt.sandbox-dependency-run';
const TEST_TIMEOUT_MS = 30_000;

interface OwnerProcess {
  readonly child: ChildProcess;
  readonly payload: string;
}

function bounded<T>(operation: Promise<T>, description: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${description} exceeded ${TEST_TIMEOUT_MS}ms`)),
      TEST_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function startOwnerProcess(): Promise<OwnerProcess> {
  const ownerModuleUrl = pathToFileURL(
    path.join(import.meta.dirname, 'sandbox-owner-labels.ts'),
  ).href;
  const source = [
    `import { addSandboxOwnershipLabels } from ${JSON.stringify(ownerModuleUrl)};`,
    'const args = [];',
    'addSandboxOwnershipLabels(args);',
    `const prefix = ${JSON.stringify(`${OWNER_LABEL}=`)};`,
    'const owner = args.find((value) => value.startsWith(prefix));',
    'if (owner === undefined) throw new Error("owner label missing");',
    'process.stdout.write(owner.slice(prefix.length) + "\\n");',
    'process.stdin.resume();',
  ].join('\n');
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const payload = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf('\n');
      if (newline >= 0) resolve(stdout.slice(0, newline));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (status) => {
      reject(
        new Error(
          `Owner helper exited before readiness with status ${String(status)}: ${stderr}`,
        ),
      );
    });
  });
  return { child, payload: await bounded(payload, 'owner helper readiness') };
}

function stopOwnerProcess(owner: OwnerProcess): Promise<void> {
  return bounded(
    new Promise<void>((resolve) => {
      if (owner.child.exitCode !== null || owner.child.signalCode !== null) {
        resolve();
        return;
      }
      owner.child.once('close', () => resolve());
      owner.child.kill('SIGKILL');
    }),
    'owner helper termination',
  );
}

function runEngine(engine: 'docker' | 'podman', args: readonly string[]): void {
  const result = spawnSync(engine, args, {
    encoding: 'utf8',
    env: process.env,
    timeout: TEST_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(
      `${engine} ${args.join(' ')} failed with status ${String(result.status)}: ` +
        `${result.stderr}${result.error?.message ?? ''}`,
    );
  }
}

function createLabeledVolume(
  engine: 'docker' | 'podman',
  name: string,
  labels: readonly string[],
): void {
  runEngine(engine, [
    'volume',
    'create',
    ...labels.flatMap((label) => ['--label', label]),
    name,
  ]);
}

function createDependencyVolume(
  engine: 'docker' | 'podman',
  name: string,
  owner: string,
  runId: string,
): void {
  createLabeledVolume(engine, name, [
    `${MANAGED_LABEL}=true`,
    `${OWNER_LABEL}=${owner}`,
    `${RUN_LABEL}=${runId}`,
  ]);
}

function createContainer(
  engine: 'docker' | 'podman',
  name: string,
  volume: string,
  labels: readonly string[],
): void {
  runEngine(engine, [
    'run',
    '--name',
    name,
    ...labels.flatMap((label) => ['--label', label]),
    '--mount',
    `type=volume,src=${volume},dst=/dependencies`,
    'issue3470-fake-image',
  ]);
}

function createManagedContainer(
  engine: 'docker' | 'podman',
  name: string,
  owner: string,
  runId: string,
  volume: string,
): void {
  createContainer(engine, name, volume, [
    `${MANAGED_LABEL}=true`,
    `${OWNER_LABEL}=${owner}`,
    `${RUN_LABEL}=${runId}`,
  ]);
}

async function runRecoveryStartup(
  engine: 'docker' | 'podman',
): Promise<string> {
  try {
    await runContainerSandbox(
      { command: engine, image: 'llxprt-code-sandbox' },
      [],
    );
    return 'startup unexpectedly completed';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('#3470 dependency-volume startup recovery', () => {
  const fakeEngine = useFakeEngine();
  let owners: OwnerProcess[] = [];
  let originalCwd = '';
  let workdir = '';

  afterEach(async () => {
    await Promise.all(owners.map(stopOwnerProcess));
    owners = [];
    if (originalCwd !== '') process.chdir(originalCwd);
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
  });

  it.each(['docker', 'podman'] as const)(
    'reaps a dead %s container before its volumes and preserves a concurrent live run',
    async (engine) => {
      originalCwd = process.cwd();
      workdir = fs.mkdtempSync(path.join(fakeEngine.stateRoot, 'workspace-'));
      process.chdir(workdir);
      const deadOwner = await startOwnerProcess();
      const liveOwner = await startOwnerProcess();
      owners = [deadOwner, liveOwner];
      const deadRunId = `dead-${engine}-run`;
      const liveRunId = `live-${engine}-run`;
      const deadVolume = `sandbox-node-modules-dead-${engine}-0`;
      const liveVolume = `sandbox-node-modules-live-${engine}-0`;
      createDependencyVolume(engine, deadVolume, deadOwner.payload, deadRunId);
      createDependencyVolume(engine, liveVolume, liveOwner.payload, liveRunId);
      createManagedContainer(
        engine,
        `dead-${engine}-container`,
        deadOwner.payload,
        deadRunId,
        deadVolume,
      );
      createManagedContainer(
        engine,
        `live-${engine}-container`,
        liveOwner.payload,
        liveRunId,
        liveVolume,
      );
      await stopOwnerProcess(deadOwner);
      owners = [liveOwner];

      const startupResult = await runRecoveryStartup(engine);

      expect({
        startupResult,
        containers: fakeEngine.containerNames().sort(),
        volumes: fakeEngine.volumeNames().sort(),
      }).toStrictEqual({
        startupResult: expect.stringContaining(
          "Sandbox image 'llxprt-code-sandbox' is missing",
        ),
        containers: [`live-${engine}-container`],
        volumes: [liveVolume],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['fail-ps-once', 'managed-container discovery'],
    ['fail-volume-ls-once', 'managed-volume discovery'],
  ] as const)(
    'fails closed when %s prevents %s',
    async (knob) => {
      originalCwd = process.cwd();
      workdir = fs.mkdtempSync(path.join(fakeEngine.stateRoot, 'workspace-'));
      process.chdir(workdir);
      const deadOwner = await startOwnerProcess();
      owners = [deadOwner];
      const volume = `sandbox-node-modules-${knob}-0`;
      createDependencyVolume(
        'docker',
        volume,
        deadOwner.payload,
        `${knob}-run`,
      );
      await stopOwnerProcess(deadOwner);
      owners = [];
      fakeEngine.setKnob(knob);

      await runRecoveryStartup('docker');

      expect(fakeEngine.volumeNames()).toStrictEqual([volume]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reclaims only dependency-prefixed dead-owner volumes and leaves custom, persistent, malformed, and attached storage',
    async () => {
      originalCwd = process.cwd();
      workdir = fs.mkdtempSync(path.join(fakeEngine.stateRoot, 'workspace-'));
      process.chdir(workdir);
      const deadOwner = await startOwnerProcess();
      owners = [deadOwner];
      const eligibleVolume = 'sandbox-node-modules-eligible-0';
      const attachedVolume = 'sandbox-node-modules-attached-0';
      const malformedVolume = 'sandbox-node-modules-malformed-0';
      const missingRunVolume = 'sandbox-node-modules-missing-run-0';
      const customVolume = 'user-custom-volume';
      const managedCustomVolume = 'user-managed-custom-volume';
      const checkpointVolume = 'persistent-checkpoint-volume';
      createDependencyVolume(
        'docker',
        eligibleVolume,
        deadOwner.payload,
        'eligible-run',
      );
      createDependencyVolume(
        'docker',
        managedCustomVolume,
        deadOwner.payload,
        'managed-custom-run',
      );
      createDependencyVolume(
        'docker',
        attachedVolume,
        deadOwner.payload,
        'attached-run',
      );
      createLabeledVolume('docker', malformedVolume, [
        `${MANAGED_LABEL}=true`,
        `${OWNER_LABEL}={not-json`,
        `${RUN_LABEL}=malformed-run`,
      ]);
      createLabeledVolume('docker', missingRunVolume, [
        `${MANAGED_LABEL}=true`,
        `${OWNER_LABEL}=${deadOwner.payload}`,
      ]);
      createLabeledVolume('docker', customVolume, []);
      createLabeledVolume('docker', checkpointVolume, [
        'com.vybestack.llxprt.checkpoint=true',
      ]);
      createContainer('docker', 'user-custom-container', attachedVolume, []);
      await stopOwnerProcess(deadOwner);
      owners = [];

      await runRecoveryStartup('docker');

      expect({
        containers: fakeEngine.containerNames().sort(),
        volumes: fakeEngine.volumeNames().sort(),
      }).toStrictEqual({
        containers: ['user-custom-container'],
        volumes: [
          attachedVolume,
          checkpointVolume,
          malformedVolume,
          missingRunVolume,
          customVolume,
          managedCustomVolume,
        ].sort(),
      });
    },
    TEST_TIMEOUT_MS,
  );
});

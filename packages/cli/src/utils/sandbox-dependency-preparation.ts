/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Source-checkout dependency preparation in its own container (#3573 review
 * round).
 *
 * A launch from a positively identified llxprt-code source checkout must
 * install Linux dependencies into the private dependency volumes before the
 * checked-out TypeScript can run. `bun install` runs lifecycle scripts from
 * the checkout, which is project-controlled code. The main container holds
 * the capability token from its start: the token file sits in the mounted
 * capability directory, and the entrypoint shell keeps the token in memory
 * until the final exec. A same-uid process there can read the shell's memory
 * (when the host allows ptrace) or its descriptors under /proc.
 *
 * So the install runs here, in a short-lived container started before the
 * main one. It uses the same image, workdir, workspace binds, dependency
 * volumes, hardening, user and network settings, and it has no capability
 * mount, no credential socket, no SSH agent and no other bridge. The main
 * container's entrypoint then contains no project-controlled step between the
 * token capture and the final exec. Anything the install leaves behind dies
 * with this container.
 */

import { spawn } from 'node:child_process';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import type { ContainerWorkspacePlan } from './sandbox-workspaces.js';
import { addSandboxDependencyRunLabel } from './sandbox-dependency-volumes.js';
import type { DependencyPreparationVolumes } from './sandbox-node-modules.js';
import {
  buildContainerPolicyArgs,
  buildProxiedNetworkEnvArgs,
  buildUserSandboxEnvArgs,
  SANDBOX_INTERNAL_NETWORK_NAME,
} from './sandbox-containers.js';
import { getContainerPath, isSourceDevelopmentWorkdir } from './sandbox-env.js';
import { addSandboxOwnershipLabels } from './sandbox-owner-labels.js';

/** The failure messages the entrypoint printed before the install moved. */
export const SOURCE_PREPARATION_FAILED_MESSAGE =
  'Failed to prepare isolated Linux dependencies for LLxprt source development';
export const SOURCE_PREPARATION_MISSING_MANIFEST_MESSAGE =
  'LLxprt source development requires package.json and bun.lock in the repository root';
export const SOURCE_PREPARATION_MISSING_BUN_MESSAGE =
  'LLxprt source development requires Bun in the sandbox image';

/**
 * Exit statuses of the preparation script. They sit below the engine's own
 * 125 to 127, and a failed install always exits 1, so the host can tell the
 * three failures apart without parsing output.
 */
const EXIT_MISSING_MANIFEST = 64;
const EXIT_MISSING_BUN = 65;

const NL = '\n';

/**
 * HOME for the installer when the launch runs as the host uid directly. That
 * uid has no passwd entry and no home in a fresh container, and bun writes
 * its package cache below HOME. /tmp is world-writable in the image.
 */
const CURRENT_USER_INSTALL_HOME = '/tmp';

export interface SourceDependencyPreparationPlan {
  readonly engine: 'docker' | 'podman';
  readonly image: string;
  /** Unique per run; the dependency volume lifecycle removes it on release. */
  readonly containerName: string;
  readonly runId: string;
  readonly workdir: string;
  readonly containerWorkdir: string;
  readonly includeRoots: readonly string[];
  /** `--mount` specifications of the private dependency volumes. */
  readonly dependencyMounts: readonly string[];
  /** The main container's `--user uid:gid` flag text, or '' for the image user. */
  readonly userFlag: string;
}

/**
 * The preparation script. It is launcher-generated text; the only
 * project-controlled step in it is `bun install` itself.
 */
function buildSourceDependencyPreparationScript(): string {
  return [
    'if [ ! -f package.json ] || [ ! -f bun.lock ]; then',
    `  exit ${EXIT_MISSING_MANIFEST}`,
    'fi',
    'if ! command -v bun >/dev/null 2>&1; then',
    `  exit ${EXIT_MISSING_BUN}`,
    'fi',
    'if ! bun install --no-save; then',
    '  exit 1',
    'fi',
  ].join(NL);
}

/**
 * The command the preparation container runs. It disables implicit Bash
 * startup files and strips BASH_ENV, as the main entrypoint does.
 */
export function buildSourceDependencyPreparationCommand(): string[] {
  return [
    'env',
    '-u',
    'BASH_ENV',
    'bash',
    '--noprofile',
    '--norc',
    '-c',
    buildSourceDependencyPreparationScript(),
  ];
}

function currentUserArgs(userFlag: string): string[] {
  const parts = userFlag.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== '--user') return [];
  return ['--user', parts[1], '--env', `HOME=${CURRENT_USER_INSTALL_HOME}`];
}

/**
 * Argv of the preparation run (without the engine name). Everything here is
 * an explicit allow-list: the workspace binds, the dependency volumes, the
 * policy flags the main container also gets, the network settings and the
 * user's SANDBOX_ENV. The capability mount, the credential socket, the SSH
 * agent, the config directory, the session directory, the Git config mounts
 * and the host passthrough variables are not built here at all, so no later
 * addition to the main container's argv can leak into this one.
 */
export function buildSourceDependencyPreparationRunArgs(
  plan: SourceDependencyPreparationPlan,
): string[] {
  const args = [
    'run',
    '--rm',
    '--init',
    '--workdir',
    plan.containerWorkdir,
    ...buildContainerPolicyArgs(),
    ...currentUserArgs(plan.userFlag),
  ];
  // The same last-wins order as the main container: the proxied network, when
  // configured, replaces a network-off setting from the policy flags.
  const proxyEnv = buildProxiedNetworkEnvArgs();
  if (proxyEnv.length > 0) {
    args.push(...proxyEnv, '--network', SANDBOX_INTERNAL_NETWORK_NAME);
  }
  args.push(...buildUserSandboxEnvArgs());
  addSandboxOwnershipLabels(args);
  addSandboxDependencyRunLabel(args, plan.runId);
  args.push('--name', plan.containerName);
  args.push('--volume', `${plan.workdir}:${plan.containerWorkdir}`);
  for (const includeRoot of plan.includeRoots) {
    args.push('--volume', `${includeRoot}:${getContainerPath(includeRoot)}`);
  }
  for (const mount of plan.dependencyMounts) {
    args.push('--mount', mount);
  }
  args.push(plan.image, ...buildSourceDependencyPreparationCommand());
  return args;
}

/**
 * The preparation plan for this launch, or undefined when the workspace is
 * not a positively identified source checkout (the same predicate that
 * selects the checked-out source command, so an arbitrary repository never
 * gets a preparation run). A source checkout without private dependency
 * volumes fails the launch: installing into the shared workspace bind would
 * write Linux binaries into the host's node_modules.
 */
export function planSourceDependencyPreparation(
  config: { readonly command: string; readonly image: string },
  workspacePlan: ContainerWorkspacePlan,
  volumes: DependencyPreparationVolumes | undefined,
  userFlag: string,
): SourceDependencyPreparationPlan | undefined {
  if (!isSourceDevelopmentWorkdir(workspacePlan.primaryRoot)) return undefined;
  if (config.command !== 'docker' && config.command !== 'podman') {
    throw new FatalSandboxError(
      `Source-checkout dependency preparation requires Docker or Podman, not '${config.command}'.`,
    );
  }
  if (volumes === undefined) {
    throw new FatalSandboxError(
      `${SOURCE_PREPARATION_FAILED_MESSAGE}: no private dependency volumes were planned for this launch.`,
    );
  }
  return {
    engine: config.command,
    image: config.image,
    containerName: volumes.containerName,
    runId: volumes.runId,
    workdir: workspacePlan.primaryRoot,
    containerWorkdir: getContainerPath(workspacePlan.primaryRoot),
    includeRoots: workspacePlan.includeRoots,
    dependencyMounts: volumes.mounts,
    userFlag,
  };
}

function failureForExit(
  engine: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): FatalSandboxError {
  if (code === EXIT_MISSING_MANIFEST) {
    return new FatalSandboxError(SOURCE_PREPARATION_MISSING_MANIFEST_MESSAGE);
  }
  if (code === EXIT_MISSING_BUN) {
    return new FatalSandboxError(SOURCE_PREPARATION_MISSING_BUN_MESSAGE);
  }
  const how = signal === null ? `exit status ${code}` : `signal ${signal}`;
  return new FatalSandboxError(
    `${SOURCE_PREPARATION_FAILED_MESSAGE} (${engine} run ended with ${how}).`,
  );
}

/**
 * Runs the preparation container and resolves when it exits cleanly. The
 * installer's output goes to the terminal as it did when it ran in the main
 * container; stdin is closed. A failed run rejects with the message the
 * entrypoint used to print. The container is `--rm`, and the dependency
 * volume lifecycle also removes it by name on every release path.
 */
export function runSourceDependencyPreparation(
  plan: SourceDependencyPreparationPlan,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        plan.engine,
        buildSourceDependencyPreparationRunArgs(plan),
        {
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      );
    } catch (error) {
      reject(startFailure(plan.engine, error));
      return;
    }
    child.once('error', (error) => reject(startFailure(plan.engine, error)));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(failureForExit(plan.engine, code, signal));
    });
  });
}

function startFailure(engine: string, error: unknown): FatalSandboxError {
  const detail = error instanceof Error ? error.message : String(error);
  return new FatalSandboxError(
    `${SOURCE_PREPARATION_FAILED_MESSAGE}: could not start the ${engine} preparation container: ${detail}`,
  );
}

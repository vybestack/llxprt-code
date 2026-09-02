/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persistent engine-owned checkpoint storage for the container sandbox
 * (#3464).
 *
 * The entrypoint pins the container data/log homes under the container's
 * ephemeral `$HOME`, so the checkpoint shadow Git repository and the
 * `/restore` metadata JSONs die with the `--rm` container. This module
 * provisions one engine-owned named volume per project and hands it to the
 * main container at a neutral path; the entrypoint then links the pinned
 * history and checkpoint directories into that volume, so checkpoint state
 * survives container exit and any later sandbox run of the same project
 * restores from the same history.
 *
 * The volume is deliberately NOT lifecycle-managed: it is persistent state,
 * never removed on session end, launch failure, or crash recovery. It is
 * labeled distinctly (and never carries the per-run dependency or process
 * owner labels) so the #3450 dependency reclamation and any future stale-run
 * cleanup (#3470) cannot mistake it for run-scoped storage.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { getContainerPath } from './sandbox-env.js';
import {
  runEngineCommand,
  engineFailureDetail,
  buildVolumeMountFlagArg,
  VOLUME_OPERATION_TIMEOUT_MS,
  INIT_RUN_TIMEOUT_MS,
} from './sandbox-dependency-volumes.js';
import { addSandboxOwnershipLabels } from './sandbox-owner-labels.js';

export const CHECKPOINT_VOLUME_NAME_PREFIX = 'sandbox-checkpoints-';
export const SANDBOX_CHECKPOINT_STORE_LABEL =
  'com.vybestack.llxprt.sandbox-checkpoint-store';
export const SANDBOX_CHECKPOINT_PERSISTENT_LABEL =
  'com.vybestack.llxprt.sandbox-checkpoint-persistent';
/** Neutral image path: outside the workspace bind and the container home. */
export const CHECKPOINT_STORE_MOUNT_PATH =
  '/var/lib/llxprt-sandbox/checkpoints';
export const SANDBOX_CHECKPOINT_PROJECT_KEY_ENV = 'LLXPRT_SANDBOX_PROJECT_KEY';
export const SANDBOX_CHECKPOINT_STORE_ENV = 'LLXPRT_SANDBOX_CHECKPOINT_STORE';

/**
 * Marker filename contract shared with GitService's
 * CHECKPOINT_STORE_MARKER_FILENAME (core): the init container writes it into
 * the store's per-project history dir and the in-container GitService (plus
 * the entrypoint gate) proves persistence from it. The real-engine
 * integration suite boots the image built from this tree, so drift between
 * the two constants fails that suite.
 */
export const CHECKPOINT_STORE_MARKER_FILENAME = '.llxprt-checkpoint-store';

const INIT_DESTINATION = '/tmp/llxprt-checkpoint-init';

/**
 * The in-container CLI resolves its history dir as
 * `LLXPRT_DATA_HOME/history/<sha256(project root)>` (Storage's
 * getProjectHistoryKey); the container project root equals the host workdir
 * because the workspace binds at path parity. Computed here (not imported
 * across packages) with the identical algorithm so the CLI package keeps
 * working against already-released core/settings versions.
 */
function projectHistoryKey(workdir: string): string {
  return createHash('sha256').update(workdir).digest('hex');
}

export interface CheckpointStoragePlan {
  readonly enabled: boolean;
  readonly projectKey: string;
  readonly volumeName: string;
}

const DISABLED_CHECKPOINT_PLAN: CheckpointStoragePlan = {
  enabled: false,
  projectKey: '',
  volumeName: '',
};

export function planCheckpointStorage(
  config: SandboxConfig,
  workdir: string,
  checkpointingEnabled: boolean,
): CheckpointStoragePlan {
  if (!checkpointingEnabled) return DISABLED_CHECKPOINT_PLAN;
  if (config.command !== 'docker' && config.command !== 'podman') {
    return DISABLED_CHECKPOINT_PLAN;
  }
  const projectKey = projectHistoryKey(getContainerPath(workdir));
  return {
    enabled: true,
    projectKey,
    volumeName: `${CHECKPOINT_VOLUME_NAME_PREFIX}${projectKey}`,
  };
}

function buildCheckpointVolumeCreateArgs(
  volumeName: string,
  projectKey: string,
): string[] {
  // Managed-label only: owner labels are process-scoped and the dependency
  // run label is per-run; either would let cleanup logic treat persistent
  // checkpoint history as reclaimable run-scoped storage.
  return [
    'volume',
    'create',
    '--label',
    'com.vybestack.llxprt.sandbox-managed=true',
    '--label',
    `${SANDBOX_CHECKPOINT_STORE_LABEL}=${projectKey}`,
    '--label',
    `${SANDBOX_CHECKPOINT_PERSISTENT_LABEL}=true`,
    volumeName,
  ];
}

/**
 * The init script materializes the store layout, normalizes permissions for
 * arbitrary selected uids, and writes the marker GitService later verifies.
 * Every launch re-runs it. Unlike /tmp, the shared directories are NOT
 * sticky: git must rename lockfiles over entries a previous uid created
 * (`.git/index`, refs, `COMMIT_EDITMSG`), and the sticky bit denies exactly
 * that rename to any uid but the entry's owner, as proven on Docker where a
 * sticky store made a second-uid commit fail with "Unable to write new index
 * file" / "could not open COMMIT_EDITMSG". Only this project's sandbox
 * containers can mount the volume, so /tmp-style anti-deletion protection is
 * not the threat model; cross-uid replace is required behavior.
 */
export function buildCheckpointInitScript(projectKey: string): string {
  return [
    'set -eu',
    'store="$1"',
    `mkdir -p "$store/history/${projectKey}" "$store/checkpoints"`,
    'find "$store" -type d -exec chmod a+rwX {} +',
    'find "$store" -type f -exec chmod a+rw {} +',
    `printf 'llxprt-code persistent checkpoint store\\n' > "$store/history/${projectKey}/${CHECKPOINT_STORE_MARKER_FILENAME}"`,
  ].join('\n');
}

export interface CheckpointInitPlan {
  readonly image: string;
  readonly projectKey: string;
  readonly volumeName: string;
  readonly initContainerName: string;
}

/** Argv for the bounded, hardened uid-0 store init container (#3450 shape). */
export function buildCheckpointInitRunArgs(plan: CheckpointInitPlan): string[] {
  const args: string[] = [
    'run',
    '--rm',
    '--init',
    '--user',
    '0:0',
    '--cap-drop=ALL',
    // FOWNER is the one capability the permission normalization needs: the
    // store's git objects, refs, and index files are owned by whatever uid
    // the PREVIOUS sandbox session ran as, and chmod on files the process
    // does not own requires exactly this capability. Proven on Docker:
    // without it the second launch's init dies with "changing permissions of
    // .../.git/objects: Operation not permitted" and persistence aborts.
    '--cap-add=FOWNER',
    '--security-opt',
    'no-new-privileges',
    '--network',
    'none',
    '--pull=never',
  ];
  // Ownership labels let crash recovery reap a wedged init container; they
  // stay off the volume itself, which must survive that reaping.
  addSandboxOwnershipLabels(args);
  args.push(
    '--label',
    `${SANDBOX_CHECKPOINT_STORE_LABEL}=${plan.projectKey}`,
    '--label',
    `${SANDBOX_CHECKPOINT_PERSISTENT_LABEL}=true`,
  );
  args.push('--name', plan.initContainerName);
  args.push(
    '--mount',
    buildVolumeMountFlagArg(plan.volumeName, INIT_DESTINATION),
  );
  args.push(
    plan.image,
    'sh',
    '-c',
    buildCheckpointInitScript(plan.projectKey),
    'llxprt-checkpoint-init',
    INIT_DESTINATION,
  );
  return args;
}

/**
 * Whether the engine already holds this project's labeled store volume.
 * Reuse is recognized by the checkpoint-store label, not the name alone.
 */
function storeVolumeExists(
  engine: 'docker' | 'podman',
  volumeName: string,
  projectKey: string,
): boolean {
  const result = runEngineCommand(
    engine,
    [
      'volume',
      'ls',
      '--filter',
      `label=${SANDBOX_CHECKPOINT_STORE_LABEL}=${projectKey}`,
      '--format',
      '{{.Name}}',
    ],
    VOLUME_OPERATION_TIMEOUT_MS,
  );
  if (result.status !== 0) return false;
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .includes(volumeName);
}

/**
 * Provisions the persistent checkpoint store volume (creating it on the
 * first run of a project) and appends the mount, env, and label flags for
 * the main container. Throws FatalSandboxError before the main container
 * is spawned when the engine cannot provide persistence. The store volume
 * is never deleted on any path; a failed attach may still hold valid
 * checkpoint history.
 */
export function attachPersistentCheckpointStore(
  config: SandboxConfig,
  args: string[],
  plan: CheckpointStoragePlan,
): void {
  if (!plan.enabled) return;
  const engine = config.command;
  if (engine !== 'docker' && engine !== 'podman') {
    throw new FatalSandboxError(
      `Persistent sandbox checkpoint storage requires Docker or Podman, not '${engine}'.`,
    );
  }

  if (!storeVolumeExists(engine, plan.volumeName, plan.projectKey)) {
    const create = runEngineCommand(
      engine,
      buildCheckpointVolumeCreateArgs(plan.volumeName, plan.projectKey),
      VOLUME_OPERATION_TIMEOUT_MS,
    );
    if (create.status !== 0) {
      throw new FatalSandboxError(
        `Sandbox checkpoint persistence is unavailable: ${engine} failed to create the checkpoint store volume '${plan.volumeName}': ${engineFailureDetail(create)}. Fix the container engine or disable checkpointing rather than presenting checkpoints that could not be restored.`,
      );
    }
  }

  const init = runEngineCommand(
    engine,
    buildCheckpointInitRunArgs({
      image: config.image,
      projectKey: plan.projectKey,
      volumeName: plan.volumeName,
      initContainerName: `${CHECKPOINT_VOLUME_NAME_PREFIX}init-${randomUUID()}`,
    }),
    INIT_RUN_TIMEOUT_MS,
  );
  if (init.status !== 0) {
    throw new FatalSandboxError(
      `Sandbox checkpoint persistence is unavailable: ${engine} failed to initialize the checkpoint store volume '${plan.volumeName}': ${engineFailureDetail(init)}. Fix the container engine or disable checkpointing rather than presenting checkpoints that could not be restored.`,
    );
  }

  args.push(
    '--mount',
    buildVolumeMountFlagArg(plan.volumeName, CHECKPOINT_STORE_MOUNT_PATH),
  );
  args.push(
    '--env',
    `${SANDBOX_CHECKPOINT_PROJECT_KEY_ENV}=${plan.projectKey}`,
  );
  args.push(
    '--env',
    `${SANDBOX_CHECKPOINT_STORE_ENV}=${CHECKPOINT_STORE_MOUNT_PATH}`,
  );
  args.push('--label', `${SANDBOX_CHECKPOINT_STORE_LABEL}=${plan.projectKey}`);
  args.push('--label', `${SANDBOX_CHECKPOINT_PERSISTENT_LABEL}=true`);
}

/**
 * Entrypoint stanza (runs after the XDG home pin): verifies the persistent
 * store is actually mounted for this project (a missing mount must abort
 * the sandbox before the CLI presents checkpointing as available), then
 * links the pinned history and checkpoint metadata directories into the
 * store, following the container's real `$HOME` in both default and
 * current-user (`su -p`) modes. Inert when the host did not provision the
 * store vars; GitService then fails checkpointing explicitly.
 */
export function buildCheckpointEntrypointScript(): string {
  const keyRef = '${' + SANDBOX_CHECKPOINT_PROJECT_KEY_ENV + '}';
  const keyDefaultRef = '${' + SANDBOX_CHECKPOINT_PROJECT_KEY_ENV + ':-}';
  const storeRef = '${' + SANDBOX_CHECKPOINT_STORE_ENV + '}';
  const storeDefaultRef = '${' + SANDBOX_CHECKPOINT_STORE_ENV + ':-}';
  return [
    `if [ -n "${keyDefaultRef}" ] && [ -n "${storeDefaultRef}" ]; then`,
    `  if [ ! -f "${storeRef}/history/${keyRef}/${CHECKPOINT_STORE_MARKER_FILENAME}" ]; then`,
    `    echo "llxprt-code: persistent checkpoint store is not mounted at '${storeRef}' (missing ${CHECKPOINT_STORE_MARKER_FILENAME} for this project); refusing to start with checkpointing enabled" >&2`,
    '    exit 1',
    '  fi',
    '  mkdir -p "$LLXPRT_DATA_HOME" "$LLXPRT_LOG_HOME/tmp"',
    // Link at the history ROOT: the in-container CLI resolves
    // LLXPRT_DATA_HOME/history/<projectKey>, which must land inside the
    // store without an extra nesting level.
    `  ln -sfn "${storeRef}/history" "$LLXPRT_DATA_HOME/history"`,
    `  mkdir -p "$LLXPRT_LOG_HOME/tmp/${keyRef}"`,
    `  ln -sfn "${storeRef}/checkpoints" "$LLXPRT_LOG_HOME/tmp/${keyRef}/checkpoints"`,
    'fi',
  ].join('\n');
}

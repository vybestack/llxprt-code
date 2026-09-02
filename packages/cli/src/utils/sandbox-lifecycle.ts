/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '@vybestack/llxprt-code-telemetry';

/**
 * Explicit ownership registry for every resource acquired while preparing and
 * launching a container sandbox (#3469).
 *
 * Each acquisition registers its release here at the acquisition boundary.
 * The registry has exactly two terminal transitions:
 *
 * - a failed preparation/launch drains every owned resource through
 *   `releaseForFailedLaunch()` — the single failure path — releasing each
 *   resource exactly once in the stage order below; or
 * - a successful launch calls `transferToProcessHandlers()` once the normal
 *   process/close handlers are wired, explicitly moving ownership to them.
 *
 * The stage order is the container-before-volume guarantee: every container
 * (main engine container, proxy sidecar, and the credential proxy that hosts
 * containers) is released before the engine-owned dependency volumes, because
 * an engine volume in use by a live container cannot be removed.
 */
export const SANDBOX_RELEASE_STAGE_ORDER = [
  'main-container',
  'proxy-sidecar',
  'credential-proxy',
  'tunnel',
  'session-tmpdir',
  'dependency-volume',
] as const;

export type SandboxReleaseStage = (typeof SANDBOX_RELEASE_STAGE_ORDER)[number];

interface OwnedSandboxResource {
  readonly stage: SandboxReleaseStage;
  readonly description: string;
  readonly release: () => void;
}

function warnReleaseFailed(description: string, error: unknown): void {
  const message =
    `Warning: failed to release ${description}: ` +
    `${error instanceof Error ? error.message : String(error)}\n`;
  debugLogger.error(message);
  process.stderr.write(message);
}

export class SandboxLaunchLifecycle {
  private resources: OwnedSandboxResource[] = [];
  private drained = false;
  private readonly releasedDescriptions: string[] = [];

  /**
   * Takes ownership of a resource. `release` may be undefined when the
   * acquisition step produced nothing releasable (for example an SSH agent
   * setup that skipped forwarding); such acquisitions are not owned.
   */
  own(
    stage: SandboxReleaseStage,
    description: string,
    release: (() => void) | undefined,
  ): void {
    if (this.drained) {
      throw new Error(
        `Cannot own '${description}' after the launch lifecycle was drained.`,
      );
    }
    if (release === undefined) return;
    this.resources.push({ stage, description, release });
  }

  /**
   * Successful launch: the wired process/close handlers now own every
   * resource. Spends this lifecycle without releasing anything.
   */
  transferToProcessHandlers(): void {
    this.drained = true;
    this.resources = [];
  }

  /**
   * Failed preparation/launch: releases every owned resource, each exactly
   * once, in stage order (containers before volumes), in acquisition order
   * within a stage. Never throws: a failing release is written to stderr so
   * it stays visible without replacing the original launch error, and the
   * drain continues with the remaining resources.
   */
  releaseForFailedLaunch(): void {
    if (this.drained) return;
    this.drained = true;
    const ordered = SANDBOX_RELEASE_STAGE_ORDER.flatMap((stage) =>
      this.resources.filter((resource) => resource.stage === stage),
    );
    this.resources = [];
    for (const resource of ordered) {
      try {
        resource.release();
        this.releasedDescriptions.push(resource.description);
        debugLogger.log(
          `Released ${resource.description} after failed launch.`,
        );
      } catch (error) {
        warnReleaseFailed(resource.description, error);
      }
    }
  }

  /** Descriptions of the resources this registry released, in release order. */
  releasedResources(): readonly string[] {
    return this.releasedDescriptions;
  }
}

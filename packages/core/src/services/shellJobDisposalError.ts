/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structured information about a surviving process tree that dispose() could
 * not kill. Each entry carries the job id, its pid, and the exact remediation
 * command a human can run to force-kill the tree.
 */
export interface SurvivorInfo {
  readonly id: string;
  readonly pid: number | undefined;
  readonly remediation: string;
}

/**
 * Thrown by ShellJobManager.dispose when one or more Windows process trees
 * could not be killed after bounded retry. The error carries surviving job
 * details and any tree-termination failures encountered during disposal.
 */
export class ShellJobDisposalError extends Error {
  readonly survivors: readonly SurvivorInfo[];
  readonly killFailures: readonly Error[];

  constructor(
    survivors: readonly SurvivorInfo[],
    killFailures: readonly Error[] = [],
  ) {
    const lines = survivors
      .map(
        (survivor) =>
          `  job ${survivor.id} (pid ${survivor.pid}): ${survivor.remediation}`,
      )
      .join('\n');
    const failureDetails =
      killFailures.length === 0
        ? ''
        : `\nTree termination failures:\n${killFailures.map((error) => `  ${error.message}`).join('\n')}`;
    super(
      `dispose() could not kill ${survivors.length} surviving process tree(s):\n${lines}${failureDetails}`,
    );
    this.name = 'ShellJobDisposalError';
    this.survivors = survivors;
    this.killFailures = killFailures;
  }
}

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class McpConstructionResources {
  private releases: ReadonlyArray<() => void | Promise<void>> = [];

  retain(release: () => void | Promise<void>): void {
    this.releases = [...this.releases, release];
  }

  async reject(primary: unknown): Promise<never> {
    const failures: unknown[] = [];
    for (const release of [...this.releases].reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        [primary, ...failures],
        'MCP construction cleanup failed',
      );
    throw primary;
  }
}

export function settleMcpClosures(
  releases: ReadonlyArray<() => void | Promise<void>>,
): Promise<Array<PromiseSettledResult<void>>> {
  return Promise.allSettled(
    releases.map(async (release): Promise<void> => {
      await release();
    }),
  );
}

export async function joinMcpRetirementOperations(
  operations: ReadonlyArray<Promise<void> | undefined>,
): Promise<unknown[]> {
  const results = await Promise.allSettled(operations);
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}

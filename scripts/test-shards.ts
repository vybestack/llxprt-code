/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for CI test sharding (issue #2707).
 *
 * The root test command used to run all workspaces sequentially, so CI
 * wall-clock was the *sum* of every package's test time. Sharding splits the
 * suite into parallel CI jobs so the critical path becomes *max(shard)*.
 *
 * This module owns:
 *   - the shard → workspace assignment map,
 *   - helpers to expand a shard name to its workspace identifiers,
 *   - a coverage validator used by `scripts/check-test-shards.ts` to fail CI
 *     if a workspace is added without being assigned to a shard.
 *
 * Workspace identifiers are the **last path segment** of each workspace
 * (`packages/cli` → `cli`), matching how `scripts/test.ts` `matchesFilter`
 * resolves `--workspace <name>`.
 *
 * The `scripts` shard is special: it runs `npm run test:scripts` (the root
 * script harness) and owns no workspaces, so it is excluded from coverage
 * checks.
 */

/** A workspace identifier is the last path segment of a workspace dir. */
export type WorkspaceId = string;

export interface ShardDefinition {
  /** Unique shard name; also the CI matrix value and `--shard` argument. */
  readonly name: string;
  /** Workspace ids (last path segment) this shard owns. Empty for scripts. */
  readonly workspaces: readonly WorkspaceId[];
  /**
   * True for the special script-harness shard that runs `npm run
   * test:scripts`. Such shards own no workspaces and are excluded from
   * coverage validation.
   */
  readonly isScriptsShard?: boolean;
}

/**
 * The canonical shard map. Keep this in sync with the `shard` matrix in
 * `.github/workflows/ci.yml` — `scripts/check-test-shards.ts` enforces that
 * every declared workspace is assigned to exactly one non-scripts shard.
 *
 * Shard sizing rationale (durations from CI run 30167877866):
 *   cli       ~703s   (its own shard; paired with the separate cli cost issue)
 *   agents    ~289s
 *   providers ~185s
 *   core      ~130s
 *   rest      ~55s    (12 small packages combined)
 *   scripts   ~270s   (root script harness, runs in parallel as its own job)
 */
export const TEST_SHARDS: readonly ShardDefinition[] = [
  {
    name: 'cli',
    workspaces: ['cli'],
  },
  {
    name: 'agents',
    workspaces: ['agents'],
  },
  {
    name: 'providers',
    workspaces: ['providers'],
  },
  {
    name: 'core',
    workspaces: ['core'],
  },
  {
    name: 'rest',
    workspaces: [
      'zed-acp',
      'tools',
      'storage',
      'auth',
      'settings',
      'telemetry',
      'ide-integration',
      'policy',
      'mcp',
      'lsp',
      'test-utils',
      'a2a-server',
      'vscode-ide-companion',
    ],
  },
  {
    name: 'scripts',
    workspaces: [],
    isScriptsShard: true,
  },
];

/** Name of the special script-harness shard. */
export const SCRIPTS_SHARD_NAME = 'scripts';

/**
 * Returns the definition for a shard name, or `undefined` if unknown.
 */
export function findShard(
  shards: readonly ShardDefinition[],
  name: string,
): ShardDefinition | undefined {
  return shards.find((s) => s.name === name);
}

/**
 * All shard names, in declared order.
 */
export function getAllShardNames(
  shards: readonly ShardDefinition[] = TEST_SHARDS,
): readonly string[] {
  return shards.map((s) => s.name);
}

/**
 * The workspace ids assigned across all non-scripts shards (the set that must
 * equal the declared workspaces for coverage to pass).
 */
export function getAllAssignedWorkspaceIds(
  shards: readonly ShardDefinition[] = TEST_SHARDS,
): readonly WorkspaceId[] {
  return shards.flatMap((s) => (s.isScriptsShard ? [] : s.workspaces));
}

/**
 * Expands a shard name to its owned workspace ids. Returns an empty array for
 * the scripts shard (the caller runs `npm run test:scripts` instead). Throws
 * if the shard name is unknown so a typo cannot silently run nothing.
 *
 * Returns a defensive copy so callers cannot mutate the canonical shard map
 * at runtime (TypeScript's `readonly` is compile-time only).
 */
export function expandShard(
  shards: readonly ShardDefinition[],
  name: string,
): readonly WorkspaceId[] {
  const shard = findShard(shards, name);
  if (!shard) {
    const known = getAllShardNames(shards).join(', ');
    throw new Error(`Unknown shard "${name}". Known shards: ${known}.`);
  }
  return shard.isScriptsShard ? [] : [...shard.workspaces];
}

// ---------------------------------------------------------------------------
// Coverage validation
// ---------------------------------------------------------------------------

export type ShardCoverageIssueKind =
  | 'duplicate-shard-name'
  | 'empty-shard'
  | 'duplicate-workspace'
  | 'unknown-workspace'
  | 'missing-workspace';

export interface ShardCoverageIssue {
  readonly kind: ShardCoverageIssueKind;
  readonly detail: string;
}

export interface ShardCoverageResult {
  readonly issues: readonly ShardCoverageIssue[];
  readonly ok: boolean;
}

/**
 * Validates that the shard assignment covers every declared workspace exactly
 * once, with no duplicates, unknowns, or empty non-scripts shards. The
 * `scripts` shard is excluded (it owns no workspaces).
 *
 * @param shards the shard definitions to validate.
 * @param declaredWorkspaceIds the last-path-segment id of every workspace
 *   declared in the root package.json `workspaces` array that actually exists
 *   on disk (i.e. discovered by `scripts/test.ts`).
 */
export function validateShardCoverage(
  shards: readonly ShardDefinition[],
  declaredWorkspaceIds: readonly string[],
): ShardCoverageResult {
  const issues: ShardCoverageIssue[] = [];

  // 1. Duplicate shard names.
  const seenNames = new Set<string>();
  for (const shard of shards) {
    if (seenNames.has(shard.name)) {
      issues.push({
        kind: 'duplicate-shard-name',
        detail: `Shard name "${shard.name}" is declared more than once.`,
      });
    }
    seenNames.add(shard.name);
  }

  // 2. Non-scripts shards must not be empty.
  for (const shard of shards) {
    if (!shard.isScriptsShard && shard.workspaces.length === 0) {
      issues.push({
        kind: 'empty-shard',
        detail: `Shard "${shard.name}" owns no workspaces. Assign workspaces or mark it isScriptsShard.`,
      });
    }
  }

  // 3. Collect assignments (excluding scripts shard), detect intra/across
  //    duplicates and unknown ids.
  const declared = new Set(declaredWorkspaceIds);
  const assignedCounts = new Map<string, number>();
  for (const shard of shards) {
    if (shard.isScriptsShard) {
      continue;
    }
    for (const id of shard.workspaces) {
      assignedCounts.set(id, (assignedCounts.get(id) ?? 0) + 1);
    }
  }

  for (const [id, count] of assignedCounts) {
    if (count > 1) {
      issues.push({
        kind: 'duplicate-workspace',
        detail: `Workspace "${id}" appears ${count} times across all shards; each workspace must belong to exactly one shard.`,
      });
    }
    if (!declared.has(id)) {
      issues.push({
        kind: 'unknown-workspace',
        detail: `Shard map references workspace "${id}", but no such workspace is declared in package.json.`,
      });
    }
  }

  // 4. Missing: declared but not assigned to any shard. Iterate over the
  //    deduplicated `declared` set to avoid duplicate messages if the caller
  //    passes the same workspace id more than once.
  const assigned = new Set(assignedCounts.keys());
  const sortedDeclared = [...declared].sort();
  for (const id of sortedDeclared) {
    if (!assigned.has(id)) {
      issues.push({
        kind: 'missing-workspace',
        detail: `Workspace "${id}" is declared in package.json but is not assigned to any shard. Add it to a shard in scripts/test-shards.ts.`,
      });
    }
  }

  return { issues, ok: issues.length === 0 };
}

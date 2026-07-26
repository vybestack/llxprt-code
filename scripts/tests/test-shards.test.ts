/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TEST_SHARDS,
  SCRIPTS_SHARD_NAME,
  findShard,
  getAllAssignedWorkspaceIds,
  getAllShardNames,
  expandShard,
  validateShardCoverage,
  type ShardDefinition,
} from '../test-shards.ts';

const repoRoot = resolve(__dirname, '..', '..');

function readDeclaredWorkspaceIds(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  ) as { workspaces?: string[] };
  return (pkg.workspaces ?? [])
    .filter((g) => existsSync(join(repoRoot, g, 'package.json')))
    .map((g) => g.split('/').pop() ?? g);
}

// ---------------------------------------------------------------------------
// Canonical shard map (TEST_SHARDS)
// ---------------------------------------------------------------------------

describe('TEST_SHARDS — canonical map', () => {
  it('contains a scripts shard', () => {
    const scripts = findShard(TEST_SHARDS, SCRIPTS_SHARD_NAME);
    expect(scripts).toBeDefined();
    expect(scripts?.isScriptsShard).toBe(true);
    expect(scripts?.workspaces).toEqual([]);
  });

  it('does not assign any workspace to more than one shard', () => {
    const assigned = getAllAssignedWorkspaceIds();
    const unique = new Set(assigned);
    expect(assigned.length).toBe(unique.size);
  });

  it('covers every declared workspace exactly once', () => {
    // The core invariant of issue #2707: a workspace added without being
    // assigned to a shard must fail CI. This test pins that against the real
    // repo so a future package addition trips this test (and the CI guard).
    const declared = readDeclaredWorkspaceIds();
    const assigned = new Set(getAllAssignedWorkspaceIds());

    expect([...assigned].sort()).toEqual([...declared].sort());
  });

  it('has no empty non-scripts shards', () => {
    for (const shard of TEST_SHARDS) {
      if (!shard.isScriptsShard) {
        expect(
          shard.workspaces.length,
          `shard "${shard.name}" must own workspaces`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('has unique shard names', () => {
    const names = getAllShardNames();
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// findShard / getAllShardNames / getAllAssignedWorkspaceIds
// ---------------------------------------------------------------------------

describe('findShard', () => {
  it('returns the definition for a known shard', () => {
    const cli = findShard(TEST_SHARDS, 'cli');
    expect(cli?.workspaces).toEqual(['cli']);
  });

  it('returns undefined for an unknown shard', () => {
    expect(findShard(TEST_SHARDS, 'nope')).toBeUndefined();
  });
});

describe('getAllShardNames', () => {
  it('returns all shard names in declared order', () => {
    expect(getAllShardNames()).toEqual(TEST_SHARDS.map((s) => s.name));
  });
});

describe('getAllAssignedWorkspaceIds', () => {
  it('excludes the scripts shard workspaces', () => {
    const assigned = getAllAssignedWorkspaceIds();
    expect(assigned.length).toBeGreaterThan(0);
    // scripts shard owns no workspaces, so excluding it is a no-op, but the
    // contract must hold even if a scripts shard were given placeholders.
    expect(assigned).not.toContain(undefined);
  });
});

// ---------------------------------------------------------------------------
// expandShard
// ---------------------------------------------------------------------------

describe('expandShard', () => {
  it('returns the workspaces for a multi-workspace shard', () => {
    const rest = expandShard(TEST_SHARDS, 'rest');
    expect(rest.length).toBeGreaterThan(1);
    expect(rest).toContain('tools');
    expect(rest).toContain('vscode-ide-companion');
  });

  it('returns an empty array for the scripts shard', () => {
    expect(expandShard(TEST_SHARDS, SCRIPTS_SHARD_NAME)).toEqual([]);
  });

  it('throws on an unknown shard name', () => {
    expect(() => expandShard(TEST_SHARDS, 'ghost')).toThrow(
      /Unknown shard "ghost"/u,
    );
  });
});

// ---------------------------------------------------------------------------
// validateShardCoverage
// ---------------------------------------------------------------------------

const baseShards: ShardDefinition[] = [
  { name: 'a', workspaces: ['pkg-a'] },
  { name: 'b', workspaces: ['pkg-b'] },
];

describe('validateShardCoverage', () => {
  it('passes when every declared workspace is assigned exactly once', () => {
    const result = validateShardCoverage(baseShards, ['pkg-a', 'pkg-b']);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('ignores the scripts shard for coverage', () => {
    const shards: ShardDefinition[] = [
      ...baseShards,
      { name: SCRIPTS_SHARD_NAME, workspaces: [], isScriptsShard: true },
    ];
    const result = validateShardCoverage(shards, ['pkg-a', 'pkg-b']);
    expect(result.ok).toBe(true);
  });

  it('reports a missing workspace', () => {
    const result = validateShardCoverage(baseShards, [
      'pkg-a',
      'pkg-b',
      'pkg-c',
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'missing-workspace')).toBe(
      true,
    );
    expect(result.issues.some((i) => i.detail.includes('pkg-c'))).toBe(true);
  });

  it('reports an unknown workspace (assigned but not declared)', () => {
    const result = validateShardCoverage(baseShards, ['pkg-a']);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'unknown-workspace')).toBe(
      true,
    );
    expect(result.issues.some((i) => i.detail.includes('pkg-b'))).toBe(true);
  });

  it('reports a duplicate workspace assignment', () => {
    const shards: ShardDefinition[] = [
      { name: 'a', workspaces: ['pkg-a', 'pkg-x'] },
      { name: 'b', workspaces: ['pkg-x'] },
    ];
    const result = validateShardCoverage(shards, ['pkg-a', 'pkg-x']);
    expect(result.ok).toBe(false);
    const dup = result.issues.find((i) => i.kind === 'duplicate-workspace');
    expect(dup).toBeDefined();
    expect(dup?.detail).toContain('pkg-x');
  });

  it('reports a duplicate shard name', () => {
    const shards: ShardDefinition[] = [
      { name: 'a', workspaces: ['pkg-a'] },
      { name: 'a', workspaces: ['pkg-b'] },
    ];
    const result = validateShardCoverage(shards, ['pkg-a', 'pkg-b']);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'duplicate-shard-name')).toBe(
      true,
    );
  });

  it('reports an empty non-scripts shard', () => {
    const shards: ShardDefinition[] = [
      { name: 'a', workspaces: ['pkg-a', 'pkg-b'] },
      { name: 'b', workspaces: [] },
    ];
    const result = validateShardCoverage(shards, ['pkg-a', 'pkg-b']);
    expect(result.ok).toBe(false);
    const empty = result.issues.find((i) => i.kind === 'empty-shard');
    expect(empty).toBeDefined();
    expect(empty?.detail).toContain('"b"');
  });

  it('reports multiple issues at once', () => {
    // shard a assigns pkg-a twice (duplicate) and pkg-q (unknown, not
    // declared); shard b is empty; pkg-z is declared but unassigned (missing).
    const shards: ShardDefinition[] = [
      { name: 'a', workspaces: ['pkg-a', 'pkg-a', 'pkg-q'] },
      { name: 'b', workspaces: [] },
    ];
    const result = validateShardCoverage(shards, ['pkg-a', 'pkg-z']);
    expect(result.ok).toBe(false);
    const kinds = new Set(result.issues.map((i) => i.kind));
    expect(kinds.has('duplicate-workspace')).toBe(true);
    expect(kinds.has('empty-shard')).toBe(true);
    expect(kinds.has('unknown-workspace')).toBe(true);
    expect(kinds.has('missing-workspace')).toBe(true);
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the heap analyzer (scripts/memory/heapanalyze.ts).
 * Tiny synthetic V8-format snapshots exercise structural validation, weak-edge
 * exclusion, and retainer-path proof statuses — no multi-gigabyte real
 * snapshot required.
 */

import { describe, expect, it } from 'bun:test';
import {
  type RetainerStatus,
  SnapshotFormatError,
  analyzeSnapshot,
  renderAnalysis,
  validateSnapshotStructure,
} from '../../memory/heapanalyze.ts';

const NODE_FIELDS = ['type', 'name', 'id', 'self_size', 'edge_count'];
const NODE_TYPES = [
  ['object', 'array', 'string', 'closure'],
  'string',
  'number',
  'number',
  'number',
];
const EDGE_FIELDS = ['type', 'name_or_index', 'to_node'];
const EDGE_TYPES = [
  ['context', 'element', 'property', 'hidden', 'weak'],
  'string_or_number',
  'number',
];
const NODE_LEN = NODE_FIELDS.length;
const MB = 1024 * 1024;

interface Fixture {
  nodeCount: number;
  edgeCount: number;
  nodes: readonly number[];
  edges: readonly number[];
  strings: readonly string[];
}

function buildFixture(f: Fixture): unknown {
  return {
    snapshot: {
      node_count: f.nodeCount,
      edge_count: f.edgeCount,
      meta: {
        node_fields: NODE_FIELDS,
        node_types: NODE_TYPES,
        edge_fields: EDGE_FIELDS,
        edge_types: EDGE_TYPES,
      },
    },
    nodes: f.nodes,
    edges: f.edges,
    strings: f.strings,
  };
}

function buildSnapshot(
  nodes: readonly number[],
  edges: readonly number[],
  strings: readonly string[],
): unknown {
  return buildFixture({
    nodeCount: nodes.length / NODE_LEN,
    edgeCount: edges.length / EDGE_FIELDS.length,
    nodes,
    edges,
    strings,
  });
}

const OPTIONS = { top: 10, minBytes: MB, maxRetainerDepth: 12 };

describe('validateSnapshotStructure — deep consistency checks', () => {
  it('accepts a well-formed snapshot', () => {
    const snap = buildSnapshot([0, 0, 1, 0, 0], [], ['root']);
    expect(() => validateSnapshotStructure(snap)).not.toThrow();
  });

  it('rejects a missing nodes array', () => {
    const snap = buildSnapshot([0, 0, 1, 0, 0], [], ['root']) as Record<
      string,
      unknown
    >;
    delete snap['nodes'];
    expect(() => validateSnapshotStructure(snap)).toThrow(SnapshotFormatError);
  });

  it('rejects non-integer/negative node_count', () => {
    const bad = buildFixture({
      nodeCount: 1.5,
      edgeCount: 0,
      nodes: [],
      edges: [],
      strings: [],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(/node_count/);
  });

  it('rejects a nodes array whose length violates the declared stride', () => {
    const bad = buildFixture({
      nodeCount: 2,
      edgeCount: 0,
      nodes: [0, 0, 1, 0, 0], // 5 numbers cannot be 2 nodes x 5 fields
      edges: [],
      strings: [],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /nodes length .* does not match node_count/,
    );
  });

  it('rejects an edges array whose length violates the declared stride', () => {
    const bad = buildFixture({
      nodeCount: 1,
      edgeCount: 1,
      nodes: [0, 0, 1, 0, 1],
      edges: [2, 0], // 2 numbers cannot be 1 edge x 3 fields
      strings: ['root'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /edges length .* does not match edge_count/,
    );
  });

  it('rejects per-node edge counts that do not sum to edge_count', () => {
    // Node declares 2 outgoing edges but edge_count says 1.
    const bad = buildFixture({
      nodeCount: 1,
      edgeCount: 1,
      nodes: [0, 0, 1, 0, 2],
      edges: [2, 1, 5],
      strings: ['root', 'x'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /sum to .* not the declared edge_count/,
    );
  });

  it('rejects an unaligned or out-of-range to_node', () => {
    const misaligned = buildFixture({
      nodeCount: 2,
      edgeCount: 1,
      nodes: [0, 0, 1, 0, 1, 0, 1, 2, 0, 0],
      edges: [2, 1, 4], // 4 % 5 !== 0
      strings: ['root', 'x'],
    });
    expect(() => validateSnapshotStructure(misaligned)).toThrow(
      /not stride-aligned or is outside/,
    );
    const outOfRange = buildFixture({
      nodeCount: 2,
      edgeCount: 1,
      nodes: [0, 0, 1, 0, 1, 0, 1, 2, 0, 0],
      edges: [2, 1, 99],
      strings: ['root', 'x'],
    });
    expect(() => validateSnapshotStructure(outOfRange)).toThrow(
      /not stride-aligned or is outside/,
    );
  });

  it('rejects node type indexes outside the enum', () => {
    const bad = buildFixture({
      nodeCount: 1,
      edgeCount: 0,
      nodes: [99, 0, 1, 0, 0], // type 99 not in enum
      edges: [],
      strings: ['root'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /type index .* outside the node type enum/,
    );
  });

  it('rejects node name indexes outside the strings table', () => {
    const bad = buildFixture({
      nodeCount: 1,
      edgeCount: 0,
      nodes: [0, 42, 1, 0, 0],
      edges: [],
      strings: ['root'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /name index .* outside the strings table/,
    );
  });

  it('rejects a negative or nonfinite self_size', () => {
    const bad = buildFixture({
      nodeCount: 1,
      edgeCount: 0,
      nodes: [0, 0, 1, -5, 0],
      edges: [],
      strings: ['root'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(/self_size/);
  });

  it('rejects an element edge whose name_or_index is not an integer slot', () => {
    const bad = buildFixture({
      nodeCount: 2,
      edgeCount: 1,
      nodes: [0, 0, 1, 0, 1, 0, 1, 2, 0, 0],
      edges: [1, 3.5, 5], // element edge with a fractional slot
      strings: ['root', 'x'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /name_or_index .* must be a nonnegative integer/,
    );
  });

  it('rejects a property edge whose name index is outside the strings table', () => {
    const bad = buildFixture({
      nodeCount: 2,
      edgeCount: 1,
      nodes: [0, 0, 1, 0, 1, 0, 1, 2, 0, 0],
      edges: [2, 99, 5],
      strings: ['root', 'x'],
    });
    expect(() => validateSnapshotStructure(bad)).toThrow(
      /name_or_index .* outside the strings table/,
    );
  });

  it('rejects missing required metadata fields', () => {
    const metaMissing = buildSnapshot([0, 0, 1, 0, 0], [], ['root']) as Record<
      string,
      unknown
    >;
    const snapRecord = metaMissing['snapshot'] as Record<string, unknown>;
    const meta = snapRecord['meta'] as Record<string, unknown>;
    delete meta['edge_fields'];
    expect(() => validateSnapshotStructure(metaMissing)).toThrow(/edge_fields/);
  });
});

describe('analyzeSnapshot — permuted field layouts', () => {
  it('handles a snapshot whose node fields are in a different order', () => {
    // Same graph as oneMbFixture but with permuted field order and stride 5:
    // fields: [self_size, edge_count, type, name, id]
    const fields = ['self_size', 'edge_count', 'type', 'name', 'id'];
    const nodeTypes = [
      'number',
      'number',
      ['object', 'string'],
      'string',
      'number',
    ];
    const snap = {
      snapshot: {
        node_count: 3,
        edge_count: 2,
        meta: {
          node_fields: fields,
          node_types: nodeTypes,
          edge_fields: EDGE_FIELDS,
          edge_types: EDGE_TYPES,
        },
      },
      // node0: Root (object) self 0, 1 edge; node1 holders; node2 big.
      nodes: [0, 1, 0, 0, 1, 16, 1, 1, 1, 2, MB, 0, 1, 2, 3],
      edges: [
        2,
        3,
        5, // Root -[child]-> node1 (offset 5)
        1,
        0,
        10, // node1 -[[0]]-> node2 (offset 10)
      ],
      strings: ['Root', 'holders', 'big-payload', 'child'],
    };
    const report = analyzeSnapshot(validateSnapshotStructure(snap), OPTIONS);
    expect(report.totalSelf).toBe(MB + 16);
    const big = report.bigObjects[0];
    expect(big.name).toBe('big-payload');
    expect(big.path.status).toBe('proven');
    const joined = big.path.steps.join(' > ');
    expect(joined).toContain('Root');
    expect(joined).toContain('holders');
  });
});

describe('analyzeSnapshot — weak-edge exclusion', () => {
  it('marks a weak-only-reachable object unreachable with no path', () => {
    // node0 (object Root) has ONE weak edge to node1 (string big).
    // With weak edges excluded, node1 has no strong retainer.
    const snap = buildSnapshot(
      [0, 0, 1, 0, 1, 2, 1, 2, 2 * MB, 0],
      [4, 0, 5], // weak edge node0 -> node1 (byte offset 5)
      ['Root', 'big'],
    );
    const report = analyzeSnapshot(validateSnapshotStructure(snap), OPTIONS);
    const big = report.bigObjects.find((o) => o.name === 'big');
    expect(big).toBeDefined();
    expect(big?.path.status).toBe('unreachable');
    expect(big?.path.steps).toHaveLength(0);
  });
});

describe('analyzeSnapshot — strong retainer path and aggregation', () => {
  const oneMbFixture = (): unknown =>
    buildSnapshot(
      [
        0,
        0,
        1,
        0,
        2, // node0 object "Root", 2 edges
        1,
        1,
        2,
        16,
        1, // node1 array "holders", 1 edge
        2,
        2,
        3,
        MB,
        0, // node2 string "big-payload", 1 MiB self, 0 edges
      ],
      [
        4,
        0,
        10, // weak edge node0 -> node2 (skipped)
        2,
        3,
        5, // property "child" node0 -> node1
        1,
        0,
        10, // element [0] node1 -> node2 (strong retainer)
      ],
      ['Root', 'holders', 'big-payload', 'child'],
    );

  it('retains the big object through the strong edge, not the weak one', () => {
    const report = analyzeSnapshot(
      validateSnapshotStructure(oneMbFixture()),
      OPTIONS,
    );
    const big = report.bigObjects[0];
    expect(big.name).toBe('big-payload');
    expect(big.bytes).toBe(MB);
    expect(big.path.status).toBe('proven');
    // The path is rendered root-first: the root is the first entry, and the
    // strong edge from the array ("holders") must appear in the chain; the
    // weak edge from Root is excluded, so the object's retainer is the array,
    // not Root.
    expect(big.path.steps.length).toBeGreaterThanOrEqual(2);
    expect(big.path.steps[0]).toContain('Root');
    const joined = big.path.steps.join(' > ');
    expect(joined).toContain('holders');
    expect(joined).not.toContain('(weak)');
  });

  it('aggregates self_size by type:name with the string dominant', () => {
    const report = analyzeSnapshot(
      validateSnapshotStructure(oneMbFixture()),
      OPTIONS,
    );
    expect(report.totalSelf).toBe(MB + 16);
    expect(report.aggregates[0].key).toBe('string:big-payload');
    expect(report.aggregates[0].bytes).toBe(MB);
  });

  it('renderAnalysis states the self_size-vs-retained limitation', () => {
    const report = analyzeSnapshot(
      validateSnapshotStructure(oneMbFixture()),
      OPTIONS,
    );
    const text = renderAnalysis(report, OPTIONS);
    expect(text).toContain('big-payload');
    expect(text).toContain('holders');
    expect(text.toLowerCase()).toContain('not retained size');
    expect(text.toLowerCase()).toContain('weak edges are ignored');
  });
});

describe('analyzeSnapshot — BFS root-to-object paths and cycles', () => {
  /**
   * Graph with a cycle: Root -> A -> B -> big-c, plus B -> A (cycle).
   * Edges are laid out per node in index order (node0's edges first, etc.).
   * Strings: 0=Root 1=A 2=B 3=big-c 4=a 5=b 6=c 7=a2
   */
  const cycleFixture = (): unknown =>
    buildSnapshot(
      [
        0,
        0,
        1,
        0,
        1, // node0 object "Root", 1 edge
        0,
        1,
        2,
        0,
        1, // node1 object "A", 1 edge
        0,
        2,
        3,
        0,
        2, // node2 object "B", 2 edges
        2,
        3,
        4,
        2 * MB,
        0, // node3 string "big-c", 2 MiB self, 0 edges
      ],
      [
        2,
        4,
        5, // Root -[a]-> A (byte offset 5)
        2,
        5,
        10, // A -[b]-> B (byte offset 10)
        2,
        6,
        15, // B -[c]-> big-c (byte offset 15)
        2,
        7,
        5, // B -[a2]-> A: the cycle edge
      ],
      ['Root', 'A', 'B', 'big-c', 'a', 'b', 'c', 'a2'],
    );

  it('terminates on a reachable cycle and proves a root-to-object path', () => {
    const report = analyzeSnapshot(
      validateSnapshotStructure(cycleFixture()),
      OPTIONS,
    );
    const big = report.bigObjects[0];
    expect(big.name).toBe('big-c');
    // Root-first proven path: ROOT, then each hop with the node it reaches.
    expect(big.path.status).toBe('proven');
    expect(big.path.steps).toEqual([
      'ROOT object:Root',
      'a (property) -> object:A',
      'b (property) -> object:B',
      'c (property) -> string:big-c',
    ]);
    // The cycle edge (a2 back to A) must not repeat A twice.
    const aOccurrences = big.path.steps.filter((step) =>
      step.includes('object:A'),
    ).length;
    expect(aOccurrences).toBe(1);
  });

  it('prefers the shortest strong path over an arbitrary first inbound edge', () => {
    // Root also points directly at B (element edge); the shortest path to
    // big-c must therefore be Root -> B -> big-c, skipping A entirely.
    // Strings: 0=Root 1=A 2=B 3=big-c 4=a 5=b 6=c 7=a2
    const withDirect = buildSnapshot(
      [
        0,
        0,
        1,
        0,
        2, // node0 Root, 2 edges
        0,
        1,
        2,
        0,
        1, // node1 A, 1 edge
        0,
        2,
        3,
        0,
        2, // node2 B, 2 edges
        2,
        3,
        4,
        2 * MB,
        0, // node3 string big-c
      ],
      [
        2,
        4,
        5, // Root -[a]-> A
        1,
        1,
        10, // Root -[[1]]-> B (direct, strong element)
        2,
        5,
        10, // A -[b]-> B
        2,
        6,
        15, // B -[c]-> big-c
        2,
        7,
        5, // B -[a2]-> A (cycle)
      ],
      ['Root', 'A', 'B', 'big-c', 'a', 'b', 'c', 'a2'],
    );
    const report = analyzeSnapshot(
      validateSnapshotStructure(withDirect),
      OPTIONS,
    );
    const big = report.bigObjects[0];
    expect(big.path.status).toBe('proven');
    expect(big.path.steps).toEqual([
      'ROOT object:Root',
      '[1] (element) -> object:B',
      'c (property) -> string:big-c',
    ]);
    expect(big.path.steps.join(' ')).not.toContain('object:A');
  });

  it('an object reachable only through a weak edge is unreachable, not proven', () => {
    // Root holds B only weakly; B holds big-w strongly. Because B itself has
    // no strong retainer, BFS never reaches it, so big-w is unreachable in
    // the strong graph: no proven path and no steps.
    const weakOnly = buildSnapshot(
      [
        0,
        0,
        1,
        0,
        1, // node0 Root, 1 edge
        0,
        1,
        2,
        0,
        1, // node1 B, 1 edge
        2,
        2,
        3,
        MB,
        0, // node2 string "big-w", 1 MiB
      ],
      [
        4,
        3,
        5, // weak Root -> B (byte offset 5)
        2,
        4,
        10, // strong B -[c]-> big-w (byte offset 10)
      ],
      ['Root', 'B', 'big-w', 'a', 'c'],
    );
    const report = analyzeSnapshot(validateSnapshotStructure(weakOnly), {
      ...OPTIONS,
      minBytes: Math.floor(MB / 2),
    });
    const big = report.bigObjects.find((o) => o.name === 'big-w');
    expect(big).toBeDefined();
    // Weak-edge-only reachability is not proof of retention.
    expect(big?.path.status).toBe('unreachable');
    expect(big?.path.steps).toHaveLength(0);
  });

  it('labels a depth-limited path truncated, never proven', () => {
    // A chain of 20 holders between Root and the big object; the depth budget
    // is 12, so the walk cannot reach the root and must say so.
    const holderCount = 20;
    const nodes: number[] = [];
    const edges: number[] = [];
    // node0 = Root with 1 edge; nodes 1..20 = holders each with 1 edge;
    // node21 = big. Strings: 0=Root, 1..20=holder-i, 21=big, 22=next
    nodes.push(0, 0, 1, 0, 1);
    for (let i = 1; i <= holderCount; i++) {
      nodes.push(0, i, i + 1, 0, 1);
    }
    nodes.push(2, holderCount + 1, holderCount + 2, MB, 0);
    for (let i = 0; i <= holderCount; i++) {
      edges.push(2, holderCount + 2, (i + 1) * NODE_LEN);
    }
    const strings = ['Root'];
    for (let i = 1; i <= holderCount; i++) {
      strings.push(`holder-${i}`);
    }
    strings.push('big', 'next');
    const report = analyzeSnapshot(
      validateSnapshotStructure(buildSnapshot(nodes, edges, strings)),
      { ...OPTIONS, maxRetainerDepth: 12 },
    );
    const big = report.bigObjects[0];
    expect(big.name).toBe('big');
    expect(big.path.status).toBe('truncated');
    // Truncated output never includes the ROOT marker: it is not a proof.
    expect(big.path.steps.join(' ')).not.toContain('ROOT');
    expect(big.path.steps.length).toBeGreaterThan(0);
    // The rendered text says truncated explicitly.
    const text = renderAnalysis(
      { ...report, bigObjects: [big] },
      { ...OPTIONS, maxRetainerDepth: 12 },
    );
    expect(text.toLowerCase()).toContain('truncated');
    const statuses: readonly RetainerStatus[] = [
      'proven',
      'truncated',
      'unreachable',
    ];
    expect(statuses).toContain(big.path.status);
  });

  it('proves a chain exactly at the depth budget', () => {
    // 12 hops exactly: Root -> 11 holders -> big.
    const holderCount = 11;
    const nodes: number[] = [];
    const edges: number[] = [];
    nodes.push(0, 0, 1, 0, 1);
    for (let i = 1; i <= holderCount; i++) {
      nodes.push(0, i, i + 1, 0, 1);
    }
    nodes.push(2, holderCount + 1, holderCount + 2, MB, 0);
    for (let i = 0; i <= holderCount; i++) {
      edges.push(2, holderCount + 2, (i + 1) * NODE_LEN);
    }
    const strings = ['Root'];
    for (let i = 1; i <= holderCount; i++) {
      strings.push(`holder-${i}`);
    }
    strings.push('big', 'next');
    const report = analyzeSnapshot(
      validateSnapshotStructure(buildSnapshot(nodes, edges, strings)),
      { ...OPTIONS, maxRetainerDepth: 12 },
    );
    const big = report.bigObjects[0];
    expect(big.path.status).toBe('proven');
    expect(big.path.steps[0]).toContain('ROOT');
  });
});

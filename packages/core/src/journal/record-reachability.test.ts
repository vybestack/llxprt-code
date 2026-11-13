/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { getU64, putU64, viewOf } from './bytes.js';
import { VectoredRecordAppender } from './groupAppender.js';
import {
  createFileHandleReader,
  type JournalFileHandle,
} from './positionalFile.js';
import { createRecordAccess, type RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import {
  EMPTY_REACHABILITY,
  RecordReachability,
  reachableBytes,
  type ReachabilityCategory,
  type ReachabilityEdge,
  type ReachabilityTotals,
  type ReachabilityState,
} from './record-reachability.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

interface DiskNode {
  readonly ref: number;
  readonly bytes: number;
  readonly children: readonly number[];
}

class DiskGraph {
  readonly appender: VectoredRecordAppender;
  resolutions = 0;
  constructor(readonly handle: JournalFileHandle) {
    this.appender = new VectoredRecordAppender(handle, 64);
  }
  access(end: number): RecordAccess {
    return createRecordAccess(
      'reachability-test',
      createFileHandleReader(this.handle),
      {
        selfOffset: 0,
        durableEnd: end,
      },
    );
  }
  async node(
    children: readonly number[] = [],
    payloadBytes = 0,
  ): Promise<DiskNode> {
    const header = new Uint8Array(8 + 8 * children.length + payloadBytes);
    const view = viewOf(header);
    putU64(view, 0, 'children', children.length);
    children.forEach((child, index) =>
      putU64(view, 8 + 8 * index, 'child', child),
    );
    const ref = await this.appender.append({
      kind: RECORD_KIND.VALUE,
      kindHeader: header,
    });
    return { ref, bytes: 24 + header.length, children };
  }
  async resolve(
    offset: number,
  ): Promise<{ bytes: number; children: readonly number[] }> {
    this.resolutions++;
    await this.appender.drain();
    const head = await this.access(this.appender.nextOffset).readRecordHead(
      offset,
    );
    const view = viewOf(head.kindHeader);
    const count = getU64(view, 0, 'children');
    return {
      bytes: head.endOffset - head.offset,
      children: Array.from({ length: count }, (_, index) =>
        getU64(view, 8 + 8 * index, 'child'),
      ),
    };
  }
  async update(
    state: ReachabilityState,
    add: readonly ReachabilityEdge[],
    remove: readonly ReachabilityEdge[],
  ): Promise<ReachabilityState> {
    await this.appender.drain();
    const ledger = new RecordReachability(
      state,
      this.appender,
      (end) => this.access(end),
      (edge) => this.resolve(edge.offset),
    );
    await ledger.replace(add, remove);
    return ledger.commit();
  }
}

function edge(
  offset: number,
  category: ReachabilityCategory,
): ReachabilityEdge {
  return { offset, category };
}

function totals(state: ReachabilityTotals): ReachabilityTotals {
  return {
    contextOnlyBytes: state.contextOnlyBytes,
    transcriptOnlyBytes: state.transcriptOnlyBytes,
    sharedBytes: state.sharedBytes,
    checkpointOnlyBytes: state.checkpointOnlyBytes,
  };
}

/** Deliberately scans every physical frame. Production must never do this. */
async function scanOracle(
  graph: DiskGraph,
  roots: readonly ReachabilityEdge[],
): Promise<ReachabilityTotals> {
  await graph.appender.drain();
  const access = graph.access(graph.appender.nextOffset);
  const nodes = new Map<number, { bytes: number; children: number[] }>();
  for (let at = 64; at < graph.appender.nextOffset; ) {
    const head = await access.readRecordHead(at);
    if (head.kind === RECORD_KIND.VALUE && head.bodyLen === 0) {
      const view = viewOf(head.kindHeader);
      const children: number[] = [];
      for (let index = 0; index < Number(view.getBigUint64(0, true)); index++)
        children.push(Number(view.getBigUint64(8 + 8 * index, true)));
      nodes.set(at, { bytes: head.endOffset - at, children });
    }
    at = head.endOffset;
  }
  const members = new Map<number, Set<ReachabilityCategory>>();
  function visit(offset: number, category: ReachabilityCategory): void {
    const categories = members.get(offset) ?? new Set<ReachabilityCategory>();
    if (categories.has(category)) return;
    categories.add(category);
    members.set(offset, categories);
    const node = nodes.get(offset);
    if (node === undefined) throw new Error(`Oracle cannot find ${offset}`);
    for (const child of node.children) visit(child, category);
  }
  for (const root of roots) visit(root.offset, root.category);
  const result = {
    contextOnlyBytes: 0,
    transcriptOnlyBytes: 0,
    sharedBytes: 0,
    checkpointOnlyBytes: 0,
  };
  for (const [offset, categories] of members) {
    const bytes = nodes.get(offset)?.bytes;
    if (bytes === undefined) throw new Error('Missing oracle record');
    if (categories.has('context') && categories.has('transcript'))
      result.sharedBytes += bytes;
    else if (categories.has('context')) result.contextOnlyBytes += bytes;
    else if (categories.has('transcript')) result.transcriptOnlyBytes += bytes;
    else result.checkpointOnlyBytes += bytes;
  }
  return result;
}

describe('incremental physical-record reachability', () => {
  const directory = useTempDir('journal-record-reachability-');
  async function withGraph(
    run: (graph: DiskGraph) => Promise<void>,
  ): Promise<void> {
    const handle = await fsp.open(path.join(directory(), 'records.llxj'), 'w+');
    try {
      await run(new DiskGraph(handle));
    } finally {
      await handle.close();
    }
  }

  it('counts a shared payload once and transfers it between the live buckets', async () => {
    await withGraph(async (graph) => {
      const payload = await graph.node([], 4096);
      let state = await graph.update(
        EMPTY_REACHABILITY,
        [edge(payload.ref, 'context')],
        [],
      );
      expect(totals(state)).toStrictEqual({
        contextOnlyBytes: payload.bytes,
        transcriptOnlyBytes: 0,
        sharedBytes: 0,
        checkpointOnlyBytes: 0,
      });
      state = await graph.update(state, [edge(payload.ref, 'transcript')], []);
      expect(totals(state)).toStrictEqual({
        contextOnlyBytes: 0,
        transcriptOnlyBytes: 0,
        sharedBytes: payload.bytes,
        checkpointOnlyBytes: 0,
      });
      expect(reachableBytes(state)).toBe(payload.bytes);
      state = await graph.update(state, [], [edge(payload.ref, 'context')]);
      expect(totals(state)).toStrictEqual({
        contextOnlyBytes: 0,
        transcriptOnlyBytes: payload.bytes,
        sharedBytes: 0,
        checkpointOnlyBytes: 0,
      });
    });
  });

  it('reclaims context-only compressed records without reclaiming transcript originals', async () => {
    await withGraph(async (graph) => {
      const contextOnly = await graph.node([], 1024);
      const original = await graph.node([], 2048);
      const old = await graph.node([contextOnly.ref, original.ref]);
      const summary = await graph.node([], 128);
      let state = await graph.update(
        EMPTY_REACHABILITY,
        [edge(old.ref, 'context'), edge(original.ref, 'transcript')],
        [],
      );
      state = await graph.update(
        state,
        [edge(summary.ref, 'context')],
        [edge(old.ref, 'context')],
      );
      expect(totals(state)).toStrictEqual({
        contextOnlyBytes: summary.bytes,
        transcriptOnlyBytes: original.bytes,
        sharedBytes: 0,
        checkpointOnlyBytes: 0,
      });
      expect(totals(state)).toStrictEqual(
        await scanOracle(graph, [
          edge(summary.ref, 'context'),
          edge(original.ref, 'transcript'),
        ]),
      );
    });
  });

  it('deduplicates overlapping checkpoints and reclaims records after the last checkpoint delete', async () => {
    await withGraph(async (graph) => {
      const payload = await graph.node([], 400);
      const saved = await graph.node([payload.ref]);
      let state = await graph.update(
        EMPTY_REACHABILITY,
        [
          edge(saved.ref, 'context'),
          edge(saved.ref, 'checkpoint'),
          edge(saved.ref, 'checkpoint'),
        ],
        [],
      );
      expect(state.checkpointOnlyBytes).toBe(0);
      state = await graph.update(state, [], [edge(saved.ref, 'context')]);
      expect(state.checkpointOnlyBytes).toBe(saved.bytes + payload.bytes);
      state = await graph.update(state, [], [edge(saved.ref, 'checkpoint')]);
      expect(state.checkpointOnlyBytes).toBe(saved.bytes + payload.bytes);
      state = await graph.update(state, [], [edge(saved.ref, 'checkpoint')]);
      expect(totals(state)).toStrictEqual(totals(EMPTY_REACHABILITY));
    });
  });

  it('adds roots before releasing old roots so unchanged descendants are not traversed again', async () => {
    await withGraph(async (graph) => {
      const payload = await graph.node([], 1024);
      const subtree = await graph.node([payload.ref]);
      const old = await graph.node([subtree.ref]);
      let state = await graph.update(
        EMPTY_REACHABILITY,
        [edge(old.ref, 'context')],
        [],
      );
      const next = await graph.node([subtree.ref]);
      graph.resolutions = 0;
      state = await graph.update(
        state,
        [edge(next.ref, 'context')],
        [edge(old.ref, 'context')],
      );
      expect(graph.resolutions).toBe(2);
      expect(state.contextOnlyBytes).toBe(
        next.bytes + subtree.bytes + payload.bytes,
      );
    });
  });

  it('matches a whole-file oracle and an independently rebuilt ledger across 200 seeded operations', async () => {
    await withGraph(async (graph) => {
      const random = new SeededRandom(854);
      let state = EMPTY_REACHABILITY;
      let roots: ReachabilityEdge[] = [];
      const nodes: DiskNode[] = [];
      const categories: readonly ReachabilityCategory[] = [
        'context',
        'transcript',
        'checkpoint',
      ];
      for (let operation = 0; operation < 200; operation++) {
        const remove: ReachabilityEdge[] = [];
        const add: ReachabilityEdge[] = [];
        if (nodes.length === 0 || random.int(3) === 0) {
          const children =
            nodes.length === 0 ? [] : [nodes[random.int(nodes.length)].ref];
          nodes.push(await graph.node(children, random.int(200)));
        }
        if (roots.length > 0 && random.int(2) === 0) {
          const at = random.int(roots.length);
          remove.push(roots[at]);
          roots = roots.filter((_, index) => index !== at);
        }
        if (random.int(4) !== 0) {
          const root = edge(
            nodes[random.int(nodes.length)].ref,
            categories[random.int(categories.length)],
          );
          add.push(root);
          roots.push(root);
        }
        state = await graph.update(state, add, remove);
        expect(totals(state)).toStrictEqual(await scanOracle(graph, roots));
        const rebuilt = await graph.update(EMPTY_REACHABILITY, roots, []);
        expect(totals(state)).toStrictEqual(totals(rebuilt));
      }
    });
  });

  it('spills a large changed-record set without losing markers shared across categories', async () => {
    await withGraph(async (graph) => {
      const children: number[] = [];
      let payloadBytes = 0;
      for (let index = 0; index < 400; index++) {
        const child = await graph.node([], index % 31);
        children.push(child.ref);
        payloadBytes += child.bytes;
      }
      const root = await graph.node(children);
      let state = await graph.update(
        EMPTY_REACHABILITY,
        [
          edge(root.ref, 'context'),
          edge(root.ref, 'transcript'),
          edge(root.ref, 'checkpoint'),
        ],
        [],
      );
      expect(state.sharedBytes).toBe(payloadBytes + root.bytes);
      expect(reachableBytes(state)).toBe(payloadBytes + root.bytes);
      state = await graph.update(
        state,
        [],
        [edge(root.ref, 'context'), edge(root.ref, 'transcript')],
      );
      expect(state.checkpointOnlyBytes).toBe(payloadBytes + root.bytes);
      expect(totals(state)).toStrictEqual(
        await scanOracle(graph, [edge(root.ref, 'checkpoint')]),
      );
      state = await graph.update(state, [], [edge(root.ref, 'checkpoint')]);
      expect(reachableBytes(state)).toBe(0);
    });
  });

  it('keeps an older ledger snapshot readable after later membership changes', async () => {
    await withGraph(async (graph) => {
      const payload = await graph.node([], 64);
      const saved = await graph.update(
        EMPTY_REACHABILITY,
        [edge(payload.ref, 'context')],
        [],
      );
      const cleared = await graph.update(
        saved,
        [],
        [edge(payload.ref, 'context')],
      );
      expect(reachableBytes(cleared)).toBe(0);
      const forked = await graph.update(
        saved,
        [edge(payload.ref, 'transcript')],
        [],
      );
      expect(forked.sharedBytes).toBe(payload.bytes);
      expect(reachableBytes(forked)).toBe(payload.bytes);
      expect(saved.contextOnlyBytes).toBe(payload.bytes);
    });
  });

  it('carries index interpretation through unchanged-category edges and permits domain transitions', async () => {
    await withGraph(async (graph) => {
      const payload = await graph.node([], 64);
      const subtree = await graph.node([payload.ref]);
      const root = await graph.node([subtree.ref]);
      await graph.appender.drain();
      const ledger = new RecordReachability(
        EMPTY_REACHABILITY,
        graph.appender,
        (end) => graph.access(end),
        async (reference) => {
          const node = await graph.resolve(reference.offset);
          return reference.offset === subtree.ref && reference.index === 'map'
            ? {
                ...node,
                children: node.children.map((child) =>
                  edge(child, 'transcript'),
                ),
              }
            : node;
        },
      );
      await ledger.replace(
        [{ ...edge(root.ref, 'context'), index: 'map' }],
        [],
      );
      const state = await ledger.commit();
      expect(state.contextOnlyBytes).toBe(root.bytes + subtree.bytes);
      expect(state.transcriptOnlyBytes).toBe(payload.bytes);
      expect(reachableBytes(state)).toBe(
        root.bytes + subtree.bytes + payload.bytes,
      );
    });
  });

  it('fails fast on a reference underflow', async () => {
    await withGraph(async (graph) => {
      const payload = await graph.node();
      await expect(
        graph.update(EMPTY_REACHABILITY, [], [edge(payload.ref, 'context')]),
      ).rejects.toThrow(/reference underflow/);
    });
  });
});

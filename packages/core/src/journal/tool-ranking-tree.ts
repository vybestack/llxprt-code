/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mapRowStream } from './mapped-row-stream.js';
import { JournalFormatError } from './errors.js';
import type { IdFactQueries } from './idFactQueries.js';
import type { IdFactBatch } from './idFactBatch.js';
import { ID_NS } from './idKeys.js';

export const TOOL_RANKING_READY = 'history:tool-ranking:2';
/** No IdFact encoding is 56 bytes; compaction uses this width to identify offset-free ranking nodes. */
export const TOOL_RANK_NODE_BYTES = 56;
const utf8 = new TextEncoder();
const namespace = ID_NS.nativeScalar;

export interface ToolRank {
  readonly id: number;
  readonly label: bigint;
  readonly ordinal: number;
  readonly block: number;
  readonly score: number;
  readonly saving: number;
}
export interface ToolRankNode extends ToolRank {
  readonly left: number;
  readonly right: number;
  readonly height: number;
  readonly count: number;
  readonly total: number;
}
function projectRank(node: ToolRank): ToolRank {
  return {
    id: node.id,
    label: node.label,
    ordinal: node.ordinal,
    block: node.block,
    score: node.score,
    saving: node.saving,
  };
}
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
export function rankBefore(a: ToolRank, b: ToolRank): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.ordinal !== b.ordinal) return a.ordinal > b.ordinal;
  return a.block > b.block;
}

export class ToolRankingTree {
  constructor(
    private readonly facts: IdFactQueries,
    private readonly pending = false,
  ) {}

  protected key(parts: ReadonlyArray<number | string>): Uint8Array {
    return utf8.encode(
      JSON.stringify([
        TOOL_RANKING_READY,
        ...(this.pending ? ['pending'] : []),
        ...parts,
      ]),
    );
  }

  node(id: number): Promise<ToolRankNode> {
    if (id === 0)
      return Promise.reject(new RangeError('Empty tool ranking child'));
    return this.facts
      .getEntry(namespace, this.key(['node', id]))
      .then((bytes) => {
        if (bytes?.length !== TOOL_RANK_NODE_BYTES)
          throw new JournalFormatError('Missing tool ranking node');
        const data = view(bytes);
        return {
          id,
          label: data.getBigUint64(0, true),
          ordinal: data.getUint32(8, true),
          block: data.getUint32(12, true),
          score: data.getFloat64(16, true),
          saving: data.getFloat64(24, true),
          left: data.getUint32(32, true),
          right: data.getUint32(36, true),
          height: data.getUint32(40, true),
          count: data.getUint32(44, true),
          total: data.getFloat64(48, true),
        };
      });
  }
  async header(): Promise<{
    root: number;
    count: number;
    rows: number;
    saving: number;
    lastParent: number;
  }> {
    const bytes = await this.facts.getEntry(namespace, this.key(['header']));
    if (bytes?.length !== 20)
      throw new JournalFormatError('Missing tool ranking header');
    const parent = await this.facts.getEntry(
      namespace,
      this.key(['lastParent']),
    );
    if (parent?.length !== 4)
      throw new JournalFormatError('Missing tool ranking parent boundary');
    const data = view(bytes);
    return {
      lastParent: view(parent).getUint32(0, true) - 1,
      root: data.getUint32(0, true),
      count: data.getUint32(4, true),
      rows: data.getUint32(8, true),
      saving: data.getFloat64(12, true),
    };
  }
  at(root: number, index: number): Promise<ToolRank> {
    if (!Number.isSafeInteger(index) || index < 0)
      return Promise.reject(new RangeError('Invalid tool rank'));
    const visit = (id: number, rank: number): Promise<ToolRank> => {
      if (id === 0)
        return Promise.reject(new RangeError('Tool rank is outside the index'));
      return this.node(id).then((node) =>
        select(id, node.left, node.right, rank),
      );
    };
    const select = (
      id: number,
      left: number,
      right: number,
      rank: number,
    ): Promise<ToolRank> => {
      const count =
        left === 0
          ? Promise.resolve(0)
          : this.node(left).then((node) => node.count);
      return count.then((size) => {
        if (rank === size) return this.node(id).then(projectRank);
        if (rank < size) return visit(left, rank);
        return visit(right, rank - size - 1);
      });
    };
    return visit(root, index);
  }
  ordered(root: number): AsyncGenerator<ToolRank, void, unknown> {
    const pending: Array<{ id: number; emit: boolean }> = [];
    if (root !== 0) pending.push({ id: root, emit: false });
    const ids = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: (): Promise<IteratorResult<number, void>> => {
        const advance = (): Promise<IteratorResult<number, void>> => {
          const next = pending.pop();
          if (next === undefined)
            return Promise.resolve({ done: true, value: undefined });
          if (next.emit)
            return Promise.resolve({ done: false, value: next.id });
          return this.node(next.id)
            .then((node) => {
              if (node.right !== 0)
                pending.push({ id: node.right, emit: false });
              pending.push({ id: node.id, emit: true });
              if (node.left !== 0) pending.push({ id: node.left, emit: false });
            })
            .then(advance);
        };
        return advance();
      },
      return: (): Promise<IteratorResult<number, void>> => {
        pending.length = 0;
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    return mapRowStream(ids, (id) => this.node(id).then(projectRank));
  }
  position(label: bigint, block: number): Promise<ToolRank | undefined> {
    return this.facts
      .getEntry(namespace, this.key(['position', String(label), block]))
      .then((bytes) => {
        if (bytes === undefined) return undefined;
        if (bytes.length !== 4)
          throw new JournalFormatError('Invalid tool ranking position');
        return this.node(view(bytes).getUint32(0, true)).then((node) =>
          node.label === label && node.block === block
            ? projectRank(node)
            : undefined,
        );
      });
  }
}

export class ToolRankingTreeWriter extends ToolRankingTree {
  constructor(
    private readonly batch: IdFactBatch,
    pending = false,
  ) {
    super(batch.queries, pending);
  }

  private async write(node: ToolRankNode): Promise<ToolRankNode> {
    const left = node.left === 0 ? undefined : await this.node(node.left);
    const right = node.right === 0 ? undefined : await this.node(node.right);
    const next = {
      ...node,
      height: 1 + Math.max(left?.height ?? 0, right?.height ?? 0),
      count: 1 + (left?.count ?? 0) + (right?.count ?? 0),
      total:
        Math.max(0, node.saving) + (left?.total ?? 0) + (right?.total ?? 0),
    };
    const bytes = new Uint8Array(TOOL_RANK_NODE_BYTES);
    const data = view(bytes);
    data.setBigUint64(0, next.label, true);
    data.setUint32(8, next.ordinal, true);
    data.setUint32(12, next.block, true);
    data.setFloat64(16, next.score, true);
    data.setFloat64(24, next.saving, true);
    data.setUint32(32, next.left, true);
    data.setUint32(36, next.right, true);
    data.setUint32(40, next.height, true);
    data.setUint32(44, next.count, true);
    data.setFloat64(48, next.total, true);
    await this.batch.setEntry(namespace, this.key(['node', node.id]), bytes);
    return next;
  }
  private async rotateRight(node: ToolRankNode): Promise<ToolRankNode> {
    const left = await this.node(node.left);
    const down = await this.write({ ...node, left: left.right });
    return this.write({ ...left, right: down.id });
  }
  private async rotateLeft(node: ToolRankNode): Promise<ToolRankNode> {
    const right = await this.node(node.right);
    const down = await this.write({ ...node, right: right.left });
    return this.write({ ...right, left: down.id });
  }
  private async balanced(node: ToolRankNode): Promise<ToolRankNode> {
    const left = node.left === 0 ? undefined : await this.node(node.left);
    const right = node.right === 0 ? undefined : await this.node(node.right);
    const balance = (left?.height ?? 0) - (right?.height ?? 0);
    if (balance > 1 && left !== undefined) {
      const outer = left.left === 0 ? 0 : (await this.node(left.left)).height;
      const inner = left.right === 0 ? 0 : (await this.node(left.right)).height;
      const adjusted =
        inner > outer
          ? await this.write({
              ...node,
              left: (await this.rotateLeft(left)).id,
            })
          : node;
      return this.rotateRight(adjusted);
    }
    if (balance < -1 && right !== undefined) {
      const outer =
        right.right === 0 ? 0 : (await this.node(right.right)).height;
      const inner = right.left === 0 ? 0 : (await this.node(right.left)).height;
      const adjusted =
        inner > outer
          ? await this.write({
              ...node,
              right: (await this.rotateRight(right)).id,
            })
          : node;
      return this.rotateLeft(adjusted);
    }
    return node;
  }
  async insert(root: number, rank: ToolRank): Promise<number> {
    if (!Number.isFinite(rank.score) || !Number.isFinite(rank.saving))
      throw new JournalFormatError('Tool ranking measurements must be finite');
    if (root === 0) {
      await this.write({
        ...rank,
        left: 0,
        right: 0,
        height: 1,
        count: 1,
        total: Math.max(0, rank.saving),
      });
      const bytes = new Uint8Array(4);
      view(bytes).setUint32(0, rank.id, true);
      await this.batch.setEntry(
        namespace,
        this.key(['position', String(rank.label), rank.block]),
        bytes,
      );
      return rank.id;
    }
    const node = await this.node(root);
    if (node.id === rank.id)
      throw new JournalFormatError('Duplicate tool ranking identity');
    const next = rankBefore(rank, node)
      ? { ...node, left: await this.insert(node.left, rank) }
      : { ...node, right: await this.insert(node.right, rank) };
    return (await this.balanced(await this.write(next))).id;
  }
  async finish(
    root: number,
    count: number,
    rows: number,
    saving: number,
    lastParent = -1,
  ): Promise<void> {
    const bytes = new Uint8Array(20);
    const data = view(bytes);
    data.setUint32(0, root, true);
    data.setUint32(4, count, true);
    data.setUint32(8, rows, true);
    data.setFloat64(12, saving, true);
    await this.batch.setEntry(namespace, this.key(['header']), bytes);
    const parent = new Uint8Array(4);
    view(parent).setUint32(0, lastParent + 1, true);
    await this.batch.setEntry(namespace, this.key(['lastParent']), parent);
  }
}

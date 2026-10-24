/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { IdTrieReader } from './idTrieReader.js';
import {
  ID_TRIE_FANOUT,
  ID_TRIE_LEAF_CAPACITY,
  ID_TRIE_MAX_DEPTH,
  compareIdHashes,
  encodeIdTrieNode,
  nibbleAt,
  type IdEntry,
  type InternalIdNode,
} from './idTrieNode.js';
import { bytesEqual } from './bytes.js';

/** Facts in ascending hash order, one at a time. */
interface SortedSource {
  peek(): Promise<IdEntry | undefined>;
  next(): Promise<IdEntry | undefined>;
}

/** The caller's updates. Checks that hashes ascend strictly, which is what makes the merge a single pass. */
class StreamSource implements SortedSource {
  private readonly iterator: Iterator<IdEntry> | AsyncIterator<IdEntry>;
  private head: IdEntry | undefined;
  private primed = false;
  private last: Uint8Array | undefined;

  constructor(entries: Iterable<IdEntry> | AsyncIterable<IdEntry>) {
    this.iterator =
      Symbol.asyncIterator in entries
        ? entries[Symbol.asyncIterator]()
        : entries[Symbol.iterator]();
  }

  async peek(): Promise<IdEntry | undefined> {
    if (!this.primed) {
      const step = await this.iterator.next();
      this.head = step.done === true ? undefined : step.value;
      if (this.head !== undefined) this.checkOrder(this.head);
      this.primed = true;
    }
    return this.head;
  }

  async next(): Promise<IdEntry | undefined> {
    const entry = await this.peek();
    this.primed = false;
    return entry;
  }

  private checkOrder(entry: IdEntry): void {
    if (
      this.last !== undefined &&
      compareIdHashes(this.last, entry.hash) >= 0
    ) {
      throw new JournalFormatError(
        'Id trie updates must have unique hashes in ascending order',
      );
    }
    this.last = entry.hash;
  }
}

/** The facts of the subtree below one nibble: the parent's entries while they carry that nibble. */
class PrefixSource implements SortedSource {
  constructor(
    private readonly parent: SortedSource,
    private readonly depth: number,
    private readonly nibble: number,
  ) {}

  async peek(): Promise<IdEntry | undefined> {
    const entry = await this.parent.peek();
    return entry !== undefined &&
      nibbleAt(entry.hash, this.depth) === this.nibble
      ? entry
      : undefined;
  }

  async next(): Promise<IdEntry | undefined> {
    return (await this.peek()) === undefined ? undefined : this.parent.next();
  }
}

/** Entries already taken from a source, handed out again before the rest of it. */
class ReplaySource implements SortedSource {
  private at = 0;

  constructor(
    private readonly buffered: readonly IdEntry[],
    private readonly rest: SortedSource,
  ) {}

  peek(): Promise<IdEntry | undefined> {
    return this.at < this.buffered.length
      ? Promise.resolve(this.buffered[this.at])
      : this.rest.peek();
  }

  next(): Promise<IdEntry | undefined> {
    if (this.at < this.buffered.length) {
      const entry = this.buffered[this.at];
      this.at += 1;
      return Promise.resolve(entry);
    }
    return this.rest.next();
  }
}

/** The facts of an existing leaf merged with the updates; an update wins over an equal key. */
class UnionSource implements SortedSource {
  private at = 0;

  constructor(
    private readonly existing: readonly IdEntry[],
    private readonly updates: SortedSource,
  ) {}

  async peek(): Promise<IdEntry | undefined> {
    const update = await this.updates.peek();
    if (this.at >= this.existing.length) return update;
    const current = this.existing[this.at];
    if (update === undefined) return current;
    return compareIdHashes(current.hash, update.hash) < 0 ? current : update;
  }

  async next(): Promise<IdEntry | undefined> {
    const update = await this.updates.peek();
    if (this.at >= this.existing.length) return this.updates.next();
    const current = this.existing[this.at];
    if (update === undefined) return this.takeExisting(current);
    const order = compareIdHashes(current.hash, update.hash);
    if (order < 0) return this.takeExisting(current);
    if (order === 0) this.at += 1;
    return this.updates.next();
  }

  private takeExisting(entry: IdEntry): IdEntry {
    this.at += 1;
    return entry;
  }
}

interface MergeContext {
  readonly appender: RecordAppender;
  readonly reader: IdTrieReader | undefined;
}

interface ExistingLeaf {
  readonly offset: number;
  readonly entries: readonly IdEntry[];
}

function sameFacts(
  left: readonly IdEntry[],
  right: readonly IdEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, at) =>
        compareIdHashes(entry.hash, right[at].hash) === 0 &&
        bytesEqual(entry.value, right[at].value),
    )
  );
}

/**
 * The node for the facts in `source` at `depth`. A subtree of eight or fewer
 * facts is a leaf and anything larger is an internal node, so the shape is a
 * function of the key set and not of the order the keys arrived in. Nine
 * facts are read ahead to tell the two apart.
 */
async function buildNode(
  context: MergeContext,
  depth: number,
  source: SortedSource,
  existing: ExistingLeaf | undefined,
): Promise<number> {
  const taken: IdEntry[] = [];
  while (taken.length <= ID_TRIE_LEAF_CAPACITY) {
    const entry = await source.next();
    if (entry === undefined) break;
    taken.push(entry);
  }
  if (taken.length <= ID_TRIE_LEAF_CAPACITY) {
    if (existing !== undefined && sameFacts(taken, existing.entries)) {
      return existing.offset;
    }
    return context.appender.append(
      encodeIdTrieNode({ kind: 'leaf', entries: taken }),
    );
  }
  if (depth >= ID_TRIE_MAX_DEPTH) {
    throw new JournalFormatError(
      `More than ${ID_TRIE_LEAF_CAPACITY} distinct hashes share all ${ID_TRIE_MAX_DEPTH} nibbles`,
    );
  }
  return buildInternal(context, depth, new ReplaySource(taken, source));
}

async function buildInternal(
  context: MergeContext,
  depth: number,
  source: SortedSource,
): Promise<number> {
  let bitmap = 0;
  const children: number[] = [];
  for (let nibble = 0; nibble < ID_TRIE_FANOUT; nibble++) {
    const below = new PrefixSource(source, depth, nibble);
    if ((await below.peek()) === undefined) continue;
    children.push(await buildNode(context, depth + 1, below, undefined));
    bitmap |= 1 << nibble;
  }
  return context.appender.append(
    encodeIdTrieNode({ kind: 'internal', bitmap, children }),
  );
}

/** Merges the updates into the subtree at `offset`, rewriting only the nodes on changed paths. */
async function mergeNode(
  context: MergeContext,
  offset: number,
  depth: number,
  source: SortedSource,
): Promise<number> {
  if (context.reader === undefined) {
    throw new JournalFormatError(
      'Merging into an existing trie needs a reader',
    );
  }
  const node = await context.reader.readNode(offset);
  if (node.kind === 'internal') {
    return mergeInternal(context, offset, node, depth, source);
  }
  const existing: ExistingLeaf = { offset, entries: node.entries };
  return buildNode(
    context,
    depth,
    new UnionSource(node.entries, source),
    existing,
  );
}

async function mergeInternal(
  context: MergeContext,
  offset: number,
  node: InternalIdNode,
  depth: number,
  source: SortedSource,
): Promise<number> {
  let bitmap = node.bitmap;
  const children: number[] = [];
  let changed = false;
  let slot = 0;
  for (let nibble = 0; nibble < ID_TRIE_FANOUT; nibble++) {
    const below = new PrefixSource(source, depth, nibble);
    const pending = (await below.peek()) !== undefined;
    const present = (node.bitmap & (1 << nibble)) !== 0;
    if (present) {
      const current = node.children[slot];
      slot += 1;
      const next = pending
        ? await mergeNode(context, current, depth + 1, below)
        : current;
      changed = changed || next !== current;
      children.push(next);
    } else if (pending) {
      children.push(await buildNode(context, depth + 1, below, undefined));
      bitmap |= 1 << nibble;
      changed = true;
    }
  }
  if (!changed) return offset;
  return context.appender.append(
    encodeIdTrieNode({ kind: 'internal', bitmap, children }),
  );
}

function isEntryArray(
  entries: Iterable<IdEntry> | AsyncIterable<IdEntry>,
): entries is readonly IdEntry[] {
  return Array.isArray(entries);
}

function unionEntries(
  existing: readonly IdEntry[],
  updates: readonly IdEntry[],
): IdEntry[] {
  const merged: IdEntry[] = [];
  let current = 0;
  let pending = 0;
  while (current < existing.length && pending < updates.length) {
    const order = compareIdHashes(
      existing[current].hash,
      updates[pending].hash,
    );
    if (order < 0) merged.push(existing[current++]);
    else {
      current += Number(order === 0);
      merged.push(updates[pending++]);
    }
  }
  merged.push(...existing.slice(current), ...updates.slice(pending));
  return merged;
}

async function mergeArrayNode(
  context: MergeContext,
  offset: number,
  depth: number,
  updates: readonly IdEntry[],
): Promise<number> {
  if (updates.length === 0) return offset;
  if (offset !== 0 && context.reader === undefined)
    throw new JournalFormatError(
      'Merging into an existing trie needs a reader',
    );
  const node =
    offset === 0 ? undefined : await context.reader?.readNode(offset);
  const entries =
    node?.kind === 'leaf' ? unionEntries(node.entries, updates) : updates;
  if (node?.kind !== 'internal' && entries.length <= ID_TRIE_LEAF_CAPACITY) {
    if (node !== undefined && sameFacts(entries, node.entries)) return offset;
    return context.appender.append(encodeIdTrieNode({ kind: 'leaf', entries }));
  }
  if (depth >= ID_TRIE_MAX_DEPTH)
    throw new JournalFormatError(
      `More than ${ID_TRIE_LEAF_CAPACITY} distinct hashes share all ${ID_TRIE_MAX_DEPTH} nibbles`,
    );
  return mergeArrayChildren(context, offset, depth, entries, node);
}

async function mergeArrayChildren(
  context: MergeContext,
  offset: number,
  depth: number,
  entries: readonly IdEntry[],
  node: Awaited<ReturnType<IdTrieReader['readNode']>> | undefined,
): Promise<number> {
  const children: number[] = [];
  let bitmap = 0;
  let at = 0;
  let slot = 0;
  let changed = false;
  for (let nibble = 0; nibble < ID_TRIE_FANOUT; nibble++) {
    const start = at;
    while (at < entries.length && nibbleAt(entries[at].hash, depth) === nibble)
      at++;
    const present =
      node?.kind === 'internal' && (node.bitmap & (1 << nibble)) !== 0;
    const previous = present ? node.children[slot++] : 0;
    if (!present && at === start) continue;
    const next =
      at === start
        ? previous
        : await mergeArrayNode(
            context,
            previous,
            depth + 1,
            entries.slice(start, at),
          );
    children.push(next);
    bitmap |= 1 << nibble;
    changed = changed || next !== previous;
  }
  if (node?.kind === 'internal' && !changed) return offset;
  return context.appender.append(
    encodeIdTrieNode({ kind: 'internal', bitmap, children }),
  );
}

/**
 * Merges `updates`, ascending by hash with unique hashes, into the trie at
 * `root` as part of the current group, and returns the new root. A path copy
 * writes each node on a changed path once however many updates pass through
 * it, so a batch of updates costs the union of their paths and not the sum.
 * Nodes this call writes cannot be read until the appender is drained, so a
 * caller that merges again in the same group drains between the merges and
 * reads through an access that reaches the appender's `nextOffset`. `root` 0 is the empty trie and needs no reader. A
 * fact that is equal to the stored one writes nothing, and a merge that
 * changes nothing returns `root`.
 */
export async function mergeIdTrie(
  appender: RecordAppender,
  reader: IdTrieReader | undefined,
  root: number,
  updates: Iterable<IdEntry> | AsyncIterable<IdEntry>,
): Promise<number> {
  const context: MergeContext = { appender, reader };
  if (isEntryArray(updates)) {
    for (let index = 1; index < updates.length; index++)
      if (compareIdHashes(updates[index - 1].hash, updates[index].hash) >= 0)
        throw new JournalFormatError(
          'Id trie updates must have unique hashes in ascending order',
        );
    return mergeArrayNode(context, root, 0, updates);
  }
  const source = new StreamSource(updates);
  if ((await source.peek()) === undefined) return root;
  if (root === 0) return buildNode(context, 0, source, undefined);
  return mergeNode(context, root, 0, source);
}

/**
 * Builds a whole trie from facts in ascending hash order, such as a rebuild
 * after compression. Nodes are appended as they complete and at most nine
 * facts per level are held, so memory is a constant whatever the count.
 * Returns 0 for no facts.
 */
export function bulkBuildIdTrie(
  appender: RecordAppender,
  entries: Iterable<IdEntry> | AsyncIterable<IdEntry>,
): Promise<number> {
  return mergeIdTrie(appender, undefined, 0, entries);
}

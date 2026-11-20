/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import {
  TRANSCRIPT_FANOUT,
  type TranscriptEntry,
  type TranscriptChild,
  type TranscriptNode,
} from './transcript-tree.js';

/** Completed nodes are emitted once; only the unfinished right spine is resident. */
export class TranscriptAppend {
  private readonly parents: TranscriptChild[][] = [];
  private entries: TranscriptEntry[] = [];
  private loaded = false;
  private changed = false;
  constructor(
    private readonly root: number,
    private readonly read: (ref: number) => Promise<TranscriptNode>,
    private readonly write: (node: TranscriptNode) => Promise<TranscriptChild>,
  ) {}

  async prepare(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (this.root === 0) return;
    let node = await this.read(this.root);
    while (node.level !== 0) {
      this.parents[node.level - 1] = node.children.slice(0, -1);
      node = await this.read(node.children[node.children.length - 1].ref);
    }
    this.entries = [...node.entries];
  }

  async append(entry: TranscriptEntry): Promise<void> {
    await this.prepare();
    if (
      this.entries.length > 0 &&
      this.entries[this.entries.length - 1].transcriptId >= entry.transcriptId
    )
      throw new JournalFormatError('Transcript admissions must increase');
    if (this.entries.length === TRANSCRIPT_FANOUT) {
      await this.complete(await this.leaf(), 1);
      this.entries = [];
    }
    this.entries.push(entry);
    this.changed = true;
  }

  private leaf(): Promise<TranscriptChild> {
    return this.write({
      mode: 'transcript',
      level: 0,
      entries: this.entries,
      children: [],
    });
  }

  private async complete(child: TranscriptChild, level: number): Promise<void> {
    const children = this.parents[level - 1] ?? [];
    children.push(child);
    this.parents[level - 1] = children;
    if (children.length < TRANSCRIPT_FANOUT) return;
    const completed = await this.write({
      mode: 'transcript',
      level,
      entries: [],
      children,
    });
    this.parents[level - 1] = [];
    await this.complete(completed, level + 1);
  }

  async finish(): Promise<number> {
    if (!this.changed) return this.root;
    let child = await this.leaf();
    for (let index = 0; index < this.parents.length; index++) {
      const children = [...this.parents[index], child];
      child = await this.write({
        mode: 'transcript',
        level: index + 1,
        entries: [],
        children,
      });
    }
    return child.ref;
  }
}

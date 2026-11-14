/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { EntryFill, VersionEdit } from '../../groupEdits.js';
import { LABEL_STEP, FIRST_NEXT_LABEL, labelBetween } from '../../labels.js';
import type { RowDraft } from '../../rowDraft.js';
import { ENTRY_FLAG, type RowEntry } from '../../rowEntry.js';
import {
  CHRONOLOGY_SEQ_NONE,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '../../rowRecord.js';
import { ID_SHAPES } from './idHistoryModel.js';
import type { SeededRandom } from './seededRandom.js';
import type { Version } from '../../version.js';

/** One id of a model row: a call or a response, as a draft id tuple. */
export interface ModelId {
  readonly rawId: string;
  readonly kind: number;
  readonly score: number;
  readonly nameLen: number;
}

/** What the model expects of the index entry's mutable fields. */
export interface ModelEntryFields {
  readonly tokens: RowEntry['tokens'];
  readonly media: RowEntry['media'];
  readonly lensRef: RowEntry['lensRef'];
}

/** A row of the test-side array model: the content a draft carries and what the entry should show. */
export interface ModelRow extends ModelEntryFields {
  readonly label: bigint;
  readonly owner: number;
  readonly speaker: number;
  readonly flags: number;
  /** A token that is unique to one version of the content; it rides in the chronology seq. */
  readonly seq: bigint;
  readonly text: string;
  readonly ids: readonly ModelId[];
  readonly endpoint: bigint;
}

export const ZERO_FIELDS: ModelEntryFields = {
  tokens: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  media: { mediaChars: 0, imageChars: [0, 0, 0], pdfBytes: [0, 0, 0] },
  lensRef: [0, 0, 0],
};

const ENDPOINTS = [0n, 7n] as const;
const FLAG_CHOICES = [
  0,
  ROW_FLAG.hasThinking,
  ROW_FLAG.invalidateResponses,
  ROW_FLAG.cacheAnchor | ROW_FLAG.hasImage,
  ROW_FLAG.hasToolCall,
] as const;

/** A saved version with the rows the model held when it was published. */
export interface SavedVersion {
  readonly version: Version;
  readonly rows: readonly ModelRow[];
}

/** The edits of one step. The model has already been moved to the state they lead to. */
export interface Step {
  readonly name: string;
  readonly edits: VersionEdit[];
  /** True when the group starts a lineage (design 4.10). */
  readonly startsLineage: boolean;
}

function pick<T>(random: SeededRandom, items: readonly T[]): T {
  return items[random.int(items.length)];
}

/**
 * The test-side array of rows, with the label rule of design 2.6, and a
 * generator of steps that move the model and describe the matching edits. A
 * step is built from the model's own state, so what the store must produce is
 * known without reading the store.
 */
export class StoreModel {
  rows: ModelRow[] = [];
  next = FIRST_NEXT_LABEL;
  private seqCounter = 1n;
  /**
   * The rows of every trailer of the current lineage, oldest first. A pop that
   * lands on an ancestor gets that ancestor's entries back, which discards the
   * fills made after it (design 4.3).
   */
  private lineage: ModelRow[][] = [];
  private poppedTo: { index: number; exact: boolean } | undefined;

  constructor(private readonly random: SeededRandom) {}

  private freshSeq(): bigint {
    this.seqCounter += 1n;
    return this.seqCounter;
  }

  private randomIds(speaker: number): ModelId[] {
    const ids: ModelId[] = [];
    const random = this.random;
    const calls = speaker === 2 ? 0 : random.int(3);
    for (let at = 0; at < calls; at++) {
      ids.push({
        rawId: pick(random, ID_SHAPES),
        kind: ROW_ID_KIND.call,
        score: 0,
        nameLen: random.int(4) === 0 ? 0 : 4,
      });
    }
    const responses = speaker === 1 ? 0 : random.int(3);
    for (let at = 0; at < responses; at++) {
      ids.push({
        rawId: pick(random, ID_SHAPES),
        kind: ROW_ID_KIND.response,
        score: random.int(4),
        nameLen: 0,
      });
    }
    return ids;
  }

  /** A row with a random speaker, ids and flags; the label is the caller's. */
  makeRow(label: bigint, owner = this.random.int(4)): ModelRow {
    const speaker = this.random.int(3);
    const parent = speaker === 1 && this.random.int(3) === 0;
    return {
      ...ZERO_FIELDS,
      label,
      owner,
      speaker,
      flags:
        pick(this.random, FLAG_CHOICES) |
        (parent ? ROW_FLAG.responseParent : 0),
      seq: this.freshSeq(),
      text: `row ${label}`,
      ids: this.randomIds(speaker),
      endpoint: parent ? pick(this.random, ENDPOINTS) : 0n,
    };
  }

  /** The same row with new content and, when `keepIds` is false, new ids; fields computed from content start missing. */
  rewritten(row: ModelRow, keepIds: boolean): ModelRow {
    const parent = (row.flags & ROW_FLAG.responseParent) !== 0;
    let flags = row.flags;
    if (!keepIds) {
      flags =
        pick(this.random, FLAG_CHOICES) |
        (parent ? ROW_FLAG.responseParent : 0);
    }
    // One rewrite in four names a new owner (design 5.1), which a mirror sees as a row that changes hands.
    const owner = this.random.int(4) === 0 ? this.random.int(4) : row.owner;
    return {
      ...ZERO_FIELDS,
      label: row.label,
      owner,
      speaker: row.speaker,
      flags,
      seq: this.freshSeq(),
      text: `rewritten ${row.label} ${this.seqCounter}`,
      ids: keepIds ? row.ids : this.randomIds(row.speaker),
      endpoint: row.endpoint,
    };
  }

  draftOf(row: ModelRow): RowDraft {
    const encoder = new TextEncoder();
    return {
      owner: row.owner,
      speaker: row.speaker,
      flags: row.flags | ROW_FLAG.curated,
      chronologySeq: row.seq,
      chronologyUserTurn: 0,
      chronologyStep: 0,
      chronologyRecordedAt: 1_900_000_000_000,
      parentEndpoint: row.endpoint,
      ids: row.ids.map((id, index) => ({ ...id, block: 1 + index })),
      meta: encoder.encode('{"speaker":"x"}'),
      blocks: [
        { type: 0, bytes: encoder.encode(row.text) },
        ...row.ids.map((id, index) => ({
          type: id.kind === ROW_ID_KIND.call ? 1 : 2,
          bytes: encoder.encode(`id ${index} ${id.rawId}`),
        })),
      ],
    };
  }

  entryFlags(row: ModelRow): number {
    const calls = row.ids.some((id) => id.kind === ROW_ID_KIND.call);
    const responses = row.ids.filter((id) => id.kind === ROW_ID_KIND.response);
    const tool = row.speaker === ROW_SPEAKER.tool;
    const self = !tool || calls || responses.length === 0;
    const splitSelf = tool && calls && responses.length === 0;
    const reconAdjacent =
      tool &&
      !calls &&
      responses.some((id) => {
        if (id.rawId === '') return false;
        const callBefore = this.rows.some(
          (other) =>
            other.label < row.label &&
            other.ids.some(
              (tuple) =>
                tuple.kind === ROW_ID_KIND.call && tuple.rawId === id.rawId,
            ),
        );
        const firstTool = this.rows.find(
          (other) =>
            other.speaker === ROW_SPEAKER.tool &&
            other.ids.some(
              (tuple) =>
                tuple.kind === ROW_ID_KIND.response && tuple.rawId === id.rawId,
            ),
        );
        return !callBefore && firstTool?.label === row.label;
      });
    return (
      row.flags |
      ROW_FLAG.curated |
      (self ? ENTRY_FLAG.self : 0) |
      (splitSelf ? ENTRY_FLAG.splitSelf : 0) |
      (reconAdjacent ? ENTRY_FLAG.reconstructedAdjacent : 0)
    );
  }

  private labelFor(): bigint {
    const label = this.next;
    this.next += LABEL_STEP;
    return label;
  }

  private freshRows(count: number): ModelRow[] {
    return Array.from({ length: count }, () => this.makeRow(this.labelFor()));
  }

  private indexes(max: number): number[] {
    const count = 1 + this.random.int(Math.min(max, this.rows.length));
    const chosen = new Set<number>();
    while (chosen.size < count) chosen.add(this.random.int(this.rows.length));
    return [...chosen].sort((left, right) => left - right);
  }

  stepAppend(): Step {
    const rows = this.freshRows(1 + this.random.int(4));
    this.rows.push(...rows);
    return {
      name: 'append',
      edits: [{ kind: 'append', rows: rows.map((r) => this.draftOf(r)) }],
      startsLineage: false,
    };
  }

  stepPop(): Step {
    return this.stepPopAt(this.random.int(this.rows.length));
  }

  /** A pop that keeps the first `at` rows. */
  stepPopAt(at: number): Step {
    const cutLabel = this.rows[at].label;
    const expectedRemoved = this.rows.length - at;
    const current = this.rows;
    let index = this.lineage.length - 1;
    while (index >= 0 && this.lineage[index].length > at) index -= 1;
    if (index < 0) {
      // No ancestor of the lineage is short enough: a rebuild of the kept rows.
      this.rows = current.slice(0, at);
    } else {
      const ancestor = this.lineage[index];
      this.rows =
        ancestor.length === at
          ? [...ancestor]
          : [...ancestor, ...current.slice(ancestor.length, at)];
      this.poppedTo = { index, exact: ancestor.length === at };
    }
    return {
      name: 'pop',
      edits: [{ kind: 'pop', cutLabel, expectedRemoved }],
      startsLineage: index < 0,
    };
  }

  /** Records the rows the group just committed in the lineage bookkeeping. */
  endGroup(step: Step): void {
    if (step.startsLineage || this.lineage.length === 0) {
      this.lineage = [[...this.rows]];
    } else {
      const kept = this.poppedTo;
      if (kept !== undefined) {
        this.lineage = this.lineage.slice(
          0,
          kept.exact ? kept.index : kept.index + 1,
        );
      }
      this.lineage.push([...this.rows]);
    }
    this.poppedTo = undefined;
  }

  /** A compression of the first `replaced` rows, or of a random number of them. */
  stepCompress(replaced = 1 + this.random.int(this.rows.length)): Step {
    const retainsRows = replaced < this.rows.length;
    const retainFromLabel = retainsRows ? this.rows[replaced].label : this.next;
    const label = retainsRows ? retainFromLabel - 1n : this.labelFor();
    const summary = { ...this.makeRow(label), text: `summary ${label}` };
    this.rows = [summary, ...this.rows.slice(replaced)];
    return {
      name: 'compress',
      edits: [
        {
          kind: 'compress',
          summary: this.draftOf(summary),
          retainFromLabel,
          expectedReplaced: replaced,
        },
      ],
      startsLineage: true,
    };
  }

  /** A replacement by `count` fresh rows, or by up to six. */
  stepReplace(count = this.random.int(7)): Step {
    const rows = this.freshRows(count);
    this.rows = rows;
    const drafts = rows.map((r) => this.draftOf(r));
    const asStream = this.random.int(2) === 0;
    async function* generate(): AsyncGenerator<RowDraft> {
      for (const draft of drafts) yield draft;
    }
    return {
      name: asStream ? 'replace-stream' : 'replace',
      edits: [{ kind: 'replace', rows: asStream ? generate() : drafts }],
      startsLineage: true,
    };
  }

  stepDensity(): Step {
    const replacements: Array<{ label: bigint; draft: RowDraft }> = [];
    const removed: bigint[] = [];
    const kept: ModelRow[] = [];
    for (const row of this.rows) {
      const roll = this.random.int(8);
      if (roll === 0) {
        removed.push(row.label);
      } else if (roll === 1 || roll === 2) {
        const next = this.rewritten(row, this.random.int(2) === 0);
        replacements.push({ label: row.label, draft: this.draftOf(next) });
        kept.push(next);
      } else {
        kept.push(row);
      }
    }
    if (replacements.length + removed.length === 0) {
      const row = this.rows[this.random.int(this.rows.length)];
      removed.push(row.label);
      this.rows = this.rows.filter((r) => r.label !== row.label);
    } else {
      this.rows = kept;
    }
    return {
      name: 'density',
      edits: [{ kind: 'density', replacements, removed }],
      startsLineage: true,
    };
  }

  stepPurge(): Step {
    const rows: Array<{ label: bigint; draft: RowDraft }> = [];
    for (const at of this.indexes(3)) {
      const next = this.rewritten(this.rows[at], this.random.int(2) === 0);
      this.rows[at] = next;
      rows.push({ label: next.label, draft: this.draftOf(next) });
    }
    return {
      name: 'purge',
      edits: [{ kind: 'purge', rows }],
      startsLineage: true,
    };
  }

  /** An insert after a random live row; undefined when the neighbours leave no label between them. */
  stepInsert(): Step | undefined {
    const at = this.random.int(this.rows.length + 1) - 1;
    const afterLabel = at < 0 ? 0n : this.rows[at].label;
    const upper =
      at + 1 < this.rows.length ? this.rows[at + 1].label : this.next;
    const label = labelBetween(afterLabel, upper);
    if (label === undefined) return undefined;
    const row = { ...this.makeRow(label), text: `inserted ${label}` };
    this.rows.splice(at + 1, 0, row);
    return {
      name: 'insert',
      edits: [{ kind: 'insert', afterLabel, draft: this.draftOf(row) }],
      startsLineage: true,
    };
  }

  stepOwner(): Step {
    const changes = this.indexes(4).map((at) => {
      const owner = this.random.int(6);
      this.rows[at] = { ...this.rows[at], owner };
      return { label: this.rows[at].label, owner };
    });
    return {
      name: 'owner',
      edits: [{ kind: 'owner', changes }],
      startsLineage: true,
    };
  }

  stepFill(): Step {
    const fills: EntryFill[] = this.indexes(4).map((at) => {
      const random = this.random;
      const tokens: RowEntry['tokens'] = [
        [random.int(500), random.int(500), 0, 0],
        [0, random.int(500), 0, 0],
        [0, 0, random.int(500), 0],
      ];
      const media: RowEntry['media'] = {
        mediaChars: random.int(1000),
        imageChars: [random.int(100), 0, 0],
        pdfBytes: [0, random.int(100), 0],
      };
      const lensRef: RowEntry['lensRef'] = [random.int(9999), 0, 0];
      this.rows[at] = { ...this.rows[at], tokens, media, lensRef };
      return { label: this.rows[at].label, tokens, media, lensRef };
    });
    return {
      name: 'fill',
      edits: [{ kind: 'fill', fills }],
      startsLineage: false,
    };
  }

  stepClear(): Step {
    this.rows = [];
    return {
      name: 'clear',
      edits: [{ kind: 'clear' }],
      startsLineage: true,
    };
  }

  stepRestore(saved: SavedVersion): Step {
    this.rows = [...saved.rows];
    return {
      name: 'restore',
      edits: [{ kind: 'restore', saved: saved.version }],
      startsLineage: true,
    };
  }

  stepCheckpoint(index: number): Step {
    return {
      name: 'checkpoint',
      edits: [
        {
          kind: 'checkpoint',
          id: `c${index}`,
          name: `checkpoint ${index}`,
          createdAtMs: 1_900_000_000_000 + index,
        },
      ],
      startsLineage: false,
    };
  }

  /** Several primitives in one group, applied in order. */
  stepCombo(): Step {
    const parts: Step[] = [];
    switch (this.random.int(5)) {
      case 0:
        parts.push(this.stepPop(), this.stepAppend());
        break;
      case 1:
        parts.push(this.stepAppend(), this.stepOwner());
        break;
      case 2:
        parts.push(this.stepOwner(), this.stepFill());
        break;
      case 3:
        parts.push(this.stepDensity(), this.stepAppend());
        break;
      default:
        parts.push(this.stepCompress(), this.stepOwner());
        break;
    }
    return {
      name: parts.map((part) => part.name).join('+'),
      edits: parts.flatMap((part) => part.edits),
      startsLineage: parts.some((part) => part.startsLineage),
    };
  }
}

export { CHRONOLOGY_SEQ_NONE };

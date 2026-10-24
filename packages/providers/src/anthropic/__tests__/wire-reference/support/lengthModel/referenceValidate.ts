/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0, reference machine stage 2: a port of the validator
 * passes (`validation.ts`) that records its decisions as overlay facts. The
 * validators decide by tool id over the whole history, which cannot be
 * finite-state, so the length model reads these facts instead. In the
 * product they come from the converted-id occurrence index.
 */

import { tagMediaPurgeBoundaryBlock } from '../../../../AnthropicMediaPurgeCache.js';
import {
  cacheable,
  dropKey,
  emptyOverlay,
  type Assembled,
  type OBlock,
  type OMsg,
  type Overlay,
} from './referenceTypes.js';
import { blockFact, type BlockFact, type UnitFact } from './unitFacts.js';

interface Loc {
  msg: OMsg;
  blk: OBlock;
}

interface Removal extends Loc {
  id: string;
}

export interface Validated {
  msgs: OMsg[];
  overlay: Overlay[];
  repaired: boolean;
}

function interrupted(id: string): BlockFact {
  return blockFact({
    type: 'tool_result',
    tool_use_id: id,
    content: '[tool execution interrupted]',
    is_error: true,
  });
}

function wrap(fact: BlockFact): OBlock {
  return { f: fact, obj: fact.obj, anchored: false };
}

function attachOf(message: OMsg): { unit: number; atom: number } {
  return message.atoms[message.atoms.length - 1];
}

class Validator {
  private list: OMsg[];
  private readonly overlay: Overlay[];
  private repaired = false;
  private readonly uses = new Set<string>();
  private readonly results = new Map<string, Loc[]>();
  private nextId: number;

  constructor(
    private readonly asm: Assembled,
    units: readonly UnitFact[],
  ) {
    this.list = asm.msgs.slice();
    this.overlay = units.map(emptyOverlay);
    this.nextId = asm.nextId;
    for (const message of this.list) {
      for (const blk of message.blocks) {
        if (message.role === 'A' && blk.obj.type === 'tool_use') {
          this.uses.add(blk.obj.id);
        } else if (message.role === 'U' && blk.obj.type === 'tool_result') {
          this.addResult(blk.obj.tool_use_id, { msg: message, blk });
        }
      }
    }
  }

  run(): Validated {
    this.filterOrphans();
    this.repairAdjacency();
    return {
      msgs: this.list,
      overlay: this.overlay,
      repaired: this.repaired,
    };
  }

  private addResult(id: string, loc: Loc): void {
    this.results.set(id, [...(this.results.get(id) ?? []), loc]);
  }

  private removeResult(id: string, msg: OMsg, blk: OBlock): boolean {
    const locs = this.results.get(id) ?? [];
    const kept = locs.filter((loc) => loc.msg !== msg || loc.blk !== blk);
    if (kept.length === locs.length) return false;
    this.results.set(id, kept);
    return true;
  }

  private recordDrop(blk: OBlock): void {
    this.repaired = true;
    if (blk.origin === undefined) return;
    this.overlay[blk.origin.unit].drop.add(
      dropKey(blk.origin.atom, blk.origin.idx),
    );
  }

  private recordVanish(message: OMsg): void {
    this.repaired = true;
    for (const atom of message.atoms) {
      this.overlay[atom.unit].vanish.add(atom.atom);
    }
  }

  private filterOrphans(): void {
    let orphaned = false;
    for (const message of this.list) {
      if (message.role !== 'U') continue;
      const keep: OBlock[] = [];
      for (const blk of message.blocks) {
        if (
          blk.obj.type === 'tool_result' &&
          !this.uses.has(blk.obj.tool_use_id)
        ) {
          this.removeResult(blk.obj.tool_use_id, message, blk);
          this.recordDrop(blk);
          orphaned = true;
        } else {
          keep.push(blk);
        }
      }
      message.blocks = keep;
    }
    if (!orphaned) return;
    const next: OMsg[] = [];
    for (const message of this.list) {
      if (
        message.role === 'U' &&
        message.text === undefined &&
        message.blocks.length === 0
      ) {
        this.recordVanish(message);
      } else {
        next.push(message);
      }
    }
    this.list = next;
  }

  private repairAdjacency(): void {
    for (let pos = 0; pos < this.list.length; pos += 1) {
      const assistant = this.list[pos];
      if (assistant.role !== 'A') continue;
      if (pos + 1 < this.list.length && this.list[pos + 1].role === 'U') {
        this.repairBefore(assistant, this.list[pos + 1]);
      } else {
        this.insertMissing(assistant, pos);
      }
    }
  }

  /** The earliest later message that holds the result, with its block. */
  private sourceOf(wanted: string, next: OMsg): Loc | undefined {
    const later = (this.results.get(wanted) ?? []).filter(
      (loc) => loc.msg.id > next.id && loc.msg.id < this.asm.nextId,
    );
    if (later.length === 0) return undefined;
    const first = Math.min(...later.map((loc) => loc.msg.id));
    const inFirst = later.filter((loc) => loc.msg.id === first);
    if (inFirst.length === 1) return inFirst[0];
    const msg = inFirst[0].msg;
    const blk = msg.blocks.find(
      (candidate) =>
        candidate.obj.type === 'tool_result' &&
        candidate.obj.tool_use_id === wanted,
    );
    if (blk === undefined) {
      throw new Error('index lists a result the message does not hold');
    }
    return { msg, blk };
  }

  private removeSources(removals: readonly Removal[]): void {
    for (const removal of removals) {
      if (!this.removeResult(removal.id, removal.msg, removal.blk)) continue;
      this.recordDrop(removal.blk);
      removal.msg.blocks = removal.msg.blocks.filter(
        (candidate) => candidate !== removal.blk,
      );
      if (removal.msg.blocks.length === 0 && removal.msg.text === undefined) {
        this.recordVanish(removal.msg);
        this.list = this.list.filter((candidate) => candidate !== removal.msg);
      }
    }
  }

  private repairBefore(assistant: OMsg, next: OMsg): void {
    const collected: OBlock[] = [];
    const removals: Removal[] = [];
    for (const blk of assistant.blocks) {
      this.gather(blk, next, collected, removals);
    }
    this.removeSources(removals);
    if (collected.length === 0) return;
    this.repaired = true;
    this.blockifyNext(next);
    for (const blk of collected) {
      if (blk.obj.type === 'tool_result') {
        this.addResult(blk.obj.tool_use_id, { msg: next, blk });
      }
    }
    next.blocks = [...collected, ...next.blocks];
    this.recordAfter(assistant, collected);
  }

  /** What one tool use of the assistant message needs in the message after it. */
  private gather(
    blk: OBlock,
    next: OMsg,
    collected: OBlock[],
    removals: Removal[],
  ): void {
    if (blk.obj.type !== 'tool_use') return;
    const wanted = blk.obj.id;
    const locs = this.results.get(wanted) ?? [];
    if (locs.some((loc) => loc.msg === next)) return;
    const source = this.sourceOf(wanted, next);
    if (source === undefined) {
      collected.push(wrap(interrupted(wanted)));
      return;
    }
    removals.push({ ...source, id: wanted });
    collected.push({
      f: source.blk.f,
      obj: source.blk.obj,
      anchored: source.blk.anchored,
    });
  }

  private blockifyNext(next: OMsg): void {
    if (next.text === undefined) return;
    const fact = blockFact({ type: 'text', text: next.text });
    next.blocks = [
      {
        f: fact,
        obj: fact.obj,
        anchored: next.anchorText === true && cacheable(fact.obj),
      },
      ...next.blocks,
    ];
    if (next.purgeText !== undefined) {
      tagMediaPurgeBoundaryBlock(fact.obj, next.purgeText);
    }
    delete next.text;
    delete next.anchorText;
    delete next.purgeText;
  }

  private recordAfter(assistant: OMsg, inserted: readonly OBlock[]): void {
    const at = attachOf(assistant);
    this.overlay[at.unit].after.set(at.atom, {
      role: 'U',
      isResults: true,
      blocks: inserted.map((blk) => blk.f),
    });
  }

  private insertMissing(assistant: OMsg, pos: number): void {
    const missing: OBlock[] = [];
    for (const blk of assistant.blocks) {
      if (
        blk.obj.type === 'tool_use' &&
        (this.results.get(blk.obj.id) ?? []).length === 0
      ) {
        missing.push(wrap(interrupted(blk.obj.id)));
      }
    }
    if (missing.length === 0) return;
    this.repaired = true;
    const inserted: OMsg = {
      id: this.nextId,
      role: 'U',
      blocks: missing,
      atoms: [],
    };
    this.nextId += 1;
    this.list.splice(pos + 1, 0, inserted);
    for (const blk of missing) {
      if (blk.obj.type === 'tool_result') {
        this.addResult(blk.obj.tool_use_id, { msg: inserted, blk });
      }
    }
    this.recordAfter(assistant, missing);
  }
}

export function validate(
  asm: Assembled,
  units: readonly UnitFact[],
): Validated {
  return new Validator(asm, units).run();
}

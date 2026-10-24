/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0, reference machine stage 1: a port of `wire-builder.ts`
 * onto plain arrays of unit facts. Test-side code: it holds whole histories.
 */

import {
  OutOfDomain,
  cacheable,
  type Assembled,
  type OBlock,
  type OMsg,
  type Policy,
} from './referenceTypes.js';
import type { AtomFact, BlockFact, UnitFact } from './unitFacts.js';

function chainEnd(units: readonly UnitFact[], start: number): number {
  if (!units[start].chainStart) return start;
  let end = start;
  for (let at = start + 1; at < units.length; at += 1) {
    if (units[at].speaker !== 'ai') break;
    end = at;
  }
  return end;
}

/** Start of the last group of AI units that holds thinking, or -1. */
export function lastThinkingGroup(units: readonly UnitFact[]): number {
  let last = -1;
  let skipThrough = -1;
  units.forEach((unit, at) => {
    if (at <= skipThrough || unit.speaker !== 'ai') return;
    skipThrough = chainEnd(units, at);
    if (unit.hasThinking) last = at;
  });
  return last;
}

function redactsGroup(
  policy: Policy,
  start: number,
  lastThinking: number,
): boolean {
  return (
    policy.includeInContext === false ||
    policy.strip === 'all' ||
    (policy.strip === 'allButLast' && start !== lastThinking)
  );
}

/** The chain path orders blocks by their source block. */
function chainPriority(fact: BlockFact, source: UnitFact): number {
  if (fact.src === undefined) {
    throw new Error('a chain block carries no source index');
  }
  const block = source.row.blocks[fact.src];
  if (block.type === 'thinking' && block.sourceField === 'thinking') return 0;
  if (block.type === 'text' || block.type === 'code') return 1;
  return block.type === 'tool_call' ? 3 : 2;
}

function toOBlocks(
  blocks: readonly BlockFact[],
  unit: number,
  atom: number,
  keepAnchor: boolean,
): OBlock[] {
  return blocks.map((fact, idx) => ({
    f: fact,
    obj: fact.obj,
    origin: { unit, atom, idx },
    anchored: keepAnchor && fact.anchored,
  }));
}

class Assembler {
  private readonly msgs: OMsg[] = [];
  private nextId = 0;
  private pending: OMsg | null = null;
  private anchorPending = false;
  private readonly out: Assembled;

  constructor(
    private readonly units: readonly UnitFact[],
    private readonly policy: Policy,
  ) {
    this.out = {
      msgs: this.msgs,
      nextId: 0,
      chainContext: units.map(() => false),
      redacted: units.map(() => false),
      dropped: units.map(() => false),
    };
  }

  run(): Assembled {
    const needsLast =
      this.policy.includeInContext !== false &&
      this.policy.strip === 'allButLast';
    const lastThinking = needsLast ? lastThinkingGroup(this.units) : -1;
    let leading = true;
    let at = 0;
    while (at < this.units.length) {
      if (leading && this.units[at].speaker === 'tool') {
        this.out.dropped[at] = true;
        at += 1;
      } else {
        leading = false;
        at = this.visit(at, lastThinking);
      }
    }
    this.flushAnchor(this.pending !== null);
    this.out.nextId = this.nextId;
    return this.out;
  }

  /** Appends the row or chain group that starts at `at`; returns the next index. */
  private visit(at: number, lastThinking: number): number {
    const redact = redactsGroup(this.policy, at, lastThinking);
    const end = chainEnd(this.units, at);
    this.out.redacted[at] = redact;
    if (end === at) {
      this.appendRow(this.units[at], redact);
      return at + 1;
    }
    for (let member = at; member <= end; member += 1) {
      this.out.chainContext[member] = true;
      this.out.redacted[member] = redact;
    }
    this.appendChain(at, end, redact);
    return end + 1;
  }

  private append(message: Omit<OMsg, 'id'>): OMsg {
    const msg: OMsg = { ...message, id: this.nextId };
    this.nextId += 1;
    this.msgs.push(msg);
    return msg;
  }

  private markAnchor(message: OMsg): void {
    if (message.text !== undefined) {
      if (message.text.trim().length > 0) message.anchorText = true;
      return;
    }
    for (let at = message.blocks.length - 1; at >= 0; at -= 1) {
      if (cacheable(message.blocks[at].obj)) {
        message.blocks[at].anchored = true;
        return;
      }
    }
  }

  private flushAnchor(flushed: boolean): void {
    if (this.anchorPending && flushed) {
      this.markAnchor(this.msgs[this.msgs.length - 1]);
    }
    this.anchorPending = false;
  }

  private appendResult(unit: UnitFact, atom: AtomFact): OMsg {
    if (atom.blocks === undefined) {
      throw new Error('Tool-result message must have blocks');
    }
    const target =
      this.pending ?? this.append({ role: 'U', blocks: [], atoms: [] });
    target.atoms.push({ unit: unit.index, atom: 0 });
    target.blocks.push(...toOBlocks(atom.blocks, unit.index, 0, false));
    return target;
  }

  private appendRow(unit: UnitFact, redact: boolean): void {
    const atoms = unit.atoms[redact ? 1 : 0];
    let open = this.pending;
    if (unit.hasResponses) open = this.appendResult(unit, atoms[0]);
    if (unit.speaker === 'tool') {
      this.pending = open;
      if (unit.anchorMeta) this.anchorPending = true;
      return;
    }
    this.flushAnchor(open !== null);
    atoms.forEach((atom, atomIndex) => {
      if (unit.hasResponses && atomIndex === 0) return;
      this.appendAtom(unit, atom, atomIndex);
    });
    if (unit.speaker === 'human' && unit.anchorMeta && unit.onlyToolResponses) {
      this.anchorPending = true;
    }
    this.pending = null;
  }

  private appendAtom(unit: UnitFact, atom: AtomFact, atomIndex: number): void {
    const atoms = [{ unit: unit.index, atom: atomIndex }];
    if (atom.str !== undefined) {
      this.append({
        role: atom.role,
        text: atom.str.text,
        anchorText: atom.str.anchored ? true : undefined,
        purgeText: atom.str.purge,
        blocks: [],
        atoms,
      });
      return;
    }
    this.append({
      role: atom.role,
      blocks: toOBlocks(atom.blocks ?? [], unit.index, atomIndex, true),
      atoms,
    });
  }

  private appendChain(start: number, end: number, redact: boolean): void {
    for (let at = start; at <= end; at += 1) {
      if (this.units[at].hasResponses) {
        throw new OutOfDomain('chain row carries tool results');
      }
    }
    this.flushAnchor(this.pending !== null);
    const msg = this.append({ role: 'A', blocks: [], atoms: [] });
    for (let category = 0; category < 4; category += 1) {
      for (let at = start; at <= end; at += 1) {
        const unit = this.units[at];
        unit.chain[redact ? 1 : 0].forEach((fact, idx) => {
          if (chainPriority(fact, unit) !== category) return;
          msg.blocks.push({
            f: fact,
            obj: fact.obj,
            origin: { unit: at, atom: 0, idx },
            anchored: false,
          });
        });
      }
    }
    for (let at = start; at <= end; at += 1) {
      msg.atoms.push({ unit: at, atom: 0 });
    }
    if (msg.blocks.length === 0) msg.text = '';
    if (this.units[end].anchorMeta) this.markAnchor(msg);
    this.pending = null;
  }
}

export function assemble(
  units: readonly UnitFact[],
  policy: Policy,
): Assembled {
  return new Assembler(units, policy).run();
}

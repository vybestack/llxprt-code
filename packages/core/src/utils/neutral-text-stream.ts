/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NeutralPrefixCount } from './neutral-prefix-count.js';
import {
  isNeutralWhitespace,
  neutralCharacterKey,
  neutralPatternMachines,
} from './neutral-pattern-machine.js';

const characters = new Map<
  string,
  { readonly bytes: Buffer; readonly key: string }
>();
function characterData(value: string): {
  readonly bytes: Buffer;
  readonly key: string;
} {
  const known = characters.get(value);
  if (known !== undefined) return known;
  const data = { bytes: Buffer.from(value), key: neutralCharacterKey(value) };
  if (characters.size < 256) characters.set(value, data);
  return data;
}

interface Accepted {
  readonly count: number;
  suffix?: NeutralLexemeStream;
}

interface ShortState {
  readonly states: readonly number[];
  readonly counts: ReadonlyArray<number | undefined>;
  readonly prefix: string;
}
interface ShortTransition {
  readonly state: ShortState;
  readonly added: number;
}

class NeutralLexemeStream {
  private states = neutralPatternMachines.map((machine) => machine.start);
  private accepted: Array<Accepted | undefined> = neutralPatternMachines.map(
    () => undefined,
  );
  private piece: NeutralPrefixCount | undefined;
  private total = 0;
  private transitions: Map<string, ShortTransition> | undefined;

  appendText(text: string): void {
    const before = this.shortState();
    const key =
      before === undefined ? undefined : JSON.stringify([before, text]);
    const known = key === undefined ? undefined : this.transitions?.get(key);
    if (known !== undefined) {
      this.total += known.added;
      this.states = [...known.state.states];
      this.accepted = known.state.counts.map((count) =>
        count === undefined ? undefined : { count },
      );
      this.piece = NeutralPrefixCount.fromPrefix(known.state.prefix);
      return;
    }
    const total = this.total;
    for (const value of text) {
      const data = characterData(value);
      this.append(value, data.bytes, data.key);
    }
    const after = this.shortState();
    if (key !== undefined && after !== undefined) {
      this.transitions ??= new Map();
      if (this.transitions.size < 128)
        this.transitions.set(key, { state: after, added: this.total - total });
    }
  }

  private shortState(): ShortState | undefined {
    if (this.accepted.some((value) => value?.suffix !== undefined))
      return undefined;
    const prefix = this.piece === undefined ? '' : this.piece.shortPrefix();
    if (prefix === undefined || prefix.length > 64) return undefined;
    return {
      states: this.states,
      counts: this.accepted.map((value) => value?.count),
      prefix,
    };
  }

  append(value: string, bytes: Buffer, key: string): void {
    const before = this.piece?.count ?? 0;
    const next = this.states.map((state, index) =>
      neutralPatternMachines[index].advance(state, value, key),
    );
    if (next.some((state) => state >= 0)) {
      this.piece ??= new NeutralPrefixCount();
      this.piece.append(bytes);
    }
    for (const [index, machine] of neutralPatternMachines.entries()) {
      const accepts = machine.lookaheadWhitespace
        ? machine.accepting(this.states[index]) && isNeutralWhitespace(value)
        : machine.accepting(next[index]);
      if (accepts) {
        const saved: Accepted = {
          count: machine.lookaheadWhitespace
            ? before
            : (this.piece?.count ?? 0),
        };
        this.accepted[index] = saved;
        if (machine.lookaheadWhitespace) {
          saved.suffix = new NeutralLexemeStream();
          saved.suffix.append(value, bytes, key);
        }
      } else {
        const saved = this.accepted[index];
        if (saved !== undefined) {
          saved.suffix ??= new NeutralLexemeStream();
          saved.suffix.append(value, bytes, key);
        }
      }
    }
    this.states = next;
    if (next.every((state) => state < 0)) this.resolve();
  }

  finish(): number {
    const lookahead = neutralPatternMachines.findIndex(
      (machine) => machine.lookaheadWhitespace,
    );
    if (neutralPatternMachines[lookahead].accepting(this.states[lookahead]))
      this.accepted[lookahead] = { count: this.piece?.count ?? 0 };
    const chosen = this.accepted.find((value) => value !== undefined);
    return (
      this.total +
      (chosen === undefined ? 0 : chosen.count + (chosen.suffix?.finish() ?? 0))
    );
  }

  private resolve(): void {
    const chosen = this.accepted.find((value) => value !== undefined);
    if (chosen === undefined)
      throw new Error('Neutral pattern did not cover input');
    const suffix = chosen.suffix ?? new NeutralLexemeStream();
    this.total += chosen.count + suffix.total;
    this.states = suffix.states;
    this.accepted = suffix.accepted;
    this.piece = suffix.piece;
  }
}

/** Ordered regex alternatives retain counts and finite suffix states, never text. */
export class NeutralTextStream {
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  private readonly stream = new NeutralLexemeStream();
  private finished = false;
  append(part: Uint8Array): void {
    if (this.finished) throw new Error('Neutral text stream is finished');
    this.text(this.decoder.decode(part, { stream: true }));
  }
  finish(): number {
    if (this.finished) throw new Error('Neutral text stream is finished');
    this.finished = true;
    this.text(this.decoder.decode());
    return this.stream.finish();
  }
  private text(text: string): void {
    for (let start = 0; start < text.length; ) {
      const space = text.indexOf(' ', start);
      let end = Math.min(
        text.length,
        start + 128,
        space < 0 ? text.length : space + 1,
      );
      if (end < text.length && /[\ud800-\udbff]/u.test(text[end - 1])) end++;
      this.stream.appendText(text.slice(start, end));
      start = end;
    }
  }
}

export async function countNeutralTextStream(
  parts: AsyncIterable<Uint8Array>,
): Promise<number> {
  const counter = new NeutralTextStream();
  for await (const part of parts) counter.append(part);
  return counter.finish();
}

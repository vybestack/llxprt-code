/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the Anthropic length model as a deterministic
 * finite-state transducer over the unit stream, and its transfer summaries.
 *
 * Boundary state (10 states, proved closed by `assertClosed` in the checks):
 *   lead  : no non-tool unit has been admitted yet (tool units are dropped)
 *   chain : the previous unit opened or continued a thinking chain
 *   run   : the open final message (a maximal run of one role)
 *             N       no message yet
 *             xE      role x, nothing kept so far (would print the placeholder)
 *             xS      role x, exactly one non-blank string-content atom
 *             xB      role x, array content with at least one kept block
 *
 * A unit contributes by (its stored facts, boundary state). A node summary is
 * a total function from the 10 incoming states to (outgoing state, bytes,
 * run openings). Composition is function composition. Test-side code.
 */

import { getEmptyMessagePlaceholder } from '../../../../AnthropicMessageValidator.js';
import { modelSupportsPrefill } from '../../../../AnthropicModelData.js';
import type { Overlay } from './referenceTypes.js';
import { jsonBytes, type AtomFact, type UnitFact } from './unitFacts.js';

export type Run = 'N' | 'UE' | 'US' | 'UB' | 'AE' | 'AS' | 'AB';

export interface St {
  readonly lead: 0 | 1;
  readonly chain: 0 | 1;
  readonly run: Run;
}

export const STATES: readonly St[] = [
  { lead: 1, chain: 0, run: 'N' },
  { lead: 0, chain: 0, run: 'N' },
  { lead: 0, chain: 0, run: 'UE' },
  { lead: 0, chain: 0, run: 'US' },
  { lead: 0, chain: 0, run: 'UB' },
  { lead: 0, chain: 0, run: 'AE' },
  { lead: 0, chain: 0, run: 'AS' },
  { lead: 0, chain: 0, run: 'AB' },
  { lead: 0, chain: 1, run: 'AE' },
  { lead: 0, chain: 1, run: 'AB' },
];
export const START = 0;

const stateKey = (state: St): string =>
  `${state.lead}${state.chain}${state.run}`;
const INDEX = new Map(STATES.map((state, at) => [stateKey(state), at]));

export function indexOf(state: St): number {
  const at = INDEX.get(stateKey(state));
  if (at === undefined) {
    throw new Error(`state outside the proved set: ${stateKey(state)}`);
  }
  return at;
}

export const C = {
  frameU: jsonBytes({ role: 'user', content: '' }) - 2,
  frameA: jsonBytes({ role: 'assistant', content: '' }) - 2,
  cont: jsonBytes('Continue the conversation'),
  hello: jsonBytes('Hello'),
  phU: jsonBytes(getEmptyMessagePlaceholder('user')),
  phA: jsonBytes(getEmptyMessagePlaceholder('assistant')),
  /** `{"type":"text","text":` plus `}`: what blockify adds around a string. */
  blockify: jsonBytes({ type: 'text', text: '' }) - 2,
};

type Role = 'U' | 'A';
const frame = (role: Role): number => (role === 'U' ? C.frameU : C.frameA);
const placeholder = (role: string): number => (role === 'U' ? C.phU : C.phA);

export interface AtomSum {
  readonly role: Role;
  readonly kind: 'str' | 'arr';
  /** str: JSON bytes of the string. */
  readonly s: number;
  readonly blank: boolean;
  /** arr: kept (non-blank-text) block count and their bytes. */
  readonly k: number;
  readonly b: number;
}

const NO_OVERLAY: Overlay = {
  drop: new Set(),
  vanish: new Set(),
  after: new Map(),
};

export function atomSum(
  atom: AtomFact,
  atomIndex: number,
  overlay: Overlay,
): AtomSum {
  if (atom.str !== undefined) {
    return {
      role: atom.role,
      kind: 'str',
      s: atom.str.bytes,
      blank: atom.str.blank,
      k: 0,
      b: 0,
    };
  }
  let k = 0;
  let b = 0;
  (atom.blocks ?? []).forEach((blk, at) => {
    if (overlay.drop.has(`${atomIndex}:${at}`) || blk.blank) return;
    k += 1;
    b += blk.bytes;
  });
  return { role: atom.role, kind: 'arr', s: 0, blank: k === 0, k, b };
}

/** Atom summary of the thinking-chain path for an AI unit. */
export function chainAtomSum(unit: UnitFact, mode: 0 | 1): AtomSum {
  let k = 0;
  let b = 0;
  for (const blk of unit.chain[mode]) {
    if (blk.blank) continue;
    k += 1;
    b += blk.bytes;
  }
  return { role: 'A', kind: 'arr', s: 0, blank: k === 0, k, b };
}

interface Delta {
  readonly run: Run;
  readonly bytes: number;
  readonly opens: number;
}

/** An atom meeting a run of another role (or none): the run closes, a new one opens. */
function openRun(run: Run, atom: AtomSum, blockBytes: number): Delta {
  let bytes = 0;
  let opens = 1;
  if (run !== 'N') {
    if (run[1] === 'E') bytes += placeholder(run[0]);
    bytes += 1;
  } else if (atom.role === 'A') {
    bytes += C.frameU + C.cont + 1;
    opens += 1;
  }
  bytes += frame(atom.role);
  if (atom.blank) return { run: `${atom.role}E` as Run, bytes, opens };
  if (atom.kind === 'str') {
    return { run: `${atom.role}S` as Run, bytes: bytes + atom.s, opens };
  }
  return {
    run: `${atom.role}B` as Run,
    bytes: bytes + 2 + blockBytes,
    opens,
  };
}

export function applyAtom(run: Run, atom: AtomSum): Delta {
  const blank = atom.kind === 'str' ? atom.blank : atom.k === 0;
  const blockBytes =
    atom.kind === 'str' ? atom.s + C.blockify : atom.b + atom.k - 1;
  if (run === 'N' || run[0] !== atom.role) {
    return openRun(run, { ...atom, blank }, blockBytes);
  }
  const tag = run[1];
  if (tag === 'E') {
    if (blank) return { run, bytes: 0, opens: 0 };
    return { run: `${atom.role}B` as Run, bytes: 2 + blockBytes, opens: 0 };
  }
  if (tag === 'S') {
    return {
      run: `${atom.role}B` as Run,
      bytes: blank ? C.blockify + 2 : C.blockify + 2 + 1 + blockBytes,
      opens: 0,
    };
  }
  return { run, bytes: blank ? 0 : 1 + blockBytes, opens: 0 };
}

export interface UnitSteps {
  readonly speaker: UnitFact['speaker'];
  readonly chainStart: boolean;
  readonly atoms: readonly AtomSum[];
  readonly chainAtom: AtomSum;
  readonly vanish: ReadonlySet<number>;
  readonly after: ReadonlyMap<number, AtomSum>;
}

export function unitSteps(
  unit: UnitFact,
  mode: 0 | 1,
  overlay: Overlay,
): UnitSteps {
  const after = new Map<number, AtomSum>();
  for (const [at, atom] of overlay.after) {
    after.set(at, atomSum(atom, 0, NO_OVERLAY));
  }
  return {
    speaker: unit.speaker,
    chainStart: unit.chainStart,
    atoms: unit.atoms[mode].map((atom, at) => atomSum(atom, at, overlay)),
    chainAtom: chainAtomSum(unit, mode),
    vanish: overlay.vanish,
    after,
  };
}

export interface StepResult {
  readonly st: St;
  readonly bytes: number;
  readonly opens: number;
}

export function step(state: St, unit: UnitSteps): StepResult {
  if (unit.speaker === 'tool' && state.lead === 1) {
    return { st: state, bytes: 0, opens: 0 };
  }
  const inChain = state.chain === 1 && unit.speaker === 'ai';
  const list = inChain ? [unit.chainAtom] : unit.atoms;
  let run = state.run;
  let bytes = 0;
  let opens = 0;
  const emit = (atom: AtomSum): void => {
    const delta = applyAtom(run, atom);
    run = delta.run;
    bytes += delta.bytes;
    opens += delta.opens;
  };
  list.forEach((atom, at) => {
    if (!unit.vanish.has(at)) emit(atom);
    const extra = unit.after.get(at);
    if (extra !== undefined) emit(extra);
  });
  const wantsChain =
    unit.speaker === 'ai' && (state.chain === 1 || unit.chainStart);
  const chain: 0 | 1 = wantsChain && (run === 'AE' || run === 'AB') ? 1 : 0;
  return { st: { lead: 0, chain, run }, bytes, opens };
}

// --------------------------------------------------------------------------
// Transfer summaries

export interface Summary {
  readonly out: readonly number[];
  readonly bytes: readonly number[];
  readonly opens: readonly number[];
  /** Pure chain automaton and the last group start that holds thinking. */
  readonly cOut: readonly [number, number];
  readonly lastL: readonly [number, number];
}

export const IDENTITY: Summary = {
  out: STATES.map((_, at) => at),
  bytes: STATES.map(() => 0),
  opens: STATES.map(() => 0),
  cOut: [0, 1],
  lastL: [-1, -1],
};

export function leaf(unit: UnitFact, steps: UnitSteps): Summary {
  const out: number[] = [];
  const bytes: number[] = [];
  const opens: number[] = [];
  for (const state of STATES) {
    const result = step(state, steps);
    out.push(indexOf(result.st));
    bytes.push(result.bytes);
    opens.push(result.opens);
  }
  const ai = unit.speaker === 'ai';
  const cOut: [number, number] = [ai && unit.chainStart ? 1 : 0, ai ? 1 : 0];
  const lastL: [number, number] = [
    ai && unit.hasThinking ? unit.index : -1,
    -1,
  ];
  return { out, bytes, opens, cOut, lastL };
}

export function compose(a: Summary, b: Summary): Summary {
  const out: number[] = [];
  const bytes: number[] = [];
  const opens: number[] = [];
  for (let state = 0; state < STATES.length; state += 1) {
    const mid = a.out[state];
    out.push(b.out[mid]);
    bytes.push(a.bytes[state] + b.bytes[mid]);
    opens.push(a.opens[state] + b.opens[mid]);
  }
  const cOut: [number, number] = [b.cOut[a.cOut[0]], b.cOut[a.cOut[1]]];
  const through = (c: 0 | 1): number => {
    const viaB = b.lastL[a.cOut[c]];
    return viaB >= 0 ? viaB : a.lastL[c];
  };
  return { out, bytes, opens, cOut, lastL: [through(0), through(1)] };
}

export const sameSummary = (x: Summary, y: Summary): boolean =>
  JSON.stringify(x) === JSON.stringify(y);

export interface Final {
  readonly length: number;
  readonly messages: number;
}

export interface FinishOpts {
  readonly reasoningEnabled: boolean;
  readonly currentModel?: string;
}

/** Messages array length from a root summary: the end-of-stream fix-ups. */
export function finalize(sum: Summary, options: FinishOpts): Final {
  const end = STATES[sum.out[START]];
  let bytes = sum.bytes[START] + 2;
  let messages = sum.opens[START];
  if (end.run === 'N') {
    bytes += C.frameU + C.hello;
    messages += 1;
  } else if (end.run[1] === 'E') {
    bytes += placeholder(end.run[0]);
  }
  if (
    end.run[0] === 'A' &&
    (options.reasoningEnabled || !modelSupportsPrefill(options.currentModel))
  ) {
    bytes += 1 + C.frameU + C.cont;
    messages += 1;
  }
  return { length: bytes, messages };
}

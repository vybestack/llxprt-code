/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import type {
  AnthropicSummary,
  TransferTable,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { getEmptyMessagePlaceholder } from './AnthropicMessageValidator.js';
import { modelSupportsPrefill } from './AnthropicModelData.js';
import type {
  AnthropicAtom,
  AnthropicUnitFacts,
} from './anthropic-unit-facts.js';
export {
  anthropicUnitFacts,
  type AnthropicAtom,
} from './anthropic-unit-facts.js';

type Role = 'user' | 'assistant';
type Run =
  | 'none'
  | 'user-empty'
  | 'user-string'
  | 'user-blocks'
  | 'assistant-empty'
  | 'assistant-string'
  | 'assistant-blocks';
interface State {
  readonly leading: boolean;
  readonly chain: boolean;
  readonly run: Run;
}
const STATES: readonly State[] = [
  { leading: true, chain: false, run: 'none' },
  { leading: false, chain: false, run: 'none' },
  { leading: false, chain: false, run: 'user-empty' },
  { leading: false, chain: false, run: 'user-string' },
  { leading: false, chain: false, run: 'user-blocks' },
  { leading: false, chain: false, run: 'assistant-empty' },
  { leading: false, chain: false, run: 'assistant-string' },
  { leading: false, chain: false, run: 'assistant-blocks' },
  { leading: false, chain: true, run: 'assistant-empty' },
  { leading: false, chain: true, run: 'assistant-blocks' },
];
const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value));
const BLOCKIFY = jsonBytes({ type: 'text', text: '' }) - 2;
const CONTINUE = jsonBytes('Continue the conversation');
const frame = (role: Role): number => jsonBytes({ role, content: '' }) - 2;
const placeholder = (role: Role): number =>
  jsonBytes(getEmptyMessagePlaceholder(role));

interface AtomLength {
  readonly role: Role;
  readonly string: boolean;
  readonly blank: boolean;
  readonly bytes: number;
  readonly blockBytes: number;
}
interface Delta {
  readonly run: Run;
  readonly bytes: number;
  readonly count: number;
}
export interface AnthropicUnitOverlay {
  readonly drop?: ReadonlySet<string>;
  readonly vanish?: ReadonlySet<number>;
  readonly after?: ReadonlyMap<number, AnthropicAtom>;
}

function runOf(role: Role, form: 'empty' | 'string' | 'blocks'): Run {
  if (role === 'user') {
    if (form === 'empty') return 'user-empty';
    return form === 'string' ? 'user-string' : 'user-blocks';
  }
  if (form === 'empty') return 'assistant-empty';
  return form === 'string' ? 'assistant-string' : 'assistant-blocks';
}
function roleOf(run: Run): Role {
  return run.startsWith('user-') ? 'user' : 'assistant';
}
function lengthOf(
  atom: AnthropicAtom,
  at: number,
  overlay: AnthropicUnitOverlay,
): AtomLength {
  if (atom.form === 'string')
    return {
      role: atom.role,
      string: true,
      blank: atom.blank,
      bytes: atom.bytes,
      blockBytes: atom.bytes + BLOCKIFY,
    };
  let count = 0;
  let bytes = 0;
  for (const [index, block] of atom.blocks.entries()) {
    if (block.blank || overlay.drop?.has(`${at}:${index}`) === true) continue;
    count++;
    bytes += block.bytes;
  }
  return {
    role: atom.role,
    string: false,
    blank: count === 0,
    bytes,
    blockBytes: count === 0 ? 0 : bytes + count - 1,
  };
}
function applyAtom(run: Run, atom: AtomLength): Delta {
  if (run === 'none' || roleOf(run) !== atom.role) {
    let bytes = frame(atom.role);
    let count = 1;
    if (run !== 'none') {
      bytes += 1;
      if (run.endsWith('-empty')) bytes += placeholder(roleOf(run));
    } else if (atom.role === 'assistant') {
      bytes += frame('user') + CONTINUE + 1;
      count++;
    }
    if (atom.blank) return { run: runOf(atom.role, 'empty'), bytes, count };
    return {
      run: runOf(atom.role, atom.string ? 'string' : 'blocks'),
      bytes: bytes + (atom.string ? atom.bytes : 2 + atom.blockBytes),
      count,
    };
  }
  if (run.endsWith('-empty'))
    return atom.blank
      ? { run, bytes: 0, count: 0 }
      : {
          run: runOf(atom.role, 'blocks'),
          bytes: 2 + atom.blockBytes,
          count: 0,
        };
  if (run.endsWith('-string'))
    return {
      run: runOf(atom.role, 'blocks'),
      bytes: BLOCKIFY + 2 + (atom.blank ? 0 : 1 + atom.blockBytes),
      count: 0,
    };
  return { run, bytes: atom.blank ? 0 : 1 + atom.blockBytes, count: 0 };
}
function step(
  state: State,
  unit: AnthropicUnitFacts,
  selected: 0 | 1,
  overlay: AnthropicUnitOverlay,
): { state: State; bytes: number; count: number } {
  if (state.leading && unit.speaker === 'tool')
    return { state, bytes: 0, count: 0 };
  const atoms =
    state.chain && unit.speaker === 'ai'
      ? [unit.chain[selected]]
      : unit.atoms[selected];
  let run = state.run;
  let bytes = 0;
  let count = 0;
  const emit = (
    atom: AnthropicAtom,
    at: number,
    correction: AnthropicUnitOverlay,
  ): void => {
    const delta = applyAtom(run, lengthOf(atom, at, correction));
    run = delta.run;
    bytes += delta.bytes;
    count += delta.count;
  };
  for (const [at, atom] of atoms.entries()) {
    if (overlay.vanish?.has(at) !== true) emit(atom, at, overlay);
    const after = overlay.after?.get(at);
    if (after !== undefined) emit(after, 0, {});
  }
  const wantsChain = unit.speaker === 'ai' && (state.chain || unit.chainStart);
  return {
    state: {
      leading: false,
      chain:
        wantsChain && (run === 'assistant-empty' || run === 'assistant-blocks'),
      run,
    },
    bytes,
    count,
  };
}
function table(
  unit: AnthropicUnitFacts,
  selected: 0 | 1,
  overlay: AnthropicUnitOverlay,
): TransferTable {
  const out: number[] = [];
  const bytes: number[] = [];
  const count: number[] = [];
  for (const state of STATES) {
    const next = step(state, unit, selected, overlay);
    const at = STATES.findIndex(
      (candidate) =>
        candidate.leading === next.state.leading &&
        candidate.chain === next.state.chain &&
        candidate.run === next.state.run,
    );
    if (at < 0)
      throw new JournalFormatError(
        'Anthropic unit transfer left the ten-state domain',
      );
    out.push(at);
    bytes.push(next.bytes);
    count.push(next.count);
  }
  return { out, bytes, count };
}
export function anthropicUnitTransfer(
  unit: AnthropicUnitFacts,
  label: bigint,
  overlay: AnthropicUnitOverlay = {},
): AnthropicSummary {
  if (label < 1n)
    throw new JournalFormatError(
      'Anthropic unit transfer requires a positive label',
    );
  const ai = unit.speaker === 'ai';
  return {
    kind: 'anthropic',
    variants: [table(unit, 0, overlay), table(unit, 1, overlay)],
    cOut: [Number(ai && unit.chainStart), Number(ai)],
    lastL: [ai && unit.hasThinking ? label : 0n, 0n],
  };
}
export function finalizeAnthropicTransfer(
  root: TransferTable,
  settings: Pick<RowFormatSettings, 'reasoningEnabled' | 'model'>,
): { readonly bytes: number; readonly messages: number } {
  const end = STATES.find((_state, index) => index === root.out[0]);
  if (end === undefined)
    throw new JournalFormatError('Invalid Anthropic transfer end state');
  let bytes = root.bytes[0] + 2;
  let messages = root.count[0];
  if (end.run === 'none') {
    bytes += frame('user') + jsonBytes('Hello');
    messages++;
  } else if (end.run.endsWith('-empty')) bytes += placeholder(roleOf(end.run));
  if (
    end.run.startsWith('assistant-') &&
    (settings.reasoningEnabled || !modelSupportsPrefill(settings.model))
  ) {
    bytes += 1 + frame('user') + CONTINUE;
    messages++;
  }
  return { bytes, messages };
}

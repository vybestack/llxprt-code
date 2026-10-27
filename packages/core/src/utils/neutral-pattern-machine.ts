/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
type Predicate = (character: string) => boolean;
type Expression =
  | { readonly kind: 'character'; readonly test: Predicate }
  | {
      readonly kind: 'sequence';
      readonly parts: readonly Expression[];
    }
  | { readonly kind: 'choice'; readonly parts: readonly Expression[] }
  | {
      readonly kind: 'repeat';
      readonly part: Expression;
      readonly minimum: number;
    };
interface Node {
  readonly epsilon: number[];
  readonly edges: Array<{ readonly test: Predicate; readonly to: number }>;
}
const character = (test: Predicate): Expression => ({
  kind: 'character',
  test,
});
const sequence = (...parts: Expression[]): Expression => ({
  kind: 'sequence',
  parts,
});
const choice = (...parts: Expression[]): Expression => ({
  kind: 'choice',
  parts,
});
const repeat = (part: Expression, minimum = 0): Expression => ({
  kind: 'repeat',
  part,
  minimum,
});
const optional = (part: Expression): Expression => choice(sequence(), part);
const literal = (text: string): Expression =>
  sequence(
    ...Array.from(text, (value) =>
      character((input) => input.toLowerCase() === value),
    ),
  );

function compile(
  expression: Expression,
  nodes: Node[],
  start: number,
  end: number,
): void {
  const node = (): number => nodes.push({ epsilon: [], edges: [] }) - 1;
  if (expression.kind === 'character') {
    nodes[start].edges.push({ test: expression.test, to: end });
  } else if (expression.kind === 'choice') {
    for (const part of expression.parts) compile(part, nodes, start, end);
  } else if (expression.kind === 'sequence') {
    let before = start;
    for (const [index, part] of expression.parts.entries()) {
      const after = index === expression.parts.length - 1 ? end : node();
      compile(part, nodes, before, after);
      before = after;
    }
    if (expression.parts.length === 0) nodes[start].epsilon.push(end);
  } else {
    const body = node();
    const after = node();
    nodes[start].epsilon.push(body);
    if (expression.minimum === 0) nodes[start].epsilon.push(end);
    compile(expression.part, nodes, body, after);
    nodes[after].epsilon.push(body, end);
  }
}

interface State {
  readonly nodes: readonly number[];
  readonly accepting: boolean;
  readonly next: Map<string, number>;
}

export class NeutralPatternMachine {
  private readonly nodes: Node[] = [
    { epsilon: [], edges: [] },
    { epsilon: [], edges: [] },
  ];
  private readonly states: State[] = [];
  private readonly identities = new Map<string, number>();
  readonly start: number;
  constructor(
    expression: Expression,
    readonly lookaheadWhitespace = false,
  ) {
    compile(expression, this.nodes, 0, 1);
    this.start = this.intern([0]);
  }
  accepting(state: number): boolean {
    return state >= 0 && this.states[state].accepting;
  }
  advance(state: number, value: string, key: string): number {
    if (state < 0) return -1;
    const current = this.states[state];
    const cached = current.next.get(key);
    if (cached !== undefined) return cached;
    const targets: number[] = [];
    for (const index of current.nodes)
      for (const edge of this.nodes[index].edges)
        if (edge.test(value)) targets.push(edge.to);
    const next = targets.length === 0 ? -1 : this.intern(targets);
    current.next.set(key, next);
    return next;
  }
  private intern(input: readonly number[]): number {
    const seen = new Set(input);
    const pending = [...input];
    for (let value = pending.pop(); value !== undefined; value = pending.pop())
      for (const next of this.nodes[value].epsilon)
        if (!seen.has(next)) {
          seen.add(next);
          pending.push(next);
        }
    const nodes = [...seen].sort((left, right) => left - right);
    const key = nodes.join(',');
    const known = this.identities.get(key);
    if (known !== undefined) return known;
    const id = this.states.length;
    this.states.push({ nodes, accepting: seen.has(1), next: new Map() });
    this.identities.set(key, id);
    return id;
  }
}

const upper = /^[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]$/u;
const lower = /^[\p{Ll}\p{Lm}\p{Lo}\p{M}]$/u;
const number = /^\p{N}$/u;
const letterOrNumber = /^[\p{L}\p{N}]$/u;
const whitespace = /^\p{White_Space}$/u;
const newline = /^[\r\n]$/u;
export function neutralCharacterKey(value: string): string {
  return [
    upper.test(value),
    lower.test(value),
    number.test(value),
    letterOrNumber.test(value),
    whitespace.test(value),
    newline.test(value),
    value === ' ',
    value === '/',
    "'strevml d".includes(value.toLowerCase()) ? value.toLowerCase() : '',
  ].join(':');
}
export function isNeutralWhitespace(value: string): boolean {
  return whitespace.test(value);
}
const U = character((value) => upper.test(value));
const L = character((value) => lower.test(value));
const N = character((value) => number.test(value));
const W = character((value) => whitespace.test(value));
const R = character((value) => newline.test(value));
const prefix = optional(
  character((value) => !newline.test(value) && !letterOrNumber.test(value)),
);
const contraction = optional(
  choice(...["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"].map(literal)),
);

export const neutralPatternMachines: readonly NeutralPatternMachine[] = [
  new NeutralPatternMachine(
    sequence(prefix, repeat(U), repeat(L, 1), contraction),
  ),
  new NeutralPatternMachine(
    sequence(prefix, repeat(U, 1), repeat(L), contraction),
  ),
  new NeutralPatternMachine(sequence(N, optional(sequence(N, optional(N))))),
  new NeutralPatternMachine(
    sequence(
      optional(literal(' ')),
      repeat(
        character(
          (value) => !whitespace.test(value) && !letterOrNumber.test(value),
        ),
        1,
      ),
      repeat(character((value) => newline.test(value) || value === '/')),
    ),
  ),
  new NeutralPatternMachine(sequence(repeat(W), repeat(R, 1))),
  new NeutralPatternMachine(repeat(W, 1), true),
  new NeutralPatternMachine(repeat(W, 1)),
];

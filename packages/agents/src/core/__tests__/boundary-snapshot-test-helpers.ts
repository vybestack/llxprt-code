/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProviderNormalizationDisk } from '@vybestack/llxprt-code-core/services/history/provider-normalization-disk.js';
import {
  NormalizedProviderRequestSnapshot,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  HookOutputOwner,
  type HookSnapshotRows,
} from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  resolvePendingBoundaryFromHook,
  snapshotContents,
} from '../boundaryRecovery.js';
import { resolvePendingBoundarySnapshot } from '../boundary-recovery-snapshot.js';

export function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}
export function histUser(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { id: `hist-${text}`, timestamp: 1 },
  };
}
export function histAi(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { id: `hist-ai-${text}`, timestamp: 2 },
  };
}
export function pendingUser(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { id: `pending-${text}`, timestamp: 3 },
  };
}
export function roundTrip(contents: IContent[]): IContent[] {
  return contents.map((c) => ({
    speaker: c.speaker,
    blocks: c.blocks.map((b) => ({ ...b })),
  }));
}

export interface BoundaryCase {
  name: string;
  before: IContent[];
  after: IContent[];
  pending: IContent[];
  boundary?: unknown;
}
const h = row('history');
const p = row('pending');
const extra = row('extra');
const before = [h, p];
const smallCases: BoundaryCase[] = [
  { name: 'unmodified', before, after: before, pending: [p] },
  {
    name: 'metadata only ignores invalid throw',
    before,
    after: [{ ...h, metadata: { id: 'fresh' } }, p],
    pending: [p],
    boundary: { pendingMessageStartIndex: -1, onInvalidBoundary: 'throw' },
  },
  { name: 'append', before, after: [...before, extra], pending: [p] },
  { name: 'insert', before, after: [h, extra, p], pending: [p] },
  { name: 'pending edit', before, after: [h, extra], pending: [p] },
  { name: 'pending deletion', before, after: [h], pending: [p] },
  { name: 'history edit', before, after: [extra, p], pending: [p] },
  { name: 'prepend', before, after: [extra, ...before], pending: [p] },
  { name: 'replace all', before, after: [extra], pending: [p] },
  { name: 'complex', before, after: [p, h], pending: [p] },
  { name: 'no history prepend', before: [p], after: [extra, p], pending: [p] },
  { name: 'zero pending', before: [h], after: [h, extra], pending: [] },
  {
    name: 'within history duplicate',
    before: [h, h, p],
    after: [h, h, extra],
    pending: [p],
  },
  {
    name: 'within pending duplicate',
    before: [h, p, p],
    after: [h, p, extra],
    pending: [p, p],
  },
  {
    name: 'cross boundary duplicate',
    before: [p, p],
    after: [p, extra],
    pending: [p],
  },
  { name: 'unchanged duplicate', before: [p, p], after: [p, p], pending: [p] },
  {
    name: 'raw mismatch',
    before: [h, p, extra],
    after: [h, p, row('edited')],
    pending: [p],
  },
  {
    name: 'raw count exceeds provider',
    before: [h],
    after: [extra],
    pending: [p, p],
  },
  {
    name: 'explicit wins over duplicate',
    before: [p, p],
    after: [extra, p],
    pending: [p],
    boundary: { pendingMessageStartIndex: 1 },
  },
];

function metadataCases(): BoundaryCase[] {
  return [
    null,
    false,
    0,
    '',
    { pendingMessageStartIndex: '1' },
    { pendingMessageStartIndex: -1 },
    { pendingMessageStartIndex: 0, pendingMessageCount: 1 },
    { pendingMessageStartIndex: 1 },
    { pendingMessageStartIndex: 0 },
    { pendingMessageStartIndex: 2, pendingMessageCount: 0 },
    { pendingMessageStartIndex: 3, onInvalidBoundary: 'throw' },
    { pendingMessageStartIndex: 'bad', onInvalidBoundary: 'throw' },
  ].map((boundary) => ({
    name: `boundary ${JSON.stringify(boundary)}`,
    before,
    after: [extra, p],
    pending: [p],
    boundary,
  }));
}
function largeCases(): BoundaryCase[] {
  const pending = [row('raw-0'), row('raw-1'), row('raw-2')];
  const history = Array.from({ length: 512 }, (_, index) =>
    row(`history-${index}`),
  );
  const normalized = [
    ...history.slice(0, 64),
    pending[0],
    ...history.slice(64, 256),
    pending[1],
    ...history.slice(256),
    pending[2],
  ];
  return [
    {
      name: '512 history suffix append negative control',
      before: [...history, ...pending],
      after: [...history, ...pending, extra],
      pending,
    },
    {
      name: '512 history suffix pending edit negative control',
      before: [...history, ...pending],
      after: [...history, pending[0], pending[1], extra],
      pending,
    },
    {
      name: '512 history nonadjacent explicit wins',
      before: normalized,
      after: [...normalized.slice(0, -1), extra],
      pending,
      boundary: { pendingMessageStartIndex: 513, pendingMessageCount: 2 },
    },
    {
      name: '512 history nonadjacent unchanged',
      before: normalized,
      after: normalized,
      pending,
    },
    {
      name: '512 history nonadjacent edited suffix',
      before: normalized,
      after: [...normalized.slice(0, -1), extra],
      pending,
    },
    {
      name: '512 history nonadjacent malformed',
      before: normalized,
      after: [...normalized, extra],
      pending,
      boundary: false,
    },
    {
      name: '512 history duplicate edited suffix',
      before: [...history, p, p],
      after: [...history, p, extra],
      pending: [p],
    },
    {
      name: '512 history duplicate malformed',
      before: [...history, p, p],
      after: [...history, p, extra],
      pending: [p],
      boundary: null,
    },
  ];
}
function toolCases(): BoundaryCase[] {
  const call: IContent = {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'read',
        parameters: { path: 'a' },
      },
    ],
  };
  const response: IContent = {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read',
        result: 'a',
      },
    ],
  };
  return [
    {
      name: 'tool ID changed',
      before: [call, p],
      after: [
        {
          ...call,
          blocks: [
            {
              type: 'tool_call',
              id: 'call-2',
              name: 'read',
              parameters: { path: 'a' },
            },
          ],
        },
        p,
      ],
      pending: [p],
    },
    {
      name: 'tool response ID changed',
      before: [response, p],
      after: [
        {
          ...response,
          blocks: [
            {
              type: 'tool_response',
              callId: 'call-2',
              toolName: 'read',
              result: 'a',
            },
          ],
        },
        p,
      ],
      pending: [p],
    },
  ];
}
export function boundaryCases(): BoundaryCase[] {
  return [...smallCases, ...metadataCases(), ...largeCases(), ...toolCases()];
}

interface Outcome {
  pending: IContent[] | undefined;
  classification: string;
  error?: string;
}
function logClassification(
  message: string,
  pending: IContent[] | undefined,
): string {
  const classification = /classification=([^ ]+)/.exec(message)?.[1];
  if (classification !== undefined) return classification;
  if (message.includes('source=caller')) return 'unchanged';
  if (message.includes('cardinality')) return 'provider-pending-mismatch';
  return pending === undefined ? 'invalid-boundary' : 'hook-metadata';
}
export function legacyOutcome(test: BoundaryCase): Outcome {
  const messages: string[] = [];
  const hook = new BeforeModelHookOutput({
    hookSpecificOutput: {
      ...(test.boundary === undefined
        ? {}
        : { llm_request_boundary: test.boundary }),
    },
  });
  try {
    const pending = resolvePendingBoundaryFromHook(
      test.before,
      test.after,
      test.pending,
      hook,
      (message) => messages.push(message),
      snapshotContents(test.before),
    );
    return {
      pending,
      classification: logClassification(
        messages[messages.length - 1] ?? '',
        pending,
      ),
    };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      pending: undefined,
      classification: 'invalid-boundary',
      error: error.message,
    };
  }
}

export function diskFixture(test: BoundaryCase): {
  root: string;
  before: ProviderRequestRows;
  rawPending: ProviderRequestRows;
  after: HookSnapshotRows;
  active(): number;
  scratch(): string[];
  close(): void;
} {
  const root = mkdtempSync(join(tmpdir(), 'boundary-fixture-'));
  let active = 0;
  const owners: NormalizedProviderRequestSnapshot[] = [];
  const source = (rows: IContent[]): ProviderRequestRows => {
    const disk = new ProviderNormalizationDisk(root);
    for (const row of rows) disk.append('ordered', row);
    const owner = new NormalizedProviderRequestSnapshot(disk, 0);
    owners.push(owner);
    return {
      count: rows.length,
      async *openReader(
        signal?: AbortSignal,
      ): AsyncGenerator<IContent, void, unknown> {
        active++;
        const reader = owner.openReader(signal);
        try {
          yield* reader;
        } finally {
          await reader.return();
          active--;
        }
      },
    };
  };
  const hook = new HookOutputOwner(root);
  hook.stdout.append(
    Buffer.from(
      JSON.stringify({
        hookSpecificOutput: { llm_request: { contents: test.after } },
      }),
    ),
  );
  const after = hook.output(0)?.replacement;
  if (after === undefined) throw new Error('Missing fixture replacement');
  return {
    root,
    before: source(test.before),
    rawPending: source(test.pending),
    after,
    active: () => active,
    scratch: () => readdirSync(root).sort(),
    close: () => {
      for (const owner of owners) owner.close();
      hook.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export async function collectRows(
  source: ProviderRequestRows | undefined,
): Promise<IContent[] | undefined> {
  if (source === undefined) return undefined;
  const rows: IContent[] = [];
  for await (const row of source.openReader()) rows.push(row);
  return rows;
}
function assertNoRetainedArrays(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Array.isArray(value)).toBe(false);
  expect(value).not.toBeInstanceOf(Map);
  for (const nested of Object.values(value)) assertNoRetainedArrays(nested);
}

async function snapshotOutcome(
  test: BoundaryCase,
  fixture: ReturnType<typeof diskFixture>,
): Promise<Outcome> {
  try {
    const result = await resolvePendingBoundarySnapshot({
      ...fixture,
      boundary: test.boundary,
    });
    try {
      expect(await collectRows(result.contents)).toStrictEqual(test.after);
      expect('keys' in result).toBe(false);
      assertNoRetainedArrays(result);
      return {
        classification: result.classification,
        pending: await collectRows(result.pendingSelection),
      };
    } finally {
      result.close();
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      pending: undefined,
      classification: 'invalid-boundary',
      error: error.message,
    };
  }
}
export async function compareBoundaryCase(
  test: BoundaryCase,
): Promise<Outcome> {
  const fixture = diskFixture(test);
  const scratch = fixture.scratch();
  try {
    const actual = await snapshotOutcome(test, fixture);
    expect(fixture.active()).toBe(0);
    expect(fixture.scratch()).toStrictEqual(scratch);
    return actual;
  } finally {
    fixture.close();
  }
}

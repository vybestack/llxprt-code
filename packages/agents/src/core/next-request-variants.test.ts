/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { nextRequestChild } from './__tests__/support/next-request-child.js';
import {
  diskToolState,
  type DriverEvent,
} from './__tests__/support/service-tool-recorders.js';
import type {
  Variant,
  Ending,
} from './__tests__/support/next-request-runtime.js';

type Disk = Awaited<ReturnType<typeof diskToolState>>;
function assertRows(
  variant: Variant,
  committed: Disk[],
  transport: DriverEvent,
): void {
  const expectedRows = {
    turn: 2,
    'two-group': 4,
    directory: 3,
    ide: 3,
    client: 3,
    pause: 3,
  };
  expect(committed[0].rows).toHaveLength(expectedRows[variant]);
  expect(transport.details.liveRows).toStrictEqual(
    committed[0].rows.map((row) => row.content),
  );
  const text = JSON.stringify(committed[0].rows);
  expect(text).not.toContain('pending next input');
  expect(text).not.toContain('API Error');
  if (variant === 'directory') expect(text).toContain('following directories');
  if (variant === 'ide') expect(text).toContain('native selection');
  if (variant === 'client') expect(text).toContain('independent tool bytes');
  const hasTool = ['pause', 'two-group', 'client'].includes(variant);
  expect(
    committed[0].rows.filter((row) => row.content.speaker === 'tool'),
  ).toHaveLength(hasTool ? 1 : 0);
  const request = z
    .object({
      calls: z.number(),
      results: z.number(),
      texts: z.array(z.string()),
    })
    .parse(transport.details.request);
  expect([request.calls, request.results]).toStrictEqual(
    hasTool ? [1, 1] : [0, 0],
  );
  expect(request.texts).toContain('pending next input');
}
async function scenario(
  variant: Variant,
  role: 'primary',
  group: number,
  ending: Ending,
): Promise<unknown> {
  const child = await nextRequestChild(variant, role, group, ending);
  try {
    const ready = await child.wait('ready');
    const files = z.array(z.string()).length(1).parse(ready.details.files);
    child.send('next');
    const held = await child.wait('held');
    expect(held.details.entries).toBe(1);
    child.send('probe');
    const probe = await child.wait('probe');
    expect(probe.details.entries).toBe(1);
    const selected = 0;
    const before = await diskToolState(files[selected]);
    expect(
      z.array(z.unknown()).parse(held.details.disk)[selected],
    ).toStrictEqual(before);
    const candidate = z
      .object({
        seq: z.number(),
        rows: z.number(),
        flushes: z.number(),
        before: z.unknown(),
      })
      .parse(held.details.candidate);
    expect(candidate.before).toStrictEqual(before);
    expect(before.seq).toBe(candidate.seq - 1);
    expect(before.rows).toHaveLength(
      candidate.rows -
        (variant === 'turn' || (variant === 'pause' && group === 1) ? 2 : 1),
    );
    expect(z.array(z.number()).parse(held.details.flushes)[selected]).toBe(
      candidate.flushes,
    );
    const readyFlushes = z.array(z.number()).parse(ready.details.flushes);
    const readySeqs = z.array(z.number()).parse(ready.details.seqs);
    expect(candidate.flushes - readyFlushes[selected]).toBe(
      candidate.seq - readySeqs[selected],
    );
    child.send('release');
    const transport = await child.wait('transport');
    expect(transport.details.entries).toBe(2);
    expect(transport.details.nextAttempted).toBe(true);
    if (variant === 'turn') expect(held.details.nextAttempted).toBe(true);
    const committed = await Promise.all(files.map(diskToolState));
    expect(committed[selected].seq).toBeGreaterThanOrEqual(candidate.seq);
    const entrySeqs = z.array(z.number()).parse(transport.details.seqs);
    const entryFlushes = z.array(z.number()).parse(transport.details.flushes);
    expect(
      entryFlushes.map((count, index) => count - readyFlushes[index]),
    ).toStrictEqual(entrySeqs.map((seq, index) => seq - readySeqs[index]));
    assertRows(variant, committed, transport);
    child.send('respond');
    const completed = await child.wait('completed');
    expect(completed.details.entries).toBe(2);
    expect(completed.details.terminalEvents).toContain(
      ending === 'failure' ? 'error' : 'user_cancelled',
    );
    expect(completed.details.disk).toStrictEqual(committed);
    await child.wait('closed');
    expect(await child.child.exited).toBe(0);
    expect(
      isDeepStrictEqual(await Promise.all(files.map(diskToolState)), committed),
    ).toBe(true);
    await writeFile(
      join(child.directory, 'proof.json'),
      JSON.stringify(
        {
          variant,
          role,
          group,
          ending,
          ready,
          held,
          probe,
          transport,
          completed,
          committed,
        },
        null,
        2,
      ),
    );
    return transport.details.request;
  } finally {
    await child.close();
  }
}
const variants: readonly Variant[] = [
  'directory',
  'ide',
  'turn',
  'client',
  'pause',
  'two-group',
];
const endings: readonly Ending[] = ['failure', 'cancel'];
const cases = variants.flatMap((variant) =>
  (['pause', 'two-group'].includes(variant) ? [1, 2] : [1]).flatMap((group) =>
    endings.map((ending) => ({ variant, group, ending })),
  ),
);
describe('Production caller durability before the next provider invocation', () => {
  for (const { variant, group, ending } of cases) {
    it(`${variant} joins primary group ${group} before next request ${ending}`, async () => {
      const request = z
        .object({ texts: z.array(z.string()) })
        .parse(await scenario(variant, 'primary', group, ending));
      expect(request.texts).toContain('pending next input');
    }, 60000);
  }
});

/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  DensityReadWriteWriter,
  DensityToolOccurrence,
} from './density-read-write-facts.js';

async function observeRead(
  writer: DensityReadWriteWriter,
  event: Extract<DensityToolOccurrence, { kind: 'read' }>,
  ordinal: number,
): Promise<void> {
  if (event.paths.length === 0) return;
  const id = await writer.intern('call-id', event.id);
  const candidate = await writer.allocate();
  await writer.set(['candidate', candidate], [event.paths.length, ordinal, id]);
  for (const path of event.paths) {
    const node = await writer.allocate();
    const head = (await writer.get(['reads', path]))?.[0] ?? 0;
    await writer.set(['read', node], [candidate, head]);
    await writer.set(['reads', path], [node]);
  }
}
async function observeWrite(
  writer: DensityReadWriteWriter,
  path: string,
): Promise<void> {
  let node = (await writer.get(['reads', path]))?.[0] ?? 0;
  await writer.set(['reads', path], [0]);
  while (node !== 0) {
    const link = await writer.get(['read', node]);
    if (link === undefined) throw new Error('Missing density read link');
    const [candidate, next] = link;
    const state = await writer.get(['candidate', candidate]);
    if (state === undefined || state[0] === 0)
      throw new Error('Invalid density read candidate');
    await writer.set(
      ['candidate', candidate],
      [state[0] - 1, state[1], state[2]],
    );
    if (state[0] === 1) {
      await writer.set(['stale', state[1], state[2]], [1]);
      await writer.invalidate(state[2]);
      await writer.set(['changes'], [(await writer.changes()) + 1]);
    }
    node = next;
  }
}
export async function observeDensityTool(
  writer: DensityReadWriteWriter,
  event: DensityToolOccurrence,
  ordinal: number,
): Promise<void> {
  if (event.kind === 'read') return observeRead(writer, event, ordinal);
  if (event.kind === 'write') return observeWrite(writer, event.path);
  return writer.response(event, ordinal);
}

/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexWriter } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { AnthropicStreamRepair } from './anthropic-stream-repair.js';

export async function writeAnthropicCacheWindows(
  engine: AnthropicStreamRepair,
  writer: NativeFactIndexWriter,
  from = 0,
): Promise<void> {
  const previous = from === 0 ? undefined : await writer.get(['cache-runs']);
  let run = previous === undefined ? -1 : previous[0] - 1;
  const tail = run < 0 ? undefined : await writer.get(['cache-run', run]);
  let start = tail?.[0] ?? 0;
  let end = from;
  const previousRole = tail?.[2] === 0 ? 'user' : 'assistant';
  let role = tail === undefined ? undefined : previousRole;
  let anchors =
    from === 0 ? 0 : ((await writer.get(['cache-anchors']))?.[0] ?? 0);
  for await (const atom of engine.atoms(from * 4)) {
    const at = Math.floor(atom.key / 4);
    if (role !== atom.role) {
      if (run >= 0)
        await writer.set(
          ['cache-run', run],
          [start, end, Number(role === 'assistant')],
        );
      run++;
      role = atom.role;
      start = at;
    }
    end = (atom.end ?? at) + 1;
    if (
      !atom.repair &&
      (await engine.source.query.planAt(atom.end ?? at)).header.metadata
        ?.cacheAnchor === true
    )
      await writer.set(['cache-anchor', anchors++], [at, end]);
  }
  if (run >= 0)
    await writer.set(
      ['cache-run', run],
      [
        start,
        Math.max(end, engine.source.query.count),
        Number(role === 'assistant'),
      ],
    );
  await writer.set(['cache-runs'], [run + 1]);
  await writer.set(['cache-anchors'], [anchors]);
}

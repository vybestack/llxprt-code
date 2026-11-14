/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from './groupEdits.js';
import { ROW_BLOCK_TYPE, ROW_SPEAKER } from './rowRecord.js';
import type { Version } from './version.js';
import type { VersionSnapshot } from './versionSnapshot.js';

export async function nativeCatchupEdits(
  snapshot: VersionSnapshot,
  previous: Version,
): Promise<readonly VersionEdit[] | undefined> {
  if (
    snapshot.rows < previous.rows ||
    snapshot.version?.lineage !== previous.lineage
  )
    return undefined;
  for await (const entry of snapshot.entries(previous.rows)) {
    const { header } = await snapshot.readIds(entry);
    if (
      header.speaker !== ROW_SPEAKER.tool &&
      header.ids.length === 0 &&
      header.blocks.every((block) =>
        [
          ROW_BLOCK_TYPE.text,
          ROW_BLOCK_TYPE.code,
          ROW_BLOCK_TYPE.thinking,
        ].some((type) => type === block.type),
      )
    )
      continue;
    if (snapshot.rows !== previous.rows + 1) return undefined;
    const row = await snapshot.readRow(entry);
    return [
      {
        kind: 'append',
        rows: [
          {
            ...row.header,
            meta: row.meta,
            blocks: row.header.blocks.map((block, index) => ({
              type: block.type,
              bytes: row.blocks[index],
            })),
            ids: row.header.ids.map((id, index) => ({
              ...id,
              rawId: row.rawIds[index],
            })),
          },
        ],
      },
    ];
  }
  return [{ kind: 'append', rows: [] }];
}

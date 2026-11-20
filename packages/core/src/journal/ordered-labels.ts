/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuildShared.js';
import type { PlanContext } from './groupPlanTypes.js';
import type { JournalGroupWriter } from './groupWriter.js';
import { IdFactBatch } from './idFactBatch.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { prepareBuild } from './preparedGroup.js';
import { JournalFormatError } from './errors.js';

export type LabelSorter = (
  labels: AsyncIterable<bigint>,
) => AsyncGenerator<bigint>;

export function journalLabelSorter(host: {
  enqueue<T>(run: () => Promise<T>): Promise<T>;
  writer(): JournalGroupWriter;
  context(): { build: BuildContext; plan: PlanContext };
  installed(): void;
  openRead(): Promise<{ close(): void | Promise<void> }>;
}): LabelSorter {
  return async function* (labels): AsyncGenerator<bigint> {
    const pin = await host.openRead();
    try {
      const sorted = await host.enqueue(async () => {
        const writer = host.writer();
        const { build, plan } = host.context();
        let root = 0;
        let end = 0;
        await writer.prepareGroup(async (appender) => {
          const batch = new IdFactBatch(
            undefined,
            0,
            {
              ...build.idDeps,
              hasher: (_namespace, key) => key,
            },
            0,
            { appender, readGroup: build.readGroup },
          );
          for await (const label of labels) {
            const key = new Uint8Array(16);
            new DataView(key.buffer).setBigUint64(0, label, false);
            await batch.setEntry(0, key, new Uint8Array(0));
          }
          root = (await batch.commit(appender)).root;
          await appender.drain();
          end = appender.nextOffset;
          const live = await prepareBuild(
            build,
            plan,
            [{ kind: 'append', rows: [] }],
            appender,
            appender,
            async () => undefined,
          );
          if (live.built === undefined)
            throw new JournalFormatError(
              'Ordered labels lost the published version',
            );
          return live.built.state;
        });
        host.installed();
        return {
          root,
          reader: new IdTrieReader(
            build.readGroup(end),
            new BoundedIdNodeCache(),
          ),
        };
      });
      for await (const entry of sorted.reader.entries(sorted.root))
        yield new DataView(
          entry.hash.buffer,
          entry.hash.byteOffset,
          entry.hash.byteLength,
        ).getBigUint64(0, false);
    } finally {
      await pin.close();
    }
  };
}

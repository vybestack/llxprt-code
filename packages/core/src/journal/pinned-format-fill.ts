/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuild.js';
import type { PlanContext } from './groupPlanTypes.js';
import type { JournalGroupWriter } from './groupWriter.js';
import type { RowFormatRegistration } from './rowFormat.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { prepareBuild } from './preparedGroup.js';
import { fillRowFormats, snapshotOf } from './formatFill.js';
import { LineageChain } from './lineageChain.js';
import { JournalFormatError } from './errors.js';

export async function fillPinnedFormat(
  writer: JournalGroupWriter,
  context: BuildContext,
  planning: PlanContext,
  snapshot: VersionSnapshot,
  registration: RowFormatRegistration,
): Promise<VersionSnapshot> {
  snapshot.requireOpen();
  const release = snapshot.hold();
  let measured: VersionSnapshot | undefined;
  try {
    await writer.prepareGroup(async (appender) => {
      const published = snapshot.version;
      const ctx = {
        ...context,
        published,
        chainFor: async () => LineageChain.NONE,
      };
      const plan = { ...planning, published };
      const edits = [{ kind: 'format' as const, registration }];
      const prepared = await prepareBuild(
        ctx,
        plan,
        edits,
        appender,
        appender,
        async () => undefined,
      );
      if (prepared.built === undefined)
        throw new JournalFormatError('Pinned format has no built version');
      const filled = await fillRowFormats(
        ctx,
        prepared.built,
        appender,
        edits,
        [],
      );
      await appender.drain();
      measured = snapshotOf(
        ctx,
        filled.built,
        appender,
        release,
        writer.reader,
      );
      const live = await prepareBuild(
        context,
        planning,
        [{ kind: 'append', rows: [] }],
        appender,
        appender,
        async () => undefined,
      );
      if (live.built === undefined)
        throw new JournalFormatError(
          'Pinned format lost the published version',
        );
      return live.built.state;
    });
    if (measured === undefined)
      throw new JournalFormatError('Pinned format fill produced no snapshot');
    return measured;
  } catch (error) {
    if (measured === undefined) await release();
    else await measured.close();
    throw error;
  }
}

export function pinnedFormatPreparation(host: {
  enqueue<T>(run: () => Promise<T>): Promise<T>;
  writer(): JournalGroupWriter;
  context(): { build: BuildContext; plan: PlanContext };
  installed(): void;
}): (
  snapshot: VersionSnapshot,
  registration: RowFormatRegistration,
) => Promise<VersionSnapshot> {
  return (snapshot, registration) =>
    host.enqueue(async () => {
      const writer = host.writer();
      if (
        snapshot.restorationIn(writer.reader).kind !== 'restore' &&
        snapshot.version !== undefined
      )
        throw new JournalFormatError(
          'Pinned format belongs to another journal',
        );
      const measured = await fillPinnedFormat(
        writer,
        host.context().build,
        host.context().plan,
        snapshot,
        registration,
      );
      host.installed();
      return measured;
    });
}

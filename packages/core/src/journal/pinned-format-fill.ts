/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAppender } from './groupAppender.js';
import type { BuildContext } from './groupBuild.js';
import type { PlanContext } from './groupPlanTypes.js';
import type { JournalGroupWriter } from './groupWriter.js';
import type { RowFormatRegistration } from './rowFormat.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { prepareBuild } from './preparedGroup.js';
import { fillRowFormats, snapshotOf } from './formatFill.js';
import { LineageChain } from './lineageChain.js';
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import { fillNativeFacts } from './nativeFactFill.js';

type PinnedRequestRegistration =
  | RowFormatRegistration
  | Pick<RowFormatRegistration, 'nativeFacts'>
  | 'kimi';

async function requestMappingEdits(
  snapshot: VersionSnapshot,
  registration: PinnedRequestRegistration,
): Promise<VersionEdit[]> {
  if (registration === 'kimi') return [{ kind: 'kimi' }];
  if (registration.nativeFacts !== undefined)
    return [{ kind: 'factIndex', registration: registration.nativeFacts }];
  const slot =
    'settings' in registration ? registration.mistralSlot : undefined;
  if (slot === undefined || (await snapshot.hasMistralSlot(slot))) return [];
  return [{ kind: 'mistral', slot }];
}

async function prepareMapping(
  writer: JournalGroupWriter,
  ctx: BuildContext,
  plan: PlanContext,
  snapshot: VersionSnapshot,
  registration: PinnedRequestRegistration,
  appender: RecordAppender,
): Promise<VersionSnapshot> {
  const edits = await requestMappingEdits(snapshot, registration);
  if (edits.length === 0) return snapshot;
  const mapping = await prepareBuild(
    ctx,
    plan,
    edits,
    appender,
    appender,
    async () => undefined,
  );
  if (mapping.built === undefined)
    throw new JournalFormatError('Pinned Mistral fill has no built version');
  await appender.drain();
  const indexed = await fillNativeFacts(
    ctx,
    mapping.built,
    appender,
    registration === 'kimi' ? undefined : registration.nativeFacts,
    edits,
  );
  await appender.drain();
  return snapshotOf(
    ctx,
    indexed.built,
    appender,
    () => undefined,
    writer.reader,
  );
}

export async function fillPinnedRequest(
  writer: JournalGroupWriter,
  context: BuildContext,
  planning: PlanContext,
  snapshot: VersionSnapshot,
  registration: PinnedRequestRegistration,
): Promise<VersionSnapshot> {
  snapshot.requireOpen();
  const release = snapshot.hold();
  let measured: VersionSnapshot | undefined;
  try {
    await writer.prepareGroup(async (appender) => {
      const ctx = {
        ...context,
        published: snapshot.version,
        chainFor: async () => LineageChain.NONE,
      };
      const mapped = await prepareMapping(
        writer,
        ctx,
        { ...planning, published: ctx.published },
        snapshot,
        registration,
        appender,
      );
      if (mapped !== snapshot) {
        ctx.published = mapped.version;
        ctx.access = ctx.readGroup(appender.nextOffset);
        await mapped.close();
      }
      const edits: readonly VersionEdit[] =
        registration !== 'kimi' && 'settings' in registration
          ? [{ kind: 'format', registration }]
          : [{ kind: 'append', rows: [] }];
      const prepared = await prepareBuild(
        ctx,
        { ...planning, published: ctx.published },
        edits,
        appender,
        appender,
        async () => undefined,
      );
      if (prepared.built === undefined)
        throw new JournalFormatError('Pinned format has no built version');
      const filled =
        registration !== 'kimi' && 'settings' in registration
          ? await fillRowFormats(ctx, prepared.built, appender, edits, [])
          : { built: prepared.built };
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

export function pinnedRequestPreparation(host: {
  enqueue<T>(run: () => Promise<T>): Promise<T>;
  writer(): JournalGroupWriter;
  context(): { build: BuildContext; plan: PlanContext };
  installed(): void;
}): (
  snapshot: VersionSnapshot,
  registration: PinnedRequestRegistration,
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
      const measured = await fillPinnedRequest(
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

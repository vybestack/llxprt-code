/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError, JournalInputError } from './errors.js';
import { bytesEqual } from './bytes.js';
import { KeyedMapReader } from './keyedMap.js';
import { retainMapValue, copyPreparedMetadata } from './preparedMetadata.js';
import type { RecordAppender } from './groupAppender.js';
import {
  buildGroup,
  type BuildContext,
  type BuiltGroup,
} from './groupBuild.js';
import type { SourceRow, VersionEdit } from './groupEdits.js';
import { mutationOf, planGroup } from './groupPlan.js';
import type { GroupPlan, PlanContext } from './groupPlanTypes.js';
import type { ReadGroup } from './idFactBatch.js';
import type { NativeFactIndexRegistration } from './nativeFactIndex.js';
import { encodeRowDraft, entryForNewRow, type RowDraft } from './rowDraft.js';
import type { RecordAccess } from './recordAccess.js';
import type { MapKind } from './keyedMap.js';
import { buildStreamedAppend } from './streamed-append-build.js';
import type { AppendInput } from './streamed-append-pass.js';

export type ArrivalPreparation = (
  context: BuildContext,
  appender: RecordAppender,
) => Promise<BuiltGroup>;

export interface PreparedGroup {
  readonly appender: RecordAppender;
  readonly read: ReadGroup;
  recordArrival(build: ArrivalPreparation): Promise<void>;
  build(edits: readonly VersionEdit[]): Promise<void>;
  append(
    rows: AsyncIterable<RowDraft>,
    ownerEdits: readonly VersionEdit[],
  ): Promise<void>;
  adopt(rows: AsyncIterable<SourceRow>, nextLabel: bigint): Promise<void>;
  copyMetadata(
    source: RecordAccess,
    root: number,
    keys: readonly string[],
  ): Promise<void>;
  retainMetadata(key: string, value: Uint8Array): Promise<void>;
}

export type GroupPreparation = (group: PreparedGroup) => Promise<void>;

type RegisterFacts = (
  actual: readonly VersionEdit[],
) => Promise<NativeFactIndexRegistration | undefined>;

export interface PreparedBuild {
  readonly recording?: boolean;
  readonly plan: GroupPlan | undefined;
  readonly built: BuiltGroup | undefined;
  readonly edits: readonly VersionEdit[];
  readonly facts: NativeFactIndexRegistration | undefined;
  readonly streamedAppend?: boolean;
  readonly retainedMetadataKeys?: readonly string[];
}

async function sameMetadata(
  ctx: BuildContext,
  key: string,
  value: Uint8Array,
): Promise<boolean> {
  const reader = new KeyedMapReader(
    ctx.access,
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const prior = await reader.get(ctx.published?.roots.metaRoot ?? 0, key);
  return prior !== undefined && bytesEqual(prior, value);
}

function preparationWrites(appender: RecordAppender): {
  readonly appender: RecordAppender;
  failure(): { error: unknown } | undefined;
} {
  let failure: { error: unknown } | undefined;
  const write = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      failure = { error };
      throw error;
    }
  };
  return {
    appender: {
      get nextOffset() {
        return appender.nextOffset;
      },
      append: (record) => write(() => appender.append(record)),
      drain: () => write(() => appender.drain()),
    },
    failure: () => failure,
  };
}

class PreparedBuilder {
  result: PreparedBuild;
  failure: { error: unknown } | undefined;
  private started = false;

  constructor(
    private readonly ctx: BuildContext,
    private readonly planning: PlanContext,
    edits: readonly VersionEdit[],
    private readonly rowAppender: RecordAppender,
    private readonly register: RegisterFacts,
  ) {
    this.result = {
      plan: undefined,
      built: undefined,
      edits,
      facts: undefined,
    };
  }

  private start(actual: readonly VersionEdit[]): void {
    if (this.started || actual.some((edit) => edit.kind === 'prepared'))
      throw new JournalFormatError(
        'A prepared group builds once without nesting',
      );
    this.started = true;
  }

  async recordArrival(
    build: ArrivalPreparation,
    appender: RecordAppender,
  ): Promise<void> {
    const edits: readonly VersionEdit[] = [{ kind: 'append', rows: [] }];
    this.start(edits);
    const plan = await planGroup(this.planning, edits);
    const built = await build(this.ctx, appender);
    this.result = {
      plan,
      built,
      edits,
      facts: await this.register(edits),
      recording: true,
      streamedAppend:
        built.state.rootAggregate.rows > (this.ctx.published?.rows ?? 0),
    };
  }

  async build(actual: readonly VersionEdit[]): Promise<void> {
    this.start(actual);
    try {
      const facts = await this.register(actual);
      const plan = await planGroup(
        {
          ...this.planning,
          admitRow: async (label, draft) => {
            const encoded = encodeRowDraft(label, draft);
            const offset = await this.rowAppender.append(encoded.record);
            return entryForNewRow(
              encoded,
              offset,
              this.rowAppender.transcriptIdentity?.(offset),
            );
          },
        },
        actual,
      );
      this.result = {
        plan,
        facts,
        edits: actual,
        built: await buildGroup(
          this.ctx,
          plan,
          mutationOf(actual),
          this.rowAppender,
        ),
      };
    } catch (error) {
      this.failure = { error };
      throw error;
    }
  }

  async append(
    rows: AsyncIterable<RowDraft>,
    ownerEdits: readonly VersionEdit[],
  ): Promise<void> {
    const actual: readonly VersionEdit[] = [
      ...ownerEdits,
      { kind: 'append', rows: [] },
    ];
    await this.stream(
      (async function* (): AsyncGenerator<AppendInput> {
        for await (const draft of rows) yield { draft };
      })(),
      actual,
      ownerEdits,
    );
    if (this.result.built === undefined) {
      this.started = false;
      await this.build(actual);
    }
    this.result = { ...this.result, streamedAppend: true };
  }

  async adopt(
    rows: AsyncIterable<SourceRow>,
    nextLabel: bigint,
  ): Promise<void> {
    const edit = {
      kind: 'adopt',
      rows: [],
      placement: 'end',
      nextLabel,
    } satisfies VersionEdit;
    await this.stream(
      (async function* (): AsyncGenerator<AppendInput> {
        for await (const foreign of rows) yield { foreign };
      })(),
      [edit],
      [],
      nextLabel,
    );
    if (this.result.built === undefined) {
      this.started = false;
      await this.build([{ kind: 'append', rows: [] }]);
      const built = this.completedBuild();
      this.result = {
        ...this.result,
        built: { ...built, state: { ...built.state, nextLabel } },
      };
    }
  }

  private completedBuild(): BuiltGroup {
    if (this.result.built === undefined)
      throw new Error('Prepared group left no build');
    return this.result.built;
  }

  private async stream(
    inputs: AsyncIterable<AppendInput>,
    actual: readonly VersionEdit[],
    ownerEdits: readonly VersionEdit[],
    nextLabel?: bigint,
  ): Promise<void> {
    this.start(actual);
    try {
      const facts = await this.register(actual);
      const plan = await planGroup(this.planning, [
        ...ownerEdits,
        { kind: 'append', rows: [] },
      ]);
      const built = await buildStreamedAppend(
        this.ctx,
        plan,
        mutationOf(actual),
        this.rowAppender,
        inputs,
        nextLabel,
      );
      if (built !== undefined)
        this.result = { plan, built, edits: actual, facts };
    } catch (error) {
      this.failure = { error };
      throw error;
    }
  }

  async copyMetadata(
    source: RecordAccess,
    root: number,
    keys: readonly string[],
    appender: RecordAppender,
  ): Promise<void> {
    if (this.result.built === undefined)
      await this.build([{ kind: 'append', rows: [] }]);
    const built = this.result.built;
    if (built === undefined)
      throw new JournalFormatError('Metadata copy needs a completed group');
    this.result = {
      ...this.result,
      built: await copyPreparedMetadata(
        this.ctx,
        appender,
        built,
        source,
        root,
        keys,
      ),
    };
  }

  async retain(
    key: string,
    value: Uint8Array,
    appender: RecordAppender,
    kind: MapKind = 'meta',
    storage?: 'body',
  ): Promise<void> {
    if (
      !this.started &&
      kind === 'meta' &&
      (await sameMetadata(this.ctx, key, value))
    )
      return;
    if (!this.started) await this.build([{ kind: 'append', rows: [] }]);
    if (this.result.built === undefined)
      throw new JournalFormatError('Metadata needs a completed row group');
    this.result = {
      ...this.result,
      built: await retainMapValue(
        this.ctx,
        appender,
        this.result.built,
        kind,
        key,
        value,
        storage,
      ),
      retainedMetadataKeys:
        kind === 'meta' && key.startsWith('submission:')
          ? [...(this.result.retainedMetadataKeys ?? []), key]
          : this.result.retainedMetadataKeys,
    };
  }
}

export async function prepareBuild(
  ctx: BuildContext,
  planning: PlanContext,
  edits: readonly VersionEdit[],
  appender: RecordAppender,
  rowAppender: RecordAppender,
  register: RegisterFacts,
  recordingAppender: RecordAppender = appender,
): Promise<PreparedBuild> {
  const preparation = edits.find((edit) => edit.kind === 'prepared');
  if (
    preparation !== undefined &&
    edits.some((edit) => edit !== preparation && edit.kind !== 'setState')
  )
    throw new JournalFormatError(
      'A prepared group only accepts accompanying state edits',
    );
  const builder = new PreparedBuilder(
    ctx,
    planning,
    edits,
    rowAppender,
    register,
  );
  if (preparation?.kind !== 'prepared') {
    await builder.build(edits);
    return builder.result;
  }
  const writes = preparationWrites(appender);
  try {
    await preparation.prepare({
      appender: writes.appender,
      read: ctx.readGroup,
      recordArrival: (build) => builder.recordArrival(build, recordingAppender),
      build: (actual) => builder.build(actual),
      append: (rows, ownerEdits) => builder.append(rows, ownerEdits),
      adopt: (rows, nextLabel) => builder.adopt(rows, nextLabel),
      copyMetadata: (source, root, keys) =>
        builder.copyMetadata(source, root, keys, writes.appender),
      retainMetadata: (key, value) =>
        builder.retain(key, value, writes.appender),
    });
    for (const edit of edits) {
      if (edit.kind === 'setState')
        await builder.retain(
          edit.key,
          edit.value,
          writes.appender,
          'state',
          edit.storage,
        );
    }
  } catch (error) {
    const failure = writes.failure();
    if (failure !== undefined) throw failure.error;
    if (error instanceof JournalInputError || builder.failure?.error === error)
      throw error;
    throw new JournalInputError(error);
  }
  return builder.result;
}

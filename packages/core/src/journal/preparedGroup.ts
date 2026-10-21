/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError, JournalInputError } from './errors.js';
import { bytesEqual } from './bytes.js';
import { KeyedMapReader, KeyedMapBatch } from './keyedMap.js';
import type { RecordAppender } from './groupAppender.js';
import {
  buildGroup,
  type BuildContext,
  type BuiltGroup,
} from './groupBuild.js';
import type { VersionEdit } from './groupEdits.js';
import { mutationOf, planGroup } from './groupPlan.js';
import type { GroupPlan, PlanContext } from './groupPlanTypes.js';
import type { ReadGroup } from './idFactBatch.js';
import type { NativeFactIndexRegistration } from './nativeFactIndex.js';
import type { RowDraft } from './rowDraft.js';
import type { Version } from './version.js';

export interface PreparedGroup {
  readonly appender: RecordAppender;
  readonly read: ReadGroup;
  build(edits: readonly VersionEdit[]): Promise<void>;
  append(
    rows: AsyncIterable<RowDraft>,
    ownerEdits: readonly VersionEdit[],
  ): Promise<void>;
  retainMetadata(key: string, value: Uint8Array): Promise<void>;
}

export type GroupPreparation = (group: PreparedGroup) => Promise<void>;

type RegisterFacts = (
  actual: readonly VersionEdit[],
) => Promise<NativeFactIndexRegistration | undefined>;

export interface PreparedBuild {
  readonly plan: GroupPlan | undefined;
  readonly built: BuiltGroup | undefined;
  readonly edits: readonly VersionEdit[];
  readonly facts: NativeFactIndexRegistration | undefined;
}

async function retainMetadata(
  ctx: BuildContext,
  appender: RecordAppender,
  built: BuiltGroup,
  key: string,
  value: Uint8Array,
): Promise<BuiltGroup> {
  await appender.drain();
  const reader = new KeyedMapReader(
    ctx.readGroup(appender.nextOffset),
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const batch = new KeyedMapBatch(reader, built.state.metaRoot);
  batch.set(key, value);
  return {
    ...built,
    state: { ...built.state, metaRoot: await batch.commit(appender) },
  };
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

function appendedBase(prior: Version, built: BuiltGroup): Version {
  const state = built.state;
  return {
    ...prior,
    roots: {
      rowRoot: state.rowRoot,
      idRoot: state.idRoot,
      metaRoot: state.metaRoot,
      stateRoot: state.stateRoot,
    },
    rows: state.rootAggregate.rows,
    aggregate: state.rootAggregate,
    nextLabel: state.nextLabel,
    firstLabel: state.firstLabel,
    lastRowOffset: state.lastRowOffset,
    lastOwner: state.lastOwner,
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
    private readonly appender: RecordAppender,
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

  async build(actual: readonly VersionEdit[]): Promise<void> {
    this.start(actual);
    try {
      const facts = await this.register(actual);
      const plan = await planGroup(this.planning, actual);
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
    this.start(actual);
    let base = this.planning.published;
    let spine: BuiltGroup['spine'];
    let first = true;
    try {
      const facts = await this.register(actual);
      for await (const row of rows) {
        await this.appender.drain();
        const access = this.ctx.readGroup(this.appender.nextOffset);
        const priorSpine = spine;
        const turn = {
          ...this.ctx,
          access,
          published: base,
          spineFor:
            priorSpine === undefined
              ? this.ctx.spineFor
              : async () => priorSpine,
        };
        const plan = await planGroup(
          { ...this.planning, access, published: base },
          [...(first ? ownerEdits : []), { kind: 'append', rows: [row] }],
        );
        plan.parent = this.planning.published;
        const built = await buildGroup(
          turn,
          plan,
          mutationOf(actual),
          this.rowAppender,
        );
        base = appendedBase(plan.base, built);
        spine = built.spine;
        plan.newRows = [];
        this.result = { plan, built, edits: actual, facts };
        first = false;
      }
    } catch (error) {
      this.failure = { error };
      throw error;
    }
  }

  async retain(
    key: string,
    value: Uint8Array,
    appender: RecordAppender,
  ): Promise<void> {
    if (!this.started && (await sameMetadata(this.ctx, key, value))) return;
    if (!this.started) await this.build([{ kind: 'append', rows: [] }]);
    if (this.result.built === undefined)
      throw new JournalFormatError('Metadata needs a completed row group');
    this.result = {
      ...this.result,
      built: await retainMetadata(
        this.ctx,
        appender,
        this.result.built,
        key,
        value,
      ),
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
): Promise<PreparedBuild> {
  const preparation = edits.find((edit) => edit.kind === 'prepared');
  if (preparation !== undefined && edits.length !== 1)
    throw new JournalFormatError('A prepared group is a separate operation');
  const builder = new PreparedBuilder(
    ctx,
    planning,
    edits,
    appender,
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
      build: (actual) => builder.build(actual),
      append: (rows, ownerEdits) => builder.append(rows, ownerEdits),
      retainMetadata: (key, value) =>
        builder.retain(key, value, writes.appender),
    });
  } catch (error) {
    const failure = writes.failure();
    if (failure !== undefined) throw failure.error;
    if (error instanceof JournalInputError || builder.failure?.error === error)
      throw error;
    throw new JournalInputError(error);
  }
  return builder.result;
}

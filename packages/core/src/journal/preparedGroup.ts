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

export interface PreparedGroup {
  readonly appender: RecordAppender;
  readonly read: ReadGroup;
  build(edits: readonly VersionEdit[]): Promise<void>;
  retainMetadata(key: string, value: Uint8Array): Promise<void>;
}

export type GroupPreparation = (group: PreparedGroup) => Promise<void>;

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

export async function prepareBuild(
  ctx: BuildContext,
  planning: PlanContext,
  edits: readonly VersionEdit[],
  appender: RecordAppender,
  rowAppender: RecordAppender,
  register: (
    actual: readonly VersionEdit[],
  ) => Promise<NativeFactIndexRegistration | undefined>,
): Promise<PreparedBuild> {
  const preparation = edits.find((edit) => edit.kind === 'prepared');
  if (preparation !== undefined && edits.length !== 1)
    throw new JournalFormatError('A prepared group is a separate operation');
  let result: PreparedBuild = {
    plan: undefined,
    built: undefined,
    edits,
    facts: undefined,
  };
  let started = false;
  let buildFailure: { error: unknown } | undefined;
  const build = async (actual: readonly VersionEdit[]): Promise<void> => {
    if (started || actual.some((edit) => edit.kind === 'prepared'))
      throw new JournalFormatError(
        'A prepared group builds once without nesting',
      );
    started = true;
    try {
      const facts = await register(actual);
      const plan = await planGroup(planning, actual);
      result = {
        plan,
        facts,
        edits: actual,
        built: await buildGroup(ctx, plan, mutationOf(actual), rowAppender),
      };
    } catch (error) {
      buildFailure = { error };
      throw error;
    }
  };
  if (preparation?.kind === 'prepared') {
    const writes = preparationWrites(appender);
    try {
      await preparation.prepare({
        appender: writes.appender,
        read: ctx.readGroup,
        build,
        retainMetadata: async (key, value) => {
          if (!started && (await sameMetadata(ctx, key, value))) return;
          if (!started) await build([{ kind: 'append', rows: [] }]);
          if (result.built === undefined)
            throw new JournalFormatError(
              'Metadata needs a completed row group',
            );
          result = {
            ...result,
            built: await retainMetadata(
              ctx,
              writes.appender,
              result.built,
              key,
              value,
            ),
          };
        },
      });
    } catch (error) {
      const failure = writes.failure();
      if (failure !== undefined) throw failure.error;
      if (error instanceof JournalInputError || buildFailure?.error === error)
        throw error;
      throw new JournalInputError(error);
    }
  } else await build(edits);
  return result;
}

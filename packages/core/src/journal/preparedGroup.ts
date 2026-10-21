/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError, JournalInputError } from './errors.js';
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
}

export type GroupPreparation = (group: PreparedGroup) => Promise<void>;

export interface PreparedBuild {
  readonly plan: GroupPlan | undefined;
  readonly built: BuiltGroup | undefined;
  readonly edits: readonly VersionEdit[];
  readonly facts: NativeFactIndexRegistration | undefined;
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
    try {
      await preparation.prepare({ appender, read: ctx.readGroup, build });
    } catch (error) {
      if (error instanceof JournalInputError || buildFailure?.error === error)
        throw error;
      throw new JournalInputError(error);
    }
  } else await build(edits);
  return result;
}

/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GroupRecord, RecordAppender } from './groupAppender.js';
import type { RecordAccess } from './recordAccess.js';

export interface CommitEffectContext {
  readonly read: (end: number) => RecordAccess;
  readonly getState: (key: string) => Promise<Uint8Array | undefined>;
}

export interface CommitEffect {
  append(record: GroupRecord, appender: RecordAppender): Promise<number>;
  finish(stateRoot: number, appender: RecordAppender): Promise<number>;
  settle(committed: boolean): Promise<void>;
}

export type CommitEffectFactory = (
  context: CommitEffectContext,
) => CommitEffect;

export function effectAppender(
  appender: RecordAppender,
  effect: CommitEffect,
): RecordAppender {
  return {
    get nextOffset(): number {
      return appender.nextOffset;
    },
    append: (record) => effect.append(record, appender),
    drain: () => appender.drain(),
  };
}

export async function rollbackEffect(
  effect: CommitEffect | undefined,
  error: unknown,
): Promise<never> {
  try {
    await effect?.settle(false);
  } catch (cleanup) {
    throw new AggregateError(
      [error, cleanup],
      'Recording publication rollback failed',
    );
  }
  throw error;
}

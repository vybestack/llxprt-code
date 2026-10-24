/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { fillNeutralRowFacts } from './neutralRowFacts.js';
import type { CommitEffect } from './commitEffect.js';
import { densityFilePolicy } from './density-file-fill.js';
import { fillDensityFiles } from './density-file-fill.js';
import type { DensityFilePolicy } from './density-file-facts.js';
import { fillRowFormats, type RegisteredRowFormat } from './formatFill.js';
import { invalidateAnthropicFormats } from './formatFillLifecycle.js';
import type { BuildContext, BuiltGroup } from './groupBuild.js';
import type { RecordAppender } from './groupAppender.js';
import type { VersionEdit } from './groupEdits.js';
import { fillNativeFacts } from './nativeFactFill.js';
import type { NativeFactIndexRegistration } from './nativeFactIndex.js';
import { fillToolRanking, toolRankingPolicy } from './tool-ranking-fill.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';

export interface StoreFormatPolicies {
  readonly ranking: ToolRankingPolicy | undefined;
  readonly files: DensityFilePolicy | undefined;
  readonly facts: NativeFactIndexRegistration | undefined;
  readonly formats: readonly RegisteredRowFormat[];
}

async function fillStoreFormats(
  context: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  policies: StoreFormatPolicies,
): ReturnType<typeof fillRowFormats> {
  const ranked = await fillToolRanking(
    context,
    built,
    appender,
    edits,
    toolRankingPolicy(edits, policies.ranking),
  );
  const withFiles = await fillDensityFiles(
    context,
    ranked,
    appender,
    edits,
    densityFilePolicy(edits, policies.files),
  );
  const indexed = await fillNativeFacts(
    context,
    withFiles,
    appender,
    policies.facts,
    edits,
  );
  return fillRowFormats(
    context,
    indexed.invalidated
      ? invalidateAnthropicFormats(indexed.built)
      : indexed.built,
    appender,
    edits,
    policies.formats,
    indexed.invalidated,
    policies.facts?.scope,
  );
}

export async function finishStoreFormats(
  context: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  policies: StoreFormatPolicies,
  effect: CommitEffect | undefined,
): ReturnType<typeof fillRowFormats> {
  const filled = await fillStoreFormats(
    context,
    await fillNeutralRowFacts(context, built, appender),
    appender,
    edits,
    policies,
  );
  if (effect === undefined) return filled;
  return {
    ...filled,
    built: {
      ...filled.built,
      state: {
        ...filled.built.state,
        stateRoot: await effect.finish(filled.built.state.stateRoot, appender),
      },
    },
  };
}

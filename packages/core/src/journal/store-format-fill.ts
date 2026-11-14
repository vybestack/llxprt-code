/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { fillNeutralRowFacts } from './neutralRowFacts.js';
import type { CommitEffect } from './commitEffect.js';
import { densityFilePolicy } from './density-file-fill.js';
import { fillDensityFiles } from './density-file-fill.js';
import type { DensityFilePolicy } from './density-file-facts.js';
import { fillRowFormats, type RegisteredRowFormat } from './formatFill.js';
import {
  invalidateAnthropicFormats,
  requireIncrementalFormats,
} from './formatFillLifecycle.js';
import type { BuildContext, BuiltGroup } from './groupBuild.js';
import type { RecordAppender } from './groupAppender.js';
import type { VersionEdit } from './groupEdits.js';
import { changesNativeSource, fillNativeFacts } from './nativeFactFill.js';
import {
  ACTIVE_FACT_INDEX,
  nativeFactCoverage,
  type NativeFactIndexRegistration,
} from './nativeFactIndex.js';
import { mapReader } from './groupBuildShared.js';
import { JournalFormatError } from './errors.js';
import { fillToolRanking, toolRankingPolicy } from './tool-ranking-fill.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';

export function nativeFactRegistration(
  context: BuildContext,
  formats: readonly RegisteredRowFormat[],
  previous: NativeFactIndexRegistration | undefined,
): (
  edits: readonly VersionEdit[],
) => Promise<NativeFactIndexRegistration | undefined> {
  return async (edits) => {
    requireIncrementalFormats(edits, formats);
    const edit = edits.find((item) => item.kind === 'factIndex');
    if (
      previous === undefined &&
      edit === undefined &&
      context.published !== undefined &&
      edits.some(changesNativeSource)
    ) {
      const active = await mapReader(context, 'meta').get(
        context.published.roots.metaRoot,
        ACTIVE_FACT_INDEX,
      );
      const coverage = nativeFactCoverage(active);
      const detachedAppend =
        edits.every((item) => item.kind === 'append') &&
        context.published.slots.formatSlots.some(
          (slot) => slot.summaryKind === 'anthropic',
        );
      if (coverage !== undefined && coverage.scope !== '' && !detachedAppend)
        throw new JournalFormatError(
          'Stored format incremental holder maintenance is not implemented; a native fact writer must be registered before history mutations',
        );
    }
    return edit?.kind === 'factIndex' ? edit.registration : previous;
  };
}

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
    context.published?.slots.formatSlots.every(
      (slot) => slot.summaryKind !== 'anthropic',
    ) !== false ||
      policies.formats.some(
        ({ key, registration }) =>
          registration.nativeFactScope === policies.facts?.scope &&
          context.published?.slots.formatSlots.some(
            (slot) =>
              slot.formatKeyHash === key &&
              slot.summaryKind === 'anthropic' &&
              slot.filledThrough === context.published?.commitSeq,
          ) === true,
      ),
  );
  return fillRowFormats(
    context,
    indexed.invalidated
      ? invalidateAnthropicFormats(indexed.built)
      : indexed.built,
    appender,
    edits,
    policies.formats,
    indexed.invalidated || indexed.deferred === true,
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
  context = { ...context, ...built.groupCaches };
  const filled = await fillStoreFormats(
    context,
    await fillNeutralRowFacts(context, built, appender, edits),
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

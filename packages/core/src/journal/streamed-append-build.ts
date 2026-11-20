/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAppender } from './groupAppender.js';
import {
  commitFacts,
  commitState,
  mapReader,
  trailerState,
  type BuildContext,
  type BuiltGroup,
} from './groupBuildShared.js';
import { finishFacts, startFacts } from './groupFacts.js';
import type { GroupPlan } from './groupPlanTypes.js';
import { MISTRAL_GENERATION_KEY } from './mistralMapping.js';
import { encodeDecimal } from './metaFacts.js';
import type { MutationCode } from './recordKinds.js';
import { appendRowEntries, bulkBuildRowTree } from './rowTreeBuilder.js';
import { iterateRowEntries, loadRightSpine } from './rowTreeReader.js';
import { replaceRowEntriesStream } from './row-tree-stream-edit.js';
import {
  StreamedAppendPass,
  type AppendInput,
} from './streamed-append-pass.js';
import { slotKindsOf } from './version.js';

/** A bounded raw tail supplies the second pass once all source facts are known. No history rows are rebuilt. */
export async function buildStreamedAppend(
  ctx: BuildContext,
  plan: GroupPlan,
  mutation: MutationCode,
  appender: RecordAppender,
  inputs: AsyncIterable<AppendInput>,
  adoptedNextLabel?: bigint,
): Promise<BuiltGroup | undefined> {
  const facts = await startFacts(
    ctx.access,
    plan.base.roots,
    ctx,
    mapReader(ctx, 'meta'),
    { appender, readGroup: ctx.readGroup },
  );
  if (facts.mistralSlots !== 0)
    facts.meta.set(MISTRAL_GENERATION_KEY, encodeDecimal(ctx.commitSeq));
  const originalSpine =
    plan.base.rows > 0 ? await ctx.spineFor(plan.base) : undefined;
  const lastLabel =
    originalSpine?.leaf[originalSpine.leaf.length - 1].label ?? 0n;
  const pass = new StreamedAppendPass(
    ctx,
    facts,
    appender,
    inputs,
    plan.nextLabel,
    lastLabel,
  );
  const algebra = ctx.algebra(slotKindsOf(plan.base.slots));
  const raw = await bulkBuildRowTree(appender, algebra, pass.entries());
  if (raw === undefined) return undefined;
  await appender.drain();
  const access = ctx.readGroup(appender.nextOffset);
  let spine = originalSpine;
  if (ctx.access !== undefined && plan.base.roots.rowRoot !== 0) {
    const edited = await replaceRowEntriesStream(
      ctx.access,
      appender,
      algebra,
      { offset: plan.base.roots.rowRoot, rows: plan.base.rows },
      pass.contributions(access, pass.affectedEntries(plan.base)),
    );
    if (edited !== undefined) {
      await appender.drain();
      spine = await loadRightSpine(ctx.readGroup(appender.nextOffset), {
        offset: edited.childOffset,
        rows: plan.base.rows,
      });
    }
  }
  const additions = pass.contributions(
    access,
    iterateRowEntries(access, {
      offset: raw.root.childOffset,
      rows: raw.root.count,
    }),
  );
  const tree = await appendRowEntries(appender, algebra, spine, additions);
  const roots = await commitFacts(finishFacts(facts), plan, appender);
  const stateRoot = await commitState(ctx, plan, appender);
  const chainBase = await ctx.chainFor(plan.parent);
  plan.nextLabel = pass.nextLabelAfter(adoptedNextLabel);
  return {
    state: trailerState(ctx, plan, mutation, chainBase, {
      ...roots,
      stateRoot,
      nextLabel: plan.nextLabel,
      rowRoot: tree.root.childOffset,
      aggregate: tree.root.aggregate,
      spine: tree.spine,
      firstLabel:
        plan.base.rows > 0 ? plan.base.firstLabel : (pass.first?.label ?? 0n),
      lastRowOffset: pass.last?.recordOffset ?? plan.base.lastRowOffset,
      lastOwner: pass.last?.owner ?? plan.base.lastOwner,
    }),
    spine: tree.spine,
    chainBase,
  };
}

/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import { ROW_ID_KIND } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import type { JournalResponsePlan } from '@vybestack/llxprt-code-core/services/history/journal-response-plan.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

export function* nativeAnthropicCallIds(
  plan: JournalResponsePlan,
): Generator<string> {
  if (plan.header.speaker !== 'ai') return;
  for (const ref of plan.blocks) {
    if (ref.kind === 'reconstructed') {
      if (ref.id === undefined)
        throw new JournalFormatError('Reconstructed call has no id');
      yield normalizeToAnthropicToolId(ref.id);
    } else if (ref.kind === 'source') {
      const ids = plan.sourceIds?.(ref.at.label);
      if (ids === undefined)
        throw new JournalFormatError(
          'Native call source has no row id directory',
        );
      const at = ids.header.ids.findIndex(
        (tuple) =>
          tuple.block === ref.at.block && tuple.kind === ROW_ID_KIND.call,
      );
      if (at >= 0) yield normalizeToAnthropicToolId(ids.rawIds[at]);
    }
  }
}

export function* nativeAnthropicResultIds(
  plan: JournalResponsePlan,
): Generator<string> {
  for (const ref of plan.blocks) {
    if (ref.kind === 'response' || ref.kind === 'orphan') {
      if (ref.id === undefined)
        throw new JournalFormatError('Native result has no id');
      yield normalizeToAnthropicToolId(ref.id);
    } else if (ref.kind === 'source') {
      const ids = plan.sourceIds?.(ref.at.label);
      if (ids === undefined)
        throw new JournalFormatError(
          'Native result source has no row id directory',
        );
      const at = ids.header.ids.findIndex(
        (tuple) =>
          tuple.block === ref.at.block && tuple.kind === ROW_ID_KIND.response,
      );
      if (at >= 0) yield normalizeToAnthropicToolId(ids.rawIds[at]);
    }
  }
}

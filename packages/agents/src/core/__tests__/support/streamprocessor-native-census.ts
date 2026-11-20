/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { NativeResponsesPrompt } from '@vybestack/llxprt-code-providers/openai-responses/native-responses-body.js';
import type { RetainedOwnerCensus } from './streamprocessor-retained-census.js';

function observePlanSerialization(
  census: RetainedOwnerCensus,
  wire: AsyncLocalStorage<boolean>,
  observe: (row: IContent) => void,
): () => void {
  const indexed = IndexedJournalRequestSnapshot.prototype;
  const prompt = NativeResponsesPrompt.prototype;
  const openPlans = indexed.openPlans;
  const body = prompt.body;
  indexed.openPlans = async function* (...args) {
    const sending = wire.getStore() === true;
    const reader = openPlans.call(this, ...args);
    census.observe('request.snapshot', this);
    if (sending) census.observe('snapshot.reader', reader);
    for await (const plan of reader) {
      if (!sending) {
        yield plan;
        continue;
      }
      observe(plan.header);
      yield {
        ...plan,
        async *openBlocks() {
          for await (const block of plan.openBlocks()) {
            census.observe('native.row.block', block);
            census.observe('native.item', block);
            if (block.type === 'text') census.sampleActive(block.text);
            if (census.rowRetention !== 'none') census.trap.push(block);
            yield block;
          }
        },
      };
    }
  };
  prompt.body = async function* (...args) {
    const reader = body.call(this, ...args);
    const sending = args[1] !== 'dump';
    if (sending) census.observe('native.prompt', this);
    try {
      for (;;) {
        const next = await wire.run(sending, () => reader.next());
        if (next.done === true) return;
        yield next.value;
      }
    } finally {
      await reader.return(undefined);
    }
  };
  return () => {
    indexed.openPlans = openPlans;
    prompt.body = body;
  };
}

/** Only wire serialization contributes to the two-attempt row census. */
export function observeNativeSendRows(
  census: RetainedOwnerCensus,
  onRow: (row: IContent) => void,
): () => void {
  const wire = new AsyncLocalStorage<boolean>();
  const prompt = NativeResponsesPrompt.prototype;
  const snapshot = JournalProviderRequestSnapshot.prototype;
  const items = prompt.items;
  const readAt = snapshot.readAt;
  const dispose = prompt.dispose;
  const indexed = IndexedJournalRequestSnapshot.prototype;
  const openReader = indexed.openReader;
  const observe = (row: IContent): void => {
    census.row('snapshot.row', row);
    if (wire.getStore() === true) {
      census.row('native.row', row);
      for (const block of row.blocks)
        if (block.type === 'text') census.sampleActive(block.text);
      onRow(row);
      if (census.rowRetention !== 'none') census.trap.push(row);
    }
  };
  const restorePlans = observePlanSerialization(census, wire, observe);
  snapshot.readAt = async function (...args) {
    const row = await readAt.call(this, ...args);
    census.observe('request.snapshot', this);
    observe(row);
    return row;
  };
  indexed.openReader = async function* (...args) {
    census.observe('request.snapshot', this);
    const reader = openReader.call(this, ...args);
    for await (const row of reader) {
      observe(row);
      yield row;
    }
  };
  prompt.items = async function* (...args) {
    const reader = items.call(this, ...args);
    const sending = args[1] !== true;
    if (sending) {
      census.observe('native.prompt', this);
      census.observe('snapshot.reader', reader);
    }
    try {
      for (;;) {
        const next = await wire.run(sending, () => reader.next());
        if (next.done === true) return;
        if (sending) census.observe('native.item', next.value);
        yield next.value;
      }
    } finally {
      await reader.return(undefined);
    }
  };
  prompt.dispose = function () {
    census.cleanup.projections++;
    return dispose.call(this);
  };
  return () => {
    snapshot.readAt = readAt;
    indexed.openReader = openReader;
    restorePlans();
    prompt.items = items;
    prompt.dispose = dispose;
    wire.disable();
  };
}

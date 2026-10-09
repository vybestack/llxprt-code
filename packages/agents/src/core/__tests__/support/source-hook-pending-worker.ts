/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  processorFixture,
  sourcePending,
} from './streamprocessor-source-fixture.js';
import { registerModelHook } from './streamprocessor-model-hook-fixture.js';
import { sourceBeforeModelHook } from '../../source-before-model-hook.js';

async function run(root: string): Promise<void> {
  const setup = await processorFixture(root, 'http://127.0.0.1:1/v1', false, 1);
  registerModelHook(setup.config, root, 'edit');
  const system = setup.config.getHookSystem();
  if (system === undefined) throw new Error('Missing hook system');
  await system.initialize();
  const snapshot = await setup.history.prepareCuratedForProviderSnapshot(
    [sourcePending],
    { root },
  );
  try {
    const source = await sourceBeforeModelHook({
      config: setup.config,
      snapshot,
      pending: sourcePending,
      model: 'gpt-5.6',
      tools: undefined,
      log: () => undefined,
    });
    try {
      const pending = source.pendingSelection;
      if (pending === undefined)
        throw new Error('Hook pending selection was discarded');
      const reader = pending.rows.openReader();
      const first = await reader.next();
      await reader.return();
      let fullCount = 0;
      for await (const _row of source.openReader()) fullCount++;
      await source.close();
      let closedError: string | undefined;
      try {
        await pending.rows.openReader().next();
      } catch (error) {
        closedError = error instanceof Error ? error.message : String(error);
      }
      writeFileSync(
        join(root, 'pending-result.json'),
        JSON.stringify({
          kind: pending.kind,
          count: pending.rows.count,
          first: first.value,
          fullCount,
          closedError,
        }),
      );
    } finally {
      await source.close();
    }
  } finally {
    snapshot.close();
    setup.history.dispose();
    await setup.config.dispose();
  }
}

await run(process.argv[2]);

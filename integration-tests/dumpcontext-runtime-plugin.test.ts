/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  HistoryService,
  type HistoryDumpSnapshot,
  type HistoryDumpSource,
} from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  createIsolatedRuntimeContext,
  activateIsolatedRuntimeContext,
  resetCliProviderInfrastructure,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { GeminiProvider } from '../plugins/google-gemini/src/gemini/GeminiProvider.js';
import { buildGeminiDumpContents } from '../plugins/google-gemini/src/gemini/geminiDumpConversion.js';
import { createMockCommandContext } from '../packages/cli/src/test-utils/mockCommandContext.js';
import { dumpcontextCommand } from '../packages/cli/src/ui/commands/dumpcontextCommand.js';
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

class WatchedHistory extends HistoryService {
  opened = 0;
  closed = 0;
  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    this.opened++;
    const snapshot = await super.openDumpSnapshot();
    return {
      ...snapshot,
      close: async (): Promise<void> => {
        await snapshot.close();
        this.closed++;
      },
    };
  }
}
class FailingGemini extends GeminiProvider {
  override async buildContextDumpBody(
    history: HistoryDumpSource,
  ): Promise<Record<string, unknown>> {
    void history;
    throw new Error(`converter failed for ${this.name}`);
  }
}
async function run(
  count: number,
  provider = new GeminiProvider(),
  cancel = false,
): Promise<{
  result: unknown;
  opened: number;
  closed: number;
  body?: unknown;
  expected?: unknown;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dump-runtime-plugin-'));
  const cache = spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(root);
  const history = new WatchedHistory();
  const runtime = createIsolatedRuntimeContext({
    runtimeId: `dump-plugin-${count}`,
    workspaceDir: root,
  });
  try {
    runtime.providerManager.registerProvider(provider);
    await runtime.providerManager.setActiveProvider('gemini');
    await activateIsolatedRuntimeContext(runtime);
    for (let index = 0; index < count; index++)
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: `message-${index}` }],
      });
    await history.waitForCommit();
    const controller = new AbortController();
    if (cancel) controller.abort(new Error('dump cancelled'));
    const context = createMockCommandContext({ signal: controller.signal });
    context.services.config = Object.assign(runtime.config, {
      getAgentClient: () => ({ getHistoryService: () => history }),
    });
    if (dumpcontextCommand.action === undefined)
      throw new Error('Missing command');
    const result = await dumpcontextCommand.action(context, 'now');
    const files = await fs
      .readdir(path.join(root, 'dumps'))
      .catch((): string[] => []);
    let body: unknown;
    if (files.length > 0) {
      const dump: unknown = JSON.parse(
        await fs.readFile(path.join(root, 'dumps', files[0]), 'utf8'),
      );
      if (typeof dump !== 'object' || dump === null)
        throw new Error('Invalid dump');
      body = Reflect.get(dump, 'request').body;
    }
    const model = runtime.providerManager
      .getActiveProvider()
      ?.getCurrentModel?.();
    let expected: unknown;
    await collectJournalRowsForAssertions(history, (rows) => {
      const contents = buildGeminiDumpContents(
        [...rows],
        model,
        runtime.config,
      );
      expected = model ? { model, contents } : { contents };
    });
    return {
      result,
      opened: history.opened,
      closed: history.closed,
      body,
      expected,
    };
  } finally {
    history.dispose();
    cache.mockRestore();
    await runtime.cleanup();
    resetCliProviderInfrastructure();
    await fs.rm(root, { recursive: true, force: true });
  }
}
describe('dumpcontext runtime plugin lifecycle', () => {
  for (const count of [512, 8192])
    it(`writes the real registered Gemini plugin for ${count} journal rows`, async () => {
      const result = await run(count);
      expect(result.result).toMatchObject({ messageType: 'info' });
      expect(result.body).toStrictEqual(result.expected);
      expect(result.opened).toBe(1);
      expect(result.closed).toBe(1);
    }, 120000);
  it('rejects an old plugin before opening a snapshot', async () => {
    const result = await run(
      1,
      Object.assign(new GeminiProvider(), { contextDumpVersion: 1 }),
    );
    expect(result.result).toMatchObject({ messageType: 'error' });
    expect(JSON.stringify(result.result)).toContain('contextDumpVersion 2');
    expect(result.opened).toBe(0);
    expect(result.closed).toBe(0);
  });
  it('closes the pinned snapshot when receiver-dependent conversion fails', async () => {
    const result = await run(1, new FailingGemini());
    expect(JSON.stringify(result.result)).toContain(
      'converter failed for gemini',
    );
    expect(result.closed).toBe(1);
  });
  it('propagates command cancellation and closes the snapshot without a dump', async () => {
    const result = await run(1, new GeminiProvider(), true);
    expect(JSON.stringify(result.result)).toContain('dump cancelled');
    expect(result.closed).toBe(1);
    expect(result.body).toBeUndefined();
  });
});

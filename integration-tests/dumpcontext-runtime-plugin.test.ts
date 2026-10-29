/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';
import { createAgent } from '@vybestack/llxprt-code-agents';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import {
  HistoryService,
  type HistoryDumpSnapshot,
  type HistoryDumpSource,
} from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { bindDumpcontextCommand } from '../packages/cli/src/ui/commands/dumpcontextCommandHost.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '@vybestack/llxprt-code-providers/IModel.js';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';
import { createMockCommandContext } from '../packages/cli/src/__tests__/mockCommandContext.js';
import { createDumpcontextCommand } from '../packages/cli/src/ui/commands/dumpcontextCommand.js';
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

class WatchedHistory extends HistoryService {
  opened = 0;
  closed = 0;
  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    this.opened++;
    const snapshot = await super.openDumpSnapshot();
    const close = snapshot.close.bind(snapshot);
    snapshot.close = async (): Promise<void> => {
      await close();
      this.closed++;
    };
    return snapshot;
  }
}
/**
 * Minimal runtime plugin that owns its dump conversion through the
 * contextDumpVersion 2 hook. It has no third-party SDK dependency, so the
 * test does not need any plugin workspace installed.
 */
const PLUGIN_NAME = 'dump-plugin';
const PLUGIN_MODEL = 'dump-plugin-model';

function pluginDumpContent(row: IContent): unknown {
  return {
    role: row.speaker,
    text: row.blocks
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join(''),
  };
}

async function* pluginDumpContents(
  source: HistoryDumpSource,
): AsyncIterable<unknown> {
  for await (const row of source.rows()) yield pluginDumpContent(row);
}

class DumpPlugin implements IProvider {
  readonly name = PLUGIN_NAME;
  readonly contextDumpVersion: IProvider['contextDumpVersion'] = 2;

  async buildContextDumpBody(
    history: HistoryDumpSource,
    model?: string,
  ): Promise<Record<string, unknown>> {
    const contents = pluginDumpContents(history);
    return model ? { model, contents } : { contents };
  }

  async getModels(): Promise<IModel[]> {
    return [];
  }

  generateChatCompletion(): AsyncIterableIterator<IContent> {
    throw new Error('DumpPlugin does not generate completions');
  }

  getCurrentModel(): string {
    return PLUGIN_MODEL;
  }

  getDefaultModel(): string {
    return PLUGIN_MODEL;
  }
}

class FailingPlugin extends DumpPlugin {
  override async buildContextDumpBody(
    history: HistoryDumpSource,
  ): Promise<Record<string, unknown>> {
    void history;
    throw new Error(`converter failed for ${this.name}`);
  }
}
async function run(
  count: number,
  provider: IProvider = new DumpPlugin(),
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
  const agent = await createAgent({
    provider: PLUGIN_NAME,
    model: PLUGIN_MODEL,
    workingDir: root,
    sessionId: `dump-plugin-${count}`,
    harness: { includeProcessCwd: false },
    telemetry: { enabled: false },
    mcpEnabled: false,
    skillsSupport: false,
    providerContributions: buildProviderContributionRegistry([
      {
        specifier: 'memory:dump-plugin',
        manifest: {
          apiVersion: 1,
          id: PLUGIN_NAME,
          providers: [
            {
              providerId: PLUGIN_NAME,
              createProvider: () => provider,
              builtinAliases: [
                {
                  alias: PLUGIN_NAME,
                  config: {
                    baseProvider: PLUGIN_NAME,
                    'requires-auth': false,
                    defaultModel: PLUGIN_MODEL,
                  },
                },
              ],
            },
          ],
        },
      },
    ]),
  });
  try {
    await history.addBatch(
      Array.from(
        { length: count },
        (_, index): IContent => ({
          speaker: 'human',
          blocks: [{ type: 'text', text: `message-${index}` }],
        }),
      ),
    );
    await history.waitForCommit();
    const controller = new AbortController();
    const context = createMockCommandContext({
      signal: controller.signal,
      services: { agent },
    });
    const dumpcontextCommand = createDumpcontextCommand(
      bindDumpcontextCommand({
        readMode: () => agent.getEphemeralSetting('dumpcontext'),
        writeMode: (mode) => agent.setEphemeralSetting('dumpcontext', mode),
        readHistory: async () => {
          const snapshot = await history.openDumpSnapshot();
          if (cancel) controller.abort(new Error('dump cancelled'));
          return snapshot;
        },
        readProvider: () =>
          agent.providerReads.inspection.getProviderDumpMetadata(),
        readOutputSettings: () => ({}),
      }),
    );
    if (dumpcontextCommand.action === undefined)
      throw new Error('Missing command');
    const result = await Promise.resolve(
      dumpcontextCommand.action(context, 'now'),
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) throw error;
      return error;
    });
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
    const model = agent.getModel();
    let expected: unknown;
    await collectJournalRowsForAssertions(history, (rows) => {
      const contents = rows.map(pluginDumpContent);
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
    await history.dispose();
    cache.mockRestore();
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}
describe('dumpcontext runtime plugin lifecycle', () => {
  for (const count of [512, 8192])
    it(`writes the registered runtime plugin body for ${count} journal rows`, async () => {
      const result = await run(count);
      expect(result.result).toMatchObject({ messageType: 'info' });
      expect(result.body).toStrictEqual(result.expected);
      expect(result.opened).toBe(1);
      expect(result.closed).toBe(1);
    }, 120000);
  it('rejects an old plugin before opening a snapshot', async () => {
    const result = await run(
      1,
      Object.assign(new DumpPlugin(), { contextDumpVersion: 1 }),
    );
    expect(result.result).toMatchObject({ messageType: 'error' });
    expect(JSON.stringify(result.result)).toContain('contextDumpVersion 2');
    expect(result.opened).toBe(0);
    expect(result.closed).toBe(0);
  });
  it('closes the pinned snapshot when receiver-dependent conversion fails', async () => {
    const result = await run(1, new FailingPlugin());
    expect(JSON.stringify(result.result)).toContain(
      'converter failed for dump-plugin',
    );
    expect(result.closed).toBe(1);
  });
  it('propagates command cancellation and closes the snapshot without a dump', async () => {
    const result = await run(1, new DumpPlugin(), true);
    expect(result.result).toBeInstanceOf(Error);
    expect(result.result).toMatchObject({ message: 'dump cancelled' });
    expect(result.closed).toBe(1);
    expect(result.body).toBeUndefined();
  });
});

import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage, SettingsService } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers/ProviderManager.js';
import { OpenAIProvider } from '@vybestack/llxprt-code-providers/openai/OpenAIProvider.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { dumpcontextCommand } from './dumpcontextCommand.js';

void vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({}),
}));

class StreamingHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'dumpcontext materialized history',
    );
  }
  override getChronologyTrace(): never {
    throw new Error('dumpcontext materialized trace');
  }
}

describe('dumpcontext real streaming command', () => {
  for (const count of [512, 8192])
    it(`writes ${count} rows through the registered built-in without eager APIs`, async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dumpcontext-command-stream-'),
      );
      const cache = spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(root);
      const history = new StreamingHistory();
      try {
        for (let index = 0; index < count; index++)
          history.add({
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: `message-${index}` }],
          });
        await history.waitForCommit();
        const manager = new ProviderManager({
          settingsService: new SettingsService(),
        });
        manager.registerProvider(new OpenAIProvider('unused-test-key'));
        manager.setActiveProvider('openai');
        const context = createMockCommandContext();
        if (context.services.config === null)
          throw new Error('Missing test config');
        context.services.config = Object.assign(context.services.config, {
          getAgentClient: () => ({ getHistoryService: () => history }),
          getProviderManager: () => manager,
        });
        if (dumpcontextCommand.action === undefined)
          throw new Error('Missing dump command');
        const result = await dumpcontextCommand.action(context, 'now');
        expect(result).toMatchObject({ messageType: 'info' });
        const files = await fs.readdir(path.join(root, 'dumps'));
        const dump: unknown = JSON.parse(
          await fs.readFile(path.join(root, 'dumps', files[0]), 'utf8'),
        );
        expect(dump).toMatchObject({
          provider: 'openai',
          request: { url: 'immediate-context-dump', method: 'DUMP' },
        });
        if (typeof dump !== 'object' || dump === null)
          throw new Error('Invalid dump');
        expect(Reflect.get(dump, 'chronology')).toHaveLength(count);
        const request = Reflect.get(dump, 'request');
        expect(Reflect.get(request.body, 'messages')).toHaveLength(count);
        expect(request.body).not.toHaveProperty('chronology');
      } finally {
        history.dispose();
        cache.mockRestore();
        await fs.rm(root, { recursive: true, force: true });
      }
    }, 120000);
});

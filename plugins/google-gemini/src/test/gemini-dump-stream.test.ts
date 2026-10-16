/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers/ProviderManager.js';
import { LoggingProviderWrapper } from '@vybestack/llxprt-code-providers/LoggingProviderWrapper.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import { buildGeminiDumpContents } from '../gemini/geminiDumpConversion.js';

async function* rows(count: number): AsyncIterable<IContent> {
  for (let index = 0; index < count; index++) {
    if (index % 3 === 0)
      yield {
        speaker: 'human',
        blocks: [
          { type: 'text', text: `row-${index}` },
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'data:image/png;base64,YQ==',
          },
        ],
      };
    else if (index % 3 === 1)
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: `call_${index}`,
            name: 'read_file',
            parameters: { path: 'a' },
          },
        ],
      };
    else
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: `call_${index - 1}`,
            toolName: 'read_file',
            result: { value: index },
          },
          {
            type: 'media',
            encoding: 'url',
            mimeType: 'video/mp4',
            data: 'https://example.com/v',
          },
        ],
      };
  }
}
function iterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  );
}
describe('Gemini runtime bounded dump contract', () => {
  it('preserves conversion through runtime registration and logging wrappers', async () => {
    const manager = new ProviderManager({
      settingsService: new SettingsService(),
    });
    manager.registerProvider(new GeminiProvider());
    manager.setActiveProvider('gemini');
    const active = manager.getActiveProvider();
    if (active === undefined) throw new Error('Missing registered provider');
    const wrapped = new LoggingProviderWrapper(active);
    if (wrapped.buildContextDumpBody === undefined)
      throw new Error('Runtime wrapper lost dump conversion');
    const body = await wrapped.buildContextDumpBody(
      { rows: () => rows(1) },
      'gemini-3-pro',
    );
    expect(wrapped.contextDumpVersion).toBe(2);
    expect(iterable(body.contents)).toBe(true);
  });
  for (const model of ['gemini-2.5-pro', 'gemini-3-pro'])
    for (const count of [512, 8192]) {
      it(`${model} preserves eager media and tool bytes for ${count} rows`, async () => {
        const provider = new GeminiProvider();
        const body = await provider.buildContextDumpBody(
          { rows: () => rows(count) },
          model,
        );
        expect(provider.contextDumpVersion).toBe(2);
        if (!iterable(body.contents))
          throw new Error('Gemini dump contents must stream');
        const eagerRows: IContent[] = [];
        for await (const row of rows(count)) eagerRows.push(row);
        const eager = buildGeminiDumpContents(eagerRows, model);
        let index = 0;
        for await (const converted of body.contents) {
          expect(JSON.stringify(converted)).toBe(
            JSON.stringify(eager[index++]),
          );
        }
        expect(index).toBe(count);
      });
    }
  it('returns the source on early abandonment without reading the remaining rows', async () => {
    let read = 0;
    let closed = false;
    async function* source(): AsyncIterable<IContent> {
      try {
        for await (const row of rows(8192)) {
          read++;
          yield row;
        }
      } finally {
        closed = true;
      }
    }
    const body = await new GeminiProvider().buildContextDumpBody({
      rows: source,
    });
    if (!iterable(body.contents))
      throw new Error('Gemini dump contents must stream');
    for await (const content of body.contents) {
      expect(content).toMatchObject({ role: 'user' });
      break;
    }
    expect(read).toBe(1);
    expect(closed).toBe(true);
  });
});

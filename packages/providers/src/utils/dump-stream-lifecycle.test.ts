/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { DumpScratch } from './dumpScratch.js';
import { buildProviderDumpBodyStream } from './providerRequestConversion.js';
import { dumpRequestContextStream } from './dumpContext.js';
import { streamPrettyJson } from './streamPrettyJson.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-lifecycle-'));

function scratchWatch(): { directories: string[]; restore(): void } {
  const directories: string[] = [];
  const original = fs.mkdtempSync;
  function create(prefix: string, options?: fs.EncodingOption): string;
  function create(
    prefix: string,
    options: fs.BufferEncodingOption,
  ): NonSharedBuffer;
  function create(
    prefix: string,
    options?: fs.EncodingOption,
  ): string | NonSharedBuffer;
  function create(
    prefix: string,
    options?: fs.EncodingOption | fs.BufferEncodingOption,
  ): string | NonSharedBuffer {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding === 'buffer') {
      const result = original(prefix, { encoding: 'buffer' });
      if (prefix.includes('llxprt-dump-scratch-'))
        directories.push(result.toString());
      return result;
    }
    const result = original(prefix, { encoding });
    if (prefix.includes('llxprt-dump-scratch-')) directories.push(result);
    return result;
  }
  const spy = spyOn(fs, 'mkdtempSync').mockImplementation(create);
  return { directories, restore: () => spy.mockRestore() };
}
async function advanceToMedia(iterator: AsyncGenerator<string>): Promise<void> {
  let found = false;
  while (!found) {
    const part = await iterator.next();
    if (part.done === true) throw new Error('Missing media output');
    found = part.value.includes('YQ==');
  }
}
async function exhaust(value: unknown): Promise<void> {
  for await (const chunk of streamPrettyJson(value)) void chunk;
}
describe('stream dump cleanup and cancellation', () => {
  it('does not publish a scratch slot after a failed write', () => {
    const scratch = new DumpScratch<number>();
    const write = spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('disk write failed');
    });
    try {
      expect(() => scratch.append(5)).toThrow('disk write failed');
      expect(scratch.length).toBe(0);
      write.mockRestore();
      scratch.append(9);
      expect(scratch.read(0)).toBe(9);
    } finally {
      write.mockRestore();
      scratch.close();
    }
  });
});
describe('provider iterator cleanup', () => {
  for (const providerName of ['openai', 'anthropic']) {
    it(`${providerName} removes conversion scratch and returns failed sources`, async () => {
      const watch = scratchWatch();
      let closed = false;
      let passes = 0;
      async function* rows(): AsyncGenerator<IContent> {
        passes++;
        try {
          yield { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] };
          if (providerName === 'anthropic' || passes === 2)
            throw new Error('read failure');
        } finally {
          closed = true;
        }
      }
      try {
        await expect(
          exhaust(
            buildProviderDumpBodyStream({
              providerName,
              history: {
                rows,
                callerOwnedRows: {
                  callerOwned: true,
                  count: 1,
                  openReader: rows,
                  readAt: () => ({
                    speaker: 'human',
                    blocks: [{ type: 'text', text: 'first' }],
                  }),
                },
              },
            }),
          ),
        ).rejects.toThrow('read failure');
        expect(closed).toBe(true);
        expect(watch.directories).toStrictEqual([]);
        expect(watch.directories.filter(fs.existsSync)).toStrictEqual([]);
      } finally {
        watch.restore();
      }
    });
  }
});
describe('provider nested iterator cleanup', () => {
  for (const providerName of ['openai', 'anthropic']) {
    it(`${providerName} removes conversion scratch when nested output is abandoned`, async () => {
      const watch = scratchWatch();
      let closed = false;
      async function* rows(): AsyncGenerator<IContent> {
        try {
          yield { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] };
          yield {
            speaker: 'ai',
            blocks: [{ type: 'tool_call', id: 'c', name: 't', parameters: {} }],
          };
          for (let index = 0; index < 512; index++)
            yield {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'c',
                  toolName: 't',
                  result: index,
                },
                {
                  type: 'media',
                  mimeType: 'image/png',
                  encoding: 'base64',
                  data: 'YQ==',
                },
              ],
            };
        } finally {
          closed = true;
        }
      }
      const contents: IContent[] = [];
      for await (const row of rows()) contents.push(row);
      closed = false;
      const history: HistoryDumpSource = {
        rows,
        callerOwnedRows: {
          ...inMemoryRequestSelection(contents),
          callerOwned: true,
          openReader: rows,
        },
      };
      const iterator = streamPrettyJson(
        buildProviderDumpBodyStream({ providerName, history }),
      )[Symbol.asyncIterator]();
      try {
        await advanceToMedia(iterator);
        await iterator.return(undefined);
        expect(closed).toBe(true);
        expect(watch.directories).toStrictEqual([]);
        expect(watch.directories.filter(fs.existsSync)).toStrictEqual([]);
      } finally {
        await iterator.return(undefined);
        watch.restore();
      }
    });
  }
});
describe('stream dump writer cleanup', () => {
  afterEach(() => {
    spyOn(Storage, 'getGlobalCacheDir').mockRestore();
  });
  it('removes partial output and returns the source on cancellation', async () => {
    spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(root);
    const controller = new AbortController();
    let closed = false;
    async function* rows(): AsyncGenerator<IContent> {
      try {
        yield {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'before abort' }],
        };
        controller.abort(new Error('cancel dump'));
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'after abort' }],
        };
      } finally {
        closed = true;
      }
    }
    const request = {
      url: 'immediate-context-dump',
      method: 'DUMP',
      body: buildProviderDumpBodyStream({
        providerName: 'backend',
        history: { rows },
      }),
    };
    await expect(
      dumpRequestContextStream(request, 'backend', 'cancelled', undefined, {
        media: 'raw',
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancel dump');
    expect(closed).toBe(true);
    expect(
      fs.existsSync(path.join(root, 'dumps', 'cancelled-request.json')),
    ).toBe(false);
  });
});
describe('scratch construction cleanup', () => {
  for (const failedIndex of [1])
    it(`cleans scratch descriptors when index ${failedIndex} fails`, () => {
      const watch = scratchWatch();
      const open = fs.openSync;
      let descriptor = -1;
      let indices = 0;
      const spy = spyOn(fs, 'openSync').mockImplementation(
        (file, flags, mode) => {
          if (
            String(file).includes('llxprt-dump-scratch-') &&
            String(file).endsWith('/index') &&
            ++indices === failedIndex
          )
            throw new Error('index failure');
          const fd = open(file, flags, mode);
          if (String(file).includes('llxprt-dump-scratch-')) descriptor = fd;
          return fd;
        },
      );
      try {
        expect(() => new DumpScratch()).toThrow('index failure');
        expect(watch.directories.filter(fs.existsSync)).toStrictEqual([]);
        expect(() => fs.fstatSync(descriptor)).toThrow(/EBADF/);
      } finally {
        spy.mockRestore();
        watch.restore();
      }
    });
});

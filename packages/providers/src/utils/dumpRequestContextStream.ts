/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { ChronologyTraceEntry } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import {
  generateDumpBaseId,
  redactSensitiveData,
  type DumpRequest,
  type DumpRequestResult,
} from './dumpContext.js';
import type { DiagnosticSanitizationOptions } from './mediaDiagnostics.js';
import { streamPrettyJson } from './streamPrettyJson.js';

export async function dumpRequestContextStream(
  request: DumpRequest,
  provider: string,
  baseId?: string,
  chronology?: AsyncIterable<ChronologyTraceEntry>,
  options: DiagnosticSanitizationOptions & { signal?: AbortSignal } = {},
): Promise<DumpRequestResult> {
  if (options.media !== 'raw')
    throw new TypeError('Streaming immediate dumps require raw media');
  options.signal?.throwIfAborted();
  const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');
  await fs.mkdir(dumpDir, { recursive: true });
  const id = baseId ?? generateDumpBaseId(provider);
  const requestFilename = `${id}-request.json`;
  const filepath = path.join(dumpDir, requestFilename);
  const file = await fs.open(filepath, 'w');
  try {
    const data = {
      provider,
      timestamp: new Date().toISOString(),
      request: {
        ...redactSensitiveData({ ...request, body: undefined }, options),
        body: request.body,
      },
      ...(chronology === undefined ? {} : { chronology }),
    };
    for await (const chunk of streamPrettyJson(data)) {
      options.signal?.throwIfAborted();
      await file.writeFile(chunk, 'utf8');
    }
  } catch (error) {
    await fs.unlink(filepath);
    throw error;
  } finally {
    await file.close();
  }
  return { baseId: id, requestFilename, dumpDir };
}

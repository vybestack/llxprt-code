/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  generateDumpBaseId,
  redactSensitiveData,
  type DumpRequest,
  type DumpRequestResult,
} from './dumpContext.js';

/**
 * Writes a request dump whose body arrives as already-encoded JSON bytes from
 * a disk source, so the body is streamed to the dump file instead of being
 * materialized as one value. The envelope is the usual dump shape; only the
 * body is compact rather than pretty-printed.
 */
export async function dumpRequestContextBodyBytes(
  request: Omit<DumpRequest, 'body'>,
  provider: string,
  body: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<DumpRequestResult> {
  signal?.throwIfAborted();
  const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');
  await fs.mkdir(dumpDir, { recursive: true });
  const baseId = generateDumpBaseId(provider);
  const requestFilename = `${baseId}-request.json`;
  const filepath = path.join(dumpDir, requestFilename);
  const envelope = JSON.stringify(
    {
      provider,
      timestamp: new Date().toISOString(),
      request: redactSensitiveData(request),
    },
    null,
    2,
  );
  // Reopen the redacted request object (closing "  }\n}") to append the body.
  const closing = '\n  }\n}';
  if (!envelope.endsWith(closing))
    throw new Error('Unexpected dump envelope shape');
  const file = await fs.open(filepath, 'w');
  try {
    await file.writeFile(
      `${envelope.slice(0, -closing.length)},\n    "body": `,
      'utf8',
    );
    for await (const chunk of body) {
      signal?.throwIfAborted();
      await file.write(chunk);
    }
    await file.writeFile(closing, 'utf8');
  } catch (error) {
    await file.close();
    await fs.unlink(filepath);
    throw error;
  }
  await file.close();
  return { baseId, requestFilename, dumpDir };
}

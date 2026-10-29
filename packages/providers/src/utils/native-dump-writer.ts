/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  generateDumpBaseId,
  redactSensitiveData,
  type DumpRequest,
  type DumpRequestResult,
} from './dumpContext.js';
import { Reindenter } from './prettyJsonBytes.js';

export interface NativeDumpWriter {
  readonly result: DumpRequestResult;
  append(bytes: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  discard(): Promise<void>;
}

export async function openNativeDumpWriter(
  request: DumpRequest,
  provider: string,
  pretty: boolean,
): Promise<NativeDumpWriter> {
  const dumpDir = join(Storage.getGlobalCacheDir(), 'dumps');
  await fs.mkdir(dumpDir, { recursive: true });
  const baseId = generateDumpBaseId(provider);
  const requestFilename = `${baseId}-request.json`;
  const filepath = join(dumpDir, requestFilename);
  const closing = '\n  }\n}';
  const { body: _body, ...metadata } = request;
  const envelope = JSON.stringify(
    {
      provider,
      timestamp: new Date().toISOString(),
      request: redactSensitiveData(metadata),
    },
    null,
    2,
  );
  if (!envelope.endsWith(closing))
    throw new Error('Unexpected dump envelope shape');
  const file = await fs.open(filepath, 'w');
  const indent = pretty ? new Reindenter(2) : undefined;
  let closed = false;
  try {
    await file.writeFile(
      `${envelope.slice(0, -closing.length)},\n    "body": `,
      'utf8',
    );
  } catch (error) {
    await file.close();
    await fs.unlink(filepath);
    throw error;
  }
  return {
    result: { baseId, requestFilename, dumpDir },
    async append(bytes) {
      const chunk = indent === undefined ? bytes : indent.transform(bytes);
      if (chunk !== undefined) await file.writeFile(chunk);
    },
    async finish() {
      if (closed) return;
      indent?.finish();
      await file.writeFile(closing, 'utf8');
      await file.close();
      closed = true;
    },
    async discard() {
      if (closed) return;
      await file.close();
      closed = true;
      await fs.unlink(filepath);
    },
  };
}

/*
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

interface Descriptor {
  digest: string;
  size: number;
}

function isDescriptor(value: unknown): value is Descriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'digest' in value &&
    typeof value.digest === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(value.digest) &&
    'size' in value &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0
  );
}

export async function verifyModelStore(
  store: string,
  expectedDigest: string,
): Promise<{ files: number; bytes: number }> {
  const manifestPath = 'manifests/registry.ollama.ai/library/gemma4/e2b-it-qat';
  const raw = await readFile(join(store, manifestPath));
  if (createHash('sha256').update(raw).digest('hex') !== expectedDigest) {
    throw new Error('Manifest digest does not match the pinned model');
  }
  const manifest: unknown = JSON.parse(raw.toString('utf8'));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('config' in manifest) ||
    !isDescriptor(manifest.config) ||
    !('layers' in manifest) ||
    !Array.isArray(manifest.layers) ||
    !manifest.layers.every(isDescriptor)
  ) {
    throw new Error('Invalid model manifest descriptors');
  }
  const blobs = [manifest.config, ...manifest.layers];
  const expected = new Set([
    manifestPath,
    ...blobs.map(({ digest }) => `blobs/${digest.replace(':', '-')}`),
  ]);
  const directories = new Set(['']);
  for (const file of expected) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index++) {
      directories.add(parts.slice(0, index).join('/'));
    }
  }
  async function verifyEntries(directory: string): Promise<void> {
    for (const entry of await readdir(join(store, directory), {
      withFileTypes: true,
    })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && directories.has(relative)) {
        await verifyEntries(relative);
      } else if (!entry.isFile() || !expected.has(relative)) {
        throw new Error(`Unexpected store entry: ${relative}`);
      }
    }
  }
  await verifyEntries('');
  let bytes = raw.length;
  for (const { digest, size } of blobs) {
    const path = join(store, 'blobs', digest.replace(':', '-'));
    if ((await lstat(path)).size !== size) {
      throw new Error(`Blob size mismatch: ${digest}`);
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk);
    }
    if (`sha256:${hash.digest('hex')}` !== digest) {
      throw new Error(`Blob digest mismatch: ${digest}`);
    }
    bytes += size;
  }
  return { files: expected.size, bytes };
}

if (import.meta.main) {
  const store = process.argv[2];
  if (!store) throw new Error('Usage: verify-model-store.ts <model-store>');
  const result = await verifyModelStore(
    store,
    '07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c',
  );
  process.stdout.write(`Verified model store: ${JSON.stringify(result)}\n`);
}

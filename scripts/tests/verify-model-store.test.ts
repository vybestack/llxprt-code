/*
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyModelStore } from '../../.github/actions/setup-local-gemma/verify-model-store.ts';

const manifestPath = 'manifests/registry.ollama.ai/library/gemma4/e2b-it-qat';
const sha256 = (data: string): string =>
  createHash('sha256').update(data).digest('hex');

describe('verified portable model store', () => {
  let directory: string;
  let store: string;
  let digest: string;
  let modelPath: string;
  let manifestBytes: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pr3911-model-store-'));
    store = join(directory, 'models');
    await mkdir(join(store, 'blobs'), { recursive: true });
    await mkdir(join(store, 'manifests/registry.ollama.ai/library/gemma4'), {
      recursive: true,
    });
    const config = '{"model":"gemma4"}';
    const model = 'model weights';
    const descriptor = (data: string): { digest: string; size: number } => ({
      digest: `sha256:${sha256(data)}`,
      size: Buffer.byteLength(data),
    });
    const manifest = JSON.stringify({
      config: descriptor(config),
      layers: [descriptor(model)],
    });
    digest = sha256(manifest);
    manifestBytes = Buffer.byteLength(manifest);
    modelPath = join(store, 'blobs', `sha256-${sha256(model)}`);
    await writeFile(modelPath, model);
    await writeFile(join(store, 'blobs', `sha256-${sha256(config)}`), config);
    await writeFile(join(store, manifestPath), manifest);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('accepts a complete store without network access', async () => {
    await expect(verifyModelStore(store, digest)).resolves.toEqual({
      files: 3,
      bytes: 31 + manifestBytes,
    });
  });

  it('rejects a manifest that differs from the pinned digest', async () => {
    await writeFile(join(store, manifestPath), '{}');
    await expect(verifyModelStore(store, digest)).rejects.toThrow(
      'Manifest digest',
    );
  });

  it.each([
    {},
    { config: { digest: 'sha256:../other', size: 1 }, layers: [] },
    { config: { digest: `sha256:${'a'.repeat(64)}`, size: -1 }, layers: [] },
    { config: { digest: `sha256:${'a'.repeat(64)}`, size: 1 }, layers: [{}] },
  ])('rejects malformed manifest descriptors: %j', async (value) => {
    const raw = JSON.stringify(value);
    await writeFile(join(store, manifestPath), raw);
    await expect(verifyModelStore(store, sha256(raw))).rejects.toThrow(
      'Invalid model manifest descriptors',
    );
  });

  it('rejects unreferenced directories', async () => {
    await mkdir(join(store, 'runtime'));
    await expect(verifyModelStore(store, digest)).rejects.toThrow(
      'Unexpected store entry',
    );
  });

  it('rejects missing blobs', async () => {
    await rm(modelPath);
    await expect(verifyModelStore(store, digest)).rejects.toThrow();
  });

  it('rejects truncated downloads', async () => {
    await writeFile(modelPath, 'model');
    await expect(verifyModelStore(store, digest)).rejects.toThrow('Blob size');
  });

  it('rejects same-size corrupted blobs', async () => {
    await writeFile(modelPath, 'MODEL WEIGHTS');
    await expect(verifyModelStore(store, digest)).rejects.toThrow(
      'Blob digest',
    );
  });

  it.each([
    'blobs/sha256-extra',
    'blobs/sha256-partial-0',
    'ollama.exe',
    'manifests/other-model',
  ])('rejects unreferenced data: %s', async (extra) => {
    await writeFile(join(store, extra), 'unexpected');
    await expect(verifyModelStore(store, digest)).rejects.toThrow(
      'Unexpected store entry',
    );
  });

  it('rejects symlinks even if the target blob is valid', async () => {
    const target = join(directory, 'target');
    await writeFile(target, 'model weights');
    await rm(modelPath);
    await symlink(target, modelPath);
    await expect(verifyModelStore(store, digest)).rejects.toThrow(
      'Unexpected store entry',
    );
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProviderFileLifecycle,
  type ProviderFileDeletion,
  type ProviderFileScope,
} from '@vybestack/llxprt-code-providers/providerFilePolicy.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { writeProviderFile } from './helpers/provider-file-input.js';

describe('adoption file scope release', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'adoption-release-scopes-'));
    await mkdir(join(directory, 'provider-files'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('releases both session scopes and keeps retained, workspace and other-scope files', async () => {
    const files = join(directory, 'provider-files');
    const runtimeId = 'adopted-runtime-scope';
    const configSessionId = 'caller-config-scope';
    const owner = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    const retain = async (
      fileId: string,
      scopeId: string,
      deletion?: ProviderFileDeletion,
      scope?: ProviderFileScope,
    ): Promise<void> => {
      const input = await writeProviderFile(files, fileId, deletion, scope);
      await (await owner.retain({ ...input, scopeId })).lease.release();
    };
    for (const [fileId, scopeId] of [
      ['owned-runtime', runtimeId],
      ['owned-config', configSessionId],
    ]) {
      await retain(fileId, scopeId);
      await retain(`${fileId}-retained`, scopeId, 'retain');
    }
    await retain('caller-file', 'another-caller-scope');
    await retain('workspace-file', runtimeId, 'delete', 'workspace');
    expect(owner.snapshot().retainedFiles).toBe(6);

    await releaseAdoptedFileScope(owner, runtimeId);
    await releaseAdoptedFileScope(owner, configSessionId);

    expect((await readdir(files)).sort()).toStrictEqual([
      'caller-file',
      'owned-config-retained',
      'owned-runtime-retained',
      'workspace-file',
    ]);
    expect(owner.retainsScope('session', runtimeId)).toBe(false);
    expect(owner.retainsScope('session', configSessionId)).toBe(false);
    expect(owner.retainsScope('session', 'another-caller-scope')).toBe(true);
    expect(owner.retainsScope('workspace', runtimeId)).toBe(true);
    expect(owner.snapshot().retainedFiles).toBe(2);
  });
});

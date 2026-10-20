/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

describe('Agent-owned inherited workspace trust', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let directory: string;
  let temporaryRoot: string;
  beforeEach(async () => {
    temporaryRoot = await realpath(tmpdir());
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'inherited-trust-')),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
  });
  afterEach(async () => runCleanupSteps(cleanup.splice(0).reverse()));

  it('owns a distinct mutable child, follows parent transitions synchronously, and leaves parent and peers usable after release', async () => {
    const parent = new WorkspaceTrustLifecycle({ localTrust: true });
    cleanup.push(() => parent.dispose());
    const agent = await createAgent({
      provider: 'openai',
      model: 'child-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      parentTrustPort: parent,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => agent.dispose());
    const peer = await createAgent({
      provider: 'openai',
      model: 'peer-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      parentTrustPort: parent,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => peer.dispose());
    expect(agent.ide.isTrustedFolder()).toBe(true);
    await agent.ide.setTrustedFolderLive(false);
    expect(parent.isTrustedFolder()).toBe(true);
    expect(peer.ide.isTrustedFolder()).toBe(true);
    expect(() => agent.workspace.addDirectory(temporaryRoot)).toThrow(
      'trusted workspace',
    );
    const revoked = parent.setTrustedFolderLive(false);
    expect(peer.ide.isTrustedFolder()).toBe(false);
    await revoked;
    await parent.setTrustedFolderLive(true);
    expect(agent.ide.isTrustedFolder()).toBe(true);
    agent.workspace.addDirectory(temporaryRoot);
    expect(agent.workspace.getDirectories()).toContain(
      await realpath(tmpdir()),
    );
    await agent.dispose();
    await expect(agent.ide.setTrustedFolderLive(false)).rejects.toThrow(
      'disposed',
    );
    await parent.setTrustedFolderLive(false);
    expect(peer.ide.isTrustedFolder()).toBe(false);
    await parent.setTrustedFolderLive(true);
    expect(peer.ide.isTrustedFolder()).toBe(true);
    expect(peer.getModel()).toBe('peer-model');
  });

  it('rejects simultaneous borrowed and inherited trust before acquiring credential transports', async () => {
    const parent = new WorkspaceTrustLifecycle();
    cleanup.push(() => parent.dispose());
    const construction = createAgent({
      provider: 'openai',
      model: 'invalid-child',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      parentTrustPort: parent,
      trustPort: parent,
    });
    cleanup.push(async () =>
      construction.then(
        (agent) => agent.dispose(),
        () => undefined,
      ),
    );
    await expect(construction).rejects.toThrow(
      'cannot combine borrowed and inherited trust',
    );
    expect(credentials().snapshot()).toStrictEqual([]);
    expect(credentials().keySnapshot()).toStrictEqual([]);
    await parent.setTrustedFolderLive(false);
    expect(parent.isTrustedFolder()).toBe(false);
  });
});

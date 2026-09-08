/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { SessionRecordingService } from '../../packages/core/src/recording/SessionRecordingService.js';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { SessionPersistenceService } from '../../packages/core/src/storage/SessionPersistenceService.js';
import { LocalMediaStore } from '../../packages/core/src/storage/local-media-store.js';
import { RequestMediaResolver } from '../../packages/core/src/storage/request-media-resolver.js';
import { ProviderFileLifecycle } from '../../packages/providers/src/providerFilePolicy.js';
import {
  admittedMediaContentId,
  cleanupAll,
  cleanupMediaProbeResources,
  completeTurnResources,
  describeProcessFailure,
  settleOperation,
  type MediaProbeResources,
} from '../issue-3199-media-memory-lifecycle.js';

function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap(errorMessages);
  }
  return [error instanceof Error ? error.message : String(error)];
}

describe('issue 3199 media memory lifecycle', () => {
  it('handles a persistence rejection as soon as the operation is created', async () => {
    const outcome = await settleOperation(() =>
      Promise.reject(new Error('persistence failed')),
    );

    expect(outcome.success).toBe(false);
    expect(errorMessages(outcome.error)).toEqual(['persistence failed']);
  });

  it('releases request media after a synchronous persistence startup failure', async () => {
    let released = false;
    const failure = await completeTurnResources(
      settleOperation(() => {
        throw new Error('synchronous persistence failure');
      }),
      async () => {
        released = true;
      },
      undefined,
    );

    expect(released).toBe(true);
    expect(errorMessages(failure)).toEqual(['synchronous persistence failure']);
  });

  it('releases request media after persistence failure and preserves both failures', async () => {
    let released = false;
    const failure = await completeTurnResources(
      settleOperation(() => Promise.reject(new Error('persistence failed'))),
      async () => {
        released = true;
        throw new Error('release failed');
      },
      new Error('transport failed'),
    );

    expect(released).toBe(true);
    expect(errorMessages(failure)).toEqual([
      'transport failed',
      'persistence failed',
      'release failed',
    ]);
  });

  it('runs every cleanup and preserves the primary and cleanup failures', async () => {
    const completed = new Set<string>();
    const failure = await cleanupAll(
      [
        () => {
          completed.add('history');
          throw new Error('history cleanup failed');
        },
        () => {
          completed.add('recording');
        },
        async () => {
          completed.add('directory');
          throw new Error('directory cleanup failed');
        },
      ],
      new Error('probe failed'),
    );

    expect([...completed]).toEqual(['history', 'recording', 'directory']);
    expect(errorMessages(failure)).toEqual([
      'probe failed',
      'history cleanup failed',
      'directory cleanup failed',
    ]);
  });

  it('extracts the content identity of an admitted media block', () => {
    const content: IContent = {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'before' },
        {
          type: 'media',
          encoding: 'reference',
          mimeType: 'image/png',
          contentId: 'sha256:abcd1234',
          originalContentId: 'sha256:abcd1234',
          selectedContentId: 'sha256:abcd1234',
          originalObject: {
            contentId: 'sha256:abcd1234',
            mimeType: 'image/png',
            byteLength: 8,
            normalizedBase64Length: 12,
          },
          selectedObject: {
            contentId: 'sha256:abcd1234',
            mimeType: 'image/png',
            byteLength: 8,
            normalizedBase64Length: 12,
          },
          transformation: {
            policyId: 'identity',
            policyVersion: 1,
            parameters: {},
          },
          byteLength: 8,
          normalizedBase64Length: 12,
          semanticMetadata: {},
        },
      ],
    };

    expect(admittedMediaContentId(content, 3)).toBe('sha256:abcd1234');
  });

  it('rejects a turn that did not admit a media reference block', () => {
    const content: IContent = { speaker: 'ai', blocks: [] };
    expect(() => admittedMediaContentId(content, 4)).toThrow(/turn 4/);
  });

  it('cleans initialized resources and its temp directory when initialization fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llxprt-media-init-'));
    const resources: MediaProbeResources = { directory };
    let failure: unknown;

    try {
      const store = new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024,
      });
      resources.store = store;
      const history = new HistoryService();
      resources.history = history;
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'initialization probe' }],
      });
      const resolver = new RequestMediaResolver(store);
      resources.resolver = resolver;
      const recording = new SessionRecordingService({
        sessionId: 'initialization-probe',
        projectHash: 'initialization-probe',
        chatsDir: join(directory, 'recording'),
        workspaceDirs: [directory],
        provider: 'probe',
        model: 'probe',
        mediaStore: store,
      });
      resources.recording = recording;
      recording.recordContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'queued before failure' }],
      });
      const persistence = new SessionPersistenceService(
        new Storage(directory),
        'initialization-probe',
        { mediaStore: store },
      );
      resources.persistence = persistence;
      const providerRetention = new ProviderFileLifecycle({
        maxFiles: 1,
        maxBytes: 1024,
      });
      resources.providerRetention = providerRetention;
      const retained = await providerRetention.retain({
        cacheKey: 'initialization-probe',
        fileId: 'initialization-probe-file',
        bytes: 10,
        identity: {
          provider: 'probe',
          baseURL: 'https://probe.invalid',
          credentialHash: 'initialization-probe',
        },
        policy: {
          mode: 'enabled',
          scope: 'session',
          retentionMs: 60_000,
          deletion: 'retain',
          zeroDataRetention: 'incompatible-while-retained',
        },
        scopeId: 'media-probe-session',
        deleteRemote: async () => {},
      });
      await retained.lease.release();
      throw new Error('deterministic initialization failure');
    } catch (error) {
      failure = error;
    } finally {
      failure = await cleanupMediaProbeResources(resources, failure);
    }

    const {
      history,
      resolver,
      recording,
      persistence,
      providerRetention,
      store,
    } = resources;
    if (history === undefined) throw new Error('History did not initialize');
    if (resolver === undefined) throw new Error('Resolver did not initialize');
    if (recording === undefined) throw new Error('Recorder did not initialize');
    if (persistence === undefined) {
      throw new Error('Persistence did not initialize');
    }
    if (providerRetention === undefined) {
      throw new Error('Provider retention did not initialize');
    }
    if (store === undefined) throw new Error('Store did not initialize');
    expect(errorMessages(failure)).toEqual([
      'deterministic initialization failure',
    ]);
    expect(history.getAll()).toEqual([]);
    expect(resolver.accounting()).toMatchObject({ activeRequestCount: 0 });
    expect(recording.isActive()).toBe(false);
    expect(recording.getPendingByteCount()).toBe(0);
    expect(persistence.getPendingByteCount()).toBe(0);
    expect(providerRetention.snapshot().retainedFiles).toBe(0);
    await expect(
      store.admit({
        bytes: new Uint8Array([1]),
        mimeType: 'image/png',
        semanticMetadata: {},
      }),
    ).rejects.toThrow('closed');
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports signal termination without describing a null exit status', () => {
    expect(describeProcessFailure('node', null, 'SIGTERM', 'terminated')).toBe(
      'node media memory target was terminated by signal SIGTERM: terminated',
    );
  });

  it('reports a numeric exit status when no signal terminated the process', () => {
    expect(describeProcessFailure('bun', 2, null, 'failed')).toBe(
      'bun media memory target exited with status 2: failed',
    );
  });
});

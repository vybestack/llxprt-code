/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderManager } from './ProviderManager.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from './BaseProvider.js';
import { CredentialAuthority } from './auth/proxy/credential-store-factory.js';
import { ProviderFileLifecycle } from './providerFilePolicy.js';
import { createProviderConfigFixture } from './runtime/__tests__/provider-config-fixture.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  RequestMediaResolver,
  type RequestMediaResolutionService,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  IContent,
  ProviderFileReferenceMetadata,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

class MemoryFileBindings implements ProviderFileBindingStore {
  readonly references = new Map<string, ProviderFileReferenceMetadata>();
  async bind(
    contentId: string,
    reference: ProviderFileReferenceMetadata,
  ): Promise<void> {
    this.references.set(contentId, reference);
  }
  async unbind(contentId: string): Promise<void> {
    this.references.delete(contentId);
  }
}

class MediaFileProvider extends BaseProvider {
  override readonly requestMediaResolver:
    | RequestMediaResolutionService
    | undefined = undefined;
  override readonly requestMediaBudgetBytes: number | undefined = undefined;
  readonly requestProviderFileBindings: ProviderFileBindingStore | undefined =
    undefined;
  readonly requestProviderFileLifecycle: object | undefined = undefined;
  constructor() {
    super({ name: 'openai', apiKey: 'fixture-key' });
  }
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'media-model';
  }
  protected supportsOAuth(): boolean {
    return false;
  }
  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const resolver = this.requestMediaResolver;
    const budget = this.requestMediaBudgetBytes;
    const bindings = this.requestProviderFileBindings;
    const lifecycle = this.requestProviderFileLifecycle;
    if (
      resolver === undefined ||
      budget === undefined ||
      bindings === undefined ||
      !(lifecycle instanceof ProviderFileLifecycle)
    )
      throw new Error('Media/file composition missing');
    const request = await resolver.resolve({
      contents: options.contents,
      requestId: 'media-request',
      turnId: 'turn',
      aggregateBudgetBytes: budget,
    });
    try {
      const retained = await lifecycle.retain({
        identity: {
          provider: 'openai',
          baseURL: 'https://provider.example/v1',
          credentialHash: 'fixture-hash',
        },
        policy: {
          mode: 'enabled',
          scope: 'session',
          retentionMs: 1000,
          deletion: 'retain',
          zeroDataRetention: 'incompatible-while-retained',
        },
        scopeId: 'media-owner',
        cacheKey: 'media-content',
        fileId: 'uploaded-file',
        bytes: 3,
        deleteRemote: async () => {},
      });
      await bindings.bind('media-content', retained.reference);
      await retained.lease.release();
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: String(request.accounting().selectedNormalizedBytes),
          },
        ],
      };
    } finally {
      await request.release();
    }
  }
}

describe('ProviderManager media/file composition', () => {
  it('uses selected collaborators through registration and runtime replacement instead of context services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'llxprt-manager-media-'));
    const selected = createProviderConfigFixture({
      sessionId: 'media-owner',
      targetDir: root,
      cwd: process.cwd(),
      model: 'media-model',
      debugMode: false,
    });
    const selectedStore = new LocalMediaStore({
      rootDirectory: join(root, 'selected'),
      quotaBytes: 1024,
    });
    const reference = await selectedStore.admit({
      bytes: new Uint8Array([65, 66, 67]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const resolver = new RequestMediaResolver(selectedStore);
    const foreignResolver = new RequestMediaResolver(
      new LocalMediaStore({
        rootDirectory: join(root, 'foreign'),
        quotaBytes: 1024,
      }),
    );
    const bindings = new MemoryFileBindings();
    const foreignBindings = new MemoryFileBindings();
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 10,
      maxBytes: 1024,
    });
    const foreignLifecycle = new ProviderFileLifecycle({
      maxFiles: 10,
      maxBytes: 1024,
    });
    const runtime = {
      settingsService: selected.settingsService,
      runtimeId: 'same-label',
    };
    const manager = new ProviderManager(
      resolver,
      4,
      bindings,
      lifecycle,
      selected.settingsService,
      selected.config,
      runtime,
      new CredentialAuthority(),
      selected.settingsOwner,
    );
    const foreignManager = new ProviderManager(
      foreignResolver,
      1,
      foreignBindings,
      foreignLifecycle,
      selected.settingsService,
      selected.config,
      { ...runtime },
      new CredentialAuthority(),
      selected.settingsOwner,
    );
    try {
      const sharedProvider = new MediaFileProvider();
      foreignManager.registerProvider(sharedProvider);
      foreignManager.setActiveProvider('openai');
      manager.registerProvider(sharedProvider);
      manager.setActiveProvider('openai');
      manager.setRuntimeContext(
        runtime,
        selected.settingsOwner,
        selected.settingsService,
        selected.config,
      );
      const provider = manager.getActiveProvider();
      if (provider === undefined) throw new Error('Fixture provider missing');
      const chunks: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion({
        contents: [
          {
            speaker: 'human',
            blocks: [reference],
          },
        ],
      }))
        chunks.push(chunk);
      expect(chunks).toMatchObject([{ blocks: [{ text: '4' }] }]);
      expect(bindings.references.size).toBe(1);
      expect(foreignBindings.references.size).toBe(0);
      expect(lifecycle.snapshot()).toMatchObject({
        retainedFiles: 1,
        retainedBytes: 3,
        activeLeases: 0,
      });
      expect(foreignLifecycle.snapshot().retainedFiles).toBe(0);
      expect(resolver.accounting().activeRequestCount).toBe(0);
    } finally {
      manager.dispose();
      foreignManager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

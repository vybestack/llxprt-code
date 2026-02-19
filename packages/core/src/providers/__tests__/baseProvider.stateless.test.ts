/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P05
 * @requirement REQ-SP2-001
 */
import { describe, expect, it } from 'vitest';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import type { IModel } from '../IModel.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

type Snapshot = {
  callId: string;
  phase: string;
  model: string;
  baseUrl?: string;
  authToken?: string;
};

type SettingsOverrides = {
  model?: string;
  baseUrl?: string;
  authKey?: string;
  callId?: string;
};

type CallContextConfig = {
  callId: string;
  model: string;
  baseUrl: string;
  authKey?: string;
  captureAuth?: boolean;
  metadata?: Record<string, unknown>;
};

type CallContext = {
  settings: SettingsService;
  metadata: Record<string, unknown>;
  model: string;
  baseUrl: string;
  authKey?: string;
};

const PROVIDER_NAME = 'stateless-contract-test';

const createContent = (text: string): IContent => ({
  speaker: 'human',
  blocks: [
    {
      type: 'text',
      text,
    },
  ],
});

const createProviderChunk = (callId: string, phase: string): IContent => ({
  speaker: 'ai',
  blocks: [
    {
      type: 'text',
      text: `${callId}:${phase}`,
    },
  ],
});

const createSettingsService = (
  overrides: SettingsOverrides,
): SettingsService => {
  const service = new SettingsService();

  if (overrides.model) {
    service.set('model', overrides.model);
    service.setProviderSetting(PROVIDER_NAME, 'model', overrides.model);
  }

  if (overrides.baseUrl) {
    service.set('base-url', overrides.baseUrl);
    service.setProviderSetting(PROVIDER_NAME, 'base-url', overrides.baseUrl);
  }

  if (overrides.authKey) {
    service.set('auth-key', overrides.authKey);
  }

  if (overrides.callId) {
    service.set('call-id', overrides.callId);
  }

  return service;
};

const createCallContext = (config: CallContextConfig): CallContext => {
  const settings = createSettingsService({
    model: config.model,
    baseUrl: config.baseUrl,
    authKey: config.authKey,
    callId: config.callId,
  });

  const metadata: Record<string, unknown> = {
    marker: config.callId,
    captureAuth: config.captureAuth === true,
  };

  if (config.metadata) {
    Object.assign(metadata, config.metadata);
  }

  if (!('hook' in metadata)) {
    metadata.hook = { callId: config.callId };
  }

  return {
    settings,
    metadata,
    model: config.model,
    baseUrl: config.baseUrl,
    authKey: config.authKey,
  };
};

const collectChunks = async (
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> => {
  const chunks: IContent[] = [];
  for await (const chunk of iterator) {
    chunks.push(chunk);
  }
  return chunks;
};

class TestBaseProvider extends BaseProvider {
  private snapshots: Snapshot[] = [];

  constructor(baseSettings: SettingsService) {
    super({ name: PROVIDER_NAME }, undefined, undefined, baseSettings);
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  async getModels(): Promise<IModel[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'baseline-model';
  }

  snapshotsFor(callId: string): Snapshot[] {
    return this.snapshots.filter((entry) => entry.callId === callId);
  }

  get allSnapshots(): readonly Snapshot[] {
    return this.snapshots;
  }

  clearSnapshots(): void {
    this.snapshots = [];
  }

  getCurrentBaseURL(): string | undefined {
    return this.getBaseURL();
  }

  private async recordSnapshot(
    callId: string,
    phase: string,
    captureAuth: boolean,
  ): Promise<void> {
    const model = this.getModel();
    const baseUrl = this.getBaseURL();
    let authToken: string | undefined;

    if (captureAuth) {
      authToken = await this.getAuthToken();
    }

    this.snapshots.push({
      callId,
      phase,
      model,
      baseUrl,
      authToken,
    });
  }

  private async pause(): Promise<void> {
    await Promise.resolve();
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const callId =
      typeof options.metadata?.marker === 'string'
        ? (options.metadata.marker as string)
        : 'unknown';
    const captureAuth = options.metadata?.captureAuth === true;

    await this.recordSnapshot(callId, 'before-first-yield', captureAuth);
    await this.pause();

    yield createProviderChunk(callId, 'first');

    await this.pause();
    await this.recordSnapshot(callId, 'between-yields', captureAuth);
    await this.pause();

    yield createProviderChunk(callId, 'second');

    await this.pause();
    await this.recordSnapshot(callId, 'after-second-yield', captureAuth);
  }
}

const createProvider = (): TestBaseProvider =>
  new TestBaseProvider(
    createSettingsService({
      model: 'baseline-model',
      baseUrl: 'https://base.example/v1',
      callId: 'base',
    }),
  );

describe('BaseProvider stateless contract', () => {
  it('@plan:PLAN-20251018-STATELESSPROVIDER2.P05 @requirement:REQ-SP2-001 @pseudocode base-provider-call-contract.md lines 3-4 uses call-scoped settings for model/base-url resolution', async () => {
    const provider = createProvider();
    const call = createCallContext({
      callId: 'call-override',
      model: 'call-model',
      baseUrl: 'https://call.example/v1',
    });

    await collectChunks(
      provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: PROVIDER_NAME,
          contents: [createContent('ping')],
          settings: call.settings,
          metadata: call.metadata,
        }),
      ),
    );

    const snapshots = provider.snapshotsFor('call-override');
    expect(snapshots).not.toHaveLength(0);
    expect(
      Array.from(new Set(snapshots.map((entry) => entry.model))).sort(),
    ).toEqual([call.model]);
    expect(
      Array.from(new Set(snapshots.map((entry) => entry.baseUrl))).sort(),
    ).toEqual([call.baseUrl]);
  });

  it('@plan:PLAN-20251018-STATELESSPROVIDER2.P05 @requirement:REQ-SP2-001 @pseudocode base-provider-call-contract.md lines 3-5 isolates overlapping calls without leaking settings', async () => {
    const provider = createProvider();
    const callA = createCallContext({
      callId: 'call-a',
      model: 'model-a',
      baseUrl: 'https://call-a.example/v1',
    });
    const callB = createCallContext({
      callId: 'call-b',
      model: 'model-b',
      baseUrl: 'https://call-b.example/v1',
    });

    await Promise.all([
      collectChunks(
        provider.generateChatCompletion(
          createProviderCallOptions({
            providerName: PROVIDER_NAME,
            contents: [createContent('ping-a')],
            settings: callA.settings,
            metadata: callA.metadata,
          }),
        ),
      ),
      collectChunks(
        provider.generateChatCompletion(
          createProviderCallOptions({
            providerName: PROVIDER_NAME,
            contents: [createContent('ping-b')],
            settings: callB.settings,
            metadata: callB.metadata,
          }),
        ),
      ),
    ]);

    const snapshotsA = provider.snapshotsFor('call-a');
    const snapshotsB = provider.snapshotsFor('call-b');

    expect(snapshotsA).not.toHaveLength(0);
    expect(snapshotsB).not.toHaveLength(0);

    expect(
      Array.from(new Set(snapshotsA.map((entry) => entry.model))).sort(),
    ).toEqual([callA.model]);
    expect(
      Array.from(new Set(snapshotsA.map((entry) => entry.baseUrl))).sort(),
    ).toEqual([callA.baseUrl]);

    expect(
      Array.from(new Set(snapshotsB.map((entry) => entry.model))).sort(),
    ).toEqual([callB.model]);
    expect(
      Array.from(new Set(snapshotsB.map((entry) => entry.baseUrl))).sort(),
    ).toEqual([callB.baseUrl]);
  });

  it('@plan:PLAN-20251018-STATELESSPROVIDER2.P05 @requirement:REQ-SP2-001 @pseudocode base-provider-call-contract.md lines 3-7 resets overrides and auth resolver state after completion', async () => {
    const provider = createProvider();
    const authCall = createCallContext({
      callId: 'call-auth',
      model: 'model-auth',
      baseUrl: 'https://auth.example/v1',
      authKey: 'token-auth',
      captureAuth: true,
    });

    await collectChunks(
      provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: PROVIDER_NAME,
          contents: [createContent('auth-request')],
          settings: authCall.settings,
          metadata: authCall.metadata,
        }),
      ),
    );

    const authSnapshots = provider.snapshotsFor('call-auth');
    expect(
      authSnapshots.some((snapshot) => snapshot.authToken === 'token-auth'),
    ).toBe(true);

    await collectChunks(
      provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: PROVIDER_NAME,
          contents: [createContent('baseline-request')],
          metadata: {
            marker: 'baseline',
            captureAuth: true,
            hook: { callId: 'baseline' },
          },
        }),
      ),
    );

    const baselineSnapshots = provider.snapshotsFor('baseline');
    expect(baselineSnapshots).not.toHaveLength(0);

    const baselineTokens = Array.from(
      new Set(
        baselineSnapshots.map((snapshot) =>
          snapshot.authToken === undefined ? '' : snapshot.authToken,
        ),
      ),
    ).sort();

    expect(baselineTokens).toEqual(['']);
  });

  it('does not leak global base-url from another active provider', () => {
    const settings = createSettingsService({
      model: 'baseline-model',
    });
    settings.set('base-url', 'https://api.openai.com/v1');
    settings.set('activeProvider', 'openai');

    const provider = new TestBaseProvider(settings);
    expect(provider.getCurrentBaseURL()).toBeUndefined();
  });

  it('still respects global base-url when provider is active', () => {
    const settings = createSettingsService({
      model: 'baseline-model',
    });
    settings.set('base-url', 'https://api.openai.com/v1');
    settings.set('activeProvider', PROVIDER_NAME);

    const provider = new TestBaseProvider(settings);
    expect(provider.getCurrentBaseURL()).toBe('https://api.openai.com/v1');
  });
});

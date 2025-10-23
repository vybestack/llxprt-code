import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { MissingProviderRuntimeError } from '../errors.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import { SettingsService } from '../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

class HarnessProvider extends BaseProvider {
  lastNormalizedOptions: NormalizedGenerateChatOptions | undefined;

  constructor() {
    super({ name: 'harness' });
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'harness-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastNormalizedOptions = options;
    this.assertRuntimeContext(options.runtime);
    return (async function* () {})();
  }
}

describe('BaseProvider runtime guard', () => {
  const prompt: IContent = {
    speaker: 'human',
    blocks: [],
  };

  beforeEach(() => {
    clearActiveProviderRuntimeContext();
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('raises MissingProviderRuntimeError when settings are not supplied', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-001
    // Red state: `pnpm test --filter "runtime guard" --runInBand` aborts with CACError `Unknown option --filter`,
    // leaving BaseProvider guard pseudocode lines 10-14 unmet until runtime context wiring is implemented.
    const provider = new HarnessProvider();
    (
      provider as unknown as {
        authResolver: {
          resolveAuthentication: (input: unknown) => Promise<string>;
          setSettingsService: (settings: SettingsService | undefined) => void;
        };
      }
    ).authResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue(''),
      setSettingsService: vi.fn(),
    };

    (
      provider as unknown as {
        defaultSettingsService?: SettingsService;
      }
    ).defaultSettingsService = undefined;

    const iterator = provider.generateChatCompletion({
      contents: [prompt],
      metadata: { test: true },
    } as GenerateChatOptions);

    await expect(iterator.next()).rejects.toThrow(MissingProviderRuntimeError);
  });

  it('raises MissingProviderRuntimeError when config is not supplied', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-001
    // Red state: same command exits early with CACError `Unknown option --filter`, so pseudocode lines 10-16
    // covering provider runtime config guard do not execute; implementation must enable the runtime guard path.
    const provider = new HarnessProvider();

    (
      provider as unknown as {
        authResolver: {
          resolveAuthentication: (input: unknown) => Promise<string>;
          setSettingsService: (settings: SettingsService | undefined) => void;
        };
      }
    ).authResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue('token'),
      setSettingsService: vi.fn(),
    };

    const settings = new SettingsService();
    setActiveProviderRuntimeContext({
      settingsService: settings,
    });

    const iterator = provider.generateChatCompletion({
      contents: [prompt],
      settings,
      metadata: { scenario: 'missing-config' },
    } as GenerateChatOptions);

    const result = iterator.next();
    await expect(result).rejects.toThrow(MissingProviderRuntimeError);
  });
});

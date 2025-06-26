# Phase 04 – Stub ProviderManager (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To create a stub for the `ProviderManager` class, which will be responsible for managing different LLM provider instances and selecting the active one. All new methods will throw `NotYetImplemented` errors.

## Deliverables

- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts`: Stub implementation of `ProviderManager`.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts`: Basic test file for `ProviderManager`.

## Checklist (implementer)

- [ ] Create `packages/cli/src/providers/ProviderManager.ts` with a stub class:

  ```typescript
  import { IProvider } from './IProvider';
  import { OpenAIProvider } from './openai/OpenAIProvider'; // Assuming this path

  export class ProviderManager {
    private providers: Map<string, IProvider>;
    private activeProviderName: string;

    constructor() {
      this.providers = new Map<string, IProvider>();
      // Register initial providers
      this.registerProvider(new OpenAIProvider());
      this.activeProviderName = 'openai'; // Default to openai
    }

    registerProvider(provider: IProvider): void {
      this.providers.set(provider.name, provider);
    }

    setActiveProvider(name: string): void {
      throw new Error('NotYetImplemented');
    }

    getActiveProvider(): IProvider {
      throw new Error('NotYetImplemented');
    }

    async getAvailableModels(providerName?: string): Promise<any[]> {
      throw new Error('NotYetImplemented');
    }
  }
  ```

- [ ] Create `packages/cli/src/providers/ProviderManager.test.ts` with a basic test suite that imports `ProviderManager` and asserts that calling `setActiveProvider`, `getActiveProvider`, and `getAvailableModels` throws `NotYetImplemented`.

  ```typescript
  import { ProviderManager } from './ProviderManager';
  import { OpenAIProvider } from './openai/OpenAIProvider';
  import { IProvider, IModel, IMessage, ITool } from './IProvider';

  // Mock OpenAIProvider to avoid actual API calls and NotYetImplemented errors from its methods
  class MockOpenAIProvider implements IProvider {
    name: string = 'openai';
    async getModels(): Promise<IModel[]> {
      return [];
    }
    async *generateChatCompletion(
      messages: IMessage[],
      tools?: ITool[],
      toolFormat?: string,
    ): AsyncIterableIterator<any> {
      yield {};
    }
  }

  describe('ProviderManager', () => {
    let manager: ProviderManager;

    beforeEach(() => {
      // Use the mock provider for testing ProviderManager
      vi.mock('./openai/OpenAIProvider', () => ({
        OpenAIProvider: MockOpenAIProvider,
      }));
      manager = new ProviderManager();
    });

    it('should register OpenAIProvider by default', () => {
      const provider = manager.getActiveProvider(); // This will throw NotYetImplemented initially
      // We'll test this properly in a later phase after getActiveProvider is implemented
    });

    it('should throw NotYetImplemented for setActiveProvider', () => {
      expect(() => manager.setActiveProvider('anthropic')).toThrow(
        'NotYetImplemented',
      );
    });

    it('should throw NotYetImplemented for getActiveProvider', () => {
      expect(() => manager.getActiveProvider()).toThrow('NotYetImplemented');
    });

    it('should throw NotYetImplemented for getAvailableModels', async () => {
      await expect(manager.getAvailableModels()).rejects.toThrow(
        'NotYetImplemented',
      );
    });
  });
  ```

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/ProviderManager.test.ts
```

**STOP. Wait for Phase 04a verification.**

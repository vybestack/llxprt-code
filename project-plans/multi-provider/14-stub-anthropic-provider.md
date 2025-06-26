# Phase 14 – Stub AnthropicProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To create a stub for the `AnthropicProvider` class, which will implement the `IProvider` interface for Anthropic's API. All new methods will throw `NotYetImplemented` errors.

## Deliverables

- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts`: Stub implementation of `IProvider` for Anthropic.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts`: Basic test file for `AnthropicProvider`.

## Checklist (implementer)

- [ ] Create `packages/cli/src/providers/anthropic/AnthropicProvider.ts` with a stub class implementing `IProvider` and throwing `NotYetImplemented` for all methods.

  ```typescript
  import { IProvider, IModel, ITool, IMessage } from '../IProvider'; // Adjust path as needed

  export class AnthropicProvider implements IProvider {
    name: string = 'anthropic';

    constructor() {}

    async getModels(): Promise<IModel[]> {
      throw new Error('NotYetImplemented');
    }

    async *generateChatCompletion(
      messages: IMessage[],
      tools?: ITool[],
      toolFormat?: string,
    ): AsyncIterableIterator<any> {
      throw new Error('NotYetImplemented');
    }
  }
  ```

- [ ] Create `packages/cli/src/providers/anthropic/AnthropicProvider.test.ts` with a basic test suite that imports `AnthropicProvider` and asserts that calling `getModels()` and `generateChatCompletion()` throws `NotYetImplemented`.

  ```typescript
  import { AnthropicProvider } from './AnthropicProvider';

  describe('AnthropicProvider', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider();
    });

    it('should throw NotYetImplemented for getModels', async () => {
      await expect(provider.getModels()).rejects.toThrow('NotYetImplemented');
    });

    it('should throw NotYetImplemented for generateChatCompletion', async () => {
      const messages = [{ role: 'user', content: 'test' }];
      const generator = provider.generateChatCompletion(messages);
      await expect(generator.next()).rejects.toThrow('NotYetImplemented');
    });
  });
  ```

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
```

**STOP. Wait for Phase 14a verification.**

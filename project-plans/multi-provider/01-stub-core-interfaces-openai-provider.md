# Phase 01 – Stub Core Interfaces & OpenAI Provider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To create the foundational TypeScript interfaces for multi-provider support and stub out the `OpenAIProvider` class, focusing initially on chat completions and native OpenAI tool format. All new methods will throw `NotYetImplemented` errors.

## Deliverables

- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/IProvider.ts`: Interface for LLM providers.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/IModel.ts`: Interface for LLM models.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ITool.ts`: Standardized internal representation of a tool.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/IMessage.ts`: Standardized message format for conversation history.
- `/Users/acoliver/projects/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts`: Stub implementation of `IProvider` for OpenAI.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts`: Basic test file for `OpenAIProvider` (will contain failing tests initially).

## Checklist (implementer)

- [ ] Create `packages/cli/src/providers/IProvider.ts` with the following interface:

  ```typescript
  import { IModel } from './IModel';
  import { ITool } from './ITool';
  import { IMessage } from './IMessage';

  export interface IProvider {
    name: string;
    getModels(): Promise<IModel[]>;
    generateChatCompletion(
      messages: IMessage[],
      tools?: ITool[],
      toolFormat?: string,
    ): AsyncIterableIterator<any>;
    // Add other methods as needed, e.g., generateCompletion, getToolDefinitions
  }
  ```

- [ ] Create `packages/cli/src/providers/IModel.ts` with the following interface:
  ```typescript
  export interface IModel {
    id: string;
    name: string;
    provider: string;
    supportedToolFormats: string[];
  }
  ```
- [ ] Create `packages/cli/src/providers/ITool.ts` with the following interface (OpenAI function tool format):
  ```typescript
  export interface ITool {
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: object;
    };
  }
  ```
- [ ] Create `packages/cli/src/providers/IMessage.ts` with the following interface:
  ```typescript
  export interface IMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }
  ```
- [ ] Create `packages/cli/src/providers/openai/OpenAIProvider.ts` with a stub class implementing `IProvider` and throwing `NotYetImplemented` for all methods.

  ```typescript
  import { IProvider, IModel, ITool, IMessage } from '../IProvider'; // Adjust path as needed

  export class OpenAIProvider implements IProvider {
    name: string = 'openai';

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

- [ ] Create `packages/cli/src/providers/openai/OpenAIProvider.test.ts` with a basic test suite that imports `OpenAIProvider` and asserts that calling `getModels()` and `generateChatCompletion()` throws `NotYetImplemented`.

  ```typescript
  import { OpenAIProvider } from './OpenAIProvider';

  describe('OpenAIProvider', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider();
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
npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
```

**STOP. Wait for Phase 01a verification.**

# Phase 23c – Stub DeepSeekProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Introduce a compile-time stub for a new `DeepSeekProvider` that subclasses our existing `OpenAIProvider`. The stub must be registered in `ProviderManager` so that `/provider deepseek` is accepted by the CLI, but every API call throws `NotYetImplemented` until later phases.

## Deliverables

1. `packages/cli/src/providers/deepseek/DeepSeekProvider.ts` – class skeleton.
2. `packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts` – failing-safe test suite.
3. `packages/cli/src/providers/index.ts` – export `DeepSeekProvider`.
4. `packages/cli/src/providers/ProviderManager.ts` – register `DeepSeekProvider` in the constructor (after OpenAI & Anthropic).

## Checklist (implementer)

- [ ] **Create directory** `packages/cli/src/providers/deepseek/` if it does not exist.
- [ ] **DeepSeekProvider.ts**

  ```ts
  import { OpenAIProvider } from '../openai/OpenAIProvider';

  /**
   * Stub provider for DeepSeek.
   * Extends OpenAIProvider so that we inherit the entire OpenAI machinery.
   * Later phases (23d・23e) will override header handling, model listing, etc.
   */
  export class DeepSeekProvider extends OpenAIProvider {
    name: string = 'deepseek';

    constructor(
      apiKey?: string,
      baseURL: string = 'https://api.deepseek.com/v1',
    ) {
      super(apiKey, baseURL);
    }

    /**
     * Will be implemented in Phase 23d.
     */
    override async getModels() {
      throw new Error('NotYetImplemented');
    }
  }
  ```

- [ ] **DeepSeekProvider.test.ts**

  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { DeepSeekProvider } from './DeepSeekProvider';

  describe('DeepSeekProvider stub', () => {
    let provider: DeepSeekProvider;

    beforeEach(() => {
      provider = new DeepSeekProvider();
    });

    it('throws NotYetImplemented for getModels', async () => {
      await expect(provider.getModels()).rejects.toThrow('NotYetImplemented');
    });

    it('inherits OpenAIProvider.generateChatCompletion but still throws', async () => {
      const iter = provider.generateChatCompletion([
        { role: 'user', content: 'hi' } as any,
      ]);
      await expect(iter.next()).rejects.toThrow();
    });
  });
  ```

- [ ] **Aggregate exports**

  ```ts
  // packages/cli/src/providers/index.ts
  export { DeepSeekProvider } from './deepseek/DeepSeekProvider.js';
  ```

- [ ] **ProviderManager registration** (constructor)
  ```ts
  import { DeepSeekProvider } from './deepseek/DeepSeekProvider.js';
  // …
  this.registerProvider(new DeepSeekProvider());
  ```

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts
```

**STOP. Wait for Phase 23c-verification.**

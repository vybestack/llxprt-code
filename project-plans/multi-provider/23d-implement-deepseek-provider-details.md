# Phase 23d – Implement DeepSeekProvider Details (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Upgrade the `DeepSeekProvider` stub so that it can **really talk** to DeepSeek’s OpenAI-compatible REST API in **stateless chat mode** (no streaming yet, no tool-calls yet). That is enough to send a simple prompt and print the response.

## Deliverables

1. `packages/cli/src/providers/deepseek/DeepSeekProvider.ts` updated with:
   - custom header logic (`x-api-key`)
   - correct default `baseURL`
   - working `getModels()` that returns an `IModel[]` array.
   - working `generateChatCompletion()` (non-stream, stateless):
     - Accepts `(messages: IMessage[])` and returns an **async generator** yielding one final chunk (`{ type:'content', delta:string }`).
2. `packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts` extended with passing tests for both methods (mocking fetch).
3. Token-limit table updated (`packages/core/src/core/tokenLimits.ts`).
4. Plan check-box ticks removed.

## Checklist (implementer)

- [ ] **Header helper** inside class:
  ```ts
  private buildHeaders(apiKey: string) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    } as const;
  }
  ```
- [ ] **Override `generateChatCompletion`** (simplest version):
  ```ts
  import fetch from 'node-fetch';
  // …
  async *generateChatCompletion(msgs: IMessage[]): AsyncGenerator<any> {
    const body = {
      model: this.currentModel,
      messages: msgs,
      stream: false,
    };
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(this.apiKey!),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DeepSeek error ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '';
    yield { type: 'content', delta: text };
  }
  ```
- [ ] **`getModels()`** fetch `/models` endpoint, map each to `IModel` with `provider:'deepseek'` and `supportedToolFormats:['deepseek']`.
- [ ] **Token limits**: add
  - `deepseek-chat` → 32_000
  - `deepseek-coder`, `deepseek-r1-0528` → 128_000
- [ ] **Tests**: use `vi.mock('node-fetch')` to simulate success and error cases.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts
```

**STOP. Wait for Phase 23d-verification.**

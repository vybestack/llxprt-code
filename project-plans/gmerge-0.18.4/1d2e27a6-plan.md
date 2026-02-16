# REIMPLEMENT: 1d2e27a6 — Update system instruction on LLXPRT.md reload

## Upstream Summary

When the user runs `/memory refresh`, the system instruction sent to the model should be updated to include the new memory content. Previously, the system instruction was only set once at chat initialization in `startChat()`.

## Why REIMPLEMENT

Upstream's approach uses sync `getCoreSystemPrompt()`. LLxprt uses `getCoreSystemPromptAsync()` (async). Upstream doesn't compose env-context separately — LLxprt does (`getEnvironmentContext()` → prepend to system instruction). Multi-provider architecture means the client access path needs care.

## LLxprt Architecture Facts (Verified)

- **`getCoreSystemPromptAsync()`** is async, defined in `packages/core/src/core/prompts.ts:328`
  - Takes `CoreSystemPromptOptions`: `{ userMemory?, model?, tools?, provider?, includeSubagentDelegation? }`
- **`GeminiClient.startChat()`** at `client.ts:851` builds the full system instruction:
  1. `const envParts = await getEnvironmentContext(this.config)` (line 856)
  2. `let systemInstruction = await getCoreSystemPromptAsync({ userMemory, model, tools, includeSubagentDelegation })` (line 902)
  3. Prepends env context: `systemInstruction = \`${envContextText}\n\n${systemInstruction}\`` (line 914)
  4. Estimates token count and sets base offset on HistoryService (lines 917-931)
  5. Passes to `new GeminiChat(...)` constructor (line 1042+)
- **`GeminiChat.setSystemInstruction(sysInstr: string)`** exists at `geminiChat.ts:609` — sets `this.generationConfig.systemInstruction`
- **`GeminiClient.isInitialized()`** at `client.ts:584` — checks `this.chat !== undefined && this.contentGenerator !== undefined`
- **`GeminiClient.getChat()`** at `client.ts:557` — returns the `GeminiChat` instance
- **`config.getGeminiClient()`** at `config.ts:1350` — returns the `GeminiClient`
- **`config.getUserMemory()`** — returns current memory string
- **`memoryCommand.ts`** refresh action (line ~142): calls `loadHierarchicalLlxprtMemory()`, then `config.setUserMemory(memoryContent)`

## Key Difference from Upstream

Upstream:
```
getCoreSystemPrompt(config, userMemory)  // sync, simple
```

LLxprt:
```
await getEnvironmentContext(this.config)                     // async, env context
await getCoreSystemPromptAsync({ userMemory, model, tools, includeSubagentDelegation })  // async
systemInstruction = `${envContextText}\n\n${systemInstruction}`  // compose
```

The `updateSystemInstruction` method must replicate this full composition, not just the prompt generation.

## Implementation Steps (TDD per RULES.md)

### Phase 1: Add updateSystemInstruction to GeminiClient

**1a. RED — Write test first:**

Add tests in `packages/core/src/core/client.test.ts`:

- Test: `updateSystemInstruction()` rebuilds system instruction with current userMemory
  - Setup: initialize client with memory "old memory", start chat
  - Act: change memory via `config.setUserMemory("new memory")`, call `client.updateSystemInstruction()`
  - Assert: `geminiChat.setSystemInstruction` was called with string containing "new memory"

- Test: `updateSystemInstruction()` includes env-context prefix
  - Setup: mock `getEnvironmentContext` to return text parts
  - Assert: system instruction starts with env-context text

- Test: `updateSystemInstruction()` is a no-op when chat not initialized
  - Setup: client with no chat started
  - Act: call `updateSystemInstruction()`
  - Assert: no error thrown, `setSystemInstruction` not called

- Test: `updateSystemInstruction()` updates HistoryService base token offset
  - Assert: `historyService.setBaseTokenOffset` called with new count

- Test: `updateSystemInstruction()` includes tool names and subagent delegation in prompt options
  - Mock `getEnabledToolNamesForPrompt` to return specific tools
  - Assert: `getCoreSystemPromptAsync` called with those tools

- Test: `updateSystemInstruction()` falls back to estimateTextTokens when estimateTokensForText fails
  - Mock `estimateTokensForText` to throw
  - Assert: `estimateTextTokens` called as fallback, `setBaseTokenOffset` still called

- Test: `updateSystemInstruction()` handles empty env-context gracefully
  - Mock `getEnvironmentContext` to return empty array
  - Assert: system instruction does NOT have env-context prefix

Run tests — should fail.

**1b. GREEN — Add method to GeminiClient in `packages/core/src/core/client.ts`:**

```typescript
async updateSystemInstruction(): Promise<void> {
  if (!this.isInitialized()) {
    return;
  }

  const userMemory = this.config.getUserMemory();
  const model = this.runtimeState.model;
  const enabledToolNames = this.getEnabledToolNamesForPrompt();
  const includeSubagentDelegation = await this.shouldIncludeSubagentDelegation(enabledToolNames);

  let systemInstruction = await getCoreSystemPromptAsync({
    userMemory,
    model,
    tools: enabledToolNames,
    includeSubagentDelegation,
  });

  const envParts = await getEnvironmentContext(this.config);
  const envContextText = envParts
    .map((part) => ('text' in part ? part.text : ''))
    .join('\n');
  if (envContextText) {
    systemInstruction = `${envContextText}\n\n${systemInstruction}`;
  }

  this.getChat().setSystemInstruction(systemInstruction);

  const historyService = this.getHistoryService();
  if (historyService) {
    try {
      const tokenCount = await historyService.estimateTokensForText(systemInstruction, model);
      historyService.setBaseTokenOffset(tokenCount);
    } catch {
      historyService.setBaseTokenOffset(estimateTextTokens(systemInstruction));
    }
  }
}
```

This replicates the functionally equivalent composition logic from `startChat()` (lines 891-931) but operates on an already-initialized chat. Debug logging side-effects from startChat are intentionally omitted.

Run tests — should pass.

**1c. Verify:** `npm run lint && npm run typecheck`

### Phase 2: Add convenience method on Config

**2a. RED — Write test first:**

Add tests in `packages/core/src/config/config.test.ts` (or appropriate config test file):

- Test: `updateSystemInstructionIfInitialized()` calls `geminiClient.updateSystemInstruction()` when client is initialized
- Test: `updateSystemInstructionIfInitialized()` does nothing when client is not initialized

Run tests — should fail.

**2b. GREEN — Add method to Config in `packages/core/src/config/config.ts`:**

```typescript
async updateSystemInstructionIfInitialized(): Promise<void> {
  const client = this.getGeminiClient();
  if (client.isInitialized()) {
    await client.updateSystemInstruction();
  }
}
```

Run tests — should pass.

**2c. Verify:** `npm run lint && npm run typecheck`

### Phase 3: Wire into memory refresh command

**3a. RED — Write test first:**

Update `packages/cli/src/ui/commands/memoryCommand.test.ts`:

- Test: after successful memory refresh, `config.updateSystemInstructionIfInitialized()` is called
- Mock the config method

Run tests — should fail.

**3b. GREEN — Update `memoryCommand.ts`:**

In the `refresh` subcommand action, after `config.setUserMemory(memoryContent)` (around line ~157), add:

```typescript
await config.updateSystemInstructionIfInitialized();
```

Run tests — should pass.

**3c. Verify:** `npm run lint && npm run typecheck && npm run test`

## Multi-Provider Analysis (Verified)

There are TWO system instruction paths in LLxprt:

### Path 1: GeminiClient → GeminiChat (cached)
- `startChat()` builds system instruction once and stores it in `GeminiChat.generationConfig.systemInstruction`
- This cached copy becomes stale after `/memory refresh`
- **This is the path `updateSystemInstruction()` fixes** — updates the cached copy

### Path 2: GeminiProvider (fresh per call)
- `GeminiProvider.ts` lines 1585 and 1764 call `getCoreSystemPromptAsync()` on EACH API request
- These get `userMemory` from `options.userMemory` which traces back to `config.getUserMemory()`
- After `config.setUserMemory()` is called (which `/memory refresh` already does), this path **automatically picks up new memory** on the next API call
- **No additional fix needed for this path**

### Conclusion
The `updateSystemInstruction()` method on GeminiClient ensures the cached GeminiChat system instruction stays in sync. Providers that build fresh instructions per-call (GeminiProvider) already work correctly after `config.setUserMemory()`.

### Implementation note
At implementation time, verify that the normal interactive chat flow uses GeminiChat's cached system instruction (Path 1), not the provider's per-call build (Path 2). If the interactive flow goes through the provider path, `updateSystemInstruction()` is still correct (keeps GeminiChat consistent) but may be less critical.

## File Inventory

### Modified files:
| File | Change |
|------|--------|
| `packages/core/src/core/client.ts` | Add `updateSystemInstruction()` method |
| `packages/core/src/core/client.test.ts` | Tests for updateSystemInstruction |
| `packages/core/src/config/config.ts` | Add `updateSystemInstructionIfInitialized()` convenience method |
| `packages/core/src/config/config.test.ts` | Tests for config method |
| `packages/cli/src/ui/commands/memoryCommand.ts` | Call update after refresh |
| `packages/cli/src/ui/commands/memoryCommand.test.ts` | Test for refresh → update flow |

## Preservation Checklist

- [ ] Use `getCoreSystemPromptAsync()` (async), NOT `getCoreSystemPrompt()` (sync)
- [ ] Include env-context composition (getEnvironmentContext → prepend)
- [ ] Include tool names and subagent delegation in prompt options
- [ ] Update HistoryService base token offset after system instruction change
- [ ] All imports from `@vybestack/llxprt-code-core`
- [ ] References to "LLXPRT.md" not "GEMINI.md"
- [ ] Behavioral tests only (verify outcomes, not mock internals beyond necessary)

## Verification

```bash
npm run lint && npm run typecheck && npm run test
```

# Reimplement Plan: Hook Integration (Tool + LLM)

**Upstream SHAs:** `558c8ece2ca2f3fec851228e050227fdb0cec8fb` + `5bed97064a99233e4c116849abb138db4e15daa3`
**Batch:** 8

## What upstream does

1. 558c8ece: Creates `coreToolHookTriggers.ts` — fires hooks before/after tool execution in the scheduler
2. 5bed9706: Creates `geminiChatHookTriggers.ts` — fires hooks before/after model calls and before tool selection

## LLxprt approach

Wire LLxprt's existing hook infrastructure (hookRegistry, hookPlanner, hookRunner) into the runtime paths. Create trigger files adapted to LLxprt's hook API.

## Files to create

1. `packages/core/src/core/coreToolHookTriggers.ts` — tool execution hooks
2. `packages/core/src/core/geminiChatHookTriggers.ts` — LLM request/response hooks

## Files to modify

1. `packages/core/src/core/coreToolScheduler.ts` — call tool hook triggers
2. `packages/core/src/core/geminiChat.ts` — call LLM hook triggers
3. `packages/core/src/config/config.ts` — ensure `getEnableHooks()` and `getMessageBus()` are wired

## Key design

- Hook triggers check `config.getEnableHooks()` before firing
- Use existing hookRegistry/hookPlanner/hookRunner pipeline
- Fire events: beforeTool, afterTool, beforeModel, afterModel, beforeToolSelection
- Non-blocking: hook failures should not block main execution flow

## Verification

- Unit tests for trigger functions
- Integration: enable hooks, verify events fire
- Verify no regression when hooks disabled (default)

## Task 02 – Cherry-pick Qwen Streaming & Prompt Queueing Fixes

### Scope
Cherry-pick these upstream commits:

1. `147b68d04` – `Allow streaming for Qwen models with tools`
2. `4d96824d1` – `Queue prompt submissions behind active turn (#251)`
3. `672ff19d8` – `Work around Windows tokenizer shutdown crash (#287)`

### Key Files to Watch
- `packages/core/src/providers/openai/OpenAIProvider.ts` (Qwen streaming adjustments)
- `packages/core/src/providers/openai/OpenAIProvider.test.ts` / related tests
- `packages/cli/src/ui/InputPrompt.tsx` or prompt handling services impacted by queueing
- Any shared tokenizer/streaming utilities

### Acceptance Notes
- Confirm Qwen streaming changes align with our provider auth fixes (avoid regression in `setConfig`, auth resolution).
- Prompt queueing must work alongside subagent/auto-mode flows; double-check interaction with our recent prompt scheduling tweaks.
- Windows tokenizer workaround should not interfere with our tool output limiter or compression work.
- Run targeted streaming/tool tests after applying these commits.


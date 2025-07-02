# Phase 22-06a – Verification of remote-context accounting

## Verification Steps

1. `npm run typecheck && npm run lint`
2. Run focused tests:
   ```bash
   npm test --run ConversationCache.accumTokens
   npm test --run estimateRemoteTokens
   npm test --run ContextIndicator
   npm test --run ResponsesContextTrim.integration
   ```
3. Simulate 422 error:
   ```bash
   node tests/helpers/simulate_422.js  # script should exit 0 after provider retries stateless
   ```
4. Grep checks:
   - Ensure `promptTokensAccum` appears in `ConversationCache`.
   - Check `MODEL_CONTEXT_SIZE` map exists.
5. Confirm all checklist items in 22-06 file are ticked (no `[ ]`).

## Outcome

Emit `✅` if all commands succeed; otherwise list each `❌` failure item.

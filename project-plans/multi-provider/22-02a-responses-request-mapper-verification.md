# Phase 22-02a – Verification of request builder

## Steps

1. `npm run typecheck && npm run lint`
2. `npm test --run buildResponsesRequest`
3. Grep for hard-coded "prompt" field misuse:
   ```bash
   grep -R "\.prompt" packages/cli/src/providers/openai/buildResponsesRequest.ts && echo "❌ found prompt usage" || true
   ```
4. Ensure mapping doc exists:
   ```bash
   test -f packages/cli/src/providers/openai/docs/params-mapping.md
   ```
5. Check checklist boxes ticked.

## Outcome

Emit `✅` or list failures.

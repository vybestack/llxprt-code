# Phase 22-01a – Verification of Responses API bootstrap (multi-provider)

## Verification Steps

1. `npm run typecheck`
2. `npm run lint`
3. Run provider-specific tests:
   ```bash
   npm test --run OpenAIProvider.shouldUseResponses
   npm test --run OpenAIProvider.callResponses.stateless
   npm test --run OpenAIProvider.switch
   ```
4. Run legacy-guard script:
   ```bash
   OPENAI_RESPONSES_DISABLE=1 npm run test:legacy
   ```
5. Grep checks:
   - Constant present
     ```bash
     grep -q "const RESPONSES_API_MODELS" packages/cli/src/providers/openai/RESPONSES_API_MODELS.ts
     ```
   - `this.openai.responses.stream` referenced
     ```bash
     grep -R "openai.responses.stream" packages/cli/src/providers/openai | grep -q OpenAIProvider
     ```
   - `shouldUseResponses(` function exists.
6. Confirm all checklist boxes ticked in implementation file (regex `"\[ \]"` should return no matches inside 22-01 file).

## Outcome

Emit `✅` if every command exits 0 and no grep fails, otherwise list `❌` items.

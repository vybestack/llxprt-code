# Verification — 20251213issue780

Date: 2025-12-13

## Targeted (TDD) Checks

- `npm run test --workspace @vybestack/llxprt-code-core -- src/providers/openai-vercel/OpenAIVercelProvider.test.ts` ✅
- `npm run test --workspace @vybestack/llxprt-code-core -- src/providers/openai-vercel/nonStreaming.test.ts` ✅
- `npm run test --workspace @vybestack/llxprt-code -- src/providers/providerManagerInstance.oauthRegistration.test.ts` ✅

## Required Repo-Root Checklist (AGENTS.md)

1. `npm run format` ✅
2. `npm run lint` ✅
3. `npm run typecheck` ✅
4. `npm run test` ✅
5. `npm run build` ✅
6. `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"` ✅

---

# Verification Addendum — Qwen "developer" role fix

Date: 2025-12-14

## Targeted Checks

- `npm run test --workspace @vybestack/llxprt-code-core -- src/providers/openai-vercel/OpenAIVercelProvider.test.ts` ✅

## Required Repo-Root Checklist (AGENTS.md) — rerun after role fix

1. `npm run format` ✅
2. `npm run lint` ✅
3. `npm run typecheck` ✅
4. `npm run test` ✅
5. `npm run build` ✅
6. `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"` ✅

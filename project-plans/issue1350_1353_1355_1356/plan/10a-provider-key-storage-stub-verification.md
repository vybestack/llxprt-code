# Phase 10a: ProviderKeyStorage Stub Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P10a`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan.*SECURESTORE.P10" packages/core/src/storage/provider-key-storage.ts`

## Verification Commands

```bash
# 1. File exists
ls -la packages/core/src/storage/provider-key-storage.ts

# 2. Plan markers
grep -c "@plan.*SECURESTORE.P10" packages/core/src/storage/provider-key-storage.ts

# 3. TypeScript compiles
npm run typecheck

# 4. All methods present
for m in saveKey getKey deleteKey listKeys hasKey; do
  grep -q "$m" packages/core/src/storage/provider-key-storage.ts && echo "OK: $m" || echo "MISSING: $m"
done

# 5. Service name correct
grep "llxprt-code-provider-keys" packages/core/src/storage/provider-key-storage.ts

# 6. Regex present
grep "a-zA-Z0-9._-" packages/core/src/storage/provider-key-storage.ts

# 7. Line count
wc -l packages/core/src/storage/provider-key-storage.ts
# Expected: <80 lines
```

## Semantic Verification Checklist (MANDATORY)

1. **Does the stub match the pseudocode interface?**
   - [ ] Constructor takes optional secureStore
   - [ ] saveKey(name, apiKey) → Promise<void>
   - [ ] getKey(name) → Promise<string | null>
   - [ ] deleteKey(name) → Promise<boolean>
   - [ ] listKeys() → Promise<string[]>
   - [ ] hasKey(name) → Promise<boolean>

2. **Is the SecureStore config correct?**
   - [ ] Service name: `llxprt-code-provider-keys`
   - [ ] Fallback dir: `~/.llxprt/provider-keys/`
   - [ ] Fallback policy: `'allow'`

## Holistic Functionality Assessment

### Verdict
[PASS/FAIL]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P10a.md`

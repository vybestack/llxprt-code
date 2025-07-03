# Phase 23c – Verification of Stub DeepSeekProvider (multi-provider)

## Verification Steps

1. **Check File Existence**

   ```bash
   ls packages/cli/src/providers/deepseek/DeepSeekProvider.ts
   ls packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts
   ```

2. **Run Type Check**

   ```bash
   npm run typecheck
   ```

3. **Run Linter**

   ```bash
   npm run lint
   ```

4. **Run Tests**

   ```bash
   npm test packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts
   ```

   _Expected_: Tests pass, confirming `NotYetImplemented` errors are thrown.

5. **Verify Stub Content (anti-cheat)**

   ```bash
   # getModels must throw
   grep -q "throw new Error('NotYetImplemented');" \
     packages/cli/src/providers/deepseek/DeepSeekProvider.ts

   # test file must assert rejects.toThrow('NotYetImplemented')
   grep -q "rejects.toThrow('NotYetImplemented')" \
     packages/cli/src/providers/deepseek/DeepSeekProvider.test.ts
   ```

6. **ProviderManager Registration**

   ```bash
   grep -q "new DeepSeekProvider()" packages/cli/src/providers/ProviderManager.ts
   ```

7. **Aggregate Export**
   ```bash
   grep -q "export .*DeepSeekProvider" packages/cli/src/providers/index.ts
   ```

## Outcome

Emit `✅` when all checks pass; otherwise list each failed step prefixed with `❌`.

# Reimplement Plan: ripGrep debugLogger migration (upstream bb8f181ef1)

## Upstream Change
Replaces `console.error` calls with `debugLogger.warn` and `debugLogger.debug` in ripGrep.ts for consistent logging.

## LLxprt Files to Modify
- packages/core/src/tools/ripGrep.ts — Replace exactly 2 console.error calls with debugLogger

## TDD Mandate (Required First Step)

**MUST write behavioral test FIRST before any implementation:**

1. Create test file: `packages/core/src/tools/__tests__/ripGrep.debugLogger.test.ts`

2. Write behavioral test that:
   - Exercises the error path in the main `execute()` catch block (line 224-231)
   - Exercises the error path in `performRipgrepSearch()` catch block (line 360-363)
   - Verifies `debugLogger.warn` is called for the main execution error (NOT console.error)
   - Verifies `debugLogger.debug` is called for the ripgrep failure error (NOT console.error)
   - Uses real error injection (no mocking the system under test)
   - Can spy on debugLogger methods to verify they're called with expected messages

3. **Run test — MUST SEE RED:**
   ```bash
   cd packages/core && npx vitest run src/tools/__tests__/ripGrep.debugLogger.test.ts
   ```
   Test MUST fail because console.error is still used instead of debugLogger.

4. Apply the implementation changes below.

5. **Run test — MUST SEE GREEN:**
   ```bash
   cd packages/core && npx vitest run src/tools/__tests__/ripGrep.debugLogger.test.ts
   ```
   Test MUST pass after debugLogger replacement.

**DO NOT PROCEED with implementation until test is written and RED.**

## Implementation Steps

### Step 1: Add debugLogger import

**Location:** After line 21 in packages/core/src/tools/ripGrep.ts

**Find (exact match):**
```typescript
import { getErrorMessage } from '../utils/errors.js';
import { Config } from '../config/config.js';
```

**Replace with:**
```typescript
import { getErrorMessage } from '../utils/errors.js';
import { debugLogger } from '../utils/debugLogger.js';
import { Config } from '../config/config.js';
```

### Step 2: Replace console.error #1 (main catch block)

**Location:** Line 225 in packages/core/src/tools/ripGrep.ts

**Find (exact match with context):**
```typescript
      };
    } catch (error) {
      console.error(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
```

**Replace with:**
```typescript
      };
    } catch (error) {
      debugLogger.warn(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
```

### Step 3: Replace console.error #2 (ripgrep failure)

**Location:** Line 361 in packages/core/src/tools/ripGrep.ts

**Find (exact match with context):**
```typescript
      return this.parseRipgrepOutput(output, absolutePath);
    } catch (error: unknown) {
      console.error(`GrepLogic: ripgrep failed: ${getErrorMessage(error)}`);
      throw error;
    }
```

**Replace with:**
```typescript
      return this.parseRipgrepOutput(output, absolutePath);
    } catch (error: unknown) {
      debugLogger.debug(`GrepLogic: ripgrep failed: ${getErrorMessage(error)}`);
      throw error;
    }
```

## Verification

**Mandatory checks (all must pass):**

1. **No console.error remaining:**
   ```bash
   grep -n "console.error" packages/core/src/tools/ripGrep.ts
   ```
   Expected: No output (exit code 1)

2. **TDD test passes:**
   ```bash
   cd packages/core && npx vitest run src/tools/__tests__/ripGrep.debugLogger.test.ts
   ```
   Expected: All tests GREEN

3. **Type check:**
   ```bash
   npm run typecheck
   ```
   Expected: No errors

4. **Lint:**
   ```bash
   npm run lint
   ```
   Expected: No errors

5. **Full test suite:**
   ```bash
   npm run test
   ```
   Expected: All tests pass

6. **Build:**
   ```bash
   npm run build
   ```
   Expected: Successful build

7. **Smoke test:**
   ```bash
   node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
   ```
   Expected: Normal execution

## Branding Adaptations
- None required (code-only change)

## Notes
- This change migrates from console.error to debugLogger for consistency
- debugLogger.warn is used for user-facing operation errors
- debugLogger.debug is used for lower-level ripgrep execution failures
- No functional behavior changes, only logging mechanism

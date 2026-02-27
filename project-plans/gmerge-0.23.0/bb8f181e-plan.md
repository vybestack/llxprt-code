# Reimplement Plan: ripGrep debugLogger migration (upstream bb8f181ef1)

## Upstream Change
Replaces `console.error` calls with `debugLogger.warn` and `debugLogger.debug` in ripGrep.ts for consistent logging.

## LLxprt Files to Modify
- packages/core/src/tools/ripGrep.ts — Replace console.error with debugLogger calls

## Steps

1. **Read packages/core/src/tools/ripGrep.ts** to identify current logging patterns

2. **Verify debugLogger import**:
   - Check that `debugLogger` is imported from `'../utils/debugLogger.js'`
   - If not present, add import: `import { debugLogger } from '../utils/debugLogger.js';`

3. **Replace console.error calls** (two locations based on upstream diff):
   
   **Location 1: Main catch block (around line 279 in upstream)**
   - Find: `console.error(\`Error during GrepLogic execution: ${error}\`);`
   - Replace: `debugLogger.warn(\`Error during GrepLogic execution: ${error}\`);`
   
   **Location 2: ripgrep execution catch (around line 441 in upstream)**
   - Find: `console.error(\`GrepLogic: ripgrep failed: ${getErrorMessage(error)}\`);`
   - Replace: `debugLogger.debug(\`GrepLogic: ripgrep failed: ${getErrorMessage(error)}\`);`

4. **Verify no other console.error calls**:
   - Search file for any remaining `console.error` calls
   - Replace any found with appropriate debugLogger level (warn/debug/error)

## Verification
- `grep -n "console.error" packages/core/src/tools/ripGrep.ts` should return no results
- `npm run typecheck` should pass
- `npm run lint` should pass

## Branding Adaptations
- None required (code-only change)

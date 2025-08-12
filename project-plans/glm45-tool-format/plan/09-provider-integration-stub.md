# Phase 9: Provider Integration Stub

## Objective

Update OpenAIProvider to add format detection hooks with empty implementations.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Update OpenAIProvider for format detection integration.

UPDATE packages/core/src/providers/openai/OpenAIProvider.ts:
(MODIFY existing file - do not create new)

ADD to class:
- formatDetector property (optional)
- formatStrategy property (optional)

UPDATE existing methods:
- In constructor or initialize: 
  - Add formatDetector initialization (can be undefined)
- In tool handling methods:
  - Add hooks for format detection (but don't break existing logic)
  - If no formatDetector, use existing behavior

Requirements:
1. Must compile with strict TypeScript
2. PRESERVE all existing functionality
3. Only add optional properties/hooks
4. NO NotYetImplemented errors
5. Existing tests must still pass

CRITICAL: Do not break existing OpenAI provider functionality.

Output status to workers/phase-09.json
"
```

## Verification

```bash
# Check compilation
npm run typecheck

# Verify existing tests still pass
npm test packages/core/test/providers/openai/
if [ $? -ne 0 ]; then
  echo "FAIL: Broke existing OpenAI provider tests"
  exit 1
fi

# Check format properties added
grep "formatDetector\|formatStrategy" packages/core/src/providers/openai/OpenAIProvider.ts
if [ $? -ne 0 ]; then
  echo "FAIL: Format properties not added"
  exit 1
fi

# Verify no NotYetImplemented
grep "NotYetImplemented" packages/core/src/providers/openai/OpenAIProvider.ts
if [ $? -eq 0 ]; then
  echo "FAIL: NotYetImplemented found"
  exit 1
fi
```
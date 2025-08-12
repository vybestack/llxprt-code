# Phase 6: Format Strategies Stub

## Objective

Create stub implementations of format strategy classes.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Create stub implementations of format strategies.

Create packages/core/src/providers/openai/toolFormats/OpenAIFormat.ts:
- Implement IToolFormatStrategy interface
- Methods: formatTools, parseToolCall, formatToolResult
- All throw new Error('NotYetImplemented')

Create packages/core/src/providers/openai/toolFormats/QwenFormat.ts:
- Implement IToolFormatStrategy interface  
- Same methods as above
- All throw new Error('NotYetImplemented')

Requirements:
1. Must compile with strict TypeScript
2. Proper return types even when throwing
3. Maximum 40 lines each file

Output status to workers/phase-06.json
"
```

## Verification

```bash
# Check compilation
npm run typecheck

# Verify stubs
grep -r "NotYetImplemented" packages/core/src/providers/openai/toolFormats/
[ $? -eq 0 ] || echo "FAIL: Missing stubs"
```
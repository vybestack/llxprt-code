# Phase 12: Tool Integration Stub

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Add tool filtering hooks based on:
- specification.md REQ-001.2, REQ-002
- analysis/pseudocode/tool-integration.md lines 1-133

UPDATE packages/core/src/core/nonInteractiveToolExecutor.ts
At line 77 (before tool.buildAndExecute):
ADD filter initialization (stub)
ADD argument filtering (pass-through)

UPDATE packages/core/src/tools/edit.ts
ADD filtering hooks (stub)

UPDATE packages/core/src/tools/write-file.ts
ADD filtering hooks (stub)

Requirements:
1. UPDATE existing files
2. Minimal changes - just hooks
3. Tools still work

FORBIDDEN:
- Creating new tool files
- Breaking existing functionality
"
```

## Expected Changes
- Filter hooks in tool executor
- Hooks in file modification tools

## Verification
```bash
# Files updated, not replaced
git diff packages/core/src/core/nonInteractiveToolExecutor.ts
git diff packages/core/src/tools/

# TypeScript compiles
npm run typecheck || exit 1
```
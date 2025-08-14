# Phase 9: Stream Integration Stub

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Add stream filtering hooks based on:
- specification.md REQ-001.1
- analysis/pseudocode/stream-integration.md lines 1-65

UPDATE packages/cli/src/ui/hooks/useGeminiStream.ts

At line 816 (processGeminiStreamEvents):
ADD filter initialization (stub)
ADD stream wrapping (pass-through for now)

Requirements:
1. UPDATE existing file at specific location
2. Minimal changes - just hooks
3. Stream still works (pass-through)

FORBIDDEN:
- Creating new useGeminiStream file
- Breaking existing functionality
"
```

## Expected Changes
- Filter initialization in useGeminiStream
- Stream wrapper (currently pass-through)

## Verification
```bash
# File was updated, not replaced
git diff packages/cli/src/ui/hooks/useGeminiStream.ts

# TypeScript compiles
npm run typecheck || exit 1
```
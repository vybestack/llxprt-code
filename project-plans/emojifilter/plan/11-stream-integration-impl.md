# Phase 11: Stream Integration Implementation

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Implement stream filtering following pseudocode:

UPDATE packages/cli/src/ui/hooks/useGeminiStream.ts

Based on stream-integration.md:
- Lines 3-14: Initialize filter on first use
  → Line 10: Get mode from config
  → Line 12: Create EmojiFilter instance
  
- Lines 17-24: Wrap processGeminiStreamEvents
  → Line 20: Get or create filter
  → Line 21: Create filtered stream
  → Line 22: Pass filtered stream to original
  
- Lines 27-64: createFilteredStream implementation
  → Line 30-31: Filter content chunks
  → Line 32-35: Handle blocking in error mode
  → Line 38-41: Emit filtered content
  → Line 43-49: Emit system feedback in warn mode
  → Line 56-63: Flush buffer at stream end

Import EmojiFilter from packages/core/src/filters/EmojiFilter

Requirements:
1. Follow pseudocode line numbers
2. Maintain existing functionality
3. All tests must pass
"
```

## Expected Implementation
- Stream filtering active
- Chunk boundary handling
- Mode-specific behavior
- Buffer management

## Verification
```bash
# All tests pass
npm test packages/cli/src/ui/hooks/test/

# Stream still works
npm run test:integration:stream
```
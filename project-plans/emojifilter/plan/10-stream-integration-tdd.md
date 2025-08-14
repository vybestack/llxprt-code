# Phase 10: Stream Integration TDD

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Write tests for stream filtering integration:
- specification.md requirements [REQ-001.1]
- analysis/pseudocode/stream-integration.md

CREATE packages/cli/src/ui/hooks/test/useGeminiStream.emojifilter.test.ts

Test scenarios:

/**
 * @requirement REQ-001.1
 * @scenario Filter emojis from stream chunks
 * @given Stream emitting '✅ Success' in chunks
 * @when processGeminiStreamEvents with auto mode
 * @then Output contains '[OK] Success'
 */

/**
 * @requirement REQ-001.1
 * @scenario Handle emoji split across chunks
 * @given Chunk 1: 'Test \\uD83D', Chunk 2: '\\uDE00 done'
 * @when filterStreamChunk processes both
 * @then Emoji properly detected and filtered
 */

/**
 * @requirement REQ-004.2
 * @scenario Warn mode adds feedback
 * @given Stream with emojis in warn mode
 * @when Processing completes
 * @then System feedback message emitted
 */

Include property tests for chunk boundaries:
test.prop([fc.array(fc.string())])('handles any chunk sequence', (chunks) => {
  const result = processChunks(chunks);
  expect(result).toBeDefined();
});

FORBIDDEN:
- Mock stream implementations
- Testing internals
"
```

## Expected Tests
- Stream chunk filtering
- Chunk boundary handling
- Mode-specific behavior
- Buffer management
- Property tests for chunks

## Verification
```bash
# Run tests - should fail
npm test packages/cli/src/ui/hooks/test/useGeminiStream.emojifilter.test.ts
```
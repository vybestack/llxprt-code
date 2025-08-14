# Phase 5: EmojiFilter Implementation

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Implement EmojiFilter to make ALL tests pass.

UPDATE packages/core/src/filters/EmojiFilter.ts

MANDATORY: Follow pseudocode EXACTLY from analysis/pseudocode/EmojiFilter.md:

- Lines 7-12: Constructor initialization
  → Use: constructor(config) { this.config = config; ... }
  
- Lines 14-45: filterText method
  → Line 15: Check if mode === 'allowed'
  → Line 19: Call detectEmojis(text)
  → Line 25-32: Handle error mode blocking
  → Line 34-35: Apply conversions and remove decorative
  
- Lines 47-60: filterStreamChunk method
  → Line 48: Combine buffer + chunk
  → Line 49: Find safe boundary
  → Line 56-57: Split at boundary
  
- Lines 62-95: filterToolArgs method
  → Line 67: Stringify args to detect emojis
  → Line 74-81: Block in error mode
  → Line 83-85: Filter and parse back
  
- Lines 97-128: filterFileContent method
  → Line 108-115: Strict blocking for files
  → Line 117-118: Apply conversions
  
- Lines 140-147: detectEmojis private method
  → Line 142: Test each pattern
  
- Lines 149-155: applyConversions private method
  → Line 152: Replace each emoji with conversion
  
- Lines 157-163: removeDecorativeEmojis private method
  → Line 160: Remove decorative patterns

Also CREATE: packages/core/src/filters/emoji-patterns.ts
With Unicode patterns and conversion mappings

Requirements:
1. Do NOT modify tests
2. Reference pseudocode line numbers in comments
3. All tests must pass
4. No console.log or debug code

Run 'npm test packages/core/src/filters/test/' and ensure all pass.
"
```

## Expected Implementation
- Complete EmojiFilter class
- emoji-patterns.ts with Unicode ranges
- All behavioral tests passing

## Verification
```bash
# All tests pass
npm test packages/core/src/filters/test/ || exit 1

# Verify pseudocode was followed
claude --dangerously-skip-permissions -p "
Compare packages/core/src/filters/EmojiFilter.ts 
with analysis/pseudocode/EmojiFilter.md
Check every numbered line is implemented
Report missing steps
"

# No debug code
grep -r "console\.\|TODO\|FIXME" packages/core/src/filters/

# Mutation testing
npx stryker run --mutate packages/core/src/filters/EmojiFilter.ts
```
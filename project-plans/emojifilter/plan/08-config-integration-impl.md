# Phase 8: Configuration Integration Implementation

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Implement configuration integration following pseudocode:

UPDATE packages/core/src/config/config.ts
Implement based on configuration-integration.md:
- Lines 3-20: getEmojiFilterMode method
  → Line 4: Get settings service
  → Line 9: Get 'emojiFilter.mode' setting
  → Line 14: Validate mode value
  
- Lines 22-40: setEmojiFilterMode method
  → Line 23: Validate mode parameter
  → Line 34: Call settingsService.set()

UPDATE packages/cli/src/ui/commands/setCommand.ts
Implement based on configuration-integration.md:
- Lines 42-74: handleSetCommand additions
  → Line 43: Check if args[0] === 'emojifilter'
  → Line 54: Get mode from args[1]
  → Line 56: Call setEmojiFilterMode

UPDATE packages/core/src/settings/types.ts
ADD EmojiFilterSettings interface

Requirements:
1. Follow pseudocode line numbers
2. All tests must pass
3. No debug code
"
```

## Expected Implementation
- Config methods working
- Set command handling emojifilter
- Settings integration

## Verification
```bash
# All tests pass
npm test packages/core/src/config/test/
npm test packages/cli/src/ui/commands/test/

# Verify pseudocode compliance
claude --dangerously-skip-permissions -p "
Compare implementation with pseudocode
Report any deviations
"
```
# Phase 7: Configuration Integration TDD

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for configuration integration:
- specification.md requirements [REQ-003]
- analysis/pseudocode/configuration-integration.md

UPDATE packages/core/src/config/test/config.test.ts
ADD tests for emoji filter configuration

UPDATE packages/cli/src/ui/commands/test/setCommand.test.ts
ADD tests for /set emojifilter command

Test scenarios:

/**
 * @requirement REQ-003.1
 * @scenario Set emoji filter mode via command
 * @given Command '/set emojifilter warn'
 * @when handleSetCommand() is called
 * @then Settings updated with mode 'warn'
 */

/**
 * @requirement REQ-003.4
 * @scenario Configuration hierarchy
 * @given Default 'auto', session override 'error'
 * @when getEmojiFilterMode() is called
 * @then Returns 'error' (session wins)
 */

/**
 * @requirement REQ-003.1
 * @scenario Invalid mode rejected
 * @given Command '/set emojifilter invalid'
 * @when handleSetCommand() is called
 * @then Returns error 'Invalid mode'
 */

FORBIDDEN:
- Mock verification tests
- Structure-only tests
- Reverse testing
"
```

## Expected Tests
- Mode setting and getting
- Configuration precedence
- Invalid mode handling
- Command parsing
- Settings persistence

## Verification
```bash
# Run tests - should fail naturally
npm test packages/core/src/config/test/
npm test packages/cli/src/ui/commands/test/
```
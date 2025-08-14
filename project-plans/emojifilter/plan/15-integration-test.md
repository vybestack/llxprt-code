# Phase 15: Integration Testing

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Create end-to-end integration tests:
- Test complete flow from user input to filtered output
- Test file protection in real scenarios
- Test configuration changes during session

CREATE packages/integration-tests/emojifilter.integration.test.ts

Test scenarios:

/**
 * @requirement REQ-INT-001.1
 * @scenario End-to-end stream filtering
 * @given Real provider returning emojis
 * @when User interacts with CLI
 * @then Output is filtered based on mode
 */

/**
 * @requirement REQ-INT-001.2
 * @scenario File tool protection end-to-end
 * @given LLM tries to write emoji to file
 * @when In error mode
 * @then File operation blocked, file unchanged
 */

/**
 * @requirement REQ-INT-001.3
 * @scenario Configuration changes take effect
 * @given Session starts in auto mode
 * @when User runs /set emojifilter error
 * @then Next operation uses error mode
 */

Use REAL components, no mocks:
- Real Config instance
- Real SettingsService
- Real stream processing
- Real tool execution

FORBIDDEN:
- Any mocking
- Stubbing components
- Isolated testing
"
```

## Expected Tests
- Complete user flows
- Real provider integration
- Settings persistence
- Mode switching
- File system verification

## Verification
```bash
# Run integration tests
npm run test:integration

# Verify no mocks
grep -r "mock\|stub" packages/integration-tests/emojifilter.integration.test.ts
[ $? -eq 0 ] && echo "FAIL: Mocks found in integration tests"
```
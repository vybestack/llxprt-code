# Phase 13: Auto Mode TDD

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P13`

## Prerequisites
- Phase 12 completed
- saveCommand parsing auto mode
- Expected files:
  - `packages/cli/src/ui/commands/subagentCommand.ts` (auto mode stubbed)

## Implementation Tasks

### File to Modify

**File**: `packages/cli/src/ui/commands/test/subagentCommand.test.ts`

Add tests for auto mode functionality.

### Auto Mode Tests

Add to existing test file:

```typescript
/**
 * Auto mode tests
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P13
 * @requirement:REQ-003
 */
describe('saveCommand - auto mode @requirement:REQ-003', () => {
  let mockGeminiClient: any;
  let mockChat: any;

  beforeEach(() => {
    // Mock GeminiClient and chat
    mockChat = {
      sendMessage: vi.fn(),
    };
    
    mockGeminiClient = {
      getChat: vi.fn(() => mockChat),
      hasChatInitialized: vi.fn(() => true),
    };
    
    // Add to context
    context.services.config = {
      getGeminiClient: vi.fn(() => mockGeminiClient),
    } as any;
  });

  it('should generate system prompt using LLM', async () => {
    // Mock LLM response
    mockChat.sendMessage.mockResolvedValue({
      text: () => 'You are an expert Python debugger specializing in finding and fixing bugs.',
    });
    
    const args = 'testagent testprofile auto "expert Python debugger"';
    const result = await saveCommand.action(context, args);
    
    // Verify LLM was called
    expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockChat.sendMessage.mock.calls[0][0];
    expect(callArgs.message).toMatch(/expert Python debugger/);
    expect(callArgs.message).toMatch(/system prompt/i);
    
    // Verify success
    expect(result.messageType).toBe('info');
    expect(result.content).toMatch(/created successfully/i);
    
    // Verify saved with generated prompt
    const loaded = await subagentManager.loadSubagent('testagent');
    expect(loaded.systemPrompt).toBe('You are an expert Python debugger specializing in finding and fixing bugs.');
  });

  it('should handle LLM generation failure', async () => {
    // Mock LLM error
    mockChat.sendMessage.mockRejectedValue(new Error('Network error'));
    
    const args = 'testagent testprofile auto "expert debugger"';
    const result = await saveCommand.action(context, args);
    
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/failed to generate|connection|manual mode/i);
  });

  it('should handle empty LLM response', async () => {
    // Mock empty response
    mockChat.sendMessage.mockResolvedValue({
      text: () => '',
    });
    
    const args = 'testagent testprofile auto "expert debugger"';
    const result = await saveCommand.action(context, args);
    
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/empty.*response|manual mode/i);
  });

  it('should handle chat not initialized', async () => {
    mockGeminiClient.hasChatInitialized.mockReturnValue(false);
    
    const args = 'testagent testprofile auto "expert debugger"';
    const result = await saveCommand.action(context, args);
    
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/chat not.*initialized|connection/i);
  });

  it('should use correct prompt template for LLM', async () => {
    mockChat.sendMessage.mockResolvedValue({
      text: () => 'Generated prompt',
    });
    
    const description = 'expert code reviewer';
    const args = `testagent testprofile auto "${description}"`;
    await saveCommand.action(context, args);
    
    const callArgs = mockChat.sendMessage.mock.calls[0][0];
    
    // Verify prompt includes description
    expect(callArgs.message).toContain(description);
    
    // Verify prompt includes instructions
    expect(callArgs.message).toMatch(/comprehensive/i);
    expect(callArgs.message).toMatch(/role.*capabilities.*behavior/i);
    expect(callArgs.message).toMatch(/output.*only/i);
  });
});
```

## Verification Commands

```bash
# Check auto mode tests added
grep -c "saveCommand - auto mode @requirement:REQ-003" packages/cli/src/ui/commands/test/subagentCommand.test.ts
# Expected: 1

# Tests should fail naturally (stub implementation)
npm test -- subagentCommand.test.ts --grep "auto mode" 2>&1 | grep -q "FAIL\|fail" || echo "Tests should fail"

# TypeScript compiles
npm run typecheck
# Expected: No errors
```

## Success Criteria

- Auto mode tests added (5+ tests)
- Tests mock GeminiClient
- Tests verify LLM call and response handling
- Tests cover error cases (network, empty response, not initialized)
- Tests will fail naturally (stub implementation)
- All markers present

## Phase Completion Marker

```markdown
# Phase 13: Auto Mode TDD Complete

**Completed**: [TIMESTAMP]

## Tests Added
- Auto mode: 5+ tests
- LLM integration mocked
- Error cases covered

## Test Results
Tests failing naturally (stub implementation)

## Next Phase
Ready for Phase 14: Auto Mode Implementation
```

---

**CRITICAL**: Tests must mock GeminiClient to avoid real API calls during tests. Implementation in Phase 14 will make these pass.

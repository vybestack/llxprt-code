# Task 01: Behavioral Test Specifications

**Phase:** Test-First Development  
**Duration:** 3-4 days  
**Assignee:** TypeScript/Testing Specialist Subagent  
**Dependencies:** None

## Objective

Write comprehensive behavioral tests for multi-provider conversation logging functionality BEFORE any implementation begins. Tests must focus on actual behavior and data transformations, not implementation details or mocks.

## Behavioral Test Requirements

### Test Categories

#### 1. Privacy Compliance Tests
**Location:** `packages/core/src/telemetry/conversation-logging.test.ts`

```typescript
describe('Conversation Logging Privacy Compliance', () => {
  /**
   * @requirement PRIVACY-001: Logging disabled by default
   * @scenario Fresh configuration with no explicit settings
   * @given New Config instance with default settings
   * @when getConversationLoggingEnabled() is called
   * @then Returns false (disabled by default)
   */
  it('should have conversation logging disabled by default', () => {
    const config = new Config();
    expect(config.getConversationLoggingEnabled()).toBe(false);
  });

  /**
   * @requirement PRIVACY-002: Explicit opt-in required
   * @scenario User enables conversation logging via settings
   * @given Config with telemetry.logConversations: true
   * @when conversation logging methods are called
   * @then Logging proceeds and data is captured
   */
  it('should only log conversations when explicitly enabled', () => {
    const config = new Config();
    config.updateSettings({ telemetry: { logConversations: true } });
    expect(config.getConversationLoggingEnabled()).toBe(true);
  });

  /**
   * @requirement PRIVACY-003: Data redaction functionality
   * @scenario Message containing API key is processed
   * @given Message with content: "My OpenAI key is sk-1234567890abcdef"
   * @when ConversationDataRedactor.redactMessage() is called
   * @then Returned message content does not contain "sk-1234567890abcdef"
   * @and Contains redaction placeholder like "[REDACTED-API-KEY]"
   */
  it('should redact API keys from message content', () => {
    const redactor = new ConversationDataRedactor();
    const message: IMessage = {
      role: 'user',
      content: 'My OpenAI key is sk-1234567890abcdef'
    };
    const redacted = redactor.redactMessage(message, 'openai');
    expect(redacted.content).not.toContain('sk-1234567890abcdef');
    expect(redacted.content).toContain('[REDACTED-API-KEY]');
  });
});
```

#### 2. Multi-Provider Logging Tests
**Location:** `packages/core/src/providers/LoggingProviderWrapper.test.ts`

```typescript
describe('Multi-Provider Conversation Logging', () => {
  /**
   * @requirement LOGGING-001: Provider-agnostic logging
   * @scenario OpenAI provider generates chat completion
   * @given LoggingProviderWrapper wrapping OpenAI provider with logging enabled
   * @when generateChatCompletion() is called with test messages
   * @then ConversationRequestEvent is created with provider_name: 'openai'
   * @and Event contains redacted messages matching input structure
   */
  it('should log OpenAI provider requests with provider context', async () => {
    const mockProvider = createMockProvider('openai');
    const config = createConfigWithLogging(true);
    const wrapper = new LoggingProviderWrapper(mockProvider, config, new ConversationDataRedactor());
    
    const messages: IMessage[] = [
      { role: 'user', content: 'Test prompt' }
    ];
    
    const logSpy = jest.spyOn(telemetryLoggers, 'logConversationRequest');
    
    const stream = wrapper.generateChatCompletion(messages);
    await consumeAsyncIterable(stream);
    
    expect(logSpy).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider_name: 'openai',
        redacted_messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Test prompt' })
        ])
      })
    );
  });

  /**
   * @requirement LOGGING-002: Provider switching context
   * @scenario User switches from Gemini to OpenAI mid-conversation  
   * @given ProviderManager with both providers registered
   * @when setActiveProvider('openai') is called after using Gemini
   * @then ProviderSwitchEvent is logged with correct from/to provider names
   * @and Context preservation flag is set based on compatibility
   */
  it('should log provider switches with context preservation info', () => {
    const manager = new ProviderManager();
    const config = createConfigWithLogging(true);
    manager.setConfig(config);
    
    // Register providers
    manager.registerProvider(createMockProvider('gemini'));
    manager.registerProvider(createMockProvider('openai'));
    
    // Set initial provider
    manager.setActiveProvider('gemini');
    
    const logSpy = jest.spyOn(telemetryLoggers, 'logProviderSwitch');
    
    // Switch provider
    manager.setActiveProvider('openai');
    
    expect(logSpy).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        from_provider: 'gemini',
        to_provider: 'openai',
        context_preserved: expect.any(Boolean)
      })
    );
  });
});
```

#### 3. Data Redaction Tests
**Location:** `packages/core/src/privacy/ConversationDataRedactor.test.ts`

```typescript
describe('Conversation Data Redaction', () => {
  /**
   * @requirement REDACTION-001: API key patterns
   * @scenario Various API key formats in message content
   * @given Messages containing different API key patterns
   * @when redactMessage() is called for each provider
   * @then All API key patterns are replaced with appropriate placeholders
   */
  it('should redact all API key patterns', () => {
    const redactor = new ConversationDataRedactor();
    
    const testCases = [
      { content: 'OpenAI key: sk-1234567890abcdef', provider: 'openai', expected: '[REDACTED-OPENAI-KEY]' },
      { content: 'Anthropic key: sk-ant-1234567890abcdef', provider: 'anthropic', expected: '[REDACTED-ANTHROPIC-KEY]' },
      { content: 'Google key: AIzaSy1234567890abcdef', provider: 'gemini', expected: '[REDACTED-GOOGLE-KEY]' }
    ];
    
    testCases.forEach(({ content, provider, expected }) => {
      const message = { role: 'user' as const, content };
      const redacted = redactor.redactMessage(message, provider);
      expect(redacted.content).toContain(expected);
      expect(redacted.content).not.toContain(content.split(': ')[1]);
    });
  });

  /**
   * @requirement REDACTION-002: Tool parameter redaction
   * @scenario Tool call with sensitive file path
   * @given ITool with parameters containing sensitive paths
   * @when redactToolCall() is called  
   * @then Sensitive paths are redacted while maintaining structure
   */
  it('should redact sensitive data from tool parameters', () => {
    const redactor = new ConversationDataRedactor();
    
    const tool: ITool = {
      name: 'read_file',
      description: 'Read file content',
      parameters: {
        file_path: '/home/user/.ssh/id_rsa',
        encoding: 'utf-8'
      }
    };
    
    const redacted = redactor.redactToolCall(tool);
    expect(redacted.parameters.file_path).toBe('[REDACTED-SSH-KEY-PATH]');
    expect(redacted.parameters.encoding).toBe('utf-8'); // Non-sensitive preserved
  });
});
```

#### 4. Configuration Hierarchy Tests
**Location:** `packages/core/src/config/conversation-logging-config.test.ts`

```typescript
describe('Conversation Logging Configuration', () => {
  /**
   * @requirement CONFIG-001: Configuration hierarchy
   * @scenario CLI flag overrides environment variable
   * @given Environment variable LLXPRT_LOG_CONVERSATIONS=false
   * @when CLI flag --log-conversations is provided
   * @then getConversationLoggingEnabled() returns true
   */
  it('should respect configuration hierarchy with CLI flags taking precedence', () => {
    process.env.LLXPRT_LOG_CONVERSATIONS = 'false';
    
    const config = new Config();
    config.setCliFlags({ logConversations: true });
    
    expect(config.getConversationLoggingEnabled()).toBe(true);
    
    delete process.env.LLXPRT_LOG_CONVERSATIONS;
  });

  /**
   * @requirement CONFIG-002: Local storage configuration
   * @scenario Custom conversation log path is set
   * @given Settings with conversationLogPath: '/custom/path'
   * @when getConversationLogPath() is called
   * @then Returns expanded path '/custom/path'
   */
  it('should handle custom conversation log path configuration', () => {
    const config = new Config();
    config.updateSettings({
      telemetry: {
        conversationLogPath: '/custom/path'
      }
    });
    
    expect(config.getConversationLogPath()).toBe('/custom/path');
  });
});
```

#### 5. Storage Management Tests
**Location:** `packages/core/src/telemetry/ConversationLogManager.test.ts`

```typescript
describe('Conversation Log Storage Management', () => {
  /**
   * @requirement STORAGE-001: Log file rotation
   * @scenario Log file exceeds maximum size
   * @given ConversationLogManager with maxLogSizeMB: 1
   * @when writeConversationEntry() is called with large entry
   * @then New log file is created and old file is rotated
   * @and Total log files does not exceed maxLogFiles
   */
  it('should rotate log files when size limit is exceeded', async () => {
    const manager = new ConversationLogManager({
      logPath: '/tmp/test-logs',
      maxLogSizeMB: 1,
      maxLogFiles: 3
    });
    
    // Write large entry that exceeds 1MB
    const largeEntry = createLargeConversationEntry(2 * 1024 * 1024); // 2MB
    
    await manager.writeConversationEntry(largeEntry);
    
    const logFiles = await manager.getLogFiles();
    expect(logFiles.length).toBeLessThanOrEqual(3);
    expect(await manager.getCurrentLogSize()).toBeLessThan(1024 * 1024); // New file < 1MB
  });

  /**
   * @requirement STORAGE-002: Retention policy
   * @scenario Old log files exceed retention period
   * @given Log files older than retentionDays
   * @when cleanupOldLogs() is called
   * @then Files older than retention period are deleted
   */
  it('should clean up log files beyond retention period', async () => {
    const manager = new ConversationLogManager({
      logPath: '/tmp/test-logs',
      retentionDays: 7
    });
    
    // Create old log file
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    await manager.createLogFileWithDate('old-conversation.log', oldDate);
    
    await manager.cleanupOldLogs();
    
    const remainingFiles = await manager.getLogFiles();
    expect(remainingFiles.some(f => f.includes('old-conversation'))).toBe(false);
  });
});
```

#### 6. Performance Impact Tests
**Location:** `packages/core/src/telemetry/conversation-logging-performance.test.ts`

```typescript
describe('Conversation Logging Performance Impact', () => {
  /**
   * @requirement PERFORMANCE-001: Minimal overhead when disabled
   * @scenario Logging disabled, normal provider operations
   * @given LoggingProviderWrapper with logging disabled
   * @when generateChatCompletion() is called 100 times
   * @then Performance overhead is <1% compared to unwrapped provider
   */
  it('should have minimal performance impact when logging is disabled', async () => {
    const provider = createMockProvider('openai');
    const config = createConfigWithLogging(false);
    const wrapper = new LoggingProviderWrapper(provider, config, new ConversationDataRedactor());
    
    const startTime = performance.now();
    for (let i = 0; i < 100; i++) {
      const stream = wrapper.generateChatCompletion([{ role: 'user', content: `Test ${i}` }]);
      await consumeAsyncIterable(stream);
    }
    const wrappedTime = performance.now() - startTime;
    
    // Test unwrapped provider
    const startTime2 = performance.now();
    for (let i = 0; i < 100; i++) {
      const stream = provider.generateChatCompletion([{ role: 'user', content: `Test ${i}` }]);
      await consumeAsyncIterable(stream);
    }
    const unwrappedTime = performance.now() - startTime2;
    
    const overhead = ((wrappedTime - unwrappedTime) / unwrappedTime) * 100;
    expect(overhead).toBeLessThan(1); // <1% overhead when disabled
  });

  /**
   * @requirement PERFORMANCE-002: Acceptable overhead when enabled
   * @scenario Logging enabled with redaction
   * @given LoggingProviderWrapper with full logging enabled
   * @when generateChatCompletion() is called with typical conversation
   * @then Performance overhead is <5% compared to disabled logging
   */
  it('should have acceptable performance impact when logging is enabled', async () => {
    const provider = createMockProvider('openai');
    const enabledConfig = createConfigWithLogging(true);
    const disabledConfig = createConfigWithLogging(false);
    const redactor = new ConversationDataRedactor();
    
    const enabledWrapper = new LoggingProviderWrapper(provider, enabledConfig, redactor);
    const disabledWrapper = new LoggingProviderWrapper(provider, disabledConfig, redactor);
    
    const conversation = createTypicalConversation(20); // 20 messages
    
    const disabledTime = await measureProviderTime(disabledWrapper, conversation);
    const enabledTime = await measureProviderTime(enabledWrapper, conversation);
    
    const overhead = ((enabledTime - disabledTime) / disabledTime) * 100;
    expect(overhead).toBeLessThan(5); // <5% overhead when enabled
  });
});
```

## Test Implementation Guidelines

### Behavioral Focus
- **Test BEHAVIOR, not implementation**: Focus on inputs, outputs, and side effects
- **No mock theater**: Avoid testing mock interactions instead of real behavior  
- **Real data transformations**: Use actual data that demonstrates the feature working
- **State changes**: Verify actual state changes, not just method calls

### Test Data Requirements
Create realistic test data in `test/fixtures/conversation-logging/`:

```typescript
// test/fixtures/conversation-logging/sample-conversations.ts
export const sampleConversations = {
  basicUserPrompt: [
    { role: 'user', content: 'Hello, can you help me?' },
    { role: 'assistant', content: 'Of course! How can I assist you today?' }
  ],
  
  withApiKeys: [
    { role: 'user', content: 'Use this API key: sk-1234567890abcdef to access OpenAI' },
    { role: 'assistant', content: 'I cannot store or use API keys for security reasons.' }
  ],
  
  withToolCalls: [
    { role: 'user', content: 'Read the file /etc/passwd' },
    { role: 'assistant', content: 'I will read the file for you', tool_calls: [
      { name: 'read_file', parameters: { file_path: '/etc/passwd' } }
    ]}
  ],
  
  multiProvider: {
    gemini: { /* Gemini-specific test data */ },
    openai: { /* OpenAI-specific test data */ },
    anthropic: { /* Anthropic-specific test data */ }
  }
};
```

### Test Utilities
Create helper functions in `test/utils/conversation-logging-utils.ts`:

```typescript
export function createMockProvider(name: string): IProvider {
  // Create realistic mock provider for testing
}

export function createConfigWithLogging(enabled: boolean): Config {
  // Create test config with conversation logging settings
}

export async function consumeAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  // Helper to consume async iterables in tests
}

export function createLargeConversationEntry(sizeBytes: number): ConversationLogEntry {
  // Create large test entries for storage testing
}
```

## Acceptance Criteria

### Test Coverage Requirements
- [ ] 100% line coverage of new logging functionality
- [ ] All privacy requirements validated with behavioral tests
- [ ] Multi-provider consistency tested across all supported providers
- [ ] Performance impact measured and within acceptable limits
- [ ] Configuration hierarchy tested with all input sources
- [ ] Storage management tested with rotation and cleanup
- [ ] Error scenarios tested with graceful degradation

### Test Quality Requirements
- [ ] All tests focus on behavior, not implementation details
- [ ] No tests rely on mock interactions as primary assertions
- [ ] All tests use realistic data representative of actual usage
- [ ] Performance tests use statistically significant sample sizes
- [ ] Privacy tests validate actual data redaction effectiveness
- [ ] Integration tests work with real provider interfaces (where possible)

### Documentation Requirements
- [ ] Each test has clear behavioral documentation with @requirement tags
- [ ] Test scenarios are documented with @given/@when/@then structure
- [ ] Test data fixtures are documented and realistic
- [ ] Test utilities are documented with usage examples

## Task Completion Criteria

This task is complete when:

1. **Comprehensive Test Suite**: All test files created with behavioral focus
2. **All Tests Failing**: Tests fail appropriately (no implementation exists yet)
3. **Realistic Test Data**: Test fixtures represent actual usage patterns
4. **Performance Baselines**: Performance test baselines established
5. **Privacy Validation**: Privacy requirements fully tested
6. **Multi-Provider Coverage**: All providers tested consistently
7. **Documentation Complete**: All tests properly documented with behavioral specifications

The next task (02-core-logging-infrastructure) should not begin until all tests are written and failing appropriately.
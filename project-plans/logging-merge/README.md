# Multi-Provider Conversation Logging Implementation Plan

**Date:** 2025-08-08  
**Project:** llxprt  
**Feature:** Privacy-conscious multi-provider conversation logging  
**Based on:** Upstream gemini-cli logging analysis and llxprt integration strategy

## Project Overview

This plan implements comprehensive conversation logging capabilities for llxprt's multi-provider architecture, enhancing debugging and development capabilities while maintaining privacy-first design principles. Unlike upstream gemini-cli's single-provider approach, this implementation supports transparent logging across all providers (Gemini, OpenAI, Anthropic) through llxprt's existing provider abstraction system.

## Goals and Success Metrics

### Primary Goals

1. **Privacy-First Logging**: Conversation logging disabled by default with explicit opt-in
2. **Multi-Provider Support**: Consistent logging across all supported providers
3. **Developer Experience**: Enhanced debugging capabilities without changing existing workflows  
4. **Data Redaction**: Automatic sensitive data detection and redaction
5. **Clean Integration**: Leverage existing telemetry infrastructure without major architectural changes

### Success Metrics

- [ ] All existing tests pass without modification
- [ ] Logging disabled by default (privacy compliance)
- [ ] <5% performance impact when logging enabled
- [ ] Consistent conversation capture across all providers
- [ ] Automatic redaction of API keys, credentials, and PII
- [ ] Local-first storage with configurable retention policies
- [ ] Zero breaking changes to existing provider interfaces

## Architecture Changes

### Current State

llxprt implements a sophisticated multi-provider system:
- **IProvider Interface**: Common abstraction for all providers
- **ProviderManager**: Centralized provider registration and switching
- **Provider Implementations**: Gemini, OpenAI, Anthropic with different API patterns
- **Telemetry System**: OpenTelemetry-based with local-first approach

### Proposed Changes

#### 1. Logging Provider Wrapper (Decorator Pattern)
```typescript
export class LoggingProviderWrapper implements IProvider {
  constructor(
    private readonly wrapped: IProvider,
    private readonly config: Config,
    private readonly redactor: ConversationDataRedactor,
  ) {}
  
  async *generateChatCompletion(messages: IMessage[], tools?: ITool[]): AsyncIterableIterator<unknown> {
    // Log request with provider context and redaction
    // Delegate to wrapped provider
    // Log streaming response
  }
}
```

#### 2. Enhanced Telemetry Events
```typescript
export class ConversationRequestEvent extends ApiRequestEvent {
  provider_name: string;
  conversation_id: string;
  redacted_messages: IMessage[];
  tool_format?: string;
  provider_switched?: boolean;
}

export class ConversationResponseEvent extends ApiResponseEvent {
  provider_name: string;
  conversation_id: string;
  redacted_content: string;
  tool_calls?: ToolCall[];
}
```

#### 3. Data Redaction System
```typescript
export class ConversationDataRedactor {
  redactMessage(message: IMessage, providerName: string): IMessage;
  redactToolCall(toolCall: ITool): ITool;
  redactApiKeys(content: string): string;
  redactCredentials(content: string): string;
}
```

## Implementation Phases

### Phase 1: Foundation & Testing Infrastructure (Tasks 01)
**Duration:** 3-4 days  
**Focus:** Test-first development with behavioral specifications

- Create comprehensive behavioral test suite
- Test conversation logging across all providers
- Test privacy controls and data redaction
- Test multi-provider switching scenarios
- Test configuration and opt-in mechanisms

**Key Deliverables:**
- Complete test coverage for logging functionality
- Privacy compliance validation tests
- Multi-provider integration tests
- Performance benchmark tests

### Phase 2: Core Logging Infrastructure (Tasks 02)
**Duration:** 2-3 days  
**Focus:** Implement core logging components

- Implement LoggingProviderWrapper decorator
- Enhance ProviderManager with logging integration
- Extend telemetry event types for conversations
- Add conversation-specific logging methods

**Key Deliverables:**
- LoggingProviderWrapper implementation
- Enhanced telemetry events
- Provider manager logging integration
- Stream logging capabilities

### Phase 3: Privacy Controls & Data Redaction (Tasks 03)
**Duration:** 2-3 days  
**Focus:** Privacy-first implementation

- Add conversation logging configuration options
- Implement data redaction for sensitive content
- Add opt-in controls and user consent mechanisms
- Implement local storage with retention policies

**Key Deliverables:**
- Configuration schema extensions
- Data redaction engine
- Privacy control implementation
- Local storage management

### Phase 4: Provider Integration (Tasks 04)
**Duration:** 2-3 days  
**Focus:** Multi-provider logging consistency

- Integrate logging into existing provider implementations
- Add provider-specific logging hooks and metadata
- Implement provider switching context tracking
- Ensure consistency across different provider APIs

**Key Deliverables:**
- Provider-specific logging integration
- Provider switching telemetry
- Cross-provider consistency validation
- Tool format logging support

### Phase 5: Testing & Validation (Tasks 05)
**Duration:** 2-3 days  
**Focus:** Comprehensive validation and performance testing

- Execute all behavioral tests across providers
- Validate privacy controls and redaction effectiveness
- Performance impact assessment
- Integration testing with existing workflows

**Key Deliverables:**
- Complete test execution results
- Privacy compliance validation
- Performance impact analysis
- Integration test results

## Task Breakdown

The implementation is broken down into five main task groups, each designed to be executable by specialized subagents:

1. **[01-behavioral-tests.md](tasks/01-behavioral-tests.md)** - Comprehensive test specifications
2. **[02-core-logging-infrastructure.md](tasks/02-core-logging-infrastructure.md)** - Core logging implementation
3. **[03-privacy-controls.md](tasks/03-privacy-controls.md)** - Privacy and redaction systems
4. **[04-provider-integration.md](tasks/04-provider-integration.md)** - Multi-provider integration
5. **[05-testing-and-validation.md](tasks/05-testing-and-validation.md)** - Final validation and testing

## Testing Strategy

### Test-First Development Approach

Following TDD principles, all behavioral tests must be written and failing before implementation begins:

1. **Behavioral Tests**: Test actual conversation logging behavior, not implementation details
2. **Privacy Tests**: Verify opt-in requirements and data redaction effectiveness  
3. **Multi-Provider Tests**: Ensure consistent behavior across all providers
4. **Performance Tests**: Validate <5% performance impact when enabled
5. **Integration Tests**: Test with real provider APIs (where possible)

### Key Testing Areas

- **Privacy Compliance**: Logging disabled by default, explicit opt-in required
- **Data Redaction**: API keys, credentials, and PII automatically removed
- **Provider Consistency**: Same conversation logged identically across providers
- **Configuration Hierarchy**: CLI flags > env vars > config files > defaults
- **Storage Management**: Local file rotation, cleanup, and retention policies
- **Error Handling**: Graceful degradation when logging fails

## Risk Mitigation

### Technical Risks

1. **Performance Impact**: Mitigated by lightweight decorator pattern and optional logging
2. **Provider Compatibility**: Mitigated by logging at common IProvider interface level
3. **Memory Usage**: Mitigated by streaming logs and configurable retention
4. **Storage Growth**: Mitigated by automatic log rotation and cleanup policies

### Privacy Risks

1. **Accidental Data Exposure**: Mitigated by comprehensive redaction and local-first storage
2. **Opt-Out Complexity**: Mitigated by disabled-by-default with clear controls
3. **Sensitive Data Logging**: Mitigated by pattern-based redaction system
4. **Credential Leakage**: Mitigated by provider-specific credential detection

### Implementation Risks

1. **Breaking Changes**: Mitigated by decorator pattern preserving existing interfaces
2. **Test Complexity**: Mitigated by behavioral test approach focusing on outcomes
3. **Configuration Complexity**: Mitigated by following existing llxprt configuration patterns
4. **Provider Variations**: Mitigated by logging at normalized interface level

## Success Validation

The implementation will be considered successful when:

1. **All Tests Pass**: Comprehensive behavioral test suite passes
2. **Privacy Compliance**: Logging disabled by default, clear opt-in required
3. **Multi-Provider Support**: Consistent logging across Gemini, OpenAI, Anthropic
4. **Performance Acceptable**: <5% impact when enabled, no impact when disabled
5. **Data Protection**: Sensitive information automatically redacted
6. **Local Storage**: Conversation data stored locally with retention policies
7. **Developer Experience**: Enhanced debugging without workflow changes
8. **Clean Integration**: No breaking changes to existing provider system

## Additional Features Beyond Upstream

This implementation provides capabilities beyond upstream gemini-cli:

1. **Multi-Provider Comparison**: Side-by-side conversation analysis across providers
2. **Provider Switch Tracking**: Context preservation analysis across provider changes  
3. **Advanced Tool Format Logging**: Provider-specific tool formatting and parsing
4. **Enhanced Error Correlation**: Link provider-specific errors to conversation context
5. **Conversation Replay System**: Replay conversations with different providers
6. **Local-First Analytics**: Provider performance comparison without external services

## Configuration Schema

```json
{
  "telemetry": {
    "enabled": false,
    "target": "local",
    "logPrompts": true,
    "logConversations": false,
    "logResponses": false,
    "redactSensitiveData": true,
    "maxConversationHistory": 50,
    "conversationLogPath": "~/.llxprt/conversations/",
    "maxLogFiles": 10,
    "maxLogSizeMB": 100,
    "retentionDays": 30
  }
}
```

## CLI Integration

```bash
# Enable conversation logging for this session
llxprt --log-conversations "Your prompt here"

# Enable with specific provider comparison
llxprt --log-conversations --compare-providers gemini,openai "Your prompt"

# Debug mode with live logging
llxprt --debug-logging --log-conversations "Your prompt"

# Export conversation after session
llxprt debug export --session-id abc123 --format json
```

This implementation provides a solid foundation for enhanced debugging and development capabilities while maintaining llxprt's commitment to user privacy and multi-provider flexibility.
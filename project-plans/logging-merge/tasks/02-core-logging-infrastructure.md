# Task 02: Core Logging Infrastructure

**Phase:** Core Implementation  
**Duration:** 2-3 days  
**Assignee:** TypeScript Core Systems Subagent  
**Dependencies:** Task 01 (Behavioral Tests) must be complete and failing

## Objective

Implement the core logging infrastructure by enhancing existing classes rather than creating new ones. Add conversation logging capabilities to the existing provider system, telemetry infrastructure, and provider manager without breaking existing functionality.

## Implementation Requirements

### 1. Enhance Existing ProviderManager Class
**File:** `packages/core/src/providers/ProviderManager.ts`

Add logging capability to the existing ProviderManager without changing its public interface:

```typescript
// Add these imports to existing imports
import { Config } from '../config/config.js';
import { logProviderSwitch } from '../telemetry/loggers.js';
import { ProviderSwitchEvent } from '../telemetry/types.js';

export class ProviderManager implements IProviderManager {
  // ... existing properties ...
  private config?: Config;

  // Add config setter method
  setConfig(config: Config): void {
    this.config = config;
  }

  // Enhance existing registerProvider method
  registerProvider(provider: IProvider): void {
    // Wrap provider with logging if conversation logging is enabled
    let finalProvider = provider;
    if (this.config?.getConversationLoggingEnabled()) {
      finalProvider = new LoggingProviderWrapper(provider, this.config);
    }

    // ... existing registerProvider logic ...
    this.providers.set(provider.name, finalProvider);
    // ... rest of existing method ...
  }

  // Enhance existing setActiveProvider method  
  setActiveProvider(name: string): void {
    // ... existing validation ...
    
    const previousProviderName = this.activeProviderName;

    // ... existing provider switching logic ...

    // Log provider switch if conversation logging enabled
    if (this.config?.getConversationLoggingEnabled() && 
        previousProviderName && 
        previousProviderName !== name) {
      logProviderSwitch(this.config, new ProviderSwitchEvent(
        previousProviderName,
        name,
        this.generateConversationId(),
        this.isContextPreserved(previousProviderName, name)
      ));
    }

    this.activeProviderName = name;
    // ... rest of existing method ...
  }

  private generateConversationId(): string {
    // Generate unique conversation ID for session
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isContextPreserved(fromProvider: string, toProvider: string): boolean {
    // Determine if context can be preserved between providers
    // For now, assume context preserved only within same provider
    return fromProvider === toProvider;
  }
}
```

### 2. Create LoggingProviderWrapper Class
**File:** `packages/core/src/providers/LoggingProviderWrapper.ts` (NEW FILE)

Implement the decorator pattern to wrap existing providers:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider, IModel, ITool, IMessage } from './IProvider.js';
import { Config } from '../config/config.js';
import { ConversationDataRedactor } from '../privacy/ConversationDataRedactor.js';
import { 
  logConversationRequest, 
  logConversationResponse 
} from '../telemetry/loggers.js';
import {
  ConversationRequestEvent,
  ConversationResponseEvent
} from '../telemetry/types.js';

export class LoggingProviderWrapper implements IProvider {
  private conversationId: string;
  private turnNumber: number = 0;

  constructor(
    private readonly wrapped: IProvider,
    private readonly config: Config,
    private readonly redactor?: ConversationDataRedactor,
  ) {
    this.conversationId = this.generateConversationId();
  }

  get name(): string {
    return this.wrapped.name;
  }

  get isDefault(): boolean | undefined {
    return this.wrapped.isDefault;
  }

  async getModels(): Promise<IModel[]> {
    return this.wrapped.getModels();
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    const promptId = this.generatePromptId();
    this.turnNumber++;

    // Log request if conversation logging enabled
    if (this.config.getConversationLoggingEnabled()) {
      await this.logRequest(messages, tools, toolFormat, promptId);
    }

    // Get stream from wrapped provider
    const stream = this.wrapped.generateChatCompletion(messages, tools, toolFormat);
    
    // If logging disabled, pass through unchanged
    if (!this.config.getConversationLoggingEnabled()) {
      yield* stream;
      return;
    }

    // Log response stream
    yield* this.logResponseStream(stream, promptId);
  }

  private async logRequest(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
    promptId?: string
  ): Promise<void> {
    try {
      // Redact sensitive data if redactor available
      const redactedMessages = this.redactor 
        ? messages.map(msg => this.redactor!.redactMessage(msg, this.wrapped.name))
        : messages;
      
      const redactedTools = tools && this.redactor
        ? tools.map(tool => this.redactor!.redactToolCall(tool))
        : tools;

      const event = new ConversationRequestEvent(
        this.wrapped.name,
        this.conversationId,
        this.turnNumber,
        promptId || this.generatePromptId(),
        redactedMessages,
        redactedTools,
        toolFormat
      );

      logConversationRequest(this.config, event);
    } catch (error) {
      // Log error but don't fail the request
      console.warn('Failed to log conversation request:', error);
    }
  }

  private async *logResponseStream(
    stream: AsyncIterableIterator<unknown>,
    promptId: string
  ): AsyncIterableIterator<unknown> {
    let responseContent = '';
    let responseComplete = false;
    const startTime = Date.now();

    try {
      for await (const chunk of stream) {
        // Extract content from chunk (provider-specific logic needed)
        const content = this.extractContentFromChunk(chunk);
        if (content) {
          responseContent += content;
        }

        yield chunk;
      }
      responseComplete = true;
    } catch (error) {
      // Log error response
      await this.logResponse('', promptId, Date.now() - startTime, false, error);
      throw error;
    }

    if (responseComplete) {
      await this.logResponse(responseContent, promptId, Date.now() - startTime, true);
    }
  }

  private async logResponse(
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error?: unknown
  ): Promise<void> {
    try {
      // Redact response content if redactor available
      const redactedContent = this.redactor
        ? this.redactor.redactResponseContent(content, this.wrapped.name)
        : content;

      const event = new ConversationResponseEvent(
        this.wrapped.name,
        this.conversationId,
        this.turnNumber,
        promptId,
        redactedContent,
        duration,
        success,
        error ? String(error) : undefined
      );

      logConversationResponse(this.config, event);
    } catch (logError) {
      console.warn('Failed to log conversation response:', logError);
    }
  }

  private extractContentFromChunk(chunk: unknown): string {
    // Provider-specific content extraction
    // This needs to handle different provider response formats
    if (typeof chunk === 'object' && chunk !== null) {
      // Handle Gemini format
      if ('candidates' in chunk && Array.isArray((chunk as any).candidates)) {
        const candidate = (chunk as any).candidates[0];
        if (candidate?.content?.parts?.[0]?.text) {
          return candidate.content.parts[0].text;
        }
      }
      
      // Handle OpenAI format
      if ('choices' in chunk && Array.isArray((chunk as any).choices)) {
        const choice = (chunk as any).choices[0];
        if (choice?.delta?.content) {
          return choice.delta.content;
        }
      }
      
      // Handle Anthropic format
      if ('delta' in chunk && (chunk as any).delta?.text) {
        return (chunk as any).delta.text;
      }
    }
    
    return '';
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Delegate all other methods to wrapped provider
  setModel?(modelId: string): void {
    this.wrapped.setModel?.(modelId);
  }

  getCurrentModel?(): string {
    return this.wrapped.getCurrentModel?.();
  }

  setApiKey?(apiKey: string): void {
    this.wrapped.setApiKey?.(apiKey);
  }

  setBaseUrl?(baseUrl?: string): void {
    this.wrapped.setBaseUrl?.(baseUrl);
  }

  getToolFormat?(): string {
    return this.wrapped.getToolFormat?.();
  }

  setToolFormatOverride?(format: string | null): void {
    this.wrapped.setToolFormatOverride?.(format);
  }

  isPaidMode?(): boolean {
    return this.wrapped.isPaidMode?.();
  }

  clearState?(): void {
    this.wrapped.clearState?.();
    // Reset conversation logging state
    this.conversationId = this.generateConversationId();
    this.turnNumber = 0;
  }

  setConfig?(config: unknown): void {
    this.wrapped.setConfig?.(config);
  }

  getServerTools(): string[] {
    return this.wrapped.getServerTools();
  }

  async invokeServerTool(toolName: string, params: unknown, config?: unknown): Promise<unknown> {
    return this.wrapped.invokeServerTool(toolName, params, config);
  }

  setModelParams?(params: Record<string, unknown> | undefined): void {
    this.wrapped.setModelParams?.(params);
  }

  getModelParams?(): Record<string, unknown> | undefined {
    return this.wrapped.getModelParams?.();
  }
}
```

### 3. Enhance Telemetry Types
**File:** `packages/core/src/telemetry/types.ts`

Add new telemetry events to the existing file:

```typescript
// Add these new event classes to existing file

export class ConversationRequestEvent {
  'event.name': 'conversation_request';
  'event.timestamp': string; // ISO 8601
  provider_name: string;
  conversation_id: string;
  turn_number: number;
  prompt_id: string;
  redacted_messages: IMessage[];
  redacted_tools?: ITool[];
  tool_format?: string;
  provider_switched?: boolean;

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_messages: IMessage[],
    redacted_tools?: ITool[],
    tool_format?: string,
    provider_switched?: boolean
  ) {
    this['event.name'] = 'conversation_request';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.conversation_id = conversation_id;
    this.turn_number = turn_number;
    this.prompt_id = prompt_id;
    this.redacted_messages = redacted_messages;
    this.redacted_tools = redacted_tools;
    this.tool_format = tool_format;
    this.provider_switched = provider_switched;
  }
}

export class ConversationResponseEvent {
  'event.name': 'conversation_response';
  'event.timestamp': string; // ISO 8601
  provider_name: string;
  conversation_id: string;
  turn_number: number;
  prompt_id: string;
  redacted_content: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  tool_calls?: unknown[];

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_content: string,
    duration_ms: number,
    success: boolean,
    error?: string,
    tool_calls?: unknown[]
  ) {
    this['event.name'] = 'conversation_response';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.conversation_id = conversation_id;
    this.turn_number = turn_number;
    this.prompt_id = prompt_id;
    this.redacted_content = redacted_content;
    this.duration_ms = duration_ms;
    this.success = success;
    this.error = error;
    this.tool_calls = tool_calls;
  }
}

export class ProviderSwitchEvent {
  'event.name': 'provider_switch';
  'event.timestamp': string; // ISO 8601
  from_provider: string;
  to_provider: string;
  conversation_id: string;
  context_preserved: boolean;

  constructor(
    from_provider: string,
    to_provider: string,
    conversation_id: string,
    context_preserved: boolean
  ) {
    this['event.name'] = 'provider_switch';
    this['event.timestamp'] = new Date().toISOString();
    this.from_provider = from_provider;
    this.to_provider = to_provider;
    this.conversation_id = conversation_id;
    this.context_preserved = context_preserved;
  }
}

// Update the TelemetryEvent union type to include new events
export type TelemetryEvent =
  | StartSessionEvent
  | EndSessionEvent
  | UserPromptEvent
  | ToolCallEvent
  | ApiRequestEvent
  | ApiErrorEvent
  | ApiResponseEvent
  | FlashFallbackEvent
  | LoopDetectedEvent
  | NextSpeakerCheckEvent
  | SlashCommandEvent
  | MalformedJsonResponseEvent
  | ConversationRequestEvent
  | ConversationResponseEvent
  | ProviderSwitchEvent;
```

### 4. Enhance Telemetry Loggers
**File:** `packages/core/src/telemetry/loggers.ts`

Add new logging functions to existing file:

```typescript
// Add these new logging functions to existing file

import { 
  ConversationRequestEvent, 
  ConversationResponseEvent, 
  ProviderSwitchEvent 
} from './types.js';

export function logConversationRequest(
  config: Config,
  event: ConversationRequestEvent
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }
  
  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log conversation request:', error);
  }
}

export function logConversationResponse(
  config: Config,
  event: ConversationResponseEvent
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }
  
  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log conversation response:', error);
  }
}

export function logProviderSwitch(
  config: Config,
  event: ProviderSwitchEvent
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }
  
  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log provider switch:', error);
  }
}
```

### 5. Enhance Config Class
**File:** `packages/core/src/config/config.ts`

Add conversation logging configuration methods to existing Config class:

```typescript
// Add to existing Config class

  // Conversation logging configuration methods
  getConversationLoggingEnabled(): boolean {
    // Check CLI flags first
    if (this.cliFlags?.logConversations !== undefined) {
      return this.cliFlags.logConversations;
    }
    
    // Check environment variables
    const envVar = process.env.LLXPRT_LOG_CONVERSATIONS;
    if (envVar !== undefined) {
      return envVar.toLowerCase() === 'true';
    }
    
    // Check settings file
    return this.telemetrySettings.logConversations ?? false;
  }

  getResponseLoggingEnabled(): boolean {
    return this.telemetrySettings.logResponses ?? false;
  }

  getConversationLogPath(): string {
    return this.telemetrySettings.conversationLogPath ?? '~/.llxprt/conversations/';
  }

  getMaxConversationHistory(): number {
    return this.telemetrySettings.maxConversationHistory ?? 50;
  }

  getConversationRetentionDays(): number {
    return this.telemetrySettings.retentionDays ?? 30;
  }

  getMaxLogFiles(): number {
    return this.telemetrySettings.maxLogFiles ?? 10;
  }

  getMaxLogSizeMB(): number {
    return this.telemetrySettings.maxLogSizeMB ?? 100;
  }

// Update TelemetrySettings interface to include new options
interface TelemetrySettings {
  // ... existing properties ...
  logConversations?: boolean;
  logResponses?: boolean;
  redactSensitiveData?: boolean;
  maxConversationHistory?: number;
  conversationLogPath?: string;
  maxLogFiles?: number;
  maxLogSizeMB?: number;
  retentionDays?: number;
}
```

### 6. Update CLI Integration
**File:** `packages/cli/src/providers/providerManagerInstance.ts`

Ensure the provider manager instance is configured with the Config:

```typescript
// Add to existing file
import { config } from '../config.js';

// Initialize provider manager with config
providerManager.setConfig(config);
```

## Code Quality Requirements

### Error Handling
- All logging operations must be wrapped in try-catch blocks
- Logging failures must not affect provider functionality
- Log warnings for logging errors but continue operation

### Performance Considerations
- Logging wrapper should add minimal overhead when logging is disabled
- Stream processing should not buffer entire responses in memory
- Use lazy evaluation for expensive operations like redaction

### Backwards Compatibility
- All existing provider interfaces must remain unchanged
- Existing tests must continue to pass without modification
- New functionality must be opt-in only

## Testing Integration

### Verify Tests Pass
After implementation, ensure that all tests from Task 01 now pass:

```bash
npm test packages/core/src/telemetry/conversation-logging.test.ts
npm test packages/core/src/providers/LoggingProviderWrapper.test.ts
npm test packages/core/src/telemetry/conversation-logging-performance.test.ts
```

### Run Existing Tests
Verify no regressions in existing functionality:

```bash
npm test packages/core/src/providers/
npm test packages/core/src/telemetry/
npm test packages/core/src/config/
```

## File Modifications Summary

### Files to Modify (Enhance existing)
- `packages/core/src/providers/ProviderManager.ts` - Add logging integration
- `packages/core/src/telemetry/types.ts` - Add conversation events
- `packages/core/src/telemetry/loggers.ts` - Add conversation logging functions
- `packages/core/src/config/config.ts` - Add conversation logging config methods
- `packages/cli/src/providers/providerManagerInstance.ts` - Add config injection

### Files to Create (New)
- `packages/core/src/providers/LoggingProviderWrapper.ts` - Provider decorator

## Acceptance Criteria

### Functional Requirements
- [ ] LoggingProviderWrapper successfully wraps all provider types
- [ ] Conversation events are logged when enabled
- [ ] Provider switching is tracked with context information
- [ ] Configuration methods return correct values based on hierarchy
- [ ] Logging can be enabled/disabled without affecting provider functionality

### Performance Requirements
- [ ] <1% overhead when logging is disabled
- [ ] <5% overhead when logging is enabled
- [ ] No memory leaks from stream processing
- [ ] Minimal impact on provider startup time

### Quality Requirements
- [ ] All existing tests continue to pass
- [ ] New behavioral tests from Task 01 now pass
- [ ] TypeScript compilation succeeds without errors
- [ ] Code follows existing patterns and conventions
- [ ] Error handling prevents logging failures from affecting providers

### Integration Requirements
- [ ] Works with all existing provider implementations (Gemini, OpenAI, Anthropic)
- [ ] Integrates cleanly with existing telemetry infrastructure
- [ ] Configuration follows existing llxprt patterns
- [ ] CLI integration works seamlessly

## Task Completion Criteria

This task is complete when:

1. **All Implementation Complete**: All files modified/created as specified
2. **Tests Pass**: Behavioral tests from Task 01 now pass
3. **No Regressions**: All existing tests continue to pass
4. **TypeScript Clean**: No TypeScript compilation errors
5. **Performance Verified**: Performance tests show acceptable overhead
6. **Integration Works**: Provider manager correctly wraps providers when enabled

The next task (03-privacy-controls) should not begin until this core infrastructure is complete and all tests are passing.
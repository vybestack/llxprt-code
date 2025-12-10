# nui Architecture

## Overview

nui is an alternative terminal UI for llxprt-code, built on opentui instead of Ink. It provides a cleaner separation between UI rendering and backend logic.

## Design Principles

1. **UI is Dumb**: The UI layer only renders what it's told. No business logic.
2. **Adapter Owns Logic**: The adapter layer interprets events and manages state.
3. **Delegate to Core**: Reuse llxprt-code-core for history, streaming, tools.
4. **Stream Everything**: Real-time rendering as data arrives.

## Layer Responsibilities

```
┌─────────────────────────────────────────────────────────┐
│                     UI Layer                            │
│  - Renders text, markdown, tool status                  │
│  - Handles user input                                   │
│  - Shows approval prompts                               │
│  - NO business logic                                    │
├─────────────────────────────────────────────────────────┤
│                   Adapter Layer                         │
│  - Transforms GeminiClient events → UI events           │
│  - Manages session lifecycle                            │
│  - Bridges approval flow                                │
│  - Owns Config stub                                     │
├─────────────────────────────────────────────────────────┤
│                 llxprt-code-core                        │
│  - GeminiClient (streaming, history, tools)             │
│  - Providers (OpenAI, Anthropic, Gemini)                │
│  - HistoryService, SettingsService                      │
│  - All the battle-tested logic                          │
└─────────────────────────────────────────────────────────┘
```

## Event Flow

### User Message Flow

```
User Input
    │
    ▼
┌─────────────────┐
│   UI Layer      │ captures text, sends to adapter
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Adapter Layer  │ calls GeminiClient.sendMessageStream()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  GeminiClient   │ manages history, calls provider
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Provider      │ streams from API
└────────┬────────┘
         │
    Stream Events
         │
         ▼
┌─────────────────┐
│  Adapter Layer  │ transforms events
└────────┬────────┘
         │
    AdapterEvents
         │
         ▼
┌─────────────────┐
│   UI Layer      │ renders incrementally
└─────────────────┘
```

### Event Types

**From GeminiClient (ServerGeminiStreamEvent)**:

- `Content` - text chunk from model
- `Thought` - thinking/reasoning content
- `ToolCallRequest` - model wants to call a tool
- `ToolCallConfirmation` - tool needs approval
- `ToolCallResponse` - tool execution result
- `Finished` - stream complete
- `Error` - something went wrong

**To UI (AdapterEvent)**:

- `text_delta` - append text to current message
- `thinking_delta` - append to thinking section
- `tool_pending` - show tool as waiting
- `tool_approval_needed` - prompt user for approval
- `tool_executing` - show spinner
- `tool_complete` - show result
- `complete` - message done
- `error` - show error

## Config Stub Strategy

GeminiClient requires a Config object. Rather than importing the full 1700-line Config class, we create a minimal stub that satisfies GeminiClient's actual needs:

```typescript
const configStub = {
  getSessionId: () => sessionId,
  getModel: () => model,
  getProvider: () => provider,
  getSettingsService: () => settingsService,
  getContentGeneratorConfig: () => ({ ... }),
  getToolRegistry: () => undefined,  // No tools initially
  getEmbeddingModel: () => undefined,
  getComplexityAnalyzerSettings: () => ({ ... }),
  // ... other required methods
};
```

Use a Proxy wrapper to log any missing methods during development.

## Tool Execution (Future)

When tool execution is implemented:

1. GeminiClient yields `ToolCallRequest` event
2. Adapter checks approval mode:
   - Auto-approve: Execute immediately
   - Require approval: Yield `tool_approval_needed` to UI
3. UI shows approval prompt
4. User approves/rejects via callback
5. Adapter tells GeminiClient to proceed or abort
6. GeminiClient handles tool execution internally
7. Results flow back as events

## Session Lifecycle

```
┌──────────────┐
│   Create     │ createSession(config)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Initialize  │ session.initialize()
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Active     │ session.sendMessage() (repeatable)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Dispose    │ session.dispose()
└──────────────┘
```

## Streaming Markdown

The UI must render markdown incrementally as chunks arrive:

1. **Accumulate**: Buffer all text received so far
2. **Parse**: Re-parse the full buffer on each chunk
3. **Render**: Show parsed result up to current position
4. **Grow**: Incomplete constructs (code blocks) render as if complete

This ensures correct formatting even when chunks split markdown syntax.

## Future: Integration with llxprt-code

nui is designed to eventually move into `llxprt-code/packages/nui`:

- Entry point: `llxprt --ui nui` or separate binary
- Full access to real Config, arg parsing, profiles
- No more Config stub needed
- Tool execution fully integrated

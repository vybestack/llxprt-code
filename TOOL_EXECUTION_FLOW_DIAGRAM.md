# Tool Execution Flow Diagram

## Visual Flow Representation

```mermaid
graph TB
    %% Entry Points
    Start([Tool Invocation]) --> Entry{Entry Point?}
    Entry -->|Gemini Response| StreamEvent[processGeminiStreamEvents]
    Entry -->|Slash Command| SlashCmd[handleSlashCommand]
    Entry -->|At Command| AtCmd[handleAtCommand]
    
    %% Initial Scheduling
    StreamEvent --> ScheduleCall[scheduleToolCalls]
    SlashCmd --> ScheduleCall
    AtCmd --> ScheduleCall
    
    %% React Hook Layer
    ScheduleCall --> ReactScheduler[useReactToolScheduler.schedule]
    ReactScheduler --> CoreSchedule[CoreToolScheduler.schedule]
    
    %% Core Scheduling
    CoreSchedule --> CreateTools[Create ToolCall objects]
    CreateTools --> UpdateState1[Update this.toolCalls]
    UpdateState1 --> NotifyUpdate1[notifyToolCallsUpdate]
    
    %% State Propagation to React
    NotifyUpdate1 --> CallbackHandler[toolCallsUpdateHandler]
    CallbackHandler --> SetState[setToolCallsForDisplay]
    SetState --> ReactRender[React Re-render]
    
    %% Tool Validation & Approval
    CreateTools --> Validate{Validate Tool}
    Validate -->|Success| CheckApproval{Needs Approval?}
    Validate -->|Error| ErrorState[Status: error]
    
    CheckApproval -->|Yes| AwaitingApproval[Status: awaiting_approval]
    CheckApproval -->|No| Scheduled[Status: scheduled]
    
    %% User Interaction
    AwaitingApproval --> UserDecision{User Action}
    UserDecision -->|Approve| Scheduled
    UserDecision -->|Cancel| Cancelled[Status: cancelled]
    UserDecision -->|Modify| ModifyTool[Modify with Editor]
    ModifyTool --> AwaitingApproval
    
    %% Execution Phase
    Scheduled --> Execute[Execute Tool]
    Execute --> Executing[Status: executing]
    
    %% Live Output Updates
    Executing --> LiveOutput{Has Output?}
    LiveOutput -->|Yes| OutputUpdate[outputUpdateHandler]
    OutputUpdate --> UpdateOutput[Update liveOutput]
    UpdateOutput --> NotifyUpdate2[notifyToolCallsUpdate]
    NotifyUpdate2 --> ReactRender
    
    %% Completion States
    Executing --> Complete{Result?}
    Complete -->|Success| Success[Status: success]
    Complete -->|Error| Error[Status: error]
    Complete -->|Abort| Cancelled
    
    %% Completion Handling
    Success --> CheckAllComplete{All Tools Complete?}
    Error --> CheckAllComplete
    Cancelled --> CheckAllComplete
    ErrorState --> CheckAllComplete
    
    CheckAllComplete -->|Yes| CompleteHandler[onAllToolCallsComplete]
    CheckAllComplete -->|No| WaitMore[Wait for more tools]
    
    %% Continuation Flow
    CompleteHandler --> HandleCompleted[handleCompletedTools]
    HandleCompleted --> CheckContinue{Should Continue?}
    
    CheckContinue -->|Yes| SubmitResponses[submitQuery with responses]
    CheckContinue -->|No| End([End])
    
    %% Potential Loop
    SubmitResponses --> StreamEvent
    
    %% Re-render triggers highlighted
    ReactRender --> UpdateUI[Update UI Components]
    UpdateUI --> DisplayTools[Display Tool States]
    
    %% Style definitions
    classDef entryPoint fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef stateChange fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef reactUpdate fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef decision fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef completion fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    
    class Start,Entry entryPoint
    class UpdateState1,NotifyUpdate1,NotifyUpdate2,SetState,UpdateOutput stateChange
    class ReactScheduler,CallbackHandler,ReactRender,UpdateUI reactUpdate
    class Validate,CheckApproval,UserDecision,LiveOutput,Complete,CheckAllComplete,CheckContinue decision
    class Success,Error,Cancelled,End completion
```

## Key State Update Points

### 1. **Initial Tool Creation**
```
CoreToolScheduler.schedule() 
└─> this.toolCalls = [...] 
    └─> notifyToolCallsUpdate() 
        └─> React setState
```

### 2. **Status Transitions**
```
setStatusInternal(callId, newStatus) 
└─> this.toolCalls = this.toolCalls.map(...) 
    └─> notifyToolCallsUpdate() 
        └─> React setState
```

### 3. **Live Output Updates**
```
Tool execution with liveOutputCallback 
└─> outputUpdateHandler(callId, output) 
    ├─> setPendingHistoryItem (React setState)
    └─> this.toolCalls = this.toolCalls.map(...) 
        └─> notifyToolCallsUpdate() 
            └─> React setState
```

### 4. **Completion Flow**
```
All tools complete 
└─> onAllToolCallsComplete(completedTools) 
    └─> handleCompletedTools (in useGeminiStream) 
        └─> submitQuery (continuation) 
            └─> New stream → Potential new tools
```

## Circular Dependency Patterns

### Pattern 1: Tool → Stream → Tool Loop
```
┌─────────────────┐
│   Tool Calls    │
└────────┬────────┘
         │ Complete
         ▼
┌─────────────────┐
│ Submit Response │
└────────┬────────┘
         │ 
         ▼
┌─────────────────┐
│  Gemini Stream  │
└────────┬────────┘
         │ New tool request
         ▼
┌─────────────────┐
│   Tool Calls    │ ← Loop back
└─────────────────┘
```

### Pattern 2: State Update Cascade
```
Tool State Change 
├─> CoreToolScheduler state update
├─> React toolCallsForDisplay update
├─> React pendingHistoryItem update
├─> UI Re-render
└─> Computed streamingState update
    └─> UI Re-render (again)
```

## Guards Against Infinite Loops

1. **isResponding Guard**
   - Prevents new tool scheduling while stream is active
   - Located in handleCompletedTools

2. **Tool State Machine**
   - Tools can only transition forward in states
   - Terminal states (success/error/cancelled) are final

3. **Abort Signal**
   - User can cancel with ESC key
   - Propagates through entire tool chain

4. **Memory Tool Deduplication**
   - processedMemoryToolsRef prevents re-processing
   - Only new memory saves trigger refresh

5. **Model Switch Flag**
   - modelSwitchedFromQuotaError prevents continuation
   - Set when quota errors cause model fallback
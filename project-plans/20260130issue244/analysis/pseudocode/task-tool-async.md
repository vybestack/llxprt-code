# Task Tool Async Mode Pseudocode

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Interface Contract

```
INPUTS:
  - Existing TaskToolParams plus:
    - async?: boolean
  
OUTPUTS:
  - For async=true: Immediate return with launch status
  - Background: task completion updates AsyncTaskManager
  
DEPENDENCIES:
  - AsyncTaskManager (new)
  - All existing TaskTool dependencies
```

## Schema Changes

```
001: // Add to TaskToolParams interface (task.ts ~line 37)
002: INTERFACE TaskToolParams {
003:   // ... existing params ...
004:   async?: boolean  // NEW: Launch without blocking
005: }
006:
007: // Add to schema (task.ts ~line 654)
008: properties: {
009:   // ... existing properties ...
010:   async: {
011:     type: 'boolean',
012:     description: 'If true, launch subagent in background and return immediately. Default: false.'
013:   }
014: }
```

## Normalized Params Changes

```
020: // Add to TaskToolInvocationParams (task.ts ~line 56)
021: INTERFACE TaskToolInvocationParams {
022:   // ... existing params ...
023:   async: boolean  // Normalized from async param
024: }
025:
026: // Add to normalizeParams (task.ts ~line 738)
027: METHOD normalizeParams(params: TaskToolParams): TaskToolInvocationParams {
028:   // ... existing normalization ...
029:   RETURN {
030:     // ... existing fields ...
031:     async: params.async ?? false
032:   }
033: }
```

## Dependencies Changes

```
039: // Add to TaskToolDependencies (task.ts ~line 65)
040: INTERFACE TaskToolDependencies {
041:   // ... existing deps ...
042:   getAsyncTaskManager?: () => AsyncTaskManager | undefined
043: }
044:
045: // Add to TaskToolInvocationDeps (task.ts ~line 73)
046: INTERFACE TaskToolInvocationDeps {
047:   // ... existing deps ...
048:   getAsyncTaskManager?: () => AsyncTaskManager | undefined
049: }
```

## Execute Method - Async Branch

```
055: // In execute method (task.ts ~line 204), add after initial checks:
056: METHOD execute(signal: AbortSignal, updateOutput?: (output: string) => void): Promise<ToolResult> {
057:   // ... existing timeout setup (lines 208-226) ...
058:
059:   // NEW: Async mode branch
060:   IF this.normalized.async THEN
061:     RETURN this.executeAsync(signal, updateOutput)
062:   END IF
063:
064:   // ... existing sync implementation ...
065: }
```

## Async Execution Method

```
071: PRIVATE METHOD executeAsync(
072:   signal: AbortSignal,
073:   updateOutput?: (output: string) => void
074: ): Promise<ToolResult> {
075:
076:   // Get AsyncTaskManager
077:   LET asyncTaskManager = this.deps.getAsyncTaskManager?.()
078:   IF asyncTaskManager === undefined THEN
079:     RETURN {
080:       llmContent: 'Async mode requires AsyncTaskManager to be configured.',
081:       returnDisplay: 'Error: Async mode not available.',
082:       error: { message: 'AsyncTaskManager not configured', type: ToolErrorType.EXECUTION_FAILED }
083:     }
084:   END IF
085:
086:   // Check limit BEFORE launching
087:   LET canLaunch = asyncTaskManager.canLaunchAsync()
088:   IF NOT canLaunch.allowed THEN
089:     RETURN {
090:       llmContent: canLaunch.reason ?? 'Cannot launch async task.',
091:       returnDisplay: canLaunch.reason ?? 'Async task limit reached.',
092:       error: { message: canLaunch.reason ?? 'Limit reached', type: ToolErrorType.EXECUTION_FAILED }
093:     }
094:   END IF
095:
096:   // Create orchestrator (same as sync)
097:   LET orchestrator: SubagentOrchestrator
098:   TRY
099:     orchestrator = this.deps.createOrchestrator()
100:   CATCH error
101:     RETURN this.createErrorResult(error, 'Failed to create orchestrator for async task.')
102:   END TRY
103:
104:   // Create launch request (same as sync)
105:   LET launchRequest = this.createLaunchRequest(undefined)  // No timeout for launch itself
106:
107:   // Launch subagent
108:   LET launchResult: { scope, agentId, dispose }
109:   TRY
110:     launchResult = AWAIT orchestrator.launch(launchRequest, signal)
111:   CATCH error
112:     RETURN this.createErrorResult(error, `Failed to launch async subagent '${this.normalized.subagentName}'.`)
113:   END TRY
114:
115:   LET { scope, agentId, dispose } = launchResult
116:   LET contextState = this.buildContextState()
117:
118:   // Create abort controller for async task cancellation
119:   LET asyncAbortController = new AbortController()
120:
121:   // Register with AsyncTaskManager BEFORE starting background execution
122:   asyncTaskManager.registerTask({
123:     id: agentId,
124:     subagentName: this.normalized.subagentName,
125:     goalPrompt: this.normalized.goalPrompt,
126:     abortController: asyncAbortController
127:   })
128:
129:   // Set up message streaming (same as sync)
130:   IF updateOutput THEN
131:     // ... same streaming setup as sync (lines 347-365) ...
132:   END IF
133:
134:   // ERROR: DO NOT await this - execute in background
135:   // DO NOT use await here
136:   this.executeInBackground(
137:     scope,
138:     contextState,
139:     agentId,
140:     asyncTaskManager,
141:     dispose,
142:     asyncAbortController.signal
143:   )
144:
145:   // Return immediately with launch status
146:   RETURN {
147:     llmContent: `Async task launched: subagent '${this.normalized.subagentName}' (ID: ${agentId}). ` +
148:       `Task is running in background. Use 'check_async_tasks' to monitor progress.`,
149:     returnDisplay: `Async task started: **${this.normalized.subagentName}** (\`${agentId}\`)`,
150:     metadata: {
151:       agentId: agentId,
152:       async: true,
153:       status: 'running'
154:     }
155:   }
156: }
```

## Background Execution Method

```
162: PRIVATE METHOD executeInBackground(
163:   scope: SubAgentScope,
164:   contextState: ContextState,
165:   agentId: string,
166:   asyncTaskManager: AsyncTaskManager,
167:   dispose: () => Promise<void>,
168:   signal: AbortSignal
169: ): void {
170:
171:   // ERROR: This MUST NOT be awaited - fire and forget
172:   // Use IIFE to avoid returning promise
173:   (ASYNC () => {
174:     TRY
175:       // Use non-interactive mode for background execution
176:       AWAIT scope.runNonInteractive(contextState)
177:
178:       // Check if cancelled
179:       IF signal.aborted THEN
180:         // Already cancelled via cancelTask - don't override
181:         RETURN
182:       END IF
183:
184:       // Get output
185:       LET output = scope.output ?? {
186:         terminate_reason: SubagentTerminateMode.ERROR,
187:         emitted_vars: {}
188:       }
189:
190:       // Update AsyncTaskManager
191:       asyncTaskManager.completeTask(agentId, output)
192:
193:     CATCH error
194:       // Update AsyncTaskManager with failure
195:       LET errorMessage = error instanceof Error ? error.message : String(error)
196:       asyncTaskManager.failTask(agentId, errorMessage)
197:
198:     FINALLY
199:       // Always dispose
200:       TRY
201:         AWAIT dispose()
202:       CATCH
203:         // Swallow dispose errors
204:       END TRY
205:     END TRY
206:   })()
207: }
```

## Anti-Pattern Warnings

```
ERROR: Line 135-136 - DO NOT await executeInBackground
  WHY: Would block and defeat purpose of async mode
  CORRECT: Call without await, let it run in background

ERROR: Line 121-127 - MUST register BEFORE starting background
  WHY: Task should be queryable immediately after return
  CORRECT: Register first, then start execution

ERROR: Line 179-182 - DO NOT call cancelTask from here
  WHY: cancelTask is called by user via /task end
  CORRECT: Just return early if aborted, state already set

ERROR: Line 191 - MUST use correct output format
  WHY: AsyncTaskReminderService expects OutputObject format
  CORRECT: Use scope.output which has terminate_reason and emitted_vars
```

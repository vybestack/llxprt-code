# AsyncTaskAutoTrigger Pseudocode

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Interface Contract

```
INPUTS:
  - AsyncTaskManager (for completion events)
  - AsyncTaskReminderService (for notification content)
  - Client callbacks (isAgentBusy, triggerAgentTurn)
  
OUTPUTS:
  - Automatic agent turn triggered on async task completion
  
DEPENDENCIES:
  - AsyncTaskManager
  - AsyncTaskReminderService
  - Client integration points
```

## Class Implementation

```
001: CLASS AsyncTaskAutoTrigger {
002:   PRIVATE taskManager: AsyncTaskManager
003:   PRIVATE reminderService: AsyncTaskReminderService
004:   PRIVATE isAgentBusy: () => boolean
005:   PRIVATE triggerAgentTurn: (message: string) => Promise<void>
006:   PRIVATE isTriggering: boolean = false
007:   PRIVATE unsubscribers: (() => void)[] = []
008:
009:   CONSTRUCTOR(config: {
010:     taskManager: AsyncTaskManager,
011:     reminderService: AsyncTaskReminderService,
012:     isAgentBusy: () => boolean,
013:     triggerAgentTurn: (message: string) => Promise<void>
014:   }) {
015:     this.taskManager = config.taskManager
016:     this.reminderService = config.reminderService
017:     this.isAgentBusy = config.isAgentBusy
018:     this.triggerAgentTurn = config.triggerAgentTurn
019:   }
```

## Start/Stop Subscription

```
025:   METHOD start(): void {
026:     // Subscribe to all terminal state events
027:     this.unsubscribers.push(
028:       this.taskManager.onTaskCompleted(task => this.onTaskTerminal(task))
029:     )
030:     this.unsubscribers.push(
031:       this.taskManager.onTaskFailed(task => this.onTaskTerminal(task))
032:     )
033:     // NOTE: Don't auto-trigger for cancelled - user initiated
034:   }
035:
036:   METHOD stop(): void {
037:     FOR unsubscribe IN this.unsubscribers DO
038:       unsubscribe()
039:     END FOR
040:     this.unsubscribers = []
041:   }
```

## Event Handler

```
047:   PRIVATE METHOD onTaskTerminal(task: AsyncTaskInfo): void {
048:     // Attempt auto-trigger (async, don't await)
049:     this.maybeAutoTrigger()
050:   }
```

## Auto-Trigger Logic

```
056:   // Core auto-trigger logic with serialization
057:   PRIVATE ASYNC METHOD maybeAutoTrigger(): Promise<void> {
058:
059:     // ERROR: Serialize triggers - only one in flight at a time
060:     // DO NOT allow concurrent triggers
061:     IF this.isTriggering THEN
062:       // Another trigger in progress - it will pick up pending notifications
063:       RETURN
064:     END IF
065:
066:     // Check if there are pending notifications
067:     IF NOT this.reminderService.hasPendingNotifications() THEN
068:       RETURN  // Nothing to notify
069:     END IF
070:
071:     // Check if agent is busy
072:     IF this.isAgentBusy() THEN
073:       // Agent is busy - notifications will be picked up via next-turn reminder
074:       RETURN
075:     END IF
076:
077:     // Set triggering flag
078:     this.isTriggering = true
079:
080:     TRY
081:       // Generate reminder content
082:       LET reminder = this.reminderService.generateReminder()
083:
084:       IF reminder.length === 0 THEN
085:         // No content (race condition - already notified)
086:         RETURN
087:       END IF
088:
089:       // Trigger the agent turn
090:       AWAIT this.triggerAgentTurn(reminder)
091:
092:       // ERROR: Mark notified ONLY AFTER successful delivery
093:       // DO NOT mark before triggerAgentTurn
094:       this.reminderService.markAllNotified()
095:
096:     CATCH error
097:       // Trigger failed - leave notifications pending for next turn
098:       // Log but don't rethrow
099:       console.error('Auto-trigger failed:', error)
100:
101:     FINALLY
102:       this.isTriggering = false
103:     END TRY
104:   }
105: }
```

## Client Integration Points

```
111: // These methods need to be provided by the client
112:
113: // isAgentBusy(): boolean
114: // Returns true if:
115: // - Agent is currently generating a response (isResponding)
116: // - Agent is waiting for tool confirmation (awaiting user input)
117: // - Agent is in the middle of a tool execution
118: //
119: // Implementation location: packages/core/src/core/client.ts
120: // Look for: isResponding, confirmation flow, tool execution tracking
121:
122: // triggerAgentTurn(message: string): Promise<void>
123: // Injects a synthetic message and triggers the agent to respond
124: // This is like the user sending a message, but system-initiated
125: //
126: // Implementation: May need to add a method to client
127: // Pattern: Similar to how tool confirmations work
```

## Wiring in Config

```
133: // In Config or runtime setup:
134:
135: FUNCTION setupAsyncTaskAutoTrigger(
136:   config: Config,
137:   client: Client  // or whatever provides isAgentBusy/triggerAgentTurn
138: ): AsyncTaskAutoTrigger {
139:
140:   LET taskManager = config.getAsyncTaskManager()
141:   LET reminderService = config.getAsyncTaskReminderService()
142:
143:   LET autoTrigger = new AsyncTaskAutoTrigger({
144:     taskManager: taskManager,
145:     reminderService: reminderService,
146:     isAgentBusy: () => client.isAgentBusy(),
147:     triggerAgentTurn: (message) => client.triggerAgentTurn(message)
148:   })
149:
150:   autoTrigger.start()
151:
152:   RETURN autoTrigger
153: }
```

## Next-Turn Reminder Integration

```
159: // For busy agent case, notifications go through next-turn reminder
160: // This integrates with existing reminder system
161: //
162: // In the turn loop (packages/core/src/core/client.ts):
163: //
164: // Before sending user message to model:
165: // 1. Get todo reminder
166: // 2. Get async task reminder (NEW)
167: // 3. Combine reminders
168: // 4. Prepend to user message or inject as system note
169:
170: FUNCTION getNextTurnReminder(
171:   todoReminderService: TodoReminderService,
172:   asyncTaskReminderService: AsyncTaskReminderService
173: ): string {
174:   LET parts: string[] = []
175:
176:   LET todoReminder = todoReminderService.getReminder()
177:   IF todoReminder THEN
178:     parts.push(todoReminder)
179:   END IF
180:
181:   LET asyncReminder = asyncTaskReminderService.generateReminder()
182:   IF asyncReminder THEN
183:     parts.push(asyncReminder)
184:     // ERROR: Mark notified AFTER this reminder is actually sent
185:     // The caller must call markAllNotified after successful send
186:   END IF
187:
188:   RETURN parts.join('\n\n')
189: }
```

## Anti-Pattern Warnings

```
ERROR: Line 061-064 - MUST serialize triggers
  WHY: Multiple rapid completions could cause race conditions
  CORRECT: Use isTriggering flag, let in-flight trigger handle all pending

ERROR: Line 092-094 - MUST mark notified AFTER delivery
  WHY: If trigger fails, notification would be lost
  CORRECT: Only call markAllNotified after triggerAgentTurn succeeds

ERROR: Line 033 - DO NOT auto-trigger for cancelled
  WHY: User cancelled intentionally, no surprise notification needed
  CORRECT: Only subscribe to completed and failed events

ERROR: Line 184-186 - MUST defer marking to caller
  WHY: This function doesn't know if send succeeded
  CORRECT: Caller must handle markAllNotified
```

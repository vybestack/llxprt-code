# Pseudocode: Integration Wiring

## Interface Contracts

```typescript
// This pseudocode covers the "glue" — how all new components connect
// to the existing system. No single new class; instead, modifications
// to existing files.

// DialogType extension
type DialogType = /* existing types */ | 'sessionBrowser';

// UIState extension
interface UIState {
  /* existing fields */
  isSessionBrowserDialogOpen: boolean;
}

// UIActions extension
interface UIActions {
  /* existing methods */
  openSessionBrowserDialog(): void;
  closeSessionBrowserDialog(): void;
}

// SessionRecordingMetadata
interface SessionRecordingMetadata {
  sessionId: string;
  filePath: string | null;
  startTime: string;
  isResumed: boolean;
}
```

## Integration Points

```
Line 15: MODIFY packages/cli/src/ui/commands/types.ts
         - Add 'sessionBrowser' to DialogType union
         - This triggers the dialog system pipeline

Line 25: MODIFY packages/cli/src/ui/contexts/UIStateContext.tsx
         - Add isSessionBrowserDialogOpen boolean to UIState
         - Default: false

Line 35: MODIFY packages/cli/src/ui/contexts/UIActionsContext.tsx
         - Add openSessionBrowserDialog/closeSessionBrowserDialog to UIActions

Line 45: MODIFY packages/cli/src/ui/components/DialogManager.tsx
         - Add rendering case for sessionBrowser
         - Pass props: chatsDir, projectHash, currentSessionId, onSelect, onClose

Line 55: MODIFY packages/cli/src/ui/hooks/slashCommandProcessor.ts
         - Add 'sessionBrowser' case to dialog switch
         - Calls actions.openSessionBrowserDialog()

Line 65: MODIFY packages/cli/src/services/BuiltinCommandLoader.ts
         - Import continueCommand
         - Add to commands array

Line 75: MODIFY packages/cli/src/ui/commands/statsCommand.ts
         - Add session info section
         - Display sessionId, startTime, fileSize, isResumed
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Create a new dialog management mechanism
[OK] DO: Follow the exact existing pattern (DialogType → UIState → UIActions → DialogManager)

[ERROR] DO NOT: Render SessionBrowserDialog at the top-level AppContainer
[OK] DO: Render it inside DialogManager following existing priority chain

[ERROR] DO NOT: Create SessionRecordingMetadata in core package
[OK] DO: Create it in CLI package (it's a UI concern)
```

## DialogType Extension

```
10: // In packages/cli/src/ui/commands/types.ts
11: // Find the DialogType union and add 'sessionBrowser'
12: TYPE DialogType = 'auth' | 'theme' | 'editor' | 'privacy' | 'settings'
13:   | 'logging' | 'permissions' | 'provider' | 'loadProfile'
14:   | 'createProfile' | 'profileList' | 'profileDetail'
15:   | 'sessionBrowser'  // NEW
```

## UIState Extension

```
20: // In packages/cli/src/ui/contexts/UIStateContext.tsx
21: // Add to UIState interface:
22: isSessionBrowserDialogOpen: boolean  // NEW — default false
```

## UIActions Extension

```
28: // In packages/cli/src/ui/contexts/UIActionsContext.tsx
29: // Add to UIActions interface:
30: openSessionBrowserDialog: () => void   // NEW
31: closeSessionBrowserDialog: () => void  // NEW
32:
33: // In the UIActions provider implementation:
34: openSessionBrowserDialog: () => {
35:   setUIState(prev => ({ ...prev, isSessionBrowserDialogOpen: true }))
36: }
37: closeSessionBrowserDialog: () => {
38:   setUIState(prev => ({ ...prev, isSessionBrowserDialogOpen: false }))
39: }
```

## DialogManager Rendering

```
45: // In packages/cli/src/ui/components/DialogManager.tsx
46: // Add BEFORE the existing dialog chain (or in priority order):
47: IF uiState.isSessionBrowserDialogOpen THEN
48:   RETURN (
49:     <SessionBrowserDialog
50:       chatsDir={chatsDir}
51:       projectHash={projectHash}
52:       currentSessionId={currentSessionId}
53:       hasActiveConversation={hasActiveConversation}
54:       onSelect={handleSessionBrowserSelect}
55:       onClose={() => actions.closeSessionBrowserDialog()}
56:     />
57:   )
58: END IF
59:
60: // Where handleSessionBrowserSelect is:
61: FUNCTION ASYNC handleSessionBrowserSelect(session: SessionSummary): PerformResumeResult
62:   LET result = AWAIT performResume(session.sessionId, resumeContext)
63:   IF result.ok THEN
64:     // Update React state for recording infrastructure
65:     // Close dialog
66:     // Restore UI history
67:     CALL actions.closeSessionBrowserDialog()
68:     CALL restoreHistoryToUI(result.history)
69:     CALL updateRecordingState(result.newRecording, result.newLockHandle)
70:     CALL updateSessionMetadata({ ...result.metadata, isResumed: true })
71:   END IF
72:   RETURN result
73: END FUNCTION
```

## slashCommandProcessor Dialog Handling

```
80: // In packages/cli/src/ui/hooks/slashCommandProcessor.ts
81: // In the dialog switch (around line 497):
82: CASE 'sessionBrowser':
83:   actions.openSessionBrowserDialog()
84:   RETURN { type: 'handled' }
```

## BuiltinCommandLoader Registration

```
90: // In packages/cli/src/services/BuiltinCommandLoader.ts
91: IMPORT { continueCommand } from '../ui/commands/continueCommand.js'
92:
93: // In registerBuiltinCommands() commands array:
94: ...existingCommands,
95: continueCommand,
```

## Stats Command Session Section

```
100: // In packages/cli/src/ui/commands/statsCommand.ts
101: // Add session info section to stats output
102:
103: FUNCTION getSessionStats(metadata: SessionRecordingMetadata | null): string
104:   IF metadata IS null THEN
105:     RETURN "Session: No active session recording."
106:   END IF
107:
108:   LET lines = [
109:     "Session:",
110:     "  ID: " + metadata.sessionId.substring(0, 12),
111:     "  Started: " + formatRelativeTime(metadata.startTime),
112:   ]
113:
114:   IF metadata.filePath THEN
115:     TRY
116:       LET stat = AWAIT fs.stat(metadata.filePath)
117:       lines.push("  File size: " + formatFileSize(stat.size))
118:     CATCH
119:       // File may not exist yet (deferred materialization)
120:     END TRY
121:   END IF
122:
123:   lines.push("  Resumed: " + (metadata.isResumed ? "yes" : "no"))
124:   RETURN lines.join('\n')
125: END FUNCTION
```

## Config --resume Removal

```
130: // In packages/cli/src/config/config.ts
131: // REMOVE: .option('resume', { alias: 'r', ... })  (lines ~349-357)
132: // REMOVE: 'resume' from parsed args interface
133: // REMOVE: any coercion logic for --resume
134:
135: // In packages/cli/src/utils/sessionUtils.ts
136: // REMOVE: export const RESUME_LATEST = ...
137: // REMOVE: export type SessionSelector = ...
138: // REMOVE: export interface SessionSelectionResult { ... }
139: // KEEP: SessionInfo, SessionFileEntry, getSessionFiles, getAllSessionFiles
140:
141: // In config.ts import section:
142: // REMOVE: import { RESUME_LATEST } from '../utils/sessionUtils.js'
```

## AppContainer Recording State Update

```
150: // In AppContainer or wherever recording state is managed:
151: // After performResume returns ok:true, update React state:
152:
153: SET recordingIntegration = new RecordingIntegration(result.newRecording, historyService)
154: SET lockHandle = result.newLockHandle
155: SET sessionMetadata = {
156:   sessionId: result.metadata.sessionId,
157:   filePath: result.newRecording.getFilePath(),
158:   startTime: result.metadata.startTime,
159:   isResumed: true
160: }
161:
162: // The old recording/integration/lock were already disposed by performResume
163: // This state update triggers re-render → RecordingIntegration subscribes to HistoryService
```

## Relative Time Formatter

```
170: // Utility function, location: packages/cli/src/utils/formatRelativeTime.ts
171:
172: FUNCTION formatRelativeTime(date: Date | string, mode: 'long' | 'short' = 'long'): string
173:   LET now = new Date()
174:   LET target = typeof date === 'string' ? new Date(date) : date
175:   LET diffMs = now.getTime() - target.getTime()
176:
177:   // Clamp future dates to "just now"
178:   IF diffMs < 0 THEN SET diffMs = 0 END IF
179:
180:   LET seconds = Math.floor(diffMs / 1000)
181:   LET minutes = Math.floor(seconds / 60)
182:   LET hours = Math.floor(minutes / 60)
183:   LET days = Math.floor(hours / 24)
184:   LET weeks = Math.floor(days / 7)
185:   LET months = Math.floor(days / 30)
186:   LET years = Math.floor(days / 365)
187:
188:   IF mode === 'short' THEN
189:     IF seconds < 60 THEN RETURN 'now' END IF
190:     IF minutes < 60 THEN RETURN minutes + 'm ago' END IF
191:     IF hours < 24 THEN RETURN hours + 'h ago' END IF
192:     IF days < 7 THEN RETURN days + 'd ago' END IF
193:     IF weeks < 4 THEN RETURN weeks + 'w ago' END IF
194:     IF months < 12 THEN RETURN months + 'mo ago' END IF
195:     RETURN years + 'y ago'
196:   END IF
197:
198:   // Long mode
199:   IF seconds < 60 THEN RETURN 'just now' END IF
200:   IF minutes === 1 THEN RETURN '1 minute ago' END IF
201:   IF minutes < 60 THEN RETURN minutes + ' minutes ago' END IF
202:   IF hours === 1 THEN RETURN '1 hour ago' END IF
203:   IF hours < 24 THEN RETURN hours + ' hours ago' END IF
204:   IF days === 1 THEN RETURN 'yesterday' END IF
205:   IF days < 7 THEN RETURN days + ' days ago' END IF
206:   IF weeks === 1 THEN RETURN '1 week ago' END IF
207:   IF weeks < 4 THEN RETURN weeks + ' weeks ago' END IF
208:   IF months === 1 THEN RETURN '1 month ago' END IF
209:   IF months < 12 THEN RETURN months + ' months ago' END IF
210:   IF years === 1 THEN RETURN '1 year ago' END IF
211:   RETURN years + ' years ago'
212: END FUNCTION
```

# Pseudocode: /continue Slash Command

## Interface Contracts

```typescript
// INPUTS
// args: string — Raw argument string from user
// ctx: CommandContext — Standard command context

// OUTPUTS
// SlashCommandActionReturn — One of:
//   OpenDialogActionReturn { type: 'dialog', dialog: 'sessionBrowser' }
//   PerformResumeActionReturn { type: 'perform_resume', sessionRef: string }  // NEW
//   MessageActionReturn { type: 'message', messageType: 'error' | 'info', content }
//
// NOTE: The command does NOT return LoadHistoryActionReturn directly.
// Instead, it returns PerformResumeActionReturn for the direct resume path.
// The slashCommandProcessor handles this action by:
// 1. Calling performResume() with RecordingSwapCallbacks from AppContainer refs
// 2. Converting the result to LoadHistoryActionReturn or MessageActionReturn

// DEPENDENCIES
// - SessionDiscovery from @vybestack/llxprt-code-core (for tab completion)
// - getProjectHash from @vybestack/llxprt-code-core
// - Config.isInteractive() from core

// CONTEXT ACCESS PATTERNS (actual CommandContext structure):
// - ctx.services.config?.getSessionId() — current session ID
// - ctx.services.config?.storage.getProjectTempDir() — derive chatsDir
// - ctx.services.config?.getProjectRoot() — for getProjectHash()
// - ctx.services.config?.isInteractive() — interactive mode check
// - ctx.recordingIntegration — recording integration instance (read-only)
//
// NOTE: isProcessing check is NOT needed. The slashCommandProcessor already
// blocks input during model processing. No other command checks isProcessing.
```

## Integration Points

```
Line 10: REGISTERED in BuiltinCommandLoader.registerBuiltinCommands()
         - Added to the commands array alongside chatCommand, statsCommand, etc.
         - kind: CommandKind.BUILT_IN (NOT Dialog — we handle dialog opening conditionally)

Line 30: RETURN PerformResumeActionReturn for direct resume path
         - slashCommandProcessor handles 'perform_resume' action type
         - Processor has access to AppContainer refs → can build RecordingSwapCallbacks
         - Processor calls performResume() and converts result to load_history or message

Line 50: RETURN OpenDialogActionReturn for browser path (no args)
         - DialogManager renders SessionBrowserDialog
         - slashCommandProcessor handles 'sessionBrowser' dialog type
         - Dialog's onSelect callback receives RecordingSwapCallbacks from AppContainer

Line 65: slashCommandProcessor handles PerformResumeActionReturn:
         - Calls performResume(ref, context) with callbacks from refs
         - On success: calls ui.loadHistory() and returns load_history action
         - On error: returns message action
         - Already handles IContent[] -> Content[] conversion

Line 70: CALL iContentToHistoryItems(result.history)
         - Converts IContent[] -> HistoryItemWithoutId[]
         - For UI display reconstruction
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Use CONTINUE_LATEST from sessionUtils for "latest"
[OK] DO: Pass "latest" string directly to performResume()

[ERROR] DO NOT: Use CommandKind.Dialog — that auto-opens dialog for ALL invocations
[OK] DO: Use CommandKind.BUILT_IN and conditionally return dialog/message/load_history

[ERROR] DO NOT: Handle recording swap in the command — that's performResume's job
[OK] DO: Call performResume and use its result

[ERROR] DO NOT: Render confirmation dialogs from the command
[OK] DO: For direct path (/continue <ref>), check hasActiveConversation and return error for non-interactive
```

## Command Definition

```
10: CONST continueCommand: SlashCommand = {
11:   name: 'resume',
12:   description: 'Browse and resume a previous session',
13:   kind: CommandKind.BUILT_IN,
14:   schema: continueSchema,
15:   action: resumeAction,
16: }
```

## Schema (for tab completion)

```
20: CONST continueSchema: CommandArgumentSchema = [
21:   {
22:     kind: 'value',
23:     name: 'session',
24:     description: 'Session ID, index, or "latest"',
25:     completer: ASYNC (ctx) => {
26:       // Derive chatsDir and projectHash from config
27:       LET config = ctx.services.config
28:       IF NOT config THEN RETURN [{ value: 'latest', description: 'Resume most recent session' }]
29:       LET chatsDir = join(config.storage.getProjectTempDir(), 'chats')
30:       LET projectHash = getProjectHash(config.getProjectRoot())
31:       LET sessions = AWAIT SessionDiscovery.listSessions(chatsDir, projectHash)
32:       LET completions = [
33:         { value: 'latest', description: 'Resume most recent session' },
34:       ]
35:       FOR EACH session IN sessions.slice(0, 10)  // Limit completions
36:         completions.push({
37:           value: session.sessionId,
38:           description: session.firstUserMessage ?? session.model
39:         })
40:       END FOR
41:       RETURN completions
42:     }
43:   }
44: ]
```

## Action Function

```
45: FUNCTION ASYNC resumeAction(ctx: CommandContext, args: string): SlashCommandActionReturn
46:   LET ref = args.trim()
47:   LET config = ctx.services.config
48:
49:   // Guard: config must exist
50:   IF NOT config THEN
51:     RETURN { type: 'message', messageType: 'error', content: 'Configuration not available.' }
52:   END IF
53:
54:   // NOTE: No isProcessing check needed here. The slashCommandProcessor already
55:   // blocks input during processing (isProcessing state in useSlashCommandProcessor hook).
56:   // No other command checks isProcessing, and we follow the same pattern.
57:
58:   // No args: Open browser dialog
61:   IF ref === '' THEN
62:     // Check: Non-interactive mode
63:     IF NOT config.isInteractive() THEN
64:       RETURN { type: 'message', messageType: 'error', content: 'Session browser requires interactive mode. Use /continue latest or /continue <id>.' }
65:     END IF
66:
67:     RETURN { type: 'dialog', dialog: 'sessionBrowser' }
68:   END IF
69:
70:   // Direct resume path: /continue latest, /continue <id>, /continue <number>
71:   // Derive session infrastructure from config
72:   LET chatsDir = join(config.storage.getProjectTempDir(), 'chats')
73:   LET projectHash = getProjectHash(config.getProjectRoot())
74:   LET currentSessionId = config.getSessionId()
75:
76:   // Check: Same session (only if not "latest" — latest is resolved by performResume)
77:   IF ref !== 'latest' AND (ref === currentSessionId OR currentSessionId.startsWith(ref)) THEN
78:     RETURN { type: 'message', messageType: 'error', content: 'That session is already active.' }
79:   END IF
80:
81:   // Check: Active conversation in non-interactive mode
82:   // NOTE: hasActiveConversation needs to be derived from geminiClient state or passed in context
83:   LET geminiClient = config.getGeminiClient()
84:   LET hasActiveConversation = geminiClient?.hasChatInitialized() AND geminiClient?.getChat()?.getHistory()?.length > 2
85:   IF hasActiveConversation AND NOT config.isInteractive() THEN
86:     RETURN { type: 'message', messageType: 'error', content: 'Cannot replace active conversation in non-interactive mode. Use --continue at startup instead.' }
87:   END IF
88:
89:   // NOTE: For interactive mode with active conversation, confirmation could use
90:   // ConfirmActionReturn similar to /chat delete. For MVP, proceed without confirmation
91:   // since the user explicitly typed /continue <ref>.
92:
93:   // Build resume context using actual config accessors
94:   // NOTE: For the direct resume path (/continue <ref>), we need RecordingSwapCallbacks.
95:   // These are NOT available in CommandContext directly. Two options:
96:   // (A) Return a 'resume_session' action type that slashCommandProcessor handles
97:   //     (processor has access to AppContainer's refs and can call performResume)
98:   // (B) Have continueCommand return { type: 'dialog', dialog: 'sessionBrowser', dialogData: { autoSelectRef: ref } }
99:   //     (browser dialog handles the resume via its onSelect callback)
100:  // 
101:  // Option B is cleaner: the dialog always handles the recording swap via its
102:  // onSelect callback, which receives callbacks from AppContainer. The direct
103:  // resume path just pre-selects the session in the browser.
104:  //
105:  // However, for /continue latest or /continue <ref>, we want to skip the UI entirely.
106:  // Therefore we need a new action type: 'perform_resume' which the processor handles.
107:  
108:  RETURN {
109:    type: 'perform_resume',
110:    sessionRef: ref,
111:    // The slashCommandProcessor will use its access to AppContainer refs
112:    // to call performResume() with the proper RecordingSwapCallbacks
113:  }
105:
106:  // Execute resume
107:  LET result = AWAIT performResume(ref, resumeContext)
108:
109:  IF NOT result.ok THEN
110:    RETURN { type: 'message', messageType: 'error', content: result.error }
111:  END IF
112:
113:  // Success: Convert IContent[] to UI history format
114:  LET uiHistory = iContentToHistoryItems(result.history)
115:
116:  // Client history is already IContent[] — convert to Content[] for LoadHistoryActionReturn
117:  LET clientHistory = result.history.map(convertIContentToContent)
118:
119:  // Warnings are returned in result.warnings — can be displayed after load
120:  // The slashCommandProcessor or caller can handle these
121:
122:  // Return LoadHistoryActionReturn
123:  RETURN {
124:    type: 'load_history',
125:    history: uiHistory,
126:    clientHistory: clientHistory
127:  }
128: END FUNCTION
```

## Registration in BuiltinCommandLoader

```
160: // In packages/cli/src/services/BuiltinCommandLoader.ts
161: // Add to the commands array:
162: IMPORT { continueCommand } from '../ui/commands/continueCommand.js'
163:
164: // In registerBuiltinCommands():
165: commands.push(continueCommand)
```

# Pseudocode: SessionBrowserDialog Component

## Interface Contracts

```typescript
// INPUTS (props)
interface SessionBrowserDialogProps {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  hasActiveConversation: boolean;
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  onClose: () => void;
}

// OUTPUTS
// Renders a React/Ink component tree

// DEPENDENCIES (real, imported)
// - useSessionBrowser hook (from ./hooks/useSessionBrowser)
// - useKeypress from Ink
// - useResponsive from ./hooks/useResponsive
// - SemanticColors from ./colors
// - Box, Text from Ink
```

## Integration Points

```
Line 10: USE useSessionBrowser(props) for all state/callbacks
         - Hook manages sessions, search, sort, pagination, selection

Line 20: USE useKeypress(handleKeypress)
         - Delegates ALL keyboard handling to hook's handleKeypress

Line 30: USE useResponsive() for isNarrow
         - Single breakpoint: wide vs narrow
         - All layout changes happen simultaneously

Line 40: RENDER within DialogManager component tree
         - Parent passes onSelect that calls performResume()
         - Parent passes onClose that clears UIState flag
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Handle keyboard events directly in component
[OK] DO: Delegate all keypress handling to useSessionBrowser hook

[ERROR] DO NOT: Call resumeSession directly from this component
[OK] DO: Call onSelect prop which returns Promise<PerformResumeResult>

[ERROR] DO NOT: Use hardcoded column thresholds for narrow mode
[OK] DO: Use useResponsive().isNarrow boolean

[ERROR] DO NOT: Render active-conversation confirmation via ConsentPrompt
[OK] DO: Render confirmation inline within the browser dialog
```

## Component Structure

```
10: FUNCTION SessionBrowserDialog(props: SessionBrowserDialogProps): ReactElement
11:   LET { isNarrow } = useResponsive()
12:   LET browser = useSessionBrowser({
13:     chatsDir: props.chatsDir,
14:     projectHash: props.projectHash,
15:     currentSessionId: props.currentSessionId,
16:     hasActiveConversation: props.hasActiveConversation,
17:     onSelect: props.onSelect,
18:     onClose: props.onClose
19:   })
20:
21:   useKeypress(browser.handleKeypress)
```

## Loading State Rendering

```
25: IF browser.isLoading THEN
26:   RETURN (
27:     <Box borderStyle={isNarrow ? undefined : 'round'} flexDirection="column" padding={1}>
28:       <Text bold color={SemanticColors.text.primary}>
29:         {isNarrow ? 'Sessions' : 'Session Browser'}
30:       </Text>
31:       <Text color={SemanticColors.text.secondary}>Loading sessions...</Text>
32:     </Box>
33:   )
34: END IF
```

## Empty State Rendering

```
38: IF browser.filteredSessions.length === 0 AND browser.searchTerm === '' THEN
39:   RETURN (
40:     <Box borderStyle={isNarrow ? undefined : 'round'} flexDirection="column" padding={1}>
41:       <Text>No sessions found for this project.</Text>
42:       <Text color={SemanticColors.text.secondary}>
43:         Sessions are created automatically when you start a conversation.
44:       </Text>
45:       <Text color={SemanticColors.text.secondary}>Press Esc to close</Text>
46:     </Box>
47:   )
48: END IF
```

## No Search Results Rendering

```
52: IF browser.filteredSessions.length === 0 AND browser.searchTerm !== '' THEN
53:   RENDER search bar (unchanged)
54:   <Text>No sessions match "{browser.searchTerm}"</Text>
55:   <Text color={SemanticColors.text.secondary}>Esc Close</Text>
56: END IF
```

## Main Layout (Wide Mode)

```
60: RETURN (
61:   <Box borderStyle="round" flexDirection="column" padding={1}>
62:     {/* Title */}
63:     <Text bold color={SemanticColors.text.primary}>Session Browser</Text>
64:
65:     {/* Search Bar */}
66:     <Box>
67:       <Text>Search: </Text>
68:       <Text color={SemanticColors.text.accent}>▌</Text>
69:       <Text color={SemanticColors.text.primary}>{browser.searchTerm}</Text>
70:       <Box flexGrow={1} />
71:       <Text color={SemanticColors.text.secondary}>
72:         {browser.isSearching ? '(Tab to navigate)' : '(Tab to search)'}
73:       </Text>
74:       <Text color={SemanticColors.text.secondary}>
75:         {' '}{browser.filteredSessions.length} session{browser.filteredSessions.length !== 1 ? 's' : ''} found
76:       </Text>
77:     </Box>
78:
79:     {/* Sort Bar (wide only) */}
80:     <Box>
81:       <Text>Sort: </Text>
82:       {SORT_OPTIONS.map(opt => (
83:         <Text
84:           key={opt}
85:           color={browser.sortOrder === opt ? SemanticColors.text.accent : SemanticColors.text.secondary}
86:         >
87:           {browser.sortOrder === opt ? `[${opt}]` : opt}
88:           {'  '}
89:         </Text>
90:       ))}
91:       <Text color={SemanticColors.text.secondary}>(press s to cycle)</Text>
92:     </Box>
93:
94:     {/* Skipped Notice */}
95:     {browser.skippedCount > 0 && (
96:       <Text color={SemanticColors.status.warning}>
97:         Skipped {browser.skippedCount} unreadable session(s).
98:       </Text>
99:     )}
100:
101:    {/* Session List */}
102:    {browser.visibleSessions.map((session, i) => (
103:      <SessionRow
104:        key={session.sessionId}
105:        session={session}
106:        index={browser.page * PAGE_SIZE + i + 1}
107:        isSelected={i === browser.selectedIndex}
108:        isNarrow={false}
109:        deleteConfirm={browser.deleteConfirmIndex === i}
110:      />
111:    ))}
112:
113:    {/* Page Indicator */}
114:    {browser.totalPages > 1 && (
115:      <Text color={SemanticColors.text.secondary}>
116:        Page {browser.page + 1} of {browser.totalPages}
117:        {'  '}PgUp/PgDn to page
118:      </Text>
119:    )}
120:
121:    {/* Error Message */}
122:    {browser.error && (
123:      <Text color={SemanticColors.status.error}>Error: {browser.error}</Text>
124:    )}
125:
126:    {/* Resume Status */}
127:    {browser.isResuming && (
128:      <Text color={SemanticColors.text.secondary}>Resuming...</Text>
129:    )}
130:
131:    {/* Active Conversation Confirmation */}
132:    {browser.activeConversationConfirm && (
133:      <Box borderStyle="round" flexDirection="column" paddingX={1}>
134:        <Text>Resuming will replace the current conversation. Continue?</Text>
135:        <Text>[Y] Yes  [N] No</Text>
136:      </Box>
137:    )}
138:
139:    {/* Separator */}
140:    <Text>{'─'.repeat(70)}</Text>
141:
142:    {/* Selection Detail */}
143:    {browser.filteredSessions.length > 0 && browser.selectedSession && (
144:      <Text color={SemanticColors.text.secondary}>
145:        Selected: {browser.selectedSession.sessionId}
146:        {' '}({browser.selectedSession.provider} / {browser.selectedSession.model},
147:        {' '}{formatRelativeTime(browser.selectedSession.lastModified)})
148:      </Text>
149:    )}
150:
151:    {/* Controls Bar */}
152:    <ControlsBar
153:      hasItems={browser.filteredSessions.length > 0}
154:      isSearching={browser.isSearching}
155:      isNarrow={false}
156:      sortOrder={browser.sortOrder}
157:    />
158:  </Box>
159: )
```

## Main Layout (Narrow Mode)

```
165: // When isNarrow === true:
166: RETURN (
167:   <Box flexDirection="column">  {/* No border in narrow mode */}
168:     <Text bold color={SemanticColors.text.primary}>Sessions</Text>
169:
170:     {/* Search Bar (compact) */}
171:     <Box>
172:       <Text>Search: </Text>
173:       <Text color={SemanticColors.text.accent}>▌</Text>
174:       <Text>{browser.searchTerm}</Text>
175:     </Box>
176:     <Text color={SemanticColors.text.secondary}>
177:       {browser.filteredSessions.length} session{browser.filteredSessions.length !== 1 ? 's' : ''} found
178:     </Text>
179:
180:     {/* NO Sort Bar in narrow mode */}
181:
182:     {/* Session List (compact rows) */}
183:     {browser.visibleSessions.map((session, i) => (
184:       <SessionRowNarrow
185:         key={session.sessionId}
186:         session={session}
187:         isSelected={i === browser.selectedIndex}
188:         deleteConfirm={browser.deleteConfirmIndex === i}
189:       />
190:     ))}
191:
192:     {/* Controls Bar (abbreviated) */}
193:     <Text color={SemanticColors.text.secondary}>
194:       ↑↓ Nav  Enter Resume  Del Delete  s:{browser.sortOrder}  Esc Close
195:     </Text>
196:   </Box>
197: )
```

## SessionRow Subcomponent (Wide)

```
205: FUNCTION SessionRow({ session, index, isSelected, isNarrow, deleteConfirm })
206:   LET bullet = isSelected ? '●' : '○'
207:   LET bulletColor = isSelected ? SemanticColors.text.accent : SemanticColors.text.primary
208:
209:   RETURN (
210:     <Box flexDirection="column">
211:       {/* Line 1: Metadata */}
212:       <Box>
213:         <Text color={bulletColor}>{bullet}</Text>
214:         <Text color={SemanticColors.text.secondary}> #{index}  </Text>
215:         <Text color={SemanticColors.text.primary}>
216:           {formatRelativeTime(session.lastModified)}
217:         </Text>
218:         <Text color={SemanticColors.text.secondary}>
219:           {'    '}{session.provider} / {session.model}
220:         </Text>
221:         {session.isLocked && (
222:           <Text color={SemanticColors.status.warning}> (in use)</Text>
223:         )}
224:         <Box flexGrow={1} />
225:         <Text color={SemanticColors.text.secondary}>
226:           {formatFileSize(session.fileSize)}
227:         </Text>
228:       </Box>
229:
230:       {/* Line 2: Preview */}
231:       <Box paddingLeft={7}>
232:         {session.previewState === 'loading' && (
233:           <Text color={SemanticColors.text.secondary}>Loading...</Text>
234:         )}
235:         {session.previewState === 'loaded' && (
236:           <Text color={SemanticColors.text.secondary}>
237:             "{session.firstUserMessage}"
238:           </Text>
239:         )}
240:         {session.previewState === 'none' && (
241:           <Text color={SemanticColors.text.secondary} italic>
242:             (no user message)
243:           </Text>
244:         )}
245:         {session.previewState === 'error' && (
246:           <Text color={SemanticColors.text.secondary} italic>
247:             (preview unavailable)
248:           </Text>
249:         )}
250:       </Box>
251:
252:       {/* Inline Delete Confirmation */}
253:       {deleteConfirm && (
254:         <Box borderStyle="round" marginLeft={4} paddingX={1}>
255:           <Text>Delete "{session.firstUserMessage ?? 'session'}" ({formatRelativeTime(session.lastModified)})?</Text>
256:           <Text> [Y] Yes  [N] No  [Esc] Cancel</Text>
257:         </Box>
258:       )}
259:     </Box>
260:   )
261: END FUNCTION
```

## SessionRowNarrow Subcomponent

```
268: FUNCTION SessionRowNarrow({ session, isSelected, deleteConfirm })
269:   LET bullet = isSelected ? '●' : '○'
270:   LET bulletColor = isSelected ? SemanticColors.text.accent : SemanticColors.text.primary
271:
272:   // Truncation rules for narrow mode
273:   LET model = truncate(session.model, 20)
274:   LET preview = truncatePreview(session.firstUserMessage, 30)
275:   LET relTime = formatRelativeTimeShort(session.lastModified)
276:   LET shortId = isSelected ? session.sessionId.substring(0, 8) : null
277:
278:   RETURN (
279:     <Box flexDirection="column">
280:       <Box>
281:         <Text color={bulletColor}>{bullet} </Text>
282:         <Text color={SemanticColors.text.primary}>{relTime}</Text>
283:         <Text color={SemanticColors.text.secondary}>{'   '}{model}</Text>
284:         {session.isLocked && (
285:           <Text color={SemanticColors.status.warning}> (in use)</Text>
286:         )}
287:         {shortId && (
288:           <Box flexGrow={1} />
289:           <Text color={SemanticColors.text.secondary}>{shortId}</Text>
290:         )}
291:       </Box>
292:       <Box paddingLeft={2}>
293:         <Text color={SemanticColors.text.secondary}>"{preview}"</Text>
294:       </Box>
295:     </Box>
296:   )
297: END FUNCTION
```

## ControlsBar Subcomponent

```
305: FUNCTION ControlsBar({ hasItems, isSearching, isNarrow, sortOrder })
306:   IF NOT hasItems THEN
307:     RETURN <Text color={SemanticColors.text.secondary}>Esc Close</Text>
308:   END IF
309:
310:   IF isNarrow THEN
311:     RETURN (
312:       <Text color={SemanticColors.text.secondary}>
313:         ↑↓ Nav  Enter Resume  Del Delete  s:{sortOrder}  Esc Close
314:       </Text>
315:     )
316:   END IF
317:
318:   RETURN (
319:     <Text color={SemanticColors.text.secondary}>
320:       ↑↓ Navigate  Enter Resume  Del Delete  s Sort  Tab Search/Nav  Esc Close
321:     </Text>
322:   )
323: END FUNCTION
```

## Helper Functions

```
330: FUNCTION formatFileSize(bytes: number): string
331:   IF bytes < 1024 THEN RETURN bytes + 'B' END IF
332:   IF bytes < 1024 * 1024 THEN RETURN (bytes / 1024).toFixed(1) + 'KB' END IF
333:   RETURN (bytes / (1024 * 1024)).toFixed(1) + 'MB'
334: END FUNCTION
335:
336: FUNCTION truncate(text: string, maxLen: number): string
337:   IF text.length <= maxLen THEN RETURN text END IF
338:   RETURN text.substring(0, maxLen - 3) + '...'
339: END FUNCTION
```

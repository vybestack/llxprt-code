# SubagentCommand Pseudocode

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG.P02
**Component**: SubagentCommand
**Requirements**: REQ-003 through REQ-009, REQ-011, REQ-014, REQ-015
**Pattern Reference**: profileCommand.ts, chatCommand.ts

---

## Argument Parsing for Save Command

1. FUNCTION parseSaveArgs(args: string): { name: string, profile: string, mode: 'auto' | 'manual', input: string } | null
2.   // @requirement:REQ-011
3.   
4.   // Match the complex argument structure
5.   // Expected: <name> <profile> auto|manual "<quoted_input>"
6.   // This regex first splits on unescaped quotes, then validates the first three space-separated parts.
7.   // It is robust against extra spaces.
8.   match = args.match(/^(\S+)\s+(\S+)\s+(auto|manual)\s+"((?:[^"\\]|\\.)*)(\\"?)?/)
9.   
10.  IF NOT match THEN
11.    RETURN null
12.  END IF
13.  
14.  [, name, profile, mode, input] = match
15.  
16.  RETURN { name, profile, mode, input }
17. END FUNCTION

---

## saveCommand - Auto Mode Logic

18. ASYNC FUNCTION handleAutoMode(context: CommandContext, name: string, profile: string, description: string): Promise<SlashCommandActionReturn>
19.   // @requirement:REQ-003
20.   
21.   // Get LLM client from services
22.   client = context.services.config?.getGeminiClient()
23.   
24.   // Validate client is available
25.   IF NOT client OR NOT client.hasChatInitialized() THEN
26.     RETURN {
27.       type: 'message',
28.       messageType: 'error',
29.       content: 'Error: Chat not initialized. Set up the CLI or try manual mode.'
30.     }
31.   END IF
32.  
33.  chat = client.getChat()
34.  
35.  // Construct the prompt for the LLM
36.  autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:

${description}

Requirements:
- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior
- Be specific and actionable
- Use clear, professional language
- Output ONLY the system prompt text, no explanations or metadata`
37.
38.  TRY
39.    // Send message to LLM
40.    response = AWAIT chat.sendMessage({ message: autoModePrompt })
41.    
42.    // Extract generated prompt
43.    systemPrompt = response.text()
44.    
45.    // Validate non-empty response
46.    IF NOT systemPrompt OR systemPrompt.trim() === '' THEN
47.      THROW Error('Model returned empty prompt. Try manual mode.')
48.    END IF
49.    
50.  CATCH error
51.    RETURN {
52.      type: 'message',
53.      messageType: 'error',
54.      content: 'Error: Failed to generate system prompt. Check your connection or try manual mode.'
55.    }
56.  END TRY
57.  
58.  // Delegate to saveSubagent logic (pseudocode lines 61-128 in SubagentManager.md cover this)
59.  RETURN AWAIT saveSubagent(context, name, profile, systemPrompt)
60. END FUNCTION

---

## saveCommand - Manual Mode Logic

61. ASYNC FUNCTION handleManualMode(context: CommandContext, name: string, profile: string, systemPrompt: string): Promise<SlashCommandActionReturn>
62.   // @requirement:REQ-004
63.   
64.   // Delegate to saveSubagent logic
65.   RETURN AWAIT saveSubagent(context, name, profile, systemPrompt)
66. END FUNCTION

---

## Shared Save Subagent Logic (Helper)

67. ASYNC FUNCTION saveSubagent(context: CommandContext, name: string, profile: string, systemPrompt: string): Promise<SlashCommandActionReturn>
68.  // @requirement:REQ-002, REQ-004, REQ-014
69.  
70.  manager = context.services.subagentManager
71.  IF NOT manager THEN
72.    RETURN {
73.      type: 'message',
74.      messageType: 'error',
75.      content: 'Service not available. Run system integration (Phase 15).'
76.    }
77.  END IF
78.  
79.  TRY
80.    AWAIT manager.saveSubagent(name, profile, systemPrompt)
81.    RETURN {
82.      type: 'message',
83.      messageType: 'info',
84.      content: `Successfully created/updated subagent '${name}'.`
85.    }
86.  CATCH error
87.    RETURN {
88.      type: 'message',
89.      messageType: 'error',
90.      content: error.message
91.    }
92.  END TRY
93. END FUNCTION

---

## saveCommand - Overwrite Confirmation Logic

94. ASYNC FUNCTION handleSaveCommand(context: CommandContext, args: string) : Promise<SlashCommandActionReturn>
95.   // @requirement:REQ-014
96.   
97.   // Parse arguments
98.   parsedArgs = parseSaveArgs(args)
99.   
100.  IF NOT parsedArgs THEN
101.    RETURN {
102.      type: 'message',
103.      messageType: 'error',
104.      content: 'Usage: /subagent save <name> <profile> auto|manual "<input>"'
105.    }
106.  END IF
107. 
108. { name, profile, mode, input } = parsedArgs
109. 
110. // Check for overwrite confirmation if subagent exists
111. manager = context.services.subagentManager
112. IF manager THEN
113.   exists = AWAIT manager.subagentExists(name)
114. ELSE
115.   exists = false
116. END IF
117. 
118. IF exists AND NOT context.overwriteConfirmed THEN
119.   RETURN {
120.     type: 'confirm_action',
121.     content: `A subagent named '${name}' already exists. Do you want to overwrite it?`,
122.     confirmAction: {
123.       originalInvocation: context.invocation?.raw || ''
124.     }
125.   }
126. END IF
127. 
128. // Dispatch to correct mode handler
129. IF mode == 'auto' THEN
130.   RETURN AWAIT handleAutoMode(context, name, profile, input)
131. ELSE
132.   RETURN AWAIT handleManualMode(context, name, profile, input)
133. END IF
134. END FUNCTION

---

## listCommand Logic

135. ASYNC FUNCTION handleListCommand(context: CommandContext, args: string): Promise<SlashCommandActionReturn>
136.   // @requirement:REQ-005
137.   
138.   manager = context.services.subagentManager
139.   IF NOT manager THEN
140.     RETURN {
141.       type: 'message',
142.       messageType: 'error',
143.       content: 'Service not available. Run system integration (Phase 15).'
144.     }
145.   END IF
146.   
147.   TRY
148.     // Get list of agent names
149.     names = AWAIT manager.listSubagents()
150.     
151.     IF names.length == 0 THEN
152.       RETURN {
153.         type: 'message',
154.         messageType: 'info',
155.         content: "No subagents found. Use '/subagent save' to create one."
156.       }
157.     END IF
158.     
159.     // Load and format details for each
160.     lines = ["List of saved subagents:\n"]
161.     FOR name in names DO
162.       config = AWAIT manager.loadSubagent(name)
163.       IF config THEN
164.         createdDate = new Date(config.createdAt).toLocaleString()
165.         lines.push(`  - ${config.name} (profile: ${config.profile}, created: ${createdDate})`)
166.       END IF
167.     END FOR
168.     lines.push("\nNote: Use '/subagent show <name>' to view full configuration.")
169.     
170.     RETURN {
171.       type: 'message',
172.       messageType: 'info',
173.       content: lines.join('\n')
174.     }
175.   CATCH error
176.     RETURN {
177.       type: 'message',
178.       messageType: 'error',
179.       content: error.message
180.     }
181.   END TRY
182. END FUNCTION

---

## showCommand Logic

183. ASYNC FUNCTION handleShowCommand(context: CommandContext, args: string): Promise<SlashCommandActionReturn>
184.   // @requirement:REQ-006
185.   
186.   name = args.trim()
187.   
188.   IF name === '' THEN
189.     RETURN {
190.       type: 'message',
191.       messageType: 'error',
192.       content: 'Usage: /subagent show <name>'
193.     }
194.   END IF
195.   
196.   manager = context.services.subagentManager
197.   IF NOT manager THEN
198.     RETURN {
199.       type: 'message',
200.       messageType: 'error',
201.       content: 'Service not available. Run system integration (Phase 15).'
202.     }
203.   END IF
204.   
205.   TRY
206.     // Load the subagent config
207.     config = AWAIT manager.loadSubagent(name)
208.     
209.     // Format the output
210.     createdDate = new Date(config.createdAt).toLocaleString()
211.     updatedDate = new Date(config.updatedAt).toLocaleString()
212.     separator = '-'.repeat(60)
213.     
214.     output = [
215.       `Subagent Name: ${config.name}`,
216.       `Profile: ${config.profile}`,
217.       `Created: ${createdDate}`,
218.       `Updated: ${updatedDate}\n`,
219.       'System Prompt:', separator, config.systemPrompt, separator
220.     ].join('\n')
221.
222.    RETURN {
223.      type: 'message',
224.      messageType: 'info',
225.      content: output
226.    }
227.  CATCH error
228.    RETURN {
229.      type: 'message',
230.      messageType: 'error',
231.      content: error.message
232.    }
233.  END TRY
234. END FUNCTION

---

## deleteCommand Logic

235. ASYNC FUNCTION handleDeleteCommand(context: CommandContext, args: string): Promise<SlashCommandActionReturn>
236.   // @requirement:REQ-007
237.   
238.   name = args.trim()
239.   
240.   IF name === '' THEN
241.     RETURN {
242.       type: 'message',
243.       messageType: 'error',
244.       content: 'Usage: /subagent delete <name>'
245.     }
246.   END IF
247.   
248.   manager = context.services.subagentManager
249.   IF NOT manager THEN
250.     RETURN {
251.       type: 'message',
252.       messageType: 'error',
253.       content: 'Service not available. Run system integration (Phase 15).'
254.     }
255.   END IF
256.   
257.   TRY
258.     // Check if subagent exists using SubagentManager
259.     exists = AWAIT manager.subagentExists(name)
260.     
261.     IF NOT exists THEN
262.       THROW Error(`Subagent '${name}' not found.`)
263.     END IF
264.     
265.     // Prompt for confirmation if not already given
266.     IF NOT context.overwriteConfirmed THEN
267.       RETURN {
268.         type: 'confirm_action',
269.         content: `Are you sure you want to delete subagent '${name}'? This action cannot be undone.`,
270.         confirmAction: {
271.           originalInvocation: context.invocation?.raw || ''
272.         }
273.       }
274.     END IF
275.     
276.     // Delete the subagent
277.     AWAIT manager.deleteSubagent(name)
278.     
279.     RETURN {
280.       type: 'message',
281.       messageType: 'info',
282.       content: `Successfully deleted subagent '${name}'.`
283.     }
284.   CATCH error
285.     RETURN {
286.       type: 'message',
287.       messageType: 'error',
288.       content: error.message
289.     }
290.   END TRY
291. END FUNCTION

---

## editCommand Logic - Core Implementation

292. ASYNC FUNCTION handleEditCommand(context: CommandContext, args: string): Promise<SlashCommandActionReturn>
293.   // @requirement:REQ-008
294.   
295.   manager = context.services.subagentManager
296.   IF NOT manager THEN
297.     RETURN {
298.       type: 'message',
299.       messageType: 'error',
300.       content: 'Service not available. Run system integration (Phase 15).'
301.     }
302.   END IF
303.   
304.   name = args.trim()
305.   
306.   IF name === '' THEN
307.     RETURN {
308.       type: 'message',
309.       messageType: 'error',
310.       content: 'Usage: /subagent edit <name>'
311.     }
312.   END IF
313.   
314.   TRY
315.     // Check if subagent exists and load config (pseudocode lines 129-180 cover this)
316.     exists = AWAIT manager.subagentExists(name)
317.     
318.     IF NOT exists THEN
319.       THROW Error(`Subagent '${name}' not found.`)
320.     END IF
321.     
322.     config = AWAIT manager.loadSubagent(name)
323.     
324.     // Use system editor (pattern from text-buffer.ts)
325.     // This will be a blocking call until the editor closes
326.     editedContent = AWAIT openInExternalEditor(config)
327.     
328.     // Validate edited JSON (pseudocode line 149-159 cover this)
329.     TRY
330.       editedConfig = JSON.parse(editedContent)
331.     CATCH parseError
332.       THROW Error('Invalid JSON after editing. Changes not saved.')
333.     END TRY
334.     
335.     // Validate required fields (pseudocode line 160-167 cover this)
336.     IF NOT editedConfig.name OR NOT editedConfig.profile OR NOT editedConfig.systemPrompt THEN
337.       THROW Error('Required fields missing. Changes not saved.')
338.     END IF
339.     
340.     // Validate the profile reference (pseudocode lines 263-281 cover this)
341.     profileExists = AWAIT manager.validateProfileReference(editedConfig.profile)
342.     IF NOT profileExists THEN
343.       THROW Error(`Profile '${editedConfig.profile}' not found. Changes not saved.`)
344.     END IF
345.     
346.     // Save the new config (updating the timestamp) (pseudocode lines 61-128 cover this)
347.     AWAIT manager.saveSubagent(editedConfig.name, editedConfig.profile, editedConfig.systemPrompt)
348.     
349.     RETURN {
350.       type: 'message',
351.       messageType: 'info',
352.       content: `Successfully updated subagent '${name}'.`
353.     }
354.   CATCH error
355.     RETURN {
356.       type: 'message',
357.       messageType: 'error',
358.       content: error.message
359.     }
360.   END TRY
361. END FUNCTION

---

## openInExternalEditor Helper (text-buffer.ts Pattern)

362. ASYNC FUNCTION openInExternalEditor(config: SubagentConfig): Promise<string>
363.   // @requirement:REQ-008
364.   // Pattern Reference: project-plans/subagentconfig/analysis/findings.md, lines 109-141
365.   
366.   // Import required modules
367.   IMPORT * as fs from 'fs' // Use sync versions for spawnSync pattern
368.   IMPORT * as os from 'os'
369.   IMPORT * as path from 'path'
370.   IMPORT { spawnSync } from 'child_process'
371.   
372.   // Serialize the config to a string for editing
373.   textContent = JSON.stringify(config, null, 2)
374.   
375.   // Create a temporary directory and file
376.   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-edit-'))
377.   filePath = path.join(tmpDir, `${config.name}.json`)
378.   
379.   TRY
380.     // Write the current config to the temp file
381.     fs.writeFileSync(filePath, textContent, 'utf8')
382.     
383.     // Determine the editor command from environment variables
384.     editorCmd = process.env.VISUAL OR process.env.EDITOR OR (process.platform === 'win32' ? 'notepad' : 'vi')
385.     
386.     // Launch the editor synchronously (BLOCKING)
387.     result = spawnSync(editorCmd, [filePath], { stdio: 'inherit' })
388.     
389.     // Check for errors from spawnSync
390.     IF result.error THEN
391.       THROW result.error
392.     END IF
393.     
394.     IF typeof result.status IS number AND result.status !== 0 THEN
395.       THROW NEW Error(`Editor exited with status ${result.status}`)
396.     END IF
397.     
398.     // Read the potentially modified content
399.     editedContent = fs.readFileSync(filePath, 'utf8')
400.     editedContent = editedContent.replace(/\r\n?/g, '\n') // Normalize line endings
401.     
402.     RETURN editedContent
403.     
404.   FINALLY
405.     // Cleanup: Always try to remove the temp file and directory
406.     TRY fs.unlinkSync(filePath) CATCH // ignore
407.     TRY fs.rmdirSync(tmpDir) CATCH // ignore
408.   END TRY
409. END FUNCTION

---

## Multi-Level Completion Logic (Corrected Again)

410. // File: packages/cli/src/ui/commands/subagentCommand.ts
411. // Lines: X-X (in the actual implementation file)
412. // @requirement:REQ-009
413.
414. ASYNC FUNCTION completion(context: CommandContext, partialArg: string) : Promise<string[]>
415.   // @requirement:REQ-009
416.   // Pattern Reference: findings.md Lines 326-347 show a similar, achievable pattern.
417.   // The logic uses context to provide context-aware multi-level suggestions.
418.   // partialArg: The literal fragment currently being completed (e.g. "s", "my_a", "").
419.   // context.invocation.args: The TRIMMED arguments passed so far (e.g., "save", "save myagent").
420.   // context.invocation.raw: The full TRIMMED command line (e.g., "/subagent", "/subagent save").
421.   
422.   manager = context.services.subagentManager
423.   IF NOT manager THEN
424.     RETURN []
425.   END IF
426.   
427.   // Get the available agents and profiles for completion suggestions.
428.   // These calls might be expensive but are necessary for the feature.
429.   subagentNames = AWAIT manager.listSubagents()
430.   
431.   // Create a local ProfileManager instance for listing profiles, consistent with other commands.
432.   localProfileManager = NEW ProfileManager()
433.   profileNames = AWAIT localProfileManager.listProfiles()
434.   
435.   subcommands = ['save', 'list', 'show', 'delete', 'edit']
436. 
437.   // The key to correct completion is understanding the cursor's relative position.
438.   // Since context.invocation.args is trimmed, we must rely on the TOKEN COUNT
439.   // and the STATE OF partialArg to determine the argument slot.
440.   argsTypedSoFar = context.invocation.args
441.   
442.   // Split them into an array of tokens. A helper function handles quoted strings.
443.   argTokens = complexParse(argsTypedSoFar)
444.   
445.   // --- Completion Logic ---
446.   //
447.   // A helper function calculates the correct slot index for completion.
448.   // This is crucial because argTokens.length alone is ambiguous.
449.   // We need to know if we are completing the last token in the array (token under construction)
450.   // or entering a new blank token.
451.   argPosition = getCompletionArgPosition(argTokens, partialArg)
452.   
453.   // First, handle the case where we are at the very first token, the subcommand itself.
454.   // This is true if raw command is just "/subagent".
455.   IF context.invocation.raw.trim() === "/subagent" THEN
456.     RETURN subcommands.filter(cmd => cmd.startsWith(partialArg))
457.   END IF
458.   
459.   // Dispatch logic based on the main subcommand.
460.   mainCommand = argTokens[0]
461.   
462.   SWITCH mainCommand DO
463.   CASE 'list':
464.     // No sub-arguments for list. No suggestions.
465.     RETURN []
466.   CASE 'show', 'delete', 'edit':
467.     // For these commands, the first and only argument is a subagent name.
468.     CASE_ARG_POSITION: argPosition
469.     WHEN 1: // Completing the first/only argument
470.       RETURN subagentNames.filter(name => name.startsWith(partialArg))
471.     DEFAULT:
472.       RETURN [] // No suggestions for other positions
473.   CASE 'save':
474.     // For save, logic is based on the argument slot index BEING COMPLETED.
475.     CASE_ARG_POSITION: argPosition
476.     
477.     WHEN 1: // Completing the 1st argument slot (subagent name)
478.       RETURN subagentNames.filter(name => name.startsWith(partialArg))
479.     
480.     WHEN 2: // Completing the 2nd argument slot (profile name)
481.       RETURN profileNames.filter(name => name.startsWith(partialArg))
482.     
483.     WHEN 3: // Completing the 3rd argument slot (mode)
484.       RETURN ['auto', 'manual'].filter(mode => mode.startsWith(partialArg))
485.     
486.     DEFAULT: // All other slots (e.g. prompt text), no completion
487.       RETURN []
488.   DEFAULT: // If the main command is not a recognized subcommand.
489.     // Suggest subcommands for the main command token.
490.     RETURN subcommands.filter(cmd => cmd.startsWith(partialArg))
491.   END SWITCH
492. END FUNCTION

---

## Helper for Determining Completion Slot Index

493. // Helper: getCompletionArgPosition
494. // Calculates the 1-based index of the argument slot being completed.
495. // This correctly accounts for whether the user is typing a new argument or completing an existing one.
496. // E.g.:
497. // - "/subagent save",      partialArg=""       -> 1 (save command itself)
498. // - "/subagent save foo",  partialArg="foo"    -> 1 (still completing 'foo')
499. // - "/subagent save foo",  partialArg=""       -> 2 (cursor is after 'foo', want to complete 'profile')
500. // - "/subagent save foo ", partialArg=""       -> 2 (cursor is at start of 2nd arg slot)
501. // - "/subagent save foo p",partialArg="p"      -> 2 (still completing 'p' in 2nd slot)
502. // - "/subagent save foo p",partialArg=""       -> 3 (cursor is after 'p', want to complete 'mode')
503. FUNCTION getCompletionArgPosition(argTokens: string[], partialArg: string): number
504.   IF partialArg === "" THEN
505.     // If partialArg is empty, the user is either at the very beginning of the first slot,
506.     // or at the beginning of a new slot after completing the previous one.
507.     // In this case, the slot index they are working on is the length of the tokens.
508.     // E.g., ['save', 'foo'] (len=2) and partialArg="" means they are at slot 2 (profile).
509.     RETURN argTokens.length
510.   ELSE
511.     // If partialArg has content, it means they are actively typing into the last known token.
512.     // The slot index they are working on is one less than the token length.
513.     // E.g., ['save', 'foo'] (len=2) and partialArg="fo" means they are still completing slot 1 (name).
514.     RETURN argTokens.length - 1
515.   END IF
516. END FUNCTION

---

## Helper for Complex Argument Parsing (Needed for Completion)

517. FUNCTION complexParse(input: string): string[]
518.   // @requirement:REQ-009
519.   // Handles arguments that might be quoted, allowing spaces within quotes.
520.   // E.g., "save myagent myprofile manual \"a prompt\"" -> ['save', 'myagent', 'myprofile', 'manual', 'a prompt']
521.   
522.   // This is a simplified example. A robust implementation would be more complex.
523.   // It correctly parses quoted strings and splits the non-quoted parts.
524.   // It is crucial for accurate multi-level completion.
525.   
526.   tokens = []
527.   currentToken = []
528.   isInQuotes = false
529.   escapedQuotePending = false
530.   
531.   FOR char in (input) DO
532.     IF escapedQuotePending THEN
533.       currentToken.push(char)
534.       escapedQuotePending = false
535.       CONTINUE
536.     END IF
537.     
538.     IF char == '\\' AND isInQuotes THEN
539.       escapedQuotePending = true
540.       CONTINUE
541.     END IF
542.     
543.     IF char == '"' THEN
544.       isInQuotes = NOT isInQuotes
545.       CONTINUE
546.     END IF
547.     
548.     IF char == ' ' AND NOT isInQuotes THEN
549.       IF currentToken.length > 0 THEN
550.         tokens.push(currentToken.join(''))
551.         currentToken = []
552.       END IF
553.       CONTINUE
554.     END IF
555.     
556.     currentToken.push(char)
557.   END FOR
558.   
559.   // Add the last token if it exists
560.   IF currentToken.length > 0 THEN
561.    tokens.push(currentToken.join(''))
562.   END IF
563.   
564.   RETURN tokens
565. END FUNCTION
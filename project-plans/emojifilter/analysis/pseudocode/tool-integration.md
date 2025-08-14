# Pseudocode: Tool Integration

```
01: MODULE ToolIntegration
02:
03: METHOD integrateWithToolExecutor(executor: NonInteractiveToolExecutor): void
04:   SET config = executor.config
05:   SET emojiFilter = null
06:   
07:   FUNCTION getOrCreateFilter(): EmojiFilter
08:     IF emojiFilter === null
09:       SET mode = getEmojiFilterMode(config)
10:       SET filterConfig = { mode: mode }
11:       SET emojiFilter = new EmojiFilter(filterConfig)
12:     END IF
13:     RETURN emojiFilter
14:   END FUNCTION
15:   
16:   // Modify executeToolCall at line 77
17:   WRAP executeToolCall WITH FUNCTION(original)
18:     RETURN ASYNC FUNCTION(config, toolCallRequest, toolRegistry, abortSignal)
19:       SET filter = getOrCreateFilter()
20:       
21:       SET isSearchTool = toolCallRequest.name IN [
22:         'shell', 'bash', 'exec',
23:         'grep', 'search_file_content', 
24:         'glob', 'find', 'ls',
25:         'read_file', 'read_many_files'
26:       ]
27:       
28:       // Search tools need unfiltered access for finding emojis
29:       IF isSearchTool
30:         // Pass through without filtering - preserve emoji search patterns
31:         SET result = AWAIT original(config, toolCallRequest, toolRegistry, abortSignal)
32:         RETURN result
33:       END IF
34:       
35:       // Check if this is a file modification tool
36:       SET isFileModTool = toolCallRequest.name IN [
37:         'edit_file', 'edit',
38:         'write_file', 'create_file', 
39:         'replace', 'replace_all'
40:       ]
23:       
24:       // Filter tool arguments
25:       IF isFileModTool
26:         SET filterResult = filterFileModificationArgs(
27:           filter, 
28:           toolCallRequest.name, 
29:           toolCallRequest.args
30:         )
31:       ELSE
32:         SET filterResult = filter.filterToolArgs(toolCallRequest.args)
33:       END IF
34:       
35:       // Handle blocking in error mode
36:       IF filterResult.blocked
37:         RETURN {
38:           callId: toolCallRequest.callId,
39:           responseParts: {
40:             functionResponse: {
41:               id: toolCallRequest.callId,
42:               name: toolCallRequest.name,
43:               response: { error: filterResult.error }
44:             }
45:           },
46:           resultDisplay: filterResult.error,
47:           error: new Error(filterResult.error),
48:           errorType: ToolErrorType.VALIDATION_ERROR
49:         }
50:       END IF
51:       
52:       // Execute with filtered arguments
53:       SET filteredRequest = {
54:         ...toolCallRequest,
55:         args: filterResult.filtered
56:       }
57:       
58:       SET result = AWAIT original(config, filteredRequest, toolRegistry, abortSignal)
59:       
60:       // Add system feedback for warn mode
61:       IF filterResult.systemFeedback AND filterResult.emojiDetected
62:         // Inject feedback into conversation after tool result
63:         EMIT_SYSTEM_MESSAGE(filterResult.systemFeedback)
64:       END IF
65:       
66:       RETURN result
67:     END FUNCTION
68:   END WRAP
69: END METHOD
70:
71: METHOD filterFileModificationArgs(filter, toolName, args): FilterResult
72:   // IMPORTANT: Never filter file paths - they might legitimately contain emojis
73:   // Only filter the content being written to files
74:   IF toolName === 'edit_file' OR toolName === 'edit'
73:     SET oldResult = filter.filterFileContent(args.old_string, toolName)
74:     SET newResult = filter.filterFileContent(args.new_string, toolName)
75:     
76:     IF oldResult.blocked OR newResult.blocked
77:       RETURN {
78:         filtered: null,
79:         emojiDetected: true,
80:         blocked: true,
81:         error: "Cannot write emojis to code files"
82:       }
83:     END IF
84:     
85:     RETURN {
86:       filtered: {
87:         ...args,
88:         // Preserve file_path unchanged - never filter paths
89:         file_path: args.file_path,
90:         old_string: oldResult.filtered,
91:         new_string: newResult.filtered
92:       },
91:       emojiDetected: oldResult.emojiDetected OR newResult.emojiDetected,
92:       blocked: false,
93:       systemFeedback: oldResult.systemFeedback || newResult.systemFeedback
94:     }
95:   END IF
96:   
97:   IF toolName === 'write_file' OR toolName === 'create_file'
98:     SET result = filter.filterFileContent(args.content, toolName)
99:     IF result.blocked
100:      RETURN result
101:    END IF
102:    
103:    RETURN {
104:      filtered: {
105:        ...args,
106:        // Preserve file_path unchanged - never filter paths
107:        file_path: args.file_path,
108:        content: result.filtered
109:      },
108:      emojiDetected: result.emojiDetected,
109:      blocked: false,
110:      systemFeedback: result.systemFeedback
111:    }
112:  END IF
113:  
114:  IF toolName === 'replace' OR toolName === 'replace_all'
115:    SET result = filter.filterFileContent(args.replacement, toolName)
116:    IF result.blocked
117:      RETURN result
118:    END IF
119:    
120:    RETURN {
121:      filtered: {
122:        ...args,
        // Preserve file_path unchanged - never filter paths
123:        file_path: args.file_path,
124:        replacement: result.filtered
125:      },
125:      emojiDetected: result.emojiDetected,
126:      blocked: false,
127:      systemFeedback: result.systemFeedback
128:    }
129:  END IF
130:  
131:  // Fallback for other tools
132:  RETURN filter.filterToolArgs(args)
133: END METHOD
134:
135: END MODULE
```
# Pseudocode: EmojiFilter Class

```
01: CLASS EmojiFilter
02:   PRIVATE patterns: CompiledRegexArray
03:   PRIVATE conversions: Map<string, string>
04:   PRIVATE buffer: string
05:   PRIVATE config: FilterConfiguration
06:   
07: CONSTRUCTOR(config: FilterConfiguration)
08:   SET this.config = config
09:   SET this.patterns = compileEmojiPatterns()
10:   SET this.conversions = loadConversionMap()
11:   SET this.buffer = ""
12: END CONSTRUCTOR
13:
14: METHOD filterText(text: string): FilterResult
15:   IF config.mode === 'allowed'
16:     RETURN { filtered: text, emojiDetected: false, blocked: false }
17:   END IF
18:   
19:   SET emojiDetected = detectEmojis(text)
20:   
21:   IF NOT emojiDetected
22:     RETURN { filtered: text, emojiDetected: false, blocked: false }
23:   END IF
24:   
25:   IF config.mode === 'error'
26:     RETURN { 
27:       filtered: null, 
28:       emojiDetected: true, 
29:       blocked: true,
30:       error: "Emojis detected in content"
31:     }
32:   END IF
33:   
34:   SET filtered = applyConversions(text)
35:   SET filtered = removeDecorativeEmojis(filtered)
36:   
37:   RETURN {
38:     filtered: filtered,
39:     emojiDetected: true,
40:     blocked: false,
41:     systemFeedback: config.mode === 'warn' ? 
42:       "Emojis were detected and removed. Please avoid using emojis." : 
43:       undefined
44:   }
45: END METHOD
46:
47: METHOD filterStreamChunk(chunk: string): FilterResult
48:   SET combined = this.buffer + chunk
49:   SET lastBoundary = findLastSafeBoundary(combined)
50:   
51:   IF lastBoundary === -1
52:     SET this.buffer = combined
53:     RETURN { filtered: "", emojiDetected: false, blocked: false }
54:   END IF
55:   
56:   SET toProcess = combined.substring(0, lastBoundary)
57:   SET this.buffer = combined.substring(lastBoundary)
58:   
59:   RETURN filterText(toProcess)
60: END METHOD
61:
62: METHOD filterToolArgs(args: object): FilterResult
63:   IF config.mode === 'allowed'
64:     RETURN { filtered: args, emojiDetected: false, blocked: false }
65:   END IF
66:   
67:   SET stringified = JSON.stringify(args)
68:   SET emojiDetected = detectEmojis(stringified)
69:   
70:   IF NOT emojiDetected
71:     RETURN { filtered: args, emojiDetected: false, blocked: false }
72:   END IF
73:   
74:   IF config.mode === 'error'
75:     RETURN {
76:       filtered: null,
77:       emojiDetected: true,
78:       blocked: true,
79:       error: "Cannot execute tool with emojis in parameters"
80:     }
81:   END IF
82:   
83:   SET filteredString = applyConversions(stringified)
84:   SET filteredString = removeDecorativeEmojis(filteredString)
85:   SET filteredArgs = JSON.parse(filteredString)
86:   
87:   RETURN {
88:     filtered: filteredArgs,
89:     emojiDetected: true,
90:     blocked: false,
91:     systemFeedback: config.mode === 'warn' ?
92:       "Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters." :
93:       undefined
94:   }
95: END METHOD
96:
97: METHOD filterFileContent(content: string, toolName: string): FilterResult
98:   IF config.mode === 'allowed'
99:     RETURN { filtered: content, emojiDetected: false, blocked: false }
100:  END IF
101:  
102:  SET emojiDetected = detectEmojis(content)
103:  
104:  IF NOT emojiDetected
105:    RETURN { filtered: content, emojiDetected: false, blocked: false }
106:  END IF
107:  
108:  IF config.mode === 'error'
109:    RETURN {
110:      filtered: null,
111:      emojiDetected: true,
112:      blocked: true,
113:      error: "Cannot write emojis to code files"
114:    }
115:  END IF
116:  
117:  SET filtered = applyConversions(content)
118:  SET filtered = removeDecorativeEmojis(filtered)
119:  
120:  RETURN {
121:    filtered: filtered,
122:    emojiDetected: true,
123:    blocked: false,
124:    systemFeedback: config.mode === 'warn' ?
125:      `Emojis were removed from ${toolName} content. Please avoid using emojis in code.` :
126:      undefined
127:  }
128: END METHOD
129:
130: METHOD flushBuffer(): string
131:  SET remaining = this.buffer
132:  SET this.buffer = ""
133:  IF remaining.length > 0
134:    SET result = filterText(remaining)
135:    RETURN result.filtered || ""
136:  END IF
137:  RETURN ""
138: END METHOD
139:
140: PRIVATE METHOD detectEmojis(text: string): boolean
141:  FOR EACH pattern IN this.patterns
142:    IF pattern.test(text)
143:      RETURN true
144:    END IF
145:  END FOR
146:  RETURN false
147: END METHOD
148:
149: PRIVATE METHOD applyConversions(text: string): string
150:  SET result = text
151:  FOR EACH [emoji, replacement] IN this.conversions
152:    SET result = result.replaceAll(emoji, replacement)
153:  END FOR
154:  RETURN result
155: END METHOD
156:
157: PRIVATE METHOD removeDecorativeEmojis(text: string): string
158:  SET result = text
159:  FOR EACH pattern IN getDecorativePatterns()
160:    SET result = result.replace(pattern, "")
161:  END FOR
162:  RETURN result
163: END METHOD
164:
165: PRIVATE METHOD findLastSafeBoundary(text: string): number
166:  // Find last position that won't split a multi-byte character
167:  SET length = text.length
168:  IF length === 0
169:    RETURN -1
170:  END IF
171:  
172:  FOR i FROM length - 1 DOWN TO Math.max(0, length - 4)
173:    SET code = text.charCodeAt(i)
174:    IF code < 0xD800 OR code > 0xDFFF
175:      RETURN i + 1
176:    END IF
177:  END FOR
178:  
179:  RETURN length
180: END METHOD
181:
182: END CLASS
```
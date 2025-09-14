# LoggingProviderWrapper Pseudocode

10: CLASS LoggingProviderWrapper IMPLEMENTS IProvider
11:   PROPERTY wrappedProvider: IProvider
12:   PROPERTY config: Config
13:   PROPERTY redactor: ConversationDataRedactor
14:   PROPERTY conversationId: string
15:   PROPERTY turnNumber: number (initially 0)
16:   
17: 20: CONSTRUCTOR(wrapped: IProvider, config: Config, redactor?: ConversationDataRedactor)
18:   SET this.wrappedProvider = wrapped
29:   SET this.config = config
30:   SET this.conversationId = generateConversationId()
31:   IF redactor provided
32:     SET this.redactor = redactor
33:   ELSE
34:     CREATE new ConfigBasedRedactor with config's redaction settings
35:     SET this.redactor = new redactor
36:   END IF
37: 
38: 30: METHOD get name(): string
39:   RETURN this.wrappedProvider.name
40: 
41: 40: METHOD get isDefault(): boolean | undefined
42:   RETURN this.wrappedProvider.isDefault
43: 
44: 50: METHOD getModels(): Promise<IModel[]>
45:   DELEGATE to this.wrappedProvider.getModels()
46:   RETURN result
47: 
48: 60: METHOD getDefaultModel(): string
49:   DELEGATE to this.wrappedProvider.getDefaultModel()
50:   RETURN result
51: 
52: 70: METHOD generateChatCompletion(
53:     content: IContent[],
54:     tools?: Array<{
55:       functionDeclarations: Array<{
56:         name: string;
57:         description?: string;
58:         parameters?: unknown;
59:       }>;
60:     }>
61:   ): AsyncIterableIterator<IContent>
62:   GENERATE promptId
63:   INCREMENT this.turnNumber
64:   IF conversation logging enabled in config
65:     CALL logRequest with content, tools and promptId
66:   END IF
67:   GET stream from wrapped provider
68:   IF logging NOT enabled
69:     YIELD all chunks from stream
70:     RETURN
71:   END IF
72:   YIELD from logResponseStream with stream and promptId
73:   
74: 80: METHOD logRequest(
75:     content: IContent[],
76:     tools?: Array<{
77:       functionDeclarations: Array<{
78:         name: string;
79:         description?: string;
80:         parameters?: unknown;
81:       }>;
82:     }>,
83:     promptId?: string
84:   ): Promise<void>
85:   TRY
86:     APPLY redaction to content and tools using this.redactor
87:     CREATE new ConversationRequestEvent with:
88:       provider name
89:       conversation ID
90:       turn number
91:       prompt ID
92:       redacted content
93:       redacted tools
94:       tool format
95:     CALL logConversationRequest with config and event
96:     GET ConversationFileWriter using config's log path
97:     CALL fileWriter.writeRequest with:
98:       provider name
99:       redacted content
100:       request metadata (conversationId, turnNumber, promptId, tools, toolFormat)
101:   CATCH error
102:     LOG warning about failed request logging
103:     DON'T fail the actual request
104:   END TRY
105:   
106: 90: METHOD logResponseStream(
107:     stream: AsyncIterableIterator<IContent>,
108:     promptId: string
109:   ): AsyncIterableIterator<IContent>
110:   RECORD startTime using performance.now()
111:   INITIALIZE responseContent as empty string
112:   INITIALIZE responseComplete flag as false
113:   TRY
114:     FOR each chunk in stream
115:       EXTRACT content from chunk using extractSimpleContent
116:       IF content extracted
117:         APPEND to responseContent
118:       END IF
119:       YIELD chunk
120:     END FOR
121:     SET responseComplete = true
122:   CATCH error
123:     CALCULATE errorTime
124:     CALL logResponse with empty content, promptId, duration, success=false, error
125:     THROW error
126:   END TRY
127:   IF responseComplete
128:     CALCULATE totalTime
129:     CALL logResponse with responseContent, promptId, totalTime, success=true
130:   END IF
131:   
132: 100: METHOD extractSimpleContent(chunk: unknown): string
133:   IF chunk is not an object or is null
134:     RETURN empty string
135:   END IF
136:   TRY common content paths in chunk object:
137:     IF chunk has choices array
138:       GET first choice
139:       IF choice has delta object
140:         IF delta has content string
141:           RETURN delta.content
142:         END IF
143:       END IF
144:     END IF
145:   RETURN empty string
146:   
147: 110: METHOD logResponse(
148:     content: string,
149:     promptId: string,
150:     duration: number,
151:     success: boolean,
152:     error?: unknown
153:   ): Promise<void>
154:   TRY
155:     APPLY redaction to content using this.redactor
156:     CREATE new ConversationResponseEvent with:
157:       provider name
158:       conversation ID
159:       turn number
160:       prompt ID
161:       redacted content
162:       duration
163:       success flag
164:       error string (if applicable)
165:     CALL logConversationResponse with config and event
166:     GET ConversationFileWriter using config's log path
167:     CALL fileWriter.writeResponse with:
168:       provider name
169:       redacted content
170:       response metadata (conversationId, turnNumber, promptId, duration, success, error)
171:   CATCH logError
172:     LOG warning about failed response logging
173:   END TRY
174:   
175: 120: METHOD generateConversationId(): string
176:   RETURN unique ID with "conv_" prefix, timestamp and random string
177:   
178: 130: METHOD generatePromptId(): string
179:   RETURN unique ID with "prompt_" prefix, timestamp and random string
180:   
181: 140: METHOD logToolCall(
182:     toolName: string,
183:     params: unknown,
184:     result: unknown,
185:     startTime: number,
186:     success: boolean,
187:     error?: unknown
188:   ): Promise<void>
189:   TRY
190:     CALCULATE duration from startTime to current time
191:     EXTRACT gitStats from result metadata if available
192:     GET ConversationFileWriter using config's log path
193:     CALL fileWriter.writeToolCall with:
194:       provider name
195:       tool name
196:       tool call metadata (conversationId, turnNumber, params, result, duration, success, error, gitStats)
197:   CATCH logError
198:     LOG warning about failed tool call logging
199:   END TRY
200:   
201: 150: METHOD setModel(modelId: string)
202:   DELEGATE to this.wrappedProvider.setModel(modelId)
203:   
204: 160: METHOD getCurrentModel(): string
205:   TRY to get model from wrappedProvider.getCurrentModel()
206:   IF method doesn't exist or returns falsy value
207:     RETURN empty string
208:   ELSE
209:     RETURN model string
210:   END IF
211:   
212: 170: METHOD setApiKey(apiKey: string)
213:   DELEGATE to this.wrappedProvider.setApiKey(apiKey)
214:   
215: 180: METHOD setBaseUrl(baseUrl?: string)
216:   DELEGATE to this.wrappedProvider.setBaseUrl(baseUrl)
217:   
218: 190: METHOD getToolFormat(): string
219:   TRY to get format from wrappedProvider.getToolFormat()
220:   IF method doesn't exist or returns falsy value
221:     RETURN empty string
222:   ELSE
223:     RETURN format string
224:   END IF
225:   
226: 200: METHOD setToolFormatOverride(format: string | null)
227:   DELEGATE to this.wrappedProvider.setToolFormatOverride(format)
228:   
229: 210: METHOD isPaidMode(): boolean
230:   TRY to get paid mode status from wrappedProvider.isPaidMode()
231:   IF method doesn't exist or returns falsy value
232:     RETURN false
233:   ELSE
234:     RETURN boolean result
235:   END IF
236:   
237: 220: METHOD clearState()
238:   TRY to call wrappedProvider.clearState() if method exists
239:   RESET conversationId by generating new one
240:   RESET turnNumber to 0
241:   
242: 230: METHOD setConfig(config: unknown)
243:   DELEGATE to wrappedProvider.setConfig(config)
244:   
245: 240: METHOD getServerTools(): string[]
246:   DELEGATE to wrappedProvider.getServerTools()
247:   RETURN result
248:   
249: 250: METHOD invokeServerTool(toolName: string, params: unknown, config?: unknown): Promise<unknown>
250:   RECORD startTime
251:   TRY
252:     CALL wrappedProvider.invokeServerTool with toolName, params, config
253:     STORE result
254:     IF logging enabled in this.config
255:       CALL logToolCall with toolName, params, result, startTime, success=true
256:     END IF
257:     RETURN result
258:   CATCH error
259:     IF logging enabled in this.config
260:       CALL logToolCall with toolName, params, null, startTime, success=false, error
261:     END IF
262:     THROW error
263:   END TRY
264:   
265: 260: METHOD setModelParams(params: Record<string, unknown> | undefined)
266:   DELEGATE to wrappedProvider.setModelParams(params)
267:   
268: 270: METHOD getModelParams(): Record<string, unknown> | undefined
269:   DELEGATE to wrappedProvider.getModelParams()
270:   RETURN result
271:   
272: 280: METHOD recordSessionTokenUsage(usage: {
273:     input: number,
274:     output: number,
275:     cache?: number,
276:     tool?: number,
277:     thought?: number
278:   }): Promise<void>
279:   GET active provider name from SettingsService
280:   IF active provider name matches this wrapper's provider
281:     GET ProviderPerformanceTracker
282:     CALL tracker.recordSessionTokenUsage for each category with count
283:   END IF
284:   
285: 290: METHOD recordRequestMetrics(
286:     tokens: number,
287:     duration: number,
288:     timeToFirstToken: number | null,
289:     chunkCount: number
290:   ): void
291:   GET ProviderPerformanceTracker
292:   CALL tracker.recordCompletion with duration, timeToFirstToken, tokens, chunkCount
293:   CALL tracker.recordBurstRate with tokens and duration
294:   
295: 300: METHOD recordThrottleWait(duration: number): void
296:   GET ProviderPerformanceTracker
297:   CALL tracker.recordThrottleWait with duration
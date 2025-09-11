# ProviderManager Pseudocode

10: CLASS ProviderManager IMPLEMENTS IProviderManager
11:   PROPERTY providers: Map<string, IProvider>
12:   PROPERTY serverToolsProvider: IProvider | null
13:   PROPERTY config: Config | undefined
14:   PROPERTY providerCapabilities: Map<string, ProviderCapabilities>
15:   PROPERTY currentConversationId: string | undefined
16:   PROPERTY sessionTokenUsage: Map<string, {
17:     input: number,
18:     output: number,
19:     cache: number,
20:     tool: number,
21:     thought: number,
22:     total: number
23:   }>
24: 
25: 20: CONSTRUCTOR()
26:   INITIALIZE this.providers as empty Map
27:   SET this.serverToolsProvider = null
28:   INITIALIZE this.providerCapabilities as empty Map
29:   INITIALIZE this.sessionTokenUsage as empty Map
30: 
31: 30: METHOD setConfig(config: Config)
32:   STORE old logging enabled state
33:   STORE new logging enabled state
34:   SET this.config = config
35:   IF logging state changed
36:     CALL updateProviderWrapping()
37:   END IF
38: 
39: 40: METHOD updateProviderWrapping()
40:   GET current logging enabled state from config
41:   FOR each provider in this.providers
42:     GET base provider (unwrap if already wrapped)
43:     IF logging enabled
44:       WRAP provider with LoggingProviderWrapper
45:     ELSE
46:       USE base provider directly
47:     END IF
48:     UPDATE provider in this.providers map
49:     IF this provider is serverToolsProvider
50:       UPDATE this.serverToolsProvider reference
51:     END IF
52:   END FOR
53: 
54: 50: METHOD registerProvider(provider: IProvider)
55:   GET final provider based on logging state (wrapped or unwrapped)
56:   STORE provider in this.providers map
57:   CAPTURE provider capabilities
58:   STORE capabilities in this.providerCapabilities map
59:   IF logging enabled
60:     LOG provider capability information
61:   END IF
62:   IF provider is default AND no active provider is set
63:     SET provider as active in SettingsService
64:   END IF
65:   IF provider is gemini AND no serverToolsProvider is set
66:     SET provider as serverToolsProvider
67:   END IF
68:   IF provider is gemini AND gemini is active provider
69:     SET provider as serverToolsProvider
70:   END IF
71:   
72: 60: METHOD setActiveProvider(name: string)
73:   IF provider with name not found
74:     THROW Error "Provider not found"
75:   END IF
76:   GET previous provider name from SettingsService
77:   IF previous provider exists and differs from new provider
78:     GET previous provider
79:     IF previous provider has clearState method AND is not serverToolsProvider
80:       CALL previous provider.clearState()
81:     END IF
82:   END IF
83:   IF logging enabled AND previous provider exists AND differs from new provider
84:     LOG provider switch with conversation ID and context preservation info
85:   END IF
86:   UPDATE SettingsService with active provider name
87:   IF new provider is gemini
88:     IF no serverToolsProvider OR serverToolsProvider is not gemini
89:       SET serverToolsProvider to gemini provider
90:     END IF
91:   ELSE IF no serverToolsProvider AND gemini provider exists
92:     SET serverToolsProvider to gemini provider
93:   END IF
94:   
95: 70: METHOD clearActiveProvider()
96:   SET activeProvider to empty string in SettingsService
97:   
98: 80: METHOD getActiveProvider(): IProvider
99:   GET active provider name from SettingsService
100:   IF no active provider name
101:     THROW Error "No active provider set"
102:   END IF
103:   GET provider from this.providers map
104:   IF provider not found
105:     THROW Error "Active provider not found"
106:   END IF
107:   RETURN provider
108: 
109: 90: METHOD getAvailableModels(providerName?: string): Promise<IModel[]>
110:   IF providerName provided
111:     GET provider by name
112:     IF provider not found
113:       THROW Error "Provider not found"
114:     END IF
115:   ELSE
116:     GET active provider
117:   END IF
118:   RETURN provider.getModels()
119: 
120: 100: METHOD listProviders(): string[]
121:   RETURN array of provider names from this.providers keys
122: 
123: 110: METHOD getProviderByName(name: string): IProvider | undefined
124:   RETURN provider from this.providers map by name
125: 
126: 120: METHOD getActiveProviderName(): string
127:   RETURN active provider name from SettingsService
128: 
129: 130: METHOD hasActiveProvider(): boolean
130:   GET active provider name
131:   RETURN true if name exists and provider found in this.providers
132: 
133: 140: METHOD getServerToolsProvider(): IProvider | null
134:   IF serverToolsProvider exists
135:     RETURN serverToolsProvider
136:   END IF
137:   GET gemini provider
138:   IF gemini provider exists
139:     SET serverToolsProvider to gemini provider
140:     RETURN gemini provider
141:   END IF
142:   RETURN null
143: 
144: 150: METHOD setServerToolsProvider(provider: IProvider | null)
145:   SET this.serverToolsProvider = provider
146: 
147: 160: METHOD accumulateSessionTokens(providerName: string, usage: {
148:     input: number,
149:     output: number,
150:     cache?: number,
151:     tool?: number,
152:     thought?: number
153:   })
154:   GET token usage tracker for provider from this.sessionTokenUsage
155:   IF not found
156:     INITIALIZE tracker with zeros for all categories
157:   END IF
158:   ADD usage values to existing tracker values
159:   UPDATE total with sum of all categories
160: 
161: 170: METHOD getSessionTokenUsage(providerName: string): {
162:     input: number,
163:     output: number,
164:     cache: number,
165:     tool: number,
166:     thought: number,
167:     total: number
168:   }
169:   RETURN token usage from this.sessionTokenUsage map by provider name
170:   OR return object with zeros if not found
171: 
172: 180: METHOD generateConversationId(): string
173:   RETURN unique conversation ID with timestamp and random string
174: 
175: 190: METHOD isContextPreserved(fromProvider: string, toProvider: string): boolean
176:   GET capabilities for both providers
177:   IF capabilities missing for either provider
178:     RETURN false
179:   END IF
180:   CALCULATE capability compatibility score
181:   RETURN true if score > 0.7
182: 
183: 200: METHOD captureProviderCapabilities(provider: IProvider): ProviderCapabilities
184:   RETURN object with provider capability flags:
185:     supportsStreaming
186:     supportsTools
187:     supportsVision
188:     maxTokens
189:     supportedFormats
190:     hasModelSelection
191:     hasApiKeyConfig
192:     hasBaseUrlConfig
193:     supportsPaidMode
194: 
195: 210: METHOD detectVisionSupport(provider: IProvider): boolean
196:   SWITCH provider.name
197:     CASE 'gemini'
198:       RETURN true
199:     CASE 'openai' 
200:       GET current model
201:       RETURN true if model includes 'vision' OR 'gpt-4'
202:     CASE 'anthropic'
203:       GET current model
204:       RETURN true if model includes 'claude-3'
205:     DEFAULT
206:       RETURN false
207:   END SWITCH
208: 
209: 220: METHOD getProviderMaxTokens(provider: IProvider): number
210:   GET current model name
211:   SWITCH provider.name
212:     CASE 'gemini'
213:       IF model includes 'pro'
214:         RETURN 32768
215:       ELSE IF model includes 'flash'
216:         RETURN 8192
217:       ELSE
218:         RETURN 8192
219:     CASE 'openai'
220:       IF model includes 'gpt-4'
221:         RETURN 8192
222:       ELSE IF model includes 'gpt-3.5'
223:         RETURN 4096
224:       ELSE
225:         RETURN 4096
226:     CASE 'anthropic'
227:       IF model includes 'claude-3'
228:         RETURN 200000
229:       ELSE
230:         RETURN 100000
231:     DEFAULT
232:       RETURN 4096
233:   END SWITCH
234: 
235: 230: METHOD getSupportedToolFormats(provider: IProvider): string[]
236:   SWITCH provider.name
237:     CASE 'gemini'
238:       RETURN ['function_calling', 'gemini_tools']
239:     CASE 'openai'
240:       RETURN ['function_calling', 'json_schema', 'hermes']
241:     CASE 'anthropic'
242:       RETURN ['xml_tools', 'anthropic_tools']
243:     DEFAULT
244:       RETURN empty array
245:   END SWITCH
246: 
247: 240: METHOD createProviderContext(provider: IProvider, capabilities: ProviderCapabilities): ProviderContext
248:   RETURN context object containing:
249:     providerName
250:     currentModel
251:     toolFormat
252:     isPaidMode flag
253:     capabilities object
254:     sessionStartTime timestamp
255: 
256: 250: METHOD calculateCapabilityCompatibility(from: ProviderCapabilities, to: ProviderCapabilities): number
257:   INITIALIZE score and totalChecks counters
258:   IF tools support matches
259:     INCREMENT score
260:   END IF
261:   INCREMENT totalChecks
262:   IF vision support matches
263:     INCREMENT score
264:   END IF
265:   INCREMENT totalChecks
266:   IF streaming support matches
267:     INCREMENT score
268:   END IF
269:   INCREMENT totalChecks
270:   CHECK if formats have common elements
271:   IF common formats found
272:     INCREMENT score
273:   END IF
274:   INCREMENT totalChecks
275:   RETURN score / totalChecks
276: 
277: 260: METHOD getCurrentConversationId(): string
278:   IF this.currentConversationId not set
279:     GENERATE new conversation ID
280:   END IF
281:   RETURN this.currentConversationId
282: 
283: 270: METHOD resetConversationContext()
284:   GENERATE new conversation ID
285:   SET this.currentConversationId to new ID
286: 
287: 280: METHOD getProviderCapabilities(providerName?: string): ProviderCapabilities | undefined
288:   IF providerName not provided
289:     GET active provider name from SettingsService
290:   END IF
291:   RETURN capabilities from this.providerCapabilities map
292: 
293: 290: METHOD compareProviders(provider1: string, provider2: string): ProviderComparison
294:   GET capabilities for both providers
295:   IF either missing
296:     THROW Error "Cannot compare providers: capabilities not available"
297:   END IF
298:   RETURN comparison object with:
299:     provider names
300:     capabilities objects
301:     compatibility score
302:     recommendation string
303: 
304: 300: METHOD generateProviderRecommendation(
305:     provider1: string, 
306:     provider2: string,
307:     cap1: ProviderCapabilities,
308:     cap2: ProviderCapabilities
309:   ): string
310:   IF cap1.maxTokens > cap2.maxTokens
311:     RETURN recommendation about longer context support
312:   END IF
313:   IF cap1.supportsVision AND NOT cap2.supportsVision
314:     RETURN recommendation about vision capabilities
315:   END IF
316:   IF cap1.supportedFormats.length > cap2.supportedFormats.length
317:     RETURN recommendation about tool formats support
318:   END IF
319:   RETURN "Providers have similar capabilities"
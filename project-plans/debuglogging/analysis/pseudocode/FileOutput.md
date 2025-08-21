# FileOutput Pseudocode

```
10: CLASS FileOutput (Singleton)
11:   PRIVATE static instance: FileOutput
12:   PRIVATE currentFile: FileHandle | null
13:   PRIVATE currentPath: string | null
14:   PRIVATE writeQueue: Array<LogEntry>
15:   PRIVATE isWriting: boolean
16:   PRIVATE currentSize: number
17:   PRIVATE configManager: ConfigurationManager
18:
19: METHOD getInstance(): FileOutput
20:   IF NOT FileOutput.instance
21:     SET FileOutput.instance = new FileOutput()
22:   END IF
23:   RETURN FileOutput.instance
24: END METHOD
25:
26: CONSTRUCTOR()
27:   SET this.currentFile = null
28:   SET this.currentPath = null
29:   SET this.writeQueue = []
30:   SET this.isWriting = false
31:   SET this.currentSize = 0
32:   SET this.configManager = ConfigurationManager.getInstance()
33: END CONSTRUCTOR
34:
35: METHOD write(entry: LogEntry): Promise<void>
36:   ADD entry to this.writeQueue
37:   
38:   IF NOT this.isWriting
39:     CALL this.processQueue()
40:   END IF
41:
42:   RETURN Promise.resolve()
43: END METHOD
44:
45: METHOD async processQueue()
46:   IF this.isWriting OR this.writeQueue.length === 0
47:     RETURN
48:   END IF
49:
50:   SET this.isWriting = true
51:
52:   WHILE this.writeQueue.length > 0
53:     DECLARE entry = this.writeQueue.shift()
54:     TRY
55:       AWAIT this.writeEntry(entry)
56:     CATCH error
57:       CALL this.handleWriteError(error, entry)
58:     END TRY
59:   END WHILE
60:
61:   SET this.isWriting = false
62: END METHOD
63:
64: METHOD async writeEntry(entry: LogEntry)
65:   CALL this.ensureFileOpen()
66:   
67:   DECLARE line = this.formatEntry(entry)
68:   DECLARE buffer = Buffer.from(line + '\n')
69:   
70:   AWAIT this.currentFile.write(buffer)
71:   SET this.currentSize += buffer.length
72:
73:   IF this.shouldRotate()
74:     AWAIT this.rotate()
75:   END IF
76: END METHOD
77:
78: METHOD ensureFileOpen()
79:   IF this.currentFile !== null
80:     RETURN
81:   END IF
82:
83:   DECLARE config = this.configManager.getEffectiveConfig()
84:   DECLARE dir = this.expandPath(config.output.directory)
85:   
86:   TRY
87:     fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
88:   CATCH
89:     // Directory might already exist
90:   END TRY
91:
92:   DECLARE filename = this.generateFilename()
93:   SET this.currentPath = path.join(dir, filename)
94:   
95:   SET this.currentFile = await fs.promises.open(
96:     this.currentPath,
97:     'a',
98:     0o600
99:   )
100:
101:   SET stats = await this.currentFile.stat()
102:   SET this.currentSize = stats.size
103: END METHOD
104:
105: METHOD generateFilename(): string
106:   DECLARE now = new Date()
107:   DECLARE dateStr = now.toISOString().split('T')[0]
108:   DECLARE timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-')
109:   RETURN `${dateStr}_${timeStr}.log`
110: END METHOD
111:
112: METHOD formatEntry(entry: LogEntry): string
113:   DECLARE parts = [
114:     entry.timestamp,
115:     `[${entry.namespace}]`,
116:     `[${entry.level.toUpperCase()}]`,
117:     entry.message
118:   ]
119:
120:   IF entry.args && entry.args.length > 0
121:     DECLARE argsStr = entry.args.map(arg => {
122:       IF typeof arg === 'object'
123:         RETURN JSON.stringify(arg, null, 2)
124:       ELSE
125:         RETURN String(arg)
126:       END IF
127:     }).join(' ')
128:     parts.push(argsStr)
129:   END IF
130:
131:   RETURN parts.join(' ')
132: END METHOD
133:
134: METHOD shouldRotate(): boolean
135:   DECLARE config = this.configManager.getEffectiveConfig()
136:   
137:   IF config.output.rotate === 'never'
138:     RETURN false
139:   END IF
140:
141:   IF config.output.rotate === 'daily'
142:     DECLARE fileDate = this.getFileDateFromPath()
143:     DECLARE today = new Date().toISOString().split('T')[0]
144:     IF fileDate !== today
145:       RETURN true
146:     END IF
147:   END IF
148:
149:   IF config.output.rotate === 'size'
150:     DECLARE maxSize = this.parseSize(config.output.maxSize)
151:     IF this.currentSize >= maxSize
152:       RETURN true
153:     END IF
154:   END IF
155:
156:   RETURN false
157: END METHOD
158:
159: METHOD async rotate()
160:   IF this.currentFile
161:     AWAIT this.currentFile.close()
162:     SET this.currentFile = null
163:     SET this.currentPath = null
164:     SET this.currentSize = 0
165:   END IF
166:
167:   CALL this.cleanOldFiles()
168: END METHOD
169:
170: METHOD async cleanOldFiles()
171:   DECLARE config = this.configManager.getEffectiveConfig()
172:   DECLARE dir = this.expandPath(config.output.directory)
173:   DECLARE retention = config.output.retention
174:   
175:   DECLARE files = await fs.promises.readdir(dir)
176:   DECLARE now = Date.now()
177:   DECLARE cutoff = now - (retention * 24 * 60 * 60 * 1000)
178:
179:   FOR EACH file IN files
180:     IF file.endsWith('.log')
181:       DECLARE filepath = path.join(dir, file)
182:       DECLARE stats = await fs.promises.stat(filepath)
183:       IF stats.mtimeMs < cutoff
184:         TRY
185:           AWAIT fs.promises.unlink(filepath)
186:         CATCH
187:           // Ignore deletion errors
188:         END TRY
189:       END IF
190:     END IF
191:   END FOR
192: END METHOD
193:
194: METHOD handleWriteError(error: Error, entry: LogEntry)
195:   // Fall back to stderr
196:   console.error(`[DEBUG LOG ERROR] ${error.message}`)
197:   console.error(`[${entry.namespace}] ${entry.message}`)
198: END METHOD
199:
200: METHOD expandPath(inputPath: string): string
201:   IF inputPath.startsWith('~')
202:     RETURN path.join(os.homedir(), inputPath.slice(1))
203:   END IF
204:   RETURN inputPath
205: END METHOD
206:
207: METHOD parseSize(sizeStr: string): number
208:   DECLARE match = sizeStr.match(/^(\d+)(MB|KB|GB)?$/i)
209:   IF NOT match
210:     RETURN 10 * 1024 * 1024 // Default 10MB
211:   END IF
212:
213:   DECLARE value = parseInt(match[1])
214:   DECLARE unit = match[2]?.toUpperCase()
215:
216:   SWITCH unit
217:     CASE 'KB': RETURN value * 1024
218:     CASE 'MB': RETURN value * 1024 * 1024
219:     CASE 'GB': RETURN value * 1024 * 1024 * 1024
220:     DEFAULT: RETURN value
221:   END SWITCH
222: END METHOD
223:
224: METHOD getFileDateFromPath(): string
225:   IF NOT this.currentPath
226:     RETURN ''
227:   END IF
228:   DECLARE basename = path.basename(this.currentPath)
229:   DECLARE dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})/)
230:   RETURN dateMatch ? dateMatch[1] : ''
231: END METHOD
232:
233: METHOD async dispose()
234:   AWAIT this.processQueue()
235:   IF this.currentFile
236:     AWAIT this.currentFile.close()
237:   END IF
238: END METHOD
239:
240: END CLASS
```
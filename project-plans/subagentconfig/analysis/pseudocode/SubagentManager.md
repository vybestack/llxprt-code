# SubagentManager Pseudocode

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG.P02
**Component**: SubagentManager
**Requirements**: REQ-002, REQ-013
**Pattern Reference**: ProfileManager implementation

---

## Constructor and Initialization

1. CONSTRUCTOR(baseDir: string, profileManager: ProfileManager)
2.   // @requirement:REQ-002
3.   
4.   // Store configuration
5.   this.baseDir = baseDir
6.   this.profileManager = profileManager
7.   
8.  END CONSTRUCTOR

---

## Private Helper Methods

9.  PRIVATE FUNCTION getSubagentPath(name: string): string
10.   // @requirement:REQ-002
11.   
12.   // Centralize all name validation in this helper
13.   // 1. Validate name is not undefined or null
14.   IF name IS undefined OR name IS null THEN
15.     THROW Error("Subagent name is required")
16.   END IF
17.   
18.   // 2. Validate name is not an empty string or just whitespace
19.   IF name.trim() === '' THEN
20.     THROW Error("Subagent name is required")
21.   END IF
22.   
23.   // 3. Sanitize filename (prevent path traversal)
24.   sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '')
25.   
26.   // 4. Validate name after sanitization
27.   IF sanitizedName !== name THEN
28.     THROW Error("Invalid subagent name. Only alphanumeric, hyphens, and underscores allowed.")
29.   END IF
30.   
31.   // 5. Validate baseDir is provided to the instance
32.   IF this.baseDir IS undefined OR this.baseDir IS null OR this.baseDir.trim() === '' THEN
33.     THROW Error("Base directory is required")
34.   END IF
35.   
36.   // 6. Validate profileManager is provided to the instance
37.   IF this.profileManager IS undefined OR this.profileManager IS null THEN
38.     THROW Error("ProfileManager instance is required")
39.   END IF
40.   
41.   // Construct full path
42.   RETURN path.join(this.baseDir, `${sanitizedName}.json`)
43. END FUNCTION

44. 
45. PRIVATE FUNCTION ensureDirectory(): Promise<void>
46.   // @requirement:REQ-002
47.   
48.   TRY
49.     // Create directory if it doesn't exist
50.     AWAIT fs.mkdir(this.baseDir, { recursive: true })
51.   CATCH error
52.     IF error.code === 'EACCES' THEN
53.       THROW Error(`Permission denied: Cannot create directory ${this.baseDir}`)
54.     ELSE IF error.code === 'ENOSPC' THEN
55.       THROW Error(`No disk space: Cannot create directory ${this.baseDir}`)
56.     ELSE
57.       THROW Error(`Cannot create directory ${this.baseDir}: ${error.message}`) // General Error Case
58.     END IF
59.   END TRY
60. END FUNCTION

---

## saveSubagent Method

61. ASYNC FUNCTION saveSubagent(name: string, profile: string, systemPrompt: string): Promise<void>
62.   // @requirement:REQ-002
63.   
64.   // Validate inputs (name, profile, systemPrompt)
65.   // Name validation handled by private helper getSubagentPath (lines 9-43)
66.   IF profile is undefined OR profile.trim() === '' THEN
67.     THROW Error("Profile name is required")
68.   END IF
69.   
70.   IF systemPrompt is undefined OR systemPrompt.trim() === '' THEN
71.     THROW Error("System prompt cannot be empty")
72.   END IF
73. 
74.   // Validate profile exists (pseudocode lines 263-281 cover this)
75.   profileExists = AWAIT this.validateProfileReference(profile)
76.   IF NOT profileExists THEN
77.     THROW Error(`Profile '${profile}' not found. Use '/profile list' to see available profiles.`)
78.   END IF
79.   
80.   // Check if subagent exists for update vs create (pseudocode lines 237-260 cover this)
81.   exists = AWAIT this.subagentExists(name)
82.   
83.   IF exists THEN
84.     // Load existing to preserve createdAt
85.     existing = AWAIT this.loadSubagent(name)
86.     config = {
87.       name: name,
88.       profile: profile,
89.       systemPrompt: systemPrompt,
90.       createdAt: existing.createdAt,  // Preserve original timestamp
91.       updatedAt: new Date().toISOString()  // Update timestamp
92.     }
93.   ELSE
94.     // Create new with current timestamps
95.     now = new Date().toISOString()
96.     config = {
97.       name: name,
98.       profile: profile,
99.       systemPrompt: systemPrompt,
100.       createdAt: now,
101.       updatedAt: now
102.     }
103.   END IF
104.   
105.  // Ensure directory exists (pseudocode lines 45-60 cover this)
106.  AWAIT this.ensureDirectory()
107. 
108. // Get file path (via private helper, pseudocode lines 9-43 cover this)
109. filePath = this.getSubagentPath(name)
110. 
111. // Prepare JSON content
112. jsonString = JSON.stringify(config, null, 2)
113. 
114. // Write to file (pseudocode lines 135-147 cover this)
115. TRY
116.   AWAIT fs.writeFile(filePath, jsonString, 'utf-8')
117. CATCH error
118.   IF error.code === 'EACCES' THEN
119.     THROW Error(`Permission denied: Cannot write subagent file ${filePath}`)
120.   ELSE IF error.code === 'ENOSPC' THEN
121.     THROW Error(`No disk space: Cannot write subagent file ${filePath}`)
122.   ELSE IF error.code === 'ENOENT' THEN
123.     THROW Error(`Directory not found: ${this.baseDir}`)
124.   ELSE
125.     THROW Error(`Cannot save subagent: ${error.message}`)
126.   END IF
127. END TRY
128. END FUNCTION

---

## loadSubagent Method

129. ASYNC FUNCTION loadSubagent(name: string): Promise<SubagentConfig>
130. // @requirement:REQ-002
131. 
132. // Validate input via private helper (lines 9-43)
133. filePath = this.getSubagentPath(name)
134. 
135. // Read file (pseudocode lines 160-171 cover this)
136. TRY
137.   content = AWAIT fs.readFile(filePath, 'utf-8')
138. CATCH error
139.   IF error.code === 'ENOENT' THEN
140.     THROW Error(`Subagent '${name}' not found`)
141.   ELSE IF error.code === 'EACCES' THEN
142.     THROW Error(`Permission denied: Cannot read subagent file ${filePath}`)
143.   ELSE
144.     THROW Error(`Cannot read subagent file: ${error.message}`)
145.   END IF
146. END TRY
147. 
148. // Parse JSON (pseudocode lines 173-183 cover this)
149. TRY
150.   config = JSON.parse(content) as SubagentConfig
151. CATCH error
152.   IF error instanceof SyntaxError THEN
153.     THROW Error(`Subagent '${name}' file is corrupted (invalid JSON)`)
154.   ELSE
155.     THROW Error(`Cannot parse subagent file: ${error.message}`)
156.   END IF
157. END TRY
158. 
159. // Validate required fields (pseudocode lines 185-192 cover this)
160. IF NOT config.name OR NOT config.profile OR NOT config.systemPrompt THEN
161.   THROW Error(`Subagent '${name}' file is missing required configuration fields.`)
162. END IF
163. 
164. IF NOT config.createdAt OR NOT config.updatedAt THEN
165.   THROW Error(`Subagent '${name}' file is missing required timestamp fields.`)
166. END IF
167. 
168. // Validate timestamp format by checking if Date.parse returns a valid number
169. IF Number.isNaN(Date.parse(config.createdAt)) OR Number.isNaN(Date.parse(config.updatedAt)) THEN
170.   THROW Error(`Subagent '${name}' has an invalid timestamp format. Expected ISO 8601.`)
171. END IF
172. 
173. // Validate name matches filename after sanitization (pseudocode lines 200-203 cover this)
174. canonicalName = config.name.replace(/[^a-zA-Z0-9_-]/g, '')
175. IF canonicalName !== path.basename(filePath, '.json') THEN
176.   THROW Error(`Subagent filename mismatch: expected '${canonicalName}', found '${path.basename(filePath, '.json')}'`)
177. END IF
178. 
179. RETURN config
180. END FUNCTION

---

## listSubagents Method

181. ASYNC FUNCTION listSubagents(): Promise<string[]>
182. // @requirement:REQ-002
183. 
184. TRY
185.   // Ensure directory exists (pseudocode lines 45-60 cover this)
186.   AWAIT this.ensureDirectory()
187.   
188.   // Read directory contents (pseudocode lines 207-217 cover this)
189.   files = AWAIT fs.readdir(this.baseDir)
190.   
191.   // Filter for .json files and extract names (pseudocode lines 210-212 cover this)
192.   subagentFiles = files.filter(file => file.endsWith('.json'))
193.   subagentNames = subagentFiles.map(file => file.slice(0, -5)) // Remove .json extension
194.   
195.   // Sort alphabetically (pseudocode line 214 cover this)
196.   subagentNames.sort()
197.   
198.   RETURN subagentNames
199. CATCH error
200.   IF error.code === 'ENOENT' THEN
201.     // Directory doesn't exist yet, return fullNames list (pseudocode lines 218-221 cover this)
202.     RETURN []
203.   ELSE IF error.code === 'EACCES' THEN
204.     THROW Error(`Permission denied: Cannot read subagent directory ${this.baseDir}`)
205.   ELSE
206.     THROW Error(`Cannot list subagents: ${error.message}`)
207.   END IF
208. END TRY
209. END FUNCTION

---

## deleteSubagent Method

210. ASYNC FUNCTION deleteSubagent(name: string): Promise<boolean>
211. // @requirement:REQ-002
212. 
213. // Validate input via private helper (lines 9-43)
214. filePath = this.getSubagentPath(name)
215. 
216. // Check if subagent exists (pseudocode lines 237-260 cover this)
217. exists = AWAIT this.subagentExists(name)
218. IF NOT exists THEN
219.   RETURN false
220. END IF
221. 
222. // Delete file (pseudocode lines 243-255 cover this)
223. TRY
224.   AWAIT fs.unlink(filePath)
225.   RETURN true
226. CATCH error
227.   IF error.code === 'ENOENT' THEN
228.     // File already deleted (pseudocode lines 248-250 cover this)
229.     RETURN false
230.   ELSE IF error.code === 'EACCES' THEN
231.     THROW Error(`Permission denied: Cannot delete subagent file ${filePath}`)
232.   ELSE
233.     THROW Error(`Cannot delete subagent: ${error.message}`)
234.   END IF
235. END TRY
236. END FUNCTION

---

## subagentExists Method

237. ASYNC FUNCTION subagentExists(name: string): Promise<boolean>
238. // @requirement:REQ-002
239. 
240. // Validate input via private helper (lines 9-43)
241. // This check will return false for empty or invalid names.
242. TRY
243.   filePath = this.getSubagentPath(name)
244. CATCH errorOnValidation
245.   // getSubagentPath throws for invalid names. If it throws here, the agent doesn't
246.   // exist because its name is invalid.
247.   RETURN false
248. END TRY
249. 
250. // Check file existence (pseudocode lines 263-273 cover this)
251. TRY
252.   AWAIT fs.access(filePath, fs.constants.F_OK)
253.   RETURN true
254. CATCH errorOnAccess
255.   IF errorOnAccess.code === 'ENOENT' THEN
256.     RETURN false
257.   ELSE
258.     // For other access errors, treat as not existing to be safe
259.     RETURN false
260.   END IF
261. END TRY
262. END FUNCTION

---

## validateProfileReference Method

263. ASYNC FUNCTION validateProfileReference(profileName: string): Promise<boolean>
264. // @requirement:REQ-002
265. 
266. // Validate input (centralized to private helper now)
267. // Rely on getSubagentPath's pattern for guarding against bad arguments.
268. IF profileName is undefined OR profileName is null OR profileName.trim() === '' THEN
269.   RETURN false
270. END IF
271. 
272. // Check if profile exists using the injected ProfileManager instance.
273. TRY
274.   availableProfiles = AWAIT this.profileManager.listProfiles()
275.   RETURN availableProfiles.includes(profileName)
276. CATCH error
277.   // If ProfileManager fails, we cannot validate
278.   console.warn(`Cannot validate profile reference '${profileName}': ${error.message}`)
279.   RETURN false
280. END TRY
281. END FUNCTION

---

## Error Handling Constants

282. // Error message templates for consistency
283. // These will be used in the actual implementation for better consistency.
284. ERROR_MESSAGES = {
285.   INVALID_NAME: "Invalid subagent name. Only alphanumeric, hyphens, and underscores allowed.",
286.   NAME_REQUIRED: "Subagent name is required.",
287.   PROFILE_REQUIRED: "Profile name is required.",
288.   PROMPT_REQUIRED: "System prompt cannot be empty.",
289.   PROFILE_NOT_FOUND: "Profile '{profile}' not found. Use '/profile list' to see available profiles.",
290.   SUBAGENT_NOT_FOUND: "Subagent '{name}' not found.",
291.   PERMISSION_DENIED: "Permission denied: {operation}.",
292.   DISK_FULL: "No disk space: {operation}.",
293.   CORRUPTED_FILE: "Subagent '{name}' file is corrupted (invalid JSON).",
294.   INVALID_CONFIG: "Subagent '{name}' is invalid: {reason}."
295. }
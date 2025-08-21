# ConfigurationManager Pseudocode

```
10: CLASS ConfigurationManager (Singleton)
11:   PRIVATE static instance: ConfigurationManager
12:   PRIVATE defaultConfig: DebugSettings
13:   PRIVATE projectConfig: DebugSettings | null
14:   PRIVATE userConfig: DebugSettings | null
15:   PRIVATE envConfig: DebugSettings | null
16:   PRIVATE cliConfig: DebugSettings | null
17:   PRIVATE ephemeralConfig: DebugSettings | null
18:   PRIVATE mergedConfig: DebugSettings
19:   PRIVATE listeners: Set<Function>
20:
21: METHOD getInstance(): ConfigurationManager
22:   IF NOT ConfigurationManager.instance
23:     SET ConfigurationManager.instance = new ConfigurationManager()
24:   END IF
25:   RETURN ConfigurationManager.instance
26: END METHOD
27:
28: CONSTRUCTOR()
29:   SET this.defaultConfig = {
30:     enabled: false,
31:     namespaces: [],
32:     level: 'debug',
33:     output: { target: 'file', directory: '~/.llxprt/debug' },
34:     lazyEvaluation: true,
35:     redactPatterns: ['apiKey', 'token', 'password']
36:   }
37:   SET this.listeners = new Set()
38:   CALL this.loadConfigurations()
39:   CALL this.mergeConfigurations()
40: END CONSTRUCTOR
41:
42: METHOD loadConfigurations()
43:   CALL this.loadEnvironmentConfig()
44:   CALL this.loadUserConfig()
45:   CALL this.loadProjectConfig()
46: END METHOD
47:
48: METHOD loadEnvironmentConfig()
49:   IF process.env.DEBUG exists
50:     SET namespaces = this.parseDebugEnv(process.env.DEBUG)
51:     SET this.envConfig = {
52:       enabled: true,
53:       namespaces: namespaces
54:     }
55:   END IF
56:
57:   IF process.env.LLXPRT_DEBUG exists
58:     SET namespaces = this.parseDebugEnv(process.env.LLXPRT_DEBUG)
59:     SET this.envConfig = {
60:       enabled: true,
61:       namespaces: namespaces
62:     }
63:   END IF
64: END METHOD
65:
66: METHOD loadUserConfig()
67:   DECLARE configPath = path.join(os.homedir(), '.llxprt', 'settings.json')
68:   IF file exists at configPath
69:     TRY
70:       DECLARE content = fs.readFileSync(configPath, 'utf8')
71:       DECLARE parsed = JSON.parse(content)
72:       IF parsed.debug exists
73:         SET this.userConfig = DebugSettingsSchema.parse(parsed.debug)
74:       END IF
75:     CATCH error
76:       LOG warning "Failed to load user config"
77:     END TRY
78:   END IF
79: END METHOD
80:
81: METHOD loadProjectConfig()
82:   DECLARE configPath = path.join(process.cwd(), '.llxprt', 'config.json')
83:   IF file exists at configPath
84:     TRY
85:       DECLARE content = fs.readFileSync(configPath, 'utf8')
86:       DECLARE parsed = JSON.parse(content)
87:       IF parsed.debug exists
88:         SET this.projectConfig = DebugSettingsSchema.parse(parsed.debug)
89:       END IF
90:     CATCH error
91:       LOG warning "Failed to load project config"
92:     END TRY
93:   END IF
94: END METHOD
95:
96: METHOD mergeConfigurations()
97:   DECLARE configs = [
98:     this.defaultConfig,
99:     this.projectConfig,
100:     this.userConfig,
101:     this.envConfig,
102:     this.cliConfig,
103:     this.ephemeralConfig
104:   ].filter(Boolean)
105:
106:   SET this.mergedConfig = configs.reduce((merged, config) => {
107:     RETURN Object.assign({}, merged, config)
108:   }, {})
109:
110:   NOTIFY all listeners of configuration change
111: END METHOD
112:
113: METHOD setCliConfig(config: Partial<DebugSettings>)
114:   SET this.cliConfig = config
115:   CALL this.mergeConfigurations()
116: END METHOD
117:
118: METHOD setEphemeralConfig(config: Partial<DebugSettings>)
119:   SET this.ephemeralConfig = config
120:   CALL this.mergeConfigurations()
121: END METHOD
122:
123: METHOD persistEphemeralConfig()
124:   IF NOT this.ephemeralConfig
125:     RETURN
126:   END IF
127:
128:   DECLARE userConfigPath = path.join(os.homedir(), '.llxprt', 'settings.json')
129:   DECLARE existing = {}
130:   
131:   IF file exists at userConfigPath
132:     TRY
133:       SET existing = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'))
134:     CATCH
135:       SET existing = {}
136:     END TRY
137:   END IF
138:
139:   SET existing.debug = Object.assign({}, existing.debug, this.ephemeralConfig)
140:   
141:   TRY
142:     fs.mkdirSync(path.dirname(userConfigPath), { recursive: true })
143:     fs.writeFileSync(userConfigPath, JSON.stringify(existing, null, 2))
144:     SET this.userConfig = existing.debug
145:     SET this.ephemeralConfig = null
146:     CALL this.mergeConfigurations()
147:   CATCH error
148:     THROW new Error('Failed to persist configuration')
149:   END TRY
150: END METHOD
151:
152: METHOD getEffectiveConfig(): DebugSettings
153:   RETURN this.mergedConfig
154: END METHOD
155:
156: METHOD getOutputTarget(): string
157:   RETURN this.mergedConfig.output.target
158: END METHOD
159:
160: METHOD getRedactPatterns(): string[]
161:   RETURN this.mergedConfig.redactPatterns
162: END METHOD
163:
164: METHOD subscribe(listener: Function)
165:   this.listeners.add(listener)
166: END METHOD
167:
168: METHOD unsubscribe(listener: Function)
169:   this.listeners.delete(listener)
170: END METHOD
171:
172: METHOD parseDebugEnv(value: string): string[]
173:   RETURN value.split(',').map(s => s.trim()).filter(Boolean)
174: END METHOD
175:
176: END CLASS
```
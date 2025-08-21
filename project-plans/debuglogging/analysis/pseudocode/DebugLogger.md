# DebugLogger Pseudocode

```
10: CLASS DebugLogger
11:   PRIVATE debugInstance: Debugger
12:   PRIVATE namespace: string
13:   PRIVATE configManager: ConfigurationManager
14:   PRIVATE fileOutput: FileOutput
15:   PRIVATE enabled: boolean
16:
17: CONSTRUCTOR(namespace: string)
18:   SET this.namespace = namespace
19:   SET this.debugInstance = createDebug(namespace)
20:   SET this.configManager = ConfigurationManager.getInstance()
21:   SET this.fileOutput = FileOutput.getInstance()
22:   SET this.enabled = this.checkEnabled()
23:   SUBSCRIBE to configuration changes
24: END CONSTRUCTOR
25:
26: METHOD log(messageOrFn: string | Function, ...args: any[])
27:   IF NOT this.enabled
28:     RETURN immediately
29:   END IF
30:   
31:   DECLARE message: string
32:   IF typeof messageOrFn === 'function'
33:     TRY
34:       SET message = messageOrFn()
35:     CATCH error
36:       SET message = '[Error evaluating log function]'
37:     END TRY
38:   ELSE
39:     SET message = messageOrFn
40:   END IF
41:
42:   SET message = this.redactSensitive(message)
43:   SET timestamp = new Date().toISOString()
44:   
45:   DECLARE logEntry = {
46:     timestamp: timestamp,
47:     namespace: this.namespace,
48:     level: 'debug',
49:     message: message,
50:     args: args
51:   }
52:
53:   IF this.configManager.getOutputTarget() includes 'file'
54:     AWAIT this.fileOutput.write(logEntry)
55:   END IF
56:
57:   IF this.configManager.getOutputTarget() includes 'stderr'
58:     this.debugInstance(message, ...args)
59:   END IF
60: END METHOD
61:
62: METHOD debug(messageOrFn: string | Function, ...args: any[])
63:   CALL this.log(messageOrFn, ...args)
64: END METHOD
65:
66: METHOD error(messageOrFn: string | Function, ...args: any[])
67:   SET this.level = 'error'
68:   CALL this.log(messageOrFn, ...args)
69:   SET this.level = 'debug'
70: END METHOD
71:
72: METHOD checkEnabled(): boolean
73:   DECLARE config = this.configManager.getEffectiveConfig()
74:   IF NOT config.enabled
75:     RETURN false
76:   END IF
77:
78:   FOR EACH pattern IN config.namespaces
79:     IF this.matchesPattern(this.namespace, pattern)
80:       RETURN true
81:     END IF
82:   END FOR
83:
84:   RETURN false
85: END METHOD
86:
87: METHOD matchesPattern(namespace: string, pattern: string): boolean
88:   IF pattern === namespace
89:     RETURN true
90:   END IF
91:
92:   IF pattern.endsWith('*')
93:     DECLARE prefix = pattern.slice(0, -1)
94:     RETURN namespace.startsWith(prefix)
95:   END IF
96:
97:   RETURN false
98: END METHOD
99:
100: METHOD redactSensitive(message: string): string
101:   DECLARE patterns = this.configManager.getRedactPatterns()
102:   DECLARE result = message
103:   
104:   FOR EACH pattern IN patterns
105:     DECLARE regex = new RegExp(pattern + '["\']?:\\s*["\']?([^"\'\\s]+)', 'gi')
106:     SET result = result.replace(regex, pattern + ': [REDACTED]')
107:   END FOR
108:
109:   RETURN result
110: END METHOD
111:
112: METHOD onConfigChange(newConfig: DebugSettings)
113:   SET this.enabled = this.checkEnabled()
114: END METHOD
115:
116: METHOD dispose()
117:   UNSUBSCRIBE from configuration changes
118:   FLUSH any pending writes
119: END METHOD
120:
121: END CLASS
```
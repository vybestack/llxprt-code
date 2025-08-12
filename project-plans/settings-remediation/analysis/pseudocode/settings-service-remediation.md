# Pseudocode: SettingsService Remediation

## SettingsService Class (In-Memory Only)

```
01: CLASS SettingsService
02:   PRIVATE settings = {} // Simple in-memory object
03:   PRIVATE eventEmitter = new EventEmitter()
04:   
05:   METHOD constructor()
06:     // NO repository parameter
07:     // NO file system initialization
08:     INITIALIZE settings as empty object with structure:
09:       settings = {
10:         providers: {},
11:         global: {},
12:         activeProvider: null
13:       }
14:   END METHOD
15:   
16:   METHOD get(key: string): any
17:     // Synchronous direct access
18:     IF key contains "."
19:       RETURN getNestedValue(settings, key)
20:     ELSE
21:       RETURN settings.global[key]
22:     END IF
23:   END METHOD
24:   
25:   METHOD set(key: string, value: any): void
26:     // Synchronous update
27:     STORE oldValue = get(key)
28:     
29:     IF key contains "."
30:       setNestedValue(settings, key, value)
31:     ELSE
32:       settings.global[key] = value
33:     END IF
34:     
35:     EMIT 'change' event with {key, oldValue, newValue: value}
36:     // NO file write
37:     // NO async operations
38:   END METHOD
39:   
40:   METHOD getProviderSettings(provider: string): object
41:     RETURN settings.providers[provider] || {}
42:   END METHOD
43:   
44:   METHOD setProviderSetting(provider: string, key: string, value: any): void
45:     IF NOT settings.providers[provider]
46:       settings.providers[provider] = {}
47:     END IF
48:     
49:     STORE oldValue = settings.providers[provider][key]
50:     settings.providers[provider][key] = value
51:     
52:     EMIT 'provider-change' event with {provider, key, oldValue, newValue: value}
53:     // NO persistence
54:   END METHOD
55:   
56:   METHOD clear(): void
57:     // Reset to empty state
58:     settings = {
59:       providers: {},
60:       global: {},
61:       activeProvider: null
62:     }
63:     EMIT 'cleared' event
64:   END METHOD
65:   
66:   METHOD on(event: string, listener: function): void
67:     eventEmitter.on(event, listener)
68:   END METHOD
69:   
70:   METHOD off(event: string, listener: function): void
71:     eventEmitter.off(event, listener)
72:   END METHOD
73:   
74:   // NO saveSettings method
75:   // NO loadSettings method
76:   // NO persistSettingsToRepository method
77:   // NO file operations at all
78: END CLASS
```

## Config Class Integration

```
79: CLASS Config
80:   PRIVATE settingsService = getSettingsService()
81:   // REMOVE: private ephemeralSettings = {}
82:   
83:   METHOD getEphemeralSetting(key: string): any
84:     // Direct delegation to SettingsService
85:     RETURN settingsService.get(key)
86:   END METHOD
87:   
88:   METHOD setEphemeralSetting(key: string, value: any): void
89:     // Direct delegation, no local storage
90:     settingsService.set(key, value)
91:     // NO async operations
92:     // NO queue processing
93:     // NO file writes
94:   END METHOD
95:   
96:   METHOD clearEphemeralSettings(): void
97:     settingsService.clear()
98:   END METHOD
99:   
100:  // REMOVE: setEphemeralInSettingsService method
101:  // REMOVE: queueSettingsUpdate method
102:  // REMOVE: loadEphemeralSettingsFromService method
103: END CLASS
```

## Singleton Instance

```
104: MODULE settingsServiceInstance
105:   PRIVATE instance = null
106:   
107:   FUNCTION getSettingsService(): SettingsService
108:     IF instance is null
109:       instance = new SettingsService()
110:       // NO repository creation
111:       // NO file path configuration
112:     END IF
113:     RETURN instance
114:   END FUNCTION
115:   
116:   FUNCTION resetSettingsService(): void
117:     IF instance is not null
118:       instance.clear()
119:     END IF
120:     instance = null
121:   END FUNCTION
122: END MODULE
```

## Migration Steps

```
123: FUNCTION migrateFromPersistentToEphemeral()
124:   // One-time migration
125:   DELETE file ~/.llxprt/centralized-settings.json
126:   
127:   // Update Config class
128:   REMOVE Config.ephemeralSettings property
129:   REMOVE Config async methods for settings
130:   
131:   // Update SettingsService
132:   REMOVE FileSystemSettingsRepository import
133:   REMOVE repository parameter from constructor
134:   REMOVE all file system operations
135:   REMOVE all async/await keywords
136:   
137:   // Update tests
138:   REPLACE async test patterns with sync
139:   REMOVE file system mocks
140:   REMOVE repository mocks
141: END FUNCTION
```

## Event Flow

```
142: SEQUENCE userUpdatesModel
143:   User invokes: /model gpt-4
144:   modelCommand calls: settingsService.setProviderSetting('openai', 'model', 'gpt-4')
145:   SettingsService updates: settings.providers.openai.model = 'gpt-4'
146:   SettingsService emits: 'provider-change' event
147:   UI listener receives: event and updates display
148:   Provider listener receives: event and updates internal state
149:   // NO file writes occur
150:   // ALL operations complete in <5ms
151: END SEQUENCE
```

## Cleanup Operations

```
152: FUNCTION removeFileSystemArtifacts()
153:   DELETE packages/core/src/settings/FileSystemSettingsRepository.ts
154:   DELETE packages/core/src/settings/ISettingsRepository.ts (if exists)
155:   REMOVE from package.json any fs-extra dependencies (if only used here)
156:   REMOVE from tests any file system mocks
157:   DELETE ~/.llxprt/centralized-settings.json from user systems
158: END FUNCTION
```
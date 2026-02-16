# Pseudocode: ServerRegistry (packages/lsp/src/service/server-registry.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-LANG-010, REQ-LANG-020, REQ-LANG-030, REQ-LANG-040, REQ-CFG-040, REQ-PKG-030

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface ServerRegistryInput {
  userServerConfigs: Record<string, UserServerConfig>; // from LspConfig.servers
}

interface UserServerConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  extensions?: string[];
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}
```

### OUTPUTS this component produces:

```typescript
interface ServerRegistryOutput {
  getServersForExtension(extension: string): ServerConfig[];
  getAllServers(): ServerConfig[];
  getServerById(id: string): ServerConfig | undefined;
  isServerAvailable(id: string): Promise<boolean>;
}

interface ServerConfig {
  id: string;
  displayName: string;
  extensions: string[];
  command: string;
  args: string[];
  env: Record<string, string>;
  workspaceRootMarkers: string[];
  initializationOptions: Record<string, unknown>;
  detectCommand: () => Promise<string | null>; // resolves actual binary path
}
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  which: (cmd: string) => string | null;  // Bun.which for binary detection
}
```

---

## Pseudocode

```
01: // --- Built-in Server Configurations ---
02:
03: CONST BUILTIN_SERVERS: ServerConfig[] = [
04:   {
05:     id: 'typescript',
06:     displayName: 'TypeScript',
07:     extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
08:     command: 'typescript-language-server',
09:     args: ['--stdio'],
10:     env: {},
11:     workspaceRootMarkers: ['package.json', 'tsconfig.json'],
12:     initializationOptions: {
13:       preferences: { includeCompletions: false }
14:     },
15:     detectCommand: async () => {
16:       // Check local node_modules first, then global
17:       TRY Bun.which('typescript-language-server')
18:       FALLBACK check node_modules/.bin/typescript-language-server
19:       RETURN found path or null
20:     }
21:   },
22:   {
23:     id: 'eslint',
24:     displayName: 'ESLint',
25:     extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'],
26:     command: 'vscode-eslint-language-server',
27:     args: ['--stdio'],
28:     env: {},
29:     workspaceRootMarkers: ['package.json', '.eslintrc', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs'],
30:     initializationOptions: {
31:       run: 'onSave'
32:     },
33:     detectCommand: async () => {
34:       TRY Bun.which('vscode-eslint-language-server')
35:       FALLBACK check node_modules/.bin/
36:       RETURN found path or null
37:     }
38:   },
39:   {
40:     id: 'gopls',
41:     displayName: 'Go',
42:     extensions: ['.go'],
43:     command: 'gopls',
44:     args: ['serve'],
45:     env: {},
46:     workspaceRootMarkers: ['go.mod', 'go.sum'],
47:     initializationOptions: {},
48:     detectCommand: async () => Bun.which('gopls')
49:   },
50:   {
51:     id: 'pyright',
52:     displayName: 'Python',
53:     extensions: ['.py', '.pyi'],
54:     command: 'pyright-langserver',
55:     args: ['--stdio'],
56:     env: {},
57:     workspaceRootMarkers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
58:     initializationOptions: {},
59:     detectCommand: async () => {
60:       TRY Bun.which('pyright-langserver')
61:       FALLBACK Bun.which('basedpyright-langserver')
62:       RETURN found path or null
63:     }
64:   },
65:   {
66:     id: 'rust-analyzer',
67:     displayName: 'Rust',
68:     extensions: ['.rs'],
69:     command: 'rust-analyzer',
70:     args: [],
71:     env: {},
72:     workspaceRootMarkers: ['Cargo.toml', 'Cargo.lock'],
73:     initializationOptions: {},
74:     detectCommand: async () => Bun.which('rust-analyzer')
75:   }
76: ]
77:
78: // --- Extension-to-Server Index ---
79:
80: CLASS ServerRegistry
81:   PRIVATE readonly servers: Map<string, ServerConfig> = new Map()
82:   PRIVATE readonly extensionIndex: Map<string, string[]> = new Map()  // ext → serverId[]
83:   PRIVATE readonly logger: DebugLogger
84:
85:   CONSTRUCTOR(userConfigs: Record<string, UserServerConfig> = {})
86:     SET this.logger = new DebugLogger('llxprt:lsp:server-registry')
87:
88:     // Register built-in servers
89:     FOR EACH config IN BUILTIN_SERVERS
90:       this.registerServer(config)
91:
92:     // Register/override with user-defined servers
93:     FOR EACH [id, userConfig] IN Object.entries(userConfigs)
94:       IF this.servers.has(id)
95:         // Override existing built-in with user customizations
96:         CONST existing = this.servers.get(id)
97:         CONST merged = mergeServerConfig(existing, userConfig)
98:         this.servers.set(id, merged)
99:         // Rebuild extension index if extensions changed
100:       ELSE
101:        // Brand new custom server
102:        CONST newConfig = createServerConfigFromUser(id, userConfig)
103:        this.registerServer(newConfig)
104:
105:  PRIVATE METHOD registerServer(config: ServerConfig): void
106:    this.servers.set(config.id, config)
107:    FOR EACH ext IN config.extensions
108:      IF NOT extensionIndex.has(ext)
109:        extensionIndex.set(ext, [])
110:      extensionIndex.get(ext).push(config.id)
111:
112:  METHOD getServersForExtension(extension: string): ServerConfig[]
113:    CONST serverIds = extensionIndex.get(extension) ?? []
114:    RETURN serverIds.map(id => servers.get(id)).filter(Boolean)
115:
116:  METHOD getAllServers(): ServerConfig[]
117:    RETURN Array.from(servers.values())
118:
119:  METHOD getServerById(id: string): ServerConfig | undefined
120:    RETURN servers.get(id)
121:
122:  METHOD async isServerAvailable(id: string): Promise<boolean>
123:    CONST config = servers.get(id)
124:    IF config is undefined RETURN false
125:    CONST path = await config.detectCommand()
126:    RETURN path !== null
127:
128: END CLASS
129:
130: // --- Utility Functions ---
131:
132: FUNCTION mergeServerConfig(existing: ServerConfig, user: UserServerConfig): ServerConfig
133:   RETURN {
134:     ...existing,
135:     command: user.command ?? existing.command,
136:     args: user.args ?? existing.args,
137:     extensions: user.extensions ?? existing.extensions,
138:     env: { ...existing.env, ...user.env },
139:     initializationOptions: {
140:       ...existing.initializationOptions,
141:       ...user.initializationOptions
142:     }
143:   }
144:
145: FUNCTION createServerConfigFromUser(id: string, user: UserServerConfig): ServerConfig
146:   IF user.command is undefined
147:     THROW Error("Custom server '${id}' must specify a command")
148:   IF user.extensions is undefined OR user.extensions.length === 0
149:     THROW Error("Custom server '${id}' must specify at least one extension")
150:   RETURN {
151:     id,
152:     displayName: id,
153:     extensions: user.extensions,
154:     command: user.command,
155:     args: user.args ?? [],
156:     env: user.env ?? {},
157:     workspaceRootMarkers: [],
158:     initializationOptions: user.initializationOptions ?? {},
159:     detectCommand: async () => Bun.which(user.command)
160:   }
161:
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 15-20 | `detectCommand()` for TypeScript | Checks local `node_modules/.bin/` first (project-local install), then falls back to global PATH via `Bun.which()`. |
| 33-37 | `detectCommand()` for ESLint | Same pattern as TypeScript. ESLint language server often installed via VS Code extension, may not be in PATH. |
| 48 | `Bun.which('gopls')` | Simple PATH lookup. Go tools are typically installed globally. |
| 60-63 | `detectCommand()` for Python | Tries `pyright-langserver` first, falls back to `basedpyright-langserver` (community fork). |
| 97 | `mergeServerConfig(existing, userConfig)` | User config overrides built-in fields. Environment variables are merged (not replaced). Init options are merged. |
| 102 | `createServerConfigFromUser(id, userConfig)` | Custom servers MUST specify command and extensions. Throws if missing. |
| 112-114 | `getServersForExtension(extension)` | Returns ALL servers for an extension. For `.ts`, returns both `typescript` and `eslint`. This is what enables parallel diagnostic collection (REQ-LANG-040). |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Put all server configs in one giant file (>800 lines)
[OK]    DO: Keep server registry decomposed. Built-in configs can be imported from separate files per-language if needed (REQ-PKG-030)

[ERROR] DO NOT: Hardcode binary paths (/usr/local/bin/gopls)
[OK]    DO: Use Bun.which() for PATH-based detection, node_modules/.bin/ for local installs

[ERROR] DO NOT: Return a mutable array from getServersForExtension
[OK]    DO: Return a new array each time (immutable patterns)

[ERROR] DO NOT: Silently ignore invalid custom server configs
[OK]    DO: Throw on missing command/extensions to give clear error messages

[ERROR] DO NOT: Modify existing server configs in place when merging user overrides
[OK]    DO: Create new merged config object (immutable)
```

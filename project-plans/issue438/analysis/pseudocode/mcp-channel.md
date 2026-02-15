# Pseudocode: McpChannel (packages/lsp/src/channels/mcp-channel.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-NAV-010, REQ-NAV-020, REQ-NAV-030, REQ-NAV-040, REQ-NAV-050, REQ-NAV-060, REQ-ARCH-030, REQ-BOUNDARY-010, REQ-BOUNDARY-030

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface McpChannelInput {
  orchestrator: Orchestrator;
  workspaceRoot: string;
  inputStream: ReadableStream;   // fd3 input
  outputStream: WritableStream;  // fd4 output
}
```

### OUTPUTS this component produces:

```typescript
// Exposes MCP tools:
// - lsp_goto_definition: Navigate to symbol definition
// - lsp_find_references: Find all references to symbol
// - lsp_hover: Get type info and documentation
// - lsp_document_symbols: List symbols in a file
// - lsp_workspace_symbols: Search symbols across workspace
// - lsp_diagnostics: Get all current diagnostics
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  mcpSdk: typeof import('@modelcontextprotocol/sdk');
  orchestrator: Orchestrator;
  path: typeof import('node:path');
}
```

---

## Pseudocode

```
01: FUNCTION createMcpChannel(
02:   orchestrator: Orchestrator,
03:   workspaceRoot: string,
04:   inputStream: ReadableStream,
05:   outputStream: WritableStream
06: ): McpServer
07:   CONST logger = new DebugLogger('llxprt:lsp:mcp-channel')
08:
09:   // Create custom transport for fd3/fd4
10:   CONST transport = new FdTransport(inputStream, outputStream)
11:
12:   // Create MCP server
13:   CONST server = new McpServer({
14:     name: 'lsp-navigation',
15:     version: '0.1.0'
16:   })
17:
18:   // --- Helper: Validate and resolve file path ---
19:
20:   FUNCTION validateFilePath(filePath: string): string | null
21:     CONST resolved = path.resolve(workspaceRoot, filePath)
22:     CONST normalized = path.normalize(resolved)
23:     IF NOT normalized.startsWith(workspaceRoot)
24:       logger.log("Rejected file outside workspace: ${filePath}")
25:       RETURN null
26:     RETURN normalized
27:
28:   // --- Tool: lsp_goto_definition ---
29:
30:   server.tool('lsp_goto_definition', {
31:     description: 'Navigate to the definition of a symbol at a given position',
32:     inputSchema: {
33:       type: 'object',
34:       properties: {
35:         file: { type: 'string', description: 'File path (relative to workspace root)' },
36:         line: { type: 'number', description: 'Line number (1-based)' },
37:         character: { type: 'number', description: 'Column number (1-based)' }
38:       },
39:       required: ['file', 'line', 'character']
40:     }
41:   }, async (params) => {
42:     CONST resolvedFile = validateFilePath(params.file)
43:     IF resolvedFile is null
44:       RETURN { content: [{ type: 'text', text: 'Error: File is outside workspace boundary' }] }
45:     TRY
46:       CONST locations = await orchestrator.gotoDefinition(resolvedFile, params.line, params.character)
47:       CONST formatted = locations.map(loc => formatLocation(loc, workspaceRoot))
48:       RETURN { content: [{ type: 'text', text: formatted.join('\n') || 'No definition found' }] }
49:     CATCH error
50:       RETURN { content: [{ type: 'text', text: `Error: ${error.message}` }] }
51:   })
52:
53:   // --- Tool: lsp_find_references ---
54:
55:   server.tool('lsp_find_references', {
56:     description: 'Find all references to a symbol at a given position',
57:     inputSchema: {
58:       type: 'object',
59:       properties: {
60:         file: { type: 'string', description: 'File path (relative to workspace root)' },
61:         line: { type: 'number', description: 'Line number (1-based)' },
62:         character: { type: 'number', description: 'Column number (1-based)' }
63:       },
64:       required: ['file', 'line', 'character']
65:     }
66:   }, async (params) => {
67:     CONST resolvedFile = validateFilePath(params.file)
68:     IF resolvedFile is null
69:       RETURN { content: [{ type: 'text', text: 'Error: File is outside workspace boundary' }] }
70:     TRY
71:       CONST locations = await orchestrator.findReferences(resolvedFile, params.line, params.character)
72:       CONST formatted = locations.map(loc => formatLocation(loc, workspaceRoot))
73:       RETURN { content: [{ type: 'text', text: formatted.join('\n') || 'No references found' }] }
74:     CATCH error
75:       RETURN { content: [{ type: 'text', text: `Error: ${error.message}` }] }
76:   })
77:
78:   // --- Tool: lsp_hover ---
79:
80:   server.tool('lsp_hover', {
81:     description: 'Get type information and documentation for a symbol at a given position',
82:     inputSchema: {
83:       type: 'object',
84:       properties: {
85:         file: { type: 'string', description: 'File path (relative to workspace root)' },
86:         line: { type: 'number', description: 'Line number (1-based)' },
87:         character: { type: 'number', description: 'Column number (1-based)' }
88:       },
89:       required: ['file', 'line', 'character']
90:     }
91:   }, async (params) => {
92:     CONST resolvedFile = validateFilePath(params.file)
93:     IF resolvedFile is null
94:       RETURN { content: [{ type: 'text', text: 'Error: File is outside workspace boundary' }] }
95:     TRY
96:       CONST hover = await orchestrator.hover(resolvedFile, params.line, params.character)
97:       IF hover is null
98:         RETURN { content: [{ type: 'text', text: 'No hover information available' }] }
99:       RETURN { content: [{ type: 'text', text: hover.contents }] }
100:    CATCH error
101:      RETURN { content: [{ type: 'text', text: `Error: ${error.message}` }] }
102:  })
103:
104:  // --- Tool: lsp_document_symbols ---
105:
106:  server.tool('lsp_document_symbols', {
107:    description: 'List all symbols (functions, classes, variables) in a file',
108:    inputSchema: {
109:      type: 'object',
110:      properties: {
111:        file: { type: 'string', description: 'File path (relative to workspace root)' }
112:      },
113:      required: ['file']
114:    }
115:  }, async (params) => {
116:    CONST resolvedFile = validateFilePath(params.file)
117:    IF resolvedFile is null
118:      RETURN { content: [{ type: 'text', text: 'Error: File is outside workspace boundary' }] }
119:    TRY
120:      CONST symbols = await orchestrator.documentSymbols(resolvedFile)
121:      CONST formatted = formatDocumentSymbols(symbols)
122:      RETURN { content: [{ type: 'text', text: formatted || 'No symbols found' }] }
123:    CATCH error
124:      RETURN { content: [{ type: 'text', text: `Error: ${error.message}` }] }
125:  })
126:
127:  // --- Tool: lsp_workspace_symbols ---
128:
129:  server.tool('lsp_workspace_symbols', {
130:    description: 'Search for symbols across the entire workspace',
131:    inputSchema: {
132:      type: 'object',
133:      properties: {
134:        query: { type: 'string', description: 'Symbol name or pattern to search for' }
135:      },
136:      required: ['query']
137:    }
138:  }, async (params) => {
139:    TRY
140:      CONST symbols = await orchestrator.workspaceSymbols(params.query)
141:      CONST formatted = formatWorkspaceSymbols(symbols, workspaceRoot)
142:      RETURN { content: [{ type: 'text', text: formatted || 'No symbols found' }] }
143:    CATCH error
144:      RETURN { content: [{ type: 'text', text: `Error: ${error.message}` }] }
145:  })
146:
147:  // --- Tool: lsp_diagnostics ---
148:
149:  server.tool('lsp_diagnostics', {
150:    description: 'Retrieve current diagnostics for all known files',
151:    inputSchema: {
152:      type: 'object',
153:      properties: {},
154:      required: []
155:    }
156:  }, async () => {
157:    TRY
158:      CONST allDiags = orchestrator.getAllDiagnostics()
159:      CONST sorted = sortFileKeys(allDiags)  // alphabetical
160:      CONST formatted = formatAllDiagnostics(sorted)
161:      RETURN { content: [{ type: 'text', text: formatted || 'No diagnostics' }] }
162:    CATCH error
163:      RETURN { content: [{ type: 'text', text: `Error: ${error.message}` }] }
164:  })
165:
166:  // --- Connect transport ---
167:
168:  await server.connect(transport)
169:  logger.log("MCP channel connected on fd3/fd4")
170:
171:  RETURN server
172:
173: // --- Formatting Helpers ---
174:
175: FUNCTION formatLocation(location: Location, workspaceRoot: string): string
176:   CONST relPath = path.relative(workspaceRoot, uriToFilePath(location.uri))
177:   CONST line = location.range.start.line + 1
178:   CONST char = location.range.start.character + 1
179:   RETURN `${relPath}:${line}:${char}`
180:
181: FUNCTION formatDocumentSymbols(symbols: DocumentSymbol[]): string
182:   RETURN symbols.map(s => {
183:     CONST kind = symbolKindToString(s.kind)
184:     CONST line = s.range.start.line + 1
185:     RETURN `${kind} ${s.name} [line ${line}]`
186:   }).join('\n')
187:
188: FUNCTION formatWorkspaceSymbols(symbols: SymbolInformation[], workspaceRoot: string): string
189:   RETURN symbols.map(s => {
190:     CONST relPath = path.relative(workspaceRoot, uriToFilePath(s.location.uri))
191:     CONST line = s.location.range.start.line + 1
192:     CONST kind = symbolKindToString(s.kind)
193:     RETURN `${kind} ${s.name} (${relPath}:${line})`
194:   }).join('\n')
195:
196: FUNCTION formatAllDiagnostics(diagnostics: Record<string, Diagnostic[]>): string
197:   CONST parts: string[] = []
198:   FOR EACH [file, diags] IN Object.entries(diagnostics)
199:     IF diags.length === 0 CONTINUE
200:     parts.push(`${file}:`)
201:     FOR EACH diag IN diags
202:       parts.push(`  ${formatDiagnosticLine(diag)}`)
203:   RETURN parts.join('\n')
204:
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 10 | `new FdTransport(inputStream, outputStream)` | Custom MCP transport wrapping fd3/fd4 streams. Must implement the MCP Transport interface. |
| 13-16 | `new McpServer(...)` | MCP SDK server instance. Handles protocol negotiation and tool registration. |
| 21-26 | `validateFilePath(filePath)` | Workspace boundary enforcement. Resolves relative paths against workspace root, normalizes, then checks prefix. Applied to ALL tools with file params (REQ-NAV-030, REQ-NAV-040). |
| 46 | `orchestrator.gotoDefinition(...)` | Delegates to shared orchestrator. Orchestrator routes to appropriate LspClient. |
| 71 | `orchestrator.findReferences(...)` | Same delegation pattern. |
| 96 | `orchestrator.hover(...)` | Same delegation pattern. |
| 120 | `orchestrator.documentSymbols(...)` | Same delegation pattern. |
| 140 | `orchestrator.workspaceSymbols(...)` | Queries ALL active clients in parallel. |
| 158 | `orchestrator.getAllDiagnostics()` | Returns current diagnostic snapshot from all servers. Files sorted alphabetically (REQ-NAV-060). |
| 168 | `server.connect(transport)` | Connects MCP server to the fd3/fd4 transport. Starts message loop. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Skip workspace boundary validation on any tool
[OK]    DO: validateFilePath() on EVERY tool that accepts a file parameter (REQ-NAV-030)

[ERROR] DO NOT: Use process.stdin/stdout for MCP channel (that's the RPC channel)
[OK]    DO: Use fd3/fd4 streams via FdTransport (REQ-ARCH-030)

[ERROR] DO NOT: Create a new orchestrator — must share with RPC channel
[OK]    DO: Accept orchestrator as parameter (REQ-ARCH-040)

[ERROR] DO NOT: Return raw LSP protocol objects to the LLM
[OK]    DO: Format locations, symbols, and diagnostics into human-readable text

[ERROR] DO NOT: Let unhandled errors crash the MCP server
[OK]    DO: Catch all errors in tool handlers, return error text content
```

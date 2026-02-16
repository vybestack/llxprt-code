# Pseudocode: LanguageMap (packages/lsp/src/service/language-map.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-LANG-010

---

## Interface Contracts

### INPUTS this component receives:

```typescript
// No runtime inputs — this is a pure data file
// Queried by file extension string (e.g., '.ts', '.go')
```

### OUTPUTS this component produces:

```typescript
interface LanguageMapOutput {
  getLanguageId(extension: string): string | undefined;
  getLanguageIdForFile(filePath: string): string | undefined;
}
```

### DEPENDENCIES this component requires:

```typescript
// No dependencies — pure data mapping
import * as path from 'node:path';  // For path.extname only
```

---

## Pseudocode

```
01: // File extension → LSP languageId mapping
02: // Reference: OpenCode language.ts (MIT licensed, pure data)
03: // This is used in textDocument/didOpen to tell the LSP server what language the file is
04:
05: CONST EXTENSION_TO_LANGUAGE_ID: ReadonlyMap<string, string> = new Map([
06:   // TypeScript / JavaScript
07:   ['.ts', 'typescript'],
08:   ['.tsx', 'typescriptreact'],
09:   ['.js', 'javascript'],
10:   ['.jsx', 'javascriptreact'],
11:   ['.mjs', 'javascript'],
12:   ['.cjs', 'javascript'],
13:   ['.mts', 'typescript'],
14:   ['.cts', 'typescript'],
15:
16:   // Go
17:   ['.go', 'go'],
18:   ['.mod', 'go.mod'],
19:   ['.sum', 'go.sum'],
20:
21:   // Python
22:   ['.py', 'python'],
23:   ['.pyi', 'python'],
24:   ['.pyw', 'python'],
25:
26:   // Rust
27:   ['.rs', 'rust'],
28:
29:   // Java
30:   ['.java', 'java'],
31:
32:   // C / C++
33:   ['.c', 'c'],
34:   ['.h', 'c'],
35:   ['.cpp', 'cpp'],
36:   ['.hpp', 'cpp'],
37:   ['.cc', 'cpp'],
38:   ['.hh', 'cpp'],
39:   ['.cxx', 'cpp'],
40:   ['.hxx', 'cpp'],
41:
42:   // C#
43:   ['.cs', 'csharp'],
44:
45:   // Ruby
46:   ['.rb', 'ruby'],
47:   ['.erb', 'erb'],
48:
49:   // PHP
50:   ['.php', 'php'],
51:
52:   // Swift
53:   ['.swift', 'swift'],
54:
55:   // Kotlin
56:   ['.kt', 'kotlin'],
57:   ['.kts', 'kotlin'],
58:
59:   // Scala
60:   ['.scala', 'scala'],
61:   ['.sc', 'scala'],
62:
63:   // Dart
64:   ['.dart', 'dart'],
65:
66:   // Shell
67:   ['.sh', 'shellscript'],
68:   ['.bash', 'shellscript'],
69:   ['.zsh', 'shellscript'],
70:
71:   // Web
72:   ['.html', 'html'],
73:   ['.htm', 'html'],
74:   ['.css', 'css'],
75:   ['.scss', 'scss'],
76:   ['.less', 'less'],
77:   ['.vue', 'vue'],
78:   ['.svelte', 'svelte'],
79:
80:   // Data / Config
81:   ['.json', 'json'],
82:   ['.jsonc', 'jsonc'],
83:   ['.yaml', 'yaml'],
84:   ['.yml', 'yaml'],
85:   ['.toml', 'toml'],
86:   ['.xml', 'xml'],
87:
88:   // Markdown
89:   ['.md', 'markdown'],
90:   ['.mdx', 'mdx'],
91:
92:   // Lua
93:   ['.lua', 'lua'],
94:
95:   // Zig
96:   ['.zig', 'zig'],
97:
98:   // Elixir / Erlang
99:   ['.ex', 'elixir'],
100:  ['.exs', 'elixir'],
101:  ['.erl', 'erlang'],
102:
103:  // Haskell
104:  ['.hs', 'haskell'],
105:  ['.lhs', 'haskell'],
106:
107:  // OCaml
108:  ['.ml', 'ocaml'],
109:  ['.mli', 'ocaml'],
110:
111:  // SQL
112:  ['.sql', 'sql'],
113:
114:  // Terraform
115:  ['.tf', 'terraform'],
116:  ['.tfvars', 'terraform'],
117:
118:  // Docker
119:  ['Dockerfile', 'dockerfile'],
120:
121:  // Protobuf
122:  ['.proto', 'proto3'],
123: ])
124:
125: FUNCTION getLanguageId(extension: string): string | undefined
126:   RETURN EXTENSION_TO_LANGUAGE_ID.get(extension.toLowerCase())
127:
128: FUNCTION getLanguageIdForFile(filePath: string): string | undefined
129:   CONST ext = path.extname(filePath).toLowerCase()
130:   IF ext === ''
131:     // Handle extensionless files like Dockerfile
132:     CONST basename = path.basename(filePath)
133:     RETURN EXTENSION_TO_LANGUAGE_ID.get(basename)
134:   RETURN EXTENSION_TO_LANGUAGE_ID.get(ext)
135:
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 126 | `extension.toLowerCase()` | Extensions are normalized to lowercase for case-insensitive matching. |
| 129 | `path.extname(filePath)` | Extracts the file extension including the dot. Returns empty string for extensionless files. |
| 132-133 | `path.basename(filePath)` | For extensionless files like `Dockerfile`, use the full filename as lookup key. |
| Used by | `LspClient.touchFile()` line 103 | When sending `textDocument/didOpen`, the languageId field is required. This mapping provides it. |
| Used by | `Orchestrator.checkFile()` line 23 | To determine which servers to start, the orchestrator needs to know the file extension. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Modify the EXTENSION_TO_LANGUAGE_ID map at runtime
[OK]    DO: Keep it as ReadonlyMap — this is immutable reference data

[ERROR] DO NOT: Use case-sensitive extension matching
[OK]    DO: Normalize to lowercase before lookup

[ERROR] DO NOT: Return a default languageId for unknown extensions
[OK]    DO: Return undefined — caller handles the "no server available" case

[ERROR] DO NOT: Include duplicate entries for the same extension
[OK]    DO: Each extension maps to exactly one languageId
```

# Pseudocode: Diagnostics (packages/lsp/src/service/diagnostics.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-FMT-010 through REQ-FMT-090, REQ-DIAG-050, REQ-DIAG-060, REQ-DIAG-070

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface DiagnosticsInput {
  diagnostics: Diagnostic[];
  config: {
    maxDiagnosticsPerFile: number;      // default 20
    maxProjectDiagnosticsFiles: number; // default 5
    maxTotalDiagnosticLines: number;    // default 50
    includeSeverities: Severity[];      // default ['error']
  };
}
```

### OUTPUTS this component produces:

```typescript
interface DiagnosticsOutput {
  // Pure formatting functions
  formatDiagnosticLine(diagnostic: Diagnostic): string;
  formatFileDiagnostics(file: string, diagnostics: Diagnostic[], maxPerFile: number): string;
  formatSingleFileDiagnostics(editedFile: string, diagnostics: Diagnostic[], config: DiagConfig): string;
  formatMultiFileDiagnostics(editedFile: string, allDiagnostics: Record<string, Diagnostic[]>, config: DiagConfig): string;
  // Utility functions
  escapeXml(text: string): string;
  deduplicateDiagnostics(diagnostics: Diagnostic[]): Diagnostic[];
  filterBySeverity(diagnostics: Diagnostic[], severities: Severity[]): Diagnostic[];
  normalizeLspDiagnostic(lspDiag: LspDiagnostic, filePath: string, workspaceRoot: string): Diagnostic;
  mapSeverity(lspSeverity: number): Severity;
}
```

### DEPENDENCIES this component requires:

```typescript
// No external dependencies — pure functions only
// Uses only the Diagnostic type and string manipulation
```

---

## Pseudocode

```
01: // --- Severity Mapping ---
02:
03: FUNCTION mapSeverity(lspSeverity: number): Severity
04:   MATCH lspSeverity
05:     1 → RETURN 'error'
06:     2 → RETURN 'warning'
07:     3 → RETURN 'info'
08:     4 → RETURN 'hint'
09:     default → RETURN 'info'
10:
11: // --- XML Escaping ---
12:
13: FUNCTION escapeXml(text: string): string
14:   REPLACE '&' with '&amp;'   // must be first
15:   REPLACE '<' with '&lt;'
16:   REPLACE '>' with '&gt;'
17:   RETURN text
18:
19: // --- Diagnostic Normalization ---
20:
21: FUNCTION normalizeLspDiagnostic(
22:   lspDiag: LspDiagnostic,
23:   filePath: string,
24:   workspaceRoot: string
25: ): Diagnostic
26:   RETURN {
27:     file: relativePath(filePath, workspaceRoot),
28:     line: lspDiag.range.start.line + 1,         // 0→1 based
29:     character: lspDiag.range.start.character + 1, // 0→1 based
30:     severity: mapSeverity(lspDiag.severity ?? 1),
31:     message: escapeXml(lspDiag.message),
32:     code: extractDiagnosticCode(lspDiag.code),
33:     source: lspDiag.source
34:   }
35:
36: FUNCTION extractDiagnosticCode(code: unknown): string | number | undefined
37:   IF code is string OR code is number
38:     RETURN code
39:   IF code is object with 'value' property
40:     RETURN code.value  // LSP DiagnosticCode can be { value: number, target: string }
41:   RETURN undefined
42:
43: // --- Deduplication ---
44:
45: FUNCTION deduplicateDiagnostics(diagnostics: Diagnostic[]): Diagnostic[]
46:   CONST seen = new Set<string>()
47:   CONST result: Diagnostic[] = []
48:   FOR EACH diag IN diagnostics
49:     CONST key = `${diag.file}:${diag.line}:${diag.character}:${diag.message}`
50:     IF NOT seen.has(key)
51:       seen.add(key)
52:       result.push(diag)
53:   RETURN result
54:
55: // --- Severity Filtering ---
56:
57: FUNCTION filterBySeverity(
58:   diagnostics: Diagnostic[],
59:   severities: Severity[]
60: ): Diagnostic[]
61:   RETURN diagnostics.filter(d => severities.includes(d.severity))
62:
63: // --- Sorting ---
64:
65: FUNCTION sortDiagnosticsByLine(diagnostics: Diagnostic[]): Diagnostic[]
66:   RETURN [...diagnostics].sort((a, b) => {
67:     IF a.line !== b.line RETURN a.line - b.line
68:     RETURN a.character - b.character
69:   })
70:
71: // --- Formatting ---
72:
73: FUNCTION formatDiagnosticLine(diagnostic: Diagnostic): string
74:   CONST severity = diagnostic.severity.toUpperCase()
75:   CONST location = `[${diagnostic.line}:${diagnostic.character}]`
76:   CONST codeStr = diagnostic.code !== undefined ? ` (${diagnostic.code})` : ''
77:   RETURN `${severity} ${location} ${diagnostic.message}${codeStr}`
78:
79: FUNCTION formatFileDiagnostics(
80:   file: string,
81:   diagnostics: Diagnostic[],
82:   maxPerFile: number
83: ): string
84:   CONST sorted = sortDiagnosticsByLine(diagnostics)
85:   CONST limited = sorted.slice(0, maxPerFile)
86:   CONST lines = limited.map(d => formatDiagnosticLine(d))
87:   LET result = lines.join('\n')
88:   IF sorted.length > maxPerFile
89:     result += `\n... and ${sorted.length - maxPerFile} more`
90:   RETURN result
91:
92: // --- Single-File Output (Edit Tool) ---
93:
94: FUNCTION formatSingleFileDiagnostics(
95:   editedFile: string,       // relative path
96:   diagnostics: Diagnostic[], // all diagnostics for this file
97:   config: DiagConfig
98: ): string
99:   APPLY severity filter: filtered = filterBySeverity(diagnostics, config.includeSeverities)
100:  IF filtered.length === 0
101:    RETURN ''  // no diagnostics to show
102:
103:  CONST body = formatFileDiagnostics(editedFile, filtered, config.maxDiagnosticsPerFile)
104:  RETURN `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${editedFile}">\n${body}\n</diagnostics>`
105:
106: // --- Multi-File Output (Write Tool) ---
107:
108: FUNCTION formatMultiFileDiagnostics(
109:   editedFile: string,       // relative path of the written file
110:   allDiagnostics: Record<string, Diagnostic[]>,
111:   config: DiagConfig
112: ): string
113:   CONST parts: string[] = []
114:   LET totalDiagnosticLines = 0
115:   LET otherFileCount = 0
116:
117:   // Sort files: edited first, then alphabetical
118:   CONST sortedFiles = Object.keys(allDiagnostics).sort((a, b) => {
119:     IF a === editedFile RETURN -1
120:     IF b === editedFile RETURN 1
121:     RETURN a.localeCompare(b)
122:   })
123:
124:   FOR EACH file IN sortedFiles
125:     IF totalDiagnosticLines >= config.maxTotalDiagnosticLines
126:       BREAK
127:
128:     // Apply severity filter
129:     CONST filtered = filterBySeverity(allDiagnostics[file], config.includeSeverities)
130:     IF filtered.length === 0
131:       CONTINUE
132:
133:     // Apply per-file cap, respecting total line budget
134:     CONST remainingBudget = config.maxTotalDiagnosticLines - totalDiagnosticLines
135:     CONST effectiveCap = Math.min(config.maxDiagnosticsPerFile, remainingBudget)
136:     CONST sorted = sortDiagnosticsByLine(filtered)
137:     CONST limited = sorted.slice(0, effectiveCap)
138:     totalDiagnosticLines += limited.length
139:
140:     CONST lines = limited.map(d => formatDiagnosticLine(d))
141:     LET body = lines.join('\n')
142:     IF sorted.length > limited.length
143:       body += `\n... and ${sorted.length - limited.length} more`
144:       // EXPLICIT RULE: Overflow suffix lines (e.g., "... and N more") do NOT count
144a:     // toward maxTotalDiagnosticLines. Only actual diagnostic lines (from formatDiagnosticLine)
144b:     // are counted. This is intentional — the overflow suffix is metadata about truncation,
144c:     // not diagnostic content. (REQ-FMT-068)
145:
146:     IF file === editedFile
147:       parts.push(`\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\n${body}\n</diagnostics>`)
148:     ELSE
149:       IF otherFileCount >= config.maxProjectDiagnosticsFiles
150:         CONTINUE
151:       otherFileCount++
152:       parts.push(`\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${body}\n</diagnostics>`)
153:
154:   RETURN parts.join('')
155:
156: // --- Configuration Defaults ---
157:
158: CONST DEFAULT_DIAG_CONFIG: DiagConfig = {
159:   maxDiagnosticsPerFile: 20,
160:   maxProjectDiagnosticsFiles: 5,
161:   maxTotalDiagnosticLines: 50,
162:   includeSeverities: ['error']
163: }
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 27 | `relativePath(filePath, workspaceRoot)` | Converts absolute file path to workspace-relative. Uses `path.relative()`. |
| 28-29 | `range.start.line + 1` | 0→1 based conversion. Applied during normalization, not formatting. |
| 31 | `escapeXml(lspDiag.message)` | Must escape `&` first, then `<` and `>`. Order matters. |
| 49 | Deduplication key | Key is `file:line:character:message`. Does NOT include severity or code — two servers reporting same error at same location are considered duplicates. |
| 99 | `filterBySeverity(diagnostics, config.includeSeverities)` | Applied FIRST before any caps (REQ-FMT-068). |
| 103 | `formatFileDiagnostics(editedFile, filtered, config.maxDiagnosticsPerFile)` | Per-file cap applied SECOND after severity filter (REQ-FMT-068). |
| 125 | Total line cap check | Applied THIRD — stops including files once 50 lines reached (REQ-FMT-068). |
| 138 | `totalDiagnosticLines += limited.length` | Only actual diagnostic lines count. Overflow suffix lines do NOT count (REQ-FMT-068). |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Apply per-file cap before severity filtering
[OK]    DO: Filter order is severity → per-file cap → total cap (REQ-FMT-068)

[ERROR] DO NOT: Count overflow suffix lines ("... and N more") toward total cap
[OK]    DO: Only count actual diagnostic lines (REQ-FMT-068)

[ERROR] DO NOT: Escape XML in the wrong order (< before &)
[OK]    DO: Escape & first, then < and > (prevents double-escaping)

[ERROR] DO NOT: Return 0-based line/character numbers from normalization
[OK]    DO: Always add 1 to convert from LSP 0-based to display 1-based (REQ-FMT-080)

[ERROR] DO NOT: Include file-level sections for files with zero diagnostics after severity filter
[OK]    DO: Skip files with no matching diagnostics

[ERROR] DO NOT: Mutate the input diagnostics array
[OK]    DO: Create new arrays with spread/slice/map (immutable patterns per RULES.md)

[ERROR] DO NOT: Use non-deterministic ordering for multi-file output
[OK]    DO: Edited file first, then alphabetical (REQ-FMT-090)
```

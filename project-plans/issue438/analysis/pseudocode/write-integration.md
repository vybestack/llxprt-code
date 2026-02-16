# Pseudocode: Write Tool Diagnostic Integration (packages/core/src/tools/write-file.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-DIAG-040, REQ-DIAG-045, REQ-DIAG-050, REQ-DIAG-060, REQ-DIAG-070, REQ-DIAG-020, REQ-FMT-068, REQ-FMT-090, REQ-GRACE-050, REQ-GRACE-055, REQ-SCOPE-030

---

## Interface Contracts

### INPUTS this component receives:

```typescript
// Write tool already receives:
// - config: Config
// - filePath: string (the file being written)
// - fileContent: string (new content)
// New input: LSP diagnostic results (multi-file)
```

### OUTPUTS this component produces:

```typescript
// Modified ToolResult.llmContent:
// - Original success message (unchanged)
// - APPENDED: Diagnostics for written file + other affected files
//   Format: "\n\nLSP errors detected in this file, please fix:\n<diagnostics ...>...\n"
//           "\n\nLSP errors detected in other files:\n<diagnostics ...>...\n"
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  lspServiceClient: LspServiceClient | undefined;
  formatMultiFileDiagnostics: Function;  // from diagnostics formatting utils
}
```

---

## Pseudocode

```
01: // --- Integration point in write-file.ts ---
02: // Location: After the file write succeeds, after llmSuccessMessageParts construction,
03: //           before the ToolResult is returned (~line 459 in current write-file.ts)
04:
05: // Context: At this point:
06: //   - fileContent has been written to disk successfully
07: //   - llmSuccessMessageParts[] has the success message
08: //   - filePath is the absolute path to the written file
09:
10: // --- NEW CODE TO ADD ---
11:
12: CONST lspClient = this.config.getLspServiceClient()
13: IF lspClient is defined AND lspClient.isAlive()
14:   TRY
15:     // Touch the written file first to trigger diagnostic update
16:     await lspClient.checkFile(filePath)
17:
18:     // Get all current diagnostics (includes the written file and affected files)
19:     CONST allDiagnostics = await lspClient.getAllDiagnostics()
20:
21:     CONST lspConfig = this.config.getLspConfig()
22:     CONST includeSeverities = lspConfig?.includeSeverities ?? ['error']
23:     CONST maxPerFile = lspConfig?.maxDiagnosticsPerFile ?? 20
24:     CONST maxOtherFiles = lspConfig?.maxProjectDiagnosticsFiles ?? 5
25:     CONST maxTotalLines = 50
26:
27:     CONST workspaceRoot = this.config.getWorkspaceRoot()
28:     CONST normalizedWrittenFile = path.relative(workspaceRoot, filePath)
29:
30:     // Sort files: written file first, then alphabetical
31:     CONST sortedFiles = Object.keys(allDiagnostics).sort((a, b) => {
32:       IF a === normalizedWrittenFile RETURN -1
33:       IF b === normalizedWrittenFile RETURN 1
34:       RETURN a.localeCompare(b)
35:     })
36:
37:     LET totalDiagnosticLines = 0
38:     LET otherFileCount = 0
39:
40:     FOR EACH file IN sortedFiles
41:       IF totalDiagnosticLines >= maxTotalLines
42:         BREAK
43:
44:       // Filter by severity
45:       CONST filtered = allDiagnostics[file].filter(d =>
46:         includeSeverities.includes(d.severity)
47:       )
48:       IF filtered.length === 0
49:         CONTINUE
50:
51:       // Cap per file, respecting total budget
52:       CONST remainingBudget = maxTotalLines - totalDiagnosticLines
53:       CONST effectiveCap = Math.min(maxPerFile, remainingBudget)
54:       CONST sorted = [...filtered].sort((a, b) =>
55:         a.line - b.line || a.character - b.character
56:       )
57:       CONST limited = sorted.slice(0, effectiveCap)
58:       totalDiagnosticLines += limited.length
59:
60:       CONST diagLines = limited.map(d => {
61:         CONST codeStr = d.code !== undefined ? ` (${d.code})` : ''
62:         RETURN `${d.severity.toUpperCase()} [${d.line}:${d.character}] ${d.message}${codeStr}`
63:       }).join('\n')
64:
65:       LET suffix = ''
66:       IF sorted.length > limited.length
67:         suffix = `\n... and ${sorted.length - limited.length} more`
68:         // Overflow suffix does NOT count toward totalDiagnosticLines (REQ-FMT-068)
69:
70:       IF file === normalizedWrittenFile
71:         llmSuccessMessageParts.push(
72:           `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\n${diagLines}${suffix}\n</diagnostics>`
73:         )
74:       ELSE
75:         IF otherFileCount >= maxOtherFiles
76:           CONTINUE
77:         otherFileCount++
78:         llmSuccessMessageParts.push(
79:           `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${diagLines}${suffix}\n</diagnostics>`
80:         )
81:
82:   CATCH _error
83:     // LSP failure must never fail the write (REQ-GRACE-050)
84:     // Silently continue — write was already successful
85:
86: // --- END OF NEW CODE ---
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 12 | `this.config.getLspServiceClient()` | Same accessor as edit tool. Returns undefined if LSP disabled. |
| 16 | `lspClient.checkFile(filePath)` | Sends the written file path to LSP service. Triggers didOpen/didChange + waits for diagnostics with timeout. |
| 19 | `lspClient.getAllDiagnostics()` | After checkFile, gets ALL current diagnostics from ALL servers. This includes the written file AND other files that may have been affected (REQ-DIAG-045). |
| 28 | `path.relative(workspaceRoot, filePath)` | Normalizes the written file path for comparison with diagnostic file paths (which are already relative). |
| 31-35 | File sorting | Written file first, then alphabetical. Deterministic ordering (REQ-FMT-090). |
| 41-42 | Total line cap check | Stops including files after 50 diagnostic lines (REQ-DIAG-070). |
| 52-53 | Per-file cap with budget | Each file gets min(maxPerFile, remainingBudget) diagnostics. Ensures total cap is respected. |
| 66-68 | Overflow suffix | Does not count toward total diagnostic line cap (REQ-FMT-068). |
| 70-80 | File labeling | Written file: "in this file, please fix". Other files: "in other files" (REQ-DIAG-050). |
| 75-76 | Other-file cap | Maximum 5 other files (REQ-DIAG-060). |

### Existing Code Context (write-file.ts ~lines 409-459)

```typescript
// EXISTING CODE — NOT MODIFIED:
const llmSuccessMessageParts = [
  isNewFile
    ? `Successfully created and wrote to new file: ${displayPath}.`
    : `Successfully overwrote file: ${displayPath}.`,
];
// ... modified_by_user, emoji filter check ...

// >>> NEW LSP DIAGNOSTIC CODE INSERTED HERE <<<

const result: ToolResult = {
  llmContent: llmSuccessMessageParts.join(' '),
  returnDisplay: displayResult,
};
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Only check the written file for diagnostics
[OK]    DO: Check ALL known files — write operations often break importers (REQ-DIAG-040)

[ERROR] DO NOT: Show other-file diagnostics BEFORE the written file's diagnostics
[OK]    DO: Written file first, then others (REQ-DIAG-050, REQ-FMT-090)

[ERROR] DO NOT: Allow unlimited other-file diagnostics (could blow up context)
[OK]    DO: Cap at 5 other files (REQ-DIAG-060) and 50 total lines (REQ-DIAG-070)

[ERROR] DO NOT: Count overflow suffix lines toward the 50-line total cap
[OK]    DO: Only count actual diagnostic lines (REQ-FMT-068)

[ERROR] DO NOT: Let LSP errors fail the write tool
[OK]    DO: Wrap everything in try/catch, edit succeeds regardless (REQ-GRACE-050)

[ERROR] DO NOT: Apply per-file cap before severity filtering
[OK]    DO: Severity filter first, then per-file cap, then total cap (REQ-FMT-068)
```

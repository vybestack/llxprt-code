# Pseudocode: Edit Tool Diagnostic Integration (packages/core/src/tools/edit.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-DIAG-010, REQ-DIAG-020, REQ-DIAG-030, REQ-GRACE-050, REQ-GRACE-055, REQ-SCOPE-010, REQ-SCOPE-030

---

## Interface Contracts

### INPUTS this component receives:

```typescript
// Edit tool already receives:
// - config: Config (has getLspServiceClient(), getLspConfig())
// - filePath: string (the file being edited)
// - editData: { newContent, currentContent, ... }
// New input: LSP diagnostic results
```

### OUTPUTS this component produces:

```typescript
// Modified ToolResult.llmContent:
// - Original success message (unchanged)
// - APPENDED: Diagnostic string if errors found
//   Format: "\n\nLSP errors detected in this file, please fix:\n<diagnostics ...>...</diagnostics>"
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  lspServiceClient: LspServiceClient | undefined;  // from Config
  formatSingleFileDiagnostics: Function;            // from diagnostics formatting utils
}
```

---

## Pseudocode

```
01: // --- Integration point in edit.ts ---
02: // This code is ADDED to the existing edit.ts file
03: // Location: After the file write succeeds, after llmSuccessMessageParts construction,
04: //           before the ToolResult is returned (~line 660 in current edit.ts)
05:
06: // Context: At this point in the existing code flow:
07: //   - The file has been written to disk successfully
08: //   - llmSuccessMessageParts[] contains the success message
09: //   - editData.isNewFile / occurrences etc. are available
10: //   - filePath is the absolute path to the edited file
11:
12: // --- NEW CODE TO ADD ---
13:
14: CONST lspClient = this.config.getLspServiceClient()
15: IF lspClient is defined AND lspClient.isAlive()
16:   TRY
17:     CONST diagnostics = await lspClient.checkFile(filePath)
18:     CONST lspConfig = this.config.getLspConfig()
19:     CONST includeSeverities = lspConfig?.includeSeverities ?? ['error']
20:     CONST filtered = diagnostics.filter(d => includeSeverities.includes(d.severity))
21:
22:     IF filtered.length > 0
23:       CONST maxPerFile = lspConfig?.maxDiagnosticsPerFile ?? 20
24:       CONST relPath = path.relative(this.config.getWorkspaceRoot(), filePath)
25:       CONST limited = filtered
26:         .sort((a, b) => a.line - b.line || a.character - b.character)
27:         .slice(0, maxPerFile)
28:
29:       CONST diagLines = limited.map(d => {
30:         CONST codeStr = d.code !== undefined ? ` (${d.code})` : ''
31:         RETURN `${d.severity.toUpperCase()} [${d.line}:${d.character}] ${d.message}${codeStr}`
32:       }).join('\n')
33:
34:       LET suffix = ''
35:       IF filtered.length > maxPerFile
36:         suffix = `\n... and ${filtered.length - maxPerFile} more`
37:
38:       llmSuccessMessageParts.push(
39:         `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${relPath}">\n${diagLines}${suffix}\n</diagnostics>`
40:       )
41:   CATCH _error
42:     // LSP failure must never fail the edit (REQ-GRACE-050)
43:     // Silently continue — edit was already successful
44:
45: // --- END OF NEW CODE ---
46: // The existing ToolResult construction continues as before:
47: // return { llmContent: llmSuccessMessageParts.join(' '), ... }
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 14 | `this.config.getLspServiceClient()` | New method on Config. Returns `LspServiceClient \| undefined`. undefined if LSP is disabled or never started. |
| 15 | `lspClient.isAlive()` | Checks if the LSP service process is still running. Returns false if dead, crashed, or never started. |
| 17 | `lspClient.checkFile(filePath)` | Sends JSON-RPC `lsp/checkFile` to the LSP service. Returns `Diagnostic[]`. May timeout, in which case returns `[]`. |
| 18 | `this.config.getLspConfig()` | New method on Config. Returns `LspConfig \| undefined`. Used for configurable limits and severity filters. |
| 24 | `path.relative(workspaceRoot, filePath)` | Converts absolute path to workspace-relative for display in the `<diagnostics>` tag. |
| 38-40 | `llmSuccessMessageParts.push(...)` | Appends diagnostic string to the EXISTING success message parts array. Does not replace anything. |

### Existing Code Context (edit.ts ~lines 641-660)

```typescript
// EXISTING CODE — NOT MODIFIED:
const llmSuccessMessageParts = [
  editData.isNewFile
    ? `Created new file: ${filePath} with provided content.`
    : `Successfully modified file: ${filePath} (${editData.occurrences} replacements).`,
];
// ... emoji filter check ...

// >>> NEW LSP DIAGNOSTIC CODE INSERTED HERE <<<

const result: ToolResult = {
  llmContent: llmSuccessMessageParts.join(' '),
  returnDisplay: displayResult,
};
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Make the diagnostic check blocking or slow down the edit
[OK]    DO: The diagnostic call has a built-in timeout. If it takes too long, edit returns without diagnostics.

[ERROR] DO NOT: Let LSP errors throw from the edit tool invocation
[OK]    DO: Wrap in try/catch, silently continue (REQ-GRACE-050, REQ-GRACE-055)

[ERROR] DO NOT: Include multi-file diagnostics in the edit tool
[OK]    DO: Edit tool only reports diagnostics for the edited file (REQ-DIAG-030)

[ERROR] DO NOT: Store raw Diagnostic objects in the ToolResult metadata
[OK]    DO: Only include the formatted string in llmContent (REQ-SCOPE-030)

[ERROR] DO NOT: Show diagnostics before the success message
[OK]    DO: Success message comes first, diagnostics appended after (REQ-DIAG-020)

[ERROR] DO NOT: Modify the existing edit flow or success message construction
[OK]    DO: Only APPEND to llmSuccessMessageParts after existing content

[ERROR] DO NOT: Trigger LSP for binary file writes
[OK]    DO: The LSP service itself handles this — binary files won't have a server match (REQ-SCOPE-010)
```

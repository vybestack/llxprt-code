# Pseudocode: Apply-Patch Diagnostic Integration (packages/core/src/tools/apply-patch.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-DIAG-015, REQ-DIAG-017, REQ-SCOPE-025, REQ-SCOPE-020, REQ-DIAG-020, REQ-DIAG-030, REQ-GRACE-050, REQ-GRACE-055

---

## Interface Contracts

### INPUTS this component receives:

```typescript
// Apply-patch tool already receives:
// - config: Config (has getLspServiceClient(), getLspConfig())
// - patchOperations: PatchOperation[] — individual operations in the patch
//   Each operation has a type and affects files differently

// PatchOperation classification:
interface PatchOperation {
  type: 'create' | 'modify' | 'delete' | 'rename';
  filePath: string;
  // For 'rename': also has newPath: string
  // For 'create'/'modify': has content changes (writes content)
  // For 'delete': no content changes
  // For 'rename': may or may not include content changes
}
```

### OUTPUTS this component produces:

```typescript
// Modified ToolResult.llmContent:
// - Original patch success message (unchanged)
// - APPENDED: Per-file diagnostics for each file with content writes
//   Format: "\n\nLSP errors detected in this file, please fix:\n<diagnostics file="...">...</diagnostics>"
//   (Repeated for each file that had content writes)
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  lspServiceClient: LspServiceClient | undefined;  // from Config
  formatSingleFileDiagnostics: Function;            // from diagnostics formatting utils
}
```

---

## Mixed Operation Classification Algorithm (REQ-SCOPE-025)

This is the critical algorithm for determining whether an apply-patch operation
should trigger diagnostic collection. The key question is: did the patch WRITE
content to any file?

```
01: FUNCTION classifyPatchOperations(operations: PatchOperation[]): {
02:   contentWriteFiles: string[],     // files that received content writes
03:   hasAnyContentWrites: boolean     // quick check for diagnostic skip
04: }
05:
06:   LET contentWriteFiles: string[] = []
07:
08:   FOR EACH op IN operations
09:     SWITCH op.type
10:       CASE 'create':
11:         // New file creation always writes content → collect diagnostics
12:         contentWriteFiles.push(op.filePath)
13:
14:       CASE 'modify':
15:         // File modification always writes content → collect diagnostics
16:         contentWriteFiles.push(op.filePath)
17:
18:       CASE 'delete':
19:         // File deletion never writes content → skip diagnostics
20:         // DO NOTHING
21:
22:       CASE 'rename':
23:         // CRITICAL: Rename may be pure rename OR rename+modify
24:         // Pure rename: file moved/renamed without content changes → skip
25:         // Rename+modify: file moved AND content changed → collect for NEW path
26:         //
27:         // Classification rule: A rename operation triggers diagnostics ONLY
28:         // if the patch also includes content changes for the destination file.
29:         // This is determined by checking if the operation includes a content
30:         // diff/hunks (non-empty content changes) for the renamed file.
31:         IF op.hasContentChanges === true
32:           // Rename with content modification → diagnostics on new path
33:           contentWriteFiles.push(op.newPath)
34:         // ELSE: Pure rename → no diagnostic collection
35:
36:   RETURN {
37:     contentWriteFiles: deduplicate(contentWriteFiles),
38:     hasAnyContentWrites: contentWriteFiles.length > 0
39:   }
```

### Decision Matrix for Mixed Operations

| Operation | Content Written? | Collect Diagnostics? | Server Started? |
|-----------|-----------------|---------------------|-----------------|
| `create` new file | YES | YES, for the new file | YES (if language matched) |
| `modify` existing file | YES | YES, for the modified file | YES (if language matched) |
| `delete` file | NO | NO | NO |
| `rename` only (no content change) | NO | NO | NO |
| `rename` + content modification | YES | YES, for the NEW path | YES (if language matched) |
| Mixed: `rename A→B` + `modify C` | YES (C only) | YES for C only, NO for B | YES (for C's language) |
| Mixed: `rename A→B` (with edits) + `delete C` | YES (B only) | YES for B only, NO for C | YES (for B's language) |
| All operations are deletes/pure-renames | NO | NO | NO (REQ-SCOPE-025) |

---

## Pseudocode

```
40: // --- Integration point in apply-patch.ts ---
41: // Location: After the patch application succeeds, after llmSuccessMessageParts construction,
42: //           before the ToolResult is returned
43:
44: // Context: At this point:
45: //   - All patch operations have been applied to disk successfully
46: //   - llmSuccessMessageParts[] contains the success message
47: //   - operations[] is the list of PatchOperation objects that were applied
48:
49: // --- NEW CODE TO ADD ---
50:
51: CONST lspClient = this.config.getLspServiceClient()
52: IF lspClient is defined AND lspClient.isAlive()
53:   TRY
54:     // Step 1: Classify which files had content writes (REQ-SCOPE-025, REQ-DIAG-017)
55:     CONST { contentWriteFiles, hasAnyContentWrites } = classifyPatchOperations(operations)
56:
57:     // Step 2: If no content writes at all, skip diagnostic collection entirely
58:     // This means rename-only and delete-only patches produce NO diagnostic output
59:     // and do NOT start any LSP servers (REQ-SCOPE-025)
60:     IF NOT hasAnyContentWrites
61:       // Skip — no content was written, so no diagnostics needed
62:       // This is the common path for rename/delete-only patches
63:       RETURN  // continue to ToolResult construction
64:
65:     // Step 3: Collect diagnostics for EACH file with content writes (single-file scope)
66:     CONST lspConfig = this.config.getLspConfig()
67:     CONST includeSeverities = lspConfig?.includeSeverities ?? ['error']
68:     CONST maxPerFile = lspConfig?.maxDiagnosticsPerFile ?? 20
69:
70:     FOR EACH filePath IN contentWriteFiles
71:       CONST diagnostics = await lspClient.checkFile(filePath)
72:       CONST filtered = diagnostics.filter(d => includeSeverities.includes(d.severity))
73:
74:       IF filtered.length > 0
75:         CONST relPath = path.relative(this.config.getWorkspaceRoot(), filePath)
76:         CONST sorted = [...filtered].sort((a, b) => a.line - b.line || a.character - b.character)
77:         CONST limited = sorted.slice(0, maxPerFile)
78:
79:         CONST diagLines = limited.map(d => {
80:           CONST codeStr = d.code !== undefined ? ` (${d.code})` : ''
81:           RETURN `${d.severity.toUpperCase()} [${d.line}:${d.character}] ${d.message}${codeStr}`
82:         }).join('\n')
83:
84:         LET suffix = ''
85:         IF filtered.length > maxPerFile
86:           suffix = `\n... and ${filtered.length - maxPerFile} more`
87:
88:         llmSuccessMessageParts.push(
89:           `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${relPath}">\n${diagLines}${suffix}\n</diagnostics>`
90:         )
91:
92:   CATCH _error
93:     // LSP failure must never fail the patch (REQ-GRACE-050)
94:     // Silently continue — patch was already successful
95:
96: // --- END OF NEW CODE ---
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 51 | `this.config.getLspServiceClient()` | Same accessor as edit/write tool. Returns undefined if LSP disabled. |
| 55 | `classifyPatchOperations(operations)` | Pure function that classifies each operation. No side effects, no LSP interaction. Must be called BEFORE any LSP calls to avoid starting servers unnecessarily (REQ-SCOPE-025). |
| 60-63 | Early return for no-content patches | Critical for REQ-SCOPE-025: if the patch only renames/deletes, we skip entirely. No `checkFile()` call means no lazy server startup. |
| 71 | `lspClient.checkFile(filePath)` | Called once per file that had content writes. Single-file scope per REQ-DIAG-030. |
| 72 | Severity filtering | Uses the same `includeSeverities` config as edit and write tools (REQ-FMT-067). |
| 88-90 | `llmSuccessMessageParts.push(...)` | Appends per-file diagnostics after the success message (REQ-DIAG-020). |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Collect diagnostics for ALL files in the patch (including renames/deletes)
[OK]    DO: Only collect for files that had content writes (REQ-DIAG-017)

[ERROR] DO NOT: Start LSP servers for rename-only or delete-only patches
[OK]    DO: Skip diagnostic collection entirely when no content writes (REQ-SCOPE-025)

[ERROR] DO NOT: Use multi-file diagnostic scope for apply-patch
[OK]    DO: Use single-file scope per modified file (REQ-DIAG-030)

[ERROR] DO NOT: Treat rename-with-edits the same as pure rename
[OK]    DO: Check hasContentChanges flag to distinguish (line 31)

[ERROR] DO NOT: Let LSP errors fail the patch operation
[OK]    DO: Wrap in try/catch, silently continue (REQ-GRACE-050, REQ-GRACE-055)

[ERROR] DO NOT: Collect diagnostics for the OLD path of a renamed file
[OK]    DO: If rename+modify, collect for the NEW path only (line 33)
```

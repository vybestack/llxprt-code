# Upstream Gemini CLI Cherry-Pick Audit - Batch 1

Audit Date: 2026-02-26
Auditor: LLxprt Code AI
Target: Gemini CLI commits for v0.23.0 integration

## cc52839f19 — "Docs (#15103)"
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Upstream changes: docs/hooks/best-practices.md, docs/hooks/index.md, docs/hooks/writing-hooks.md
- Current state: We have all three files in docs/hooks/
- Specific change: Updates tool names from PascalCase (`WriteFile`, `ReadFile`, `Edit`) to snake_case (`write_file`, `read_file`, `replace`)
- Lines compared:
  - Upstream best-practices.md:222 changes `"matcher": "WriteFile|Edit"` to `"matcher": "write_file|replace"`
  - Our best-practices.md:222 still has `"matcher": "WriteFile|Edit"`
  - Upstream adds comprehensive tool reference table (100+ lines) showing all available tool names
  - Our docs have the old PascalCase conventions throughout

**Rationale:**
This is a critical documentation update reflecting the tool naming convention change from PascalCase to snake_case. We already use snake_case tool names in our actual implementation (confirmed by checking hooks that reference tools), but our documentation still shows the old PascalCase format. This creates confusion for users.

The upstream commit also adds:
1. Complete tool names reference section (lines 557-621 in index.md)
2. Event-specific matcher examples
3. Updated Claude Code migration guide with full tool name mapping table

We need to apply these documentation updates to match our actual snake_case tool names.

**Conflicts expected:** NO - pure documentation changes, just need to apply the tool name updates throughout our hooks docs

---

## 5e21c8c03c — "Code assist service metrics (#15024)"
**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Upstream changes:
  - packages/core/src/code_assist/server.ts: Adds recordConversationOffered, recordConversationInteraction, recordCodeAssistMetrics methods
  - packages/core/src/code_assist/telemetry.ts: NEW file with createConversationOffered, formatProtoJsonDuration
  - packages/core/src/code_assist/types.ts: Adds RecordCodeAssistMetricsRequest, ConversationOffered, ConversationInteraction, ActionStatus enums
- Current state:
  - We have code_assist/server.ts but it's for Google's CodeAssist API
  - No telemetry.ts file
  - Our types.ts doesn't have these metric types
- Lines examined:
  - server.ts:66-111 adds streaming latency tracking
  - server.ts:235-269 adds metric recording methods
  - All methods call this.recordCodeAssistMetrics() which POSTs to ':recordCodeAssistMetrics' endpoint

**Rationale:**
This entire commit is Google-specific telemetry for their CodeAssist service. It records:
- Conversation offered events (when model responds)
- Conversation interaction events (thumbs up/down, copy, insert, etc.)
- Streaming latency metrics
- Citation counts

All of this data goes to Google's internal metrics system via the CodeAssist API. LLxprt Code:
1. Doesn't use Google's CodeAssist API (we use USE_PROVIDER auth)
2. Doesn't have Google's internal telemetry infrastructure
3. Has its own telemetry approach via debugLogger

If we want usage metrics, we'd implement our own telemetry system, not adopt Google's internal one.

**Conflicts expected:** N/A - skipping entirely

---

## ba100642e3 — "Use official ACP SDK and support HTTP/SSE based MCP servers (#13856)"
**Verdict:** NO_OP
**Confidence:** HIGH
**Evidence:**
- Upstream changes:
  - packages/cli/package.json: Adds `"@agentclientprotocol/sdk": "^0.11.0"`
  - Deletes packages/cli/src/zed-integration/acp.ts (283 lines)
  - Deletes packages/cli/src/zed-integration/acp.test.ts
  - Deletes packages/cli/src/zed-integration/connection.ts (231 lines)
  - Deletes packages/cli/src/zed-integration/connection.test.ts
  - Updates zed-integration/fileSystemService.ts to import from SDK
- Current state:
  - We already have `"@agentclientprotocol/sdk": "^0.14.1"` in package.json (line 38)
  - We don't have acp.ts or connection.ts files
  - Our zed-integration/ only has: fileSystemService.ts, fileSystemService.test.ts, zedIntegration.ts, zedIntegration.test.ts
  - Our fileSystemService.ts already imports from `@agentclientprotocol/sdk`

**Rationale:**
We already completed this migration! LLxprt Code adopted the official ACP SDK at version 0.14.1 (upstream is still at 0.11.0). We've already:
1. Deleted the custom ACP implementation files
2. Migrated to the official SDK
3. Updated our code to use SDK types and classes

This is a NO_OP because we've already done this work, likely during an earlier merge or independently.

**Conflicts expected:** NO - already completed

---

## db643e9166 — "Remove foreground for themes other than shades of purple and holiday (#14606)"
**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Upstream changes:
  - packages/cli/src/ui/themes/ansi-light.ts:13 `Foreground: '#444'` → `Foreground: ''`
  - packages/cli/src/ui/themes/ansi.ts:13 `Foreground: 'white'` → `Foreground: ''`
  - packages/cli/src/ui/themes/theme.ts:86 `Foreground: '#383A42'` → `Foreground: ''`
  - packages/cli/src/ui/themes/theme.ts:105 `Foreground: '#CDD6F4'` → `Foreground: ''`
  - packages/cli/src/ui/themes/theme.ts:124 `Foreground: 'white'` → `Foreground: ''`
- Current state:
  - packages/cli/src/ui/themes/ansi.ts:13 still has `Foreground: 'white'`
  - We have 27 theme files total in packages/cli/src/ui/themes/
  - Checked ansi.ts - still has the old hardcoded foreground value

**Rationale:**
This is a UI polish change to remove hardcoded foreground colors from most themes, allowing the terminal's default foreground color to be respected. The commit message specifically says "other than shades of purple and holiday" - those special themes keep their foreground colors.

This is a simple, safe change that improves terminal compatibility. Users who have customized their terminal foreground colors will see better integration.

The change only affects 5 files:
- ansi-light.ts
- ansi.ts  
- theme.ts (3 theme definitions: lightTheme, darkTheme, ansiTheme)

We should apply this for consistency with upstream and better terminal integration.

**Conflicts expected:** NO - straightforward value changes, might already be partially applied or might conflict with our own theme customizations, but should be trivial to resolve

---

## 3e9a0a7628 — "chore: remove user query from footer in debug mode (#15169)"
**Verdict:** PICK
**Confidence:** MEDIUM
**Evidence:**
- Upstream change:
  - packages/cli/src/ui/hooks/useGeminiStream.ts:421 removes line: `onDebugMessage(\`User query: '${trimmedQuery}'\`);`
- Current state:
  - packages/cli/src/ui/hooks/useGeminiStream.ts:603 still has: `onDebugMessage(\`User query: '${trimmedQuery}'\`);`
  - The logger?.logMessage call on the next line is kept in both versions

**Rationale:**
This removes redundant debug output. The user query is already logged via `logger?.logMessage(MessageSenderType.USER, trimmedQuery)` so the debug message to the footer is unnecessary noise.

However, confidence is MEDIUM because:
1. Our line number is 603 vs upstream's 421 - significant divergence in file structure
2. Need to verify this is the same context (checking it's in the same function handling user queries)
3. This is a minor UX change that could be debatable - some might want both the footer debug message AND the logger

The change is safe to apply but low priority - it's just reducing debug message clutter.

**Conflicts expected:** NO - single line removal, but need to verify we're removing the right line in the right context given the line number mismatch

---

## Summary

| Commit | Verdict | Priority | Reason |
|--------|---------|----------|--------|
| cc52839f19 | REIMPLEMENT | HIGH | Update all hooks docs to snake_case tool names |
| 5e21c8c03c | SKIP | N/A | Google-internal telemetry, not applicable |
| ba100642e3 | NO_OP | N/A | Already migrated to ACP SDK v0.14.1 |
| db643e9166 | PICK | MEDIUM | Remove hardcoded foreground colors for better terminal compat |
| 3e9a0a7628 | PICK | LOW | Remove redundant debug message |

**Next Actions:**
1. Start with cc52839f19 - critically important for user-facing documentation accuracy
2. Apply db643e9166 - simple theme color fix
3. Apply 3e9a0a7628 after verifying context - minor debug cleanup

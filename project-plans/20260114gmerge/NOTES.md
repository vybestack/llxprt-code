# Execution Notes: v0.12.0 → v0.13.0

## Pre-Execution Notes

### Related Issues
- **Subagent Recovery Turn**: https://github.com/vybestack/llxprt-code/issues/1133
  - Created from upstream `60973aac` - LLxprt needs own implementation
  - Tagged "required for 0.10.0"

### Key SKIP Decisions Rationale

1. **Todo System** (7 commits skipped)
   - LLxprt has completely different todo implementation
   - Upstream: `5d87a7f9`, `121732dd`, `2e003ad8`, `6c8a48db`, `60d2c2cc`, `2b77c1de`, `be36bf61`

2. **Model Routing** (2 commits skipped)
   - LLxprt does NOT support Google's model routing (auto-redirects to lesser models)
   - Upstream: `643f2c09`, `fd2cbaca`

3. **API Key Auth Flow** (1 commit skipped)
   - `06035d5d` - Creates Gemini-specific API key dialog with keychain storage
   - LLxprt uses multi-provider profile system - users configure keys per-profile
   - Not applicable to our architecture

4. **Compression Threshold UI** (2 commits skipped)
   - `3332703f`, `d13482e8` - Makes compressionThreshold UI-editable, requires restart
   - LLxprt has ephemeral-based system that doesn't need restart

5. **debugLogger Migrations** (7 commits skipped)
   - LLxprt already uses DebugLogger, different implementation
   - Upstream: `b31b786d`, `167b6ff8`, `b31f6804`, `ab013fb7`, `e9c7a80b`, `b6524e41`

6. **Subagent System** (2 commits skipped)
   - `1c185524`, `60973aac` - LLxprt has different subagent architecture
   - Created issue #1133 for recovery turn feature

---

## Batch Execution Notes

*(To be filled during execution)*

### Batch 1
**Status:** 
**Date:** 
**Notes:**

### Batch 2
**Status:** 
**Date:** 
**Notes:**

### Batch 3
**Status:** 
**Date:** 
**Notes:**

### Batch 4
**Status:** 
**Date:** 
**Notes:**

### Batch 5
**Status:** 
**Date:** 
**Notes:**

### Batch 6
**Status:** 
**Date:** 
**Notes:**

### Batch 7
**Status:** 
**Date:** 
**Notes:**

### Batch 8
**Status:** 
**Date:** 
**Notes:**

### Batch 9
**Status:** 
**Date:** 
**Notes:**

### Batch 10
**Status:** 
**Date:** 
**Notes:**

### Batch 11
**Status:** 
**Date:** 
**Notes:**

### Batch 12
**Status:** 
**Date:** 
**Notes:**

### Batch 13
**Status:** 
**Date:** 
**Notes:**

### Batch 14 (REIMPLEMENT - Hook Config)
**Status:** 
**Date:** 
**Notes:**

### Batch 15 (REIMPLEMENT - Settings Autogen)
**Status:** 
**Date:** 
**Notes:**

### Batch 16 (REIMPLEMENT - Hook Translator)
**Status:** 
**Date:** 
**Notes:**

### Batch 17 (REIMPLEMENT - Alt Buffer)
**Status:** 
**Date:** 
**Notes:**

### Batch 18 (REIMPLEMENT - Hook I/O)
**Status:** 
**Date:** 
**Notes:**

### Batch 19 (REIMPLEMENT - Hook Planner)
**Status:** 
**Date:** 
**Notes:**

### Batch 20 (REIMPLEMENT - Extensions MCP)
**Status:** 
**Date:** 
**Notes:**

### Batch 21 (REIMPLEMENT - PolicyEngine)
**Status:** 
**Date:** 
**Notes:**

---

## Follow-ups Created

| Issue | Description | Created During |
|-------|-------------|----------------|
| #1133 | Subagent Recovery Turn | Pre-execution |

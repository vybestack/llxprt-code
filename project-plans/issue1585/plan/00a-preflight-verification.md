# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P00a`

## Purpose

Verify package existence, import graph, and release baseline before implementation. Record the approved temporary tools-owned interface/core-adapter path for missing packages/settings, packages/storage, and packages/mcp.

## Prerequisites

- Required: repository checkout and ability to run shell commands.
- Read: `project-plans/issue1585/specification.md`, `project-plans/issue1585/plan/00-overview.md`, `project-plans/issue1585/analysis/final-architecture.md`, and `project-plans/issue1585/analysis/verification-matrix.md`.

## Requirements Implemented (Expanded)

### REQ-PKG-001, REQ-REL-001, REQ-TRACEABILITY

This phase advances REQ-PKG-001.5: if packages/settings and packages/storage remain absent, the approved temporary tools-owned interface/core-adapter path is already recorded in this preflight. Implementation proceeds with the approved temporary interface-adapter path regardless — there is no stop-at-preflight gate for missing packages.

**Full requirement block**: See `plan/requirements-appendix.md` → REQ-TRACEABILITY, REQ-TEMPORARY-INTERFACES

**Behavior specification**:
- GIVEN: GitHub issue #1585 exists with requirements and comments
- WHEN: Preflight verification runs
- THEN: Issue body/comments are captured, traceability table maps requirements to phases, approved missing-packages decision is recorded, MCP ownership is decided

**Why it matters**: Without captured issue evidence, requirements may be lost. Without an approved temporary interface path, implementation cannot proceed when packages/settings/storage/mcp are absent.

## Implementation Tasks

### Step 1: Capture GitHub Issue Body And Comments Evidence

```bash
gh issue view 1585 --comments > project-plans/issue1585/analysis/issue-body-and-comments.md
```

### Step 2: Copy Template And Record Actual Outputs

```bash
cp project-plans/issue1585/analysis/preflight-results-template.md project-plans/issue1585/analysis/preflight-results.md
```

### Step 3: Run Required Evidence Commands

```bash
# Package existence
ls -la packages/tools 2>&1 | tee -a project-plans/issue1585/analysis/preflight-results.md
ls -la packages/settings 2>&1 | tee -a project-plans/issue1585/analysis/preflight-results.md
ls -la packages/storage 2>&1 | tee -a project-plans/issue1585/analysis/preflight-results.md
ls -la packages/mcp 2>&1 | tee -a project-plans/issue1585/analysis/preflight-results.md

# Missing packages reconciliation: verify no settings/storage/mcp dirs exist
find packages -maxdepth 1 -type d \( -name settings -o -name storage -o -name mcp \)
# Expected: no output (packages do not exist yet)

# Verify core services that will need temporary interfaces exist
rg -n "SettingsService|SecureStore|McpClientManager|PromptRegistry" packages/core/src packages/cli/src packages/providers/src -g "*.ts"
# Review: all matches must be covered by temporary interface/adapter mappings

# Workspace baseline
node -e "console.log(require('./package.json').workspaces.join('\n'))" | tee -a project-plans/issue1585/analysis/preflight-results.md

# Providers package metadata pattern
cat packages/providers/package.json | tee -a project-plans/issue1585/analysis/preflight-results.md

# Core package tool exports baseline
node -e "const p=require('./packages/core/package.json'); console.log(Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/')).join('\n'))" | tee -a project-plans/issue1585/analysis/preflight-results.md

# Generate current-tools-files list
find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/current-tools-files.txt

# All tool consumers across packages
rg -n "\.\./tools/|\.\./\.\./tools/|@vybestack/llxprt-code-core/tools/" packages -g "*.ts" > project-plans/issue1585/analysis/all-tool-consumers.txt

# Core import graph
rg -n "from ['\"]\.\./tools/|from ['\"]\.\./\.\./tools/" packages/core/src -g "*.ts" | tee -a project-plans/issue1585/analysis/preflight-results.md

# Provider deep imports
rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts" | tee -a project-plans/issue1585/analysis/preflight-results.md

# Tools-to-core cycle candidates
rg -n "from ['\"]\.\./\(config\|confirmation-bus\|services\|core\|mcp\|ide\|lsp\|storage\|debug\|utils\)/" packages/core/src/tools -g "*.ts" | tee -a project-plans/issue1585/analysis/preflight-results.md

# A2A server tool consumer verification
rg -n "getToolRegistry|ToolRegistry" packages/a2a-server/src -g "*.ts" | tee -a project-plans/issue1585/analysis/preflight-results.md
```

### Step 4: Record Approved Missing-Packages Decision

Edit `analysis/preflight-results.md` to add:

```
## Approved Missing-Packages Decision

packages/settings, packages/storage, and packages/mcp do not exist.
The plan approves a temporary tools-owned interface/core-adapter path:
- tools-owned interfaces in packages/tools/src/interfaces/**
- core adapters in packages/core/src/tools-adapters/**
- packages/tools MUST NOT import packages/core, packages/cli, or packages/providers
- When packages/settings, packages/storage, or packages/mcp are created, replace corresponding temporary interfaces/adapters
- MCP client/manager remain core infrastructure; mcp-tool.ts may move if it depends solely on IMcpToolService
```

### Step 5: Record MCP Ownership Decision

```
## MCP Ownership Decision

- mcp-client.ts: STAYS in core (core MCP infrastructure, OAuth/auth coupling)
- mcp-client-manager.ts: STAYS in core (manages MCP client lifecycle, depends on Config/events)
- mcp-tool.ts: CONDITIONAL MOVE - moves to packages/tools only if constructor accepts IMcpToolService instead of Config+MessageBus directly
```

**Note**: This preflight records the initial MCP ownership assessment. The final decision for `mcp-tool.ts` requires a detailed import analysis artifact `analysis/mcp-tool-decision.md` that MUST be produced before P03 (to inform contract stub design) and before P10/P11 (to determine whether MCP test/migration groups are needed). See `plan/09-tool-inventory-and-move-map.md` Step 10 and `analysis/final-architecture.md` "mcp-tool.ts decision gate" for requirements. Similarly, `analysis/lsp-diagnostics-helper-decision.md` MUST be produced before P03 to inform ILspService contract design and before P11 Group 3 to determine whether lsp-diagnostics-helper.ts moves or stays.

### Step 6: Create Traceability Table From Issue Requirements To Plan Phases

After capturing the issue body and comments, create a traceability table in `analysis/issue-body-and-comments.md` mapping each requirement from the issue body/comments to plan phases and artifacts. This is REQ-TRACEABILITY per `plan/requirements-appendix.md`.

**Traceability table format** (add as a section at the end of `analysis/issue-body-and-comments.md`):

```markdown
## Traceability: Issue Requirements → Plan Phases

| Issue Requirement | Plan Phase(s) | Artifact(s) | Status |
| --- | --- | --- | --- |
| Extract tools package | P03, P06-P16 | packages/tools/ | Planned |
| No tools→core dependency | P04, P10, P11, P15 | forbidden-imports.test.ts, boundary scan | Planned |
| MCP client/manager stay in core | P09, P15 | move-map-final.md (STAY_CORE_INFRASTRUCTURE) | Planned |
| <add rows from actual issue body/comments> | ... | ... | ... |
```

This traceability table ensures no issue requirement is lost during implementation. The implementation agent MUST review the issue body and comments and add a row for every distinct requirement or actionable comment.

**Evidence command for traceability**:
```bash
gh issue view 1585 --comments > project-plans/issue1585/analysis/issue-body-and-comments.md
```

After creating the file, review the issue body and comments and add the traceability section to that same file.

**Exhaustiveness rule**: Every distinct requirement in the issue body and comments MUST have a traceability row. If a comment raises a concern not covered by the plan, flag it as UNCOVERED. UNCOVERED items require a resolution plan before proceeding past P00a, but they do not block the approved temporary interface-adapter path — the plan may be updated to address them rather than stopping implementation.

### Files To Create Or Modify

- Create: `project-plans/issue1585/analysis/preflight-results.md`
- Create: `project-plans/issue1585/analysis/issue-body-and-comments.md`
- Create: `project-plans/issue1585/analysis/current-tools-files.txt`
- Create: `project-plans/issue1585/analysis/all-tool-consumers.txt`
- Create: `project-plans/issue1585/.completed/P00a.md`

## Verification Commands

```bash
# Verify preflight results exist with approved decisions
test -f project-plans/issue1585/analysis/preflight-results.md
grep -c "Approved Missing-Packages Decision" project-plans/issue1585/analysis/preflight-results.md
grep -c "MCP Ownership Decision" project-plans/issue1585/analysis/preflight-results.md
test -f project-plans/issue1585/analysis/current-tools-files.txt
test -f project-plans/issue1585/analysis/all-tool-consumers.txt
# Verify issue body/comments captured
test -f project-plans/issue1585/analysis/issue-body-and-comments.md
grep -c "traceability" project-plans/issue1585/analysis/issue-body-and-comments.md
```

## Semantic Verification Checklist

- [ ] I verified actual package existence, not just assumed the template output.
- [ ] I recorded the approved temporary interface-adapter path for missing packages.
- [ ] I recorded the MCP ownership decision (initial assessment; final decision requires analysis/mcp-tool-decision.md before P03/P10/P11).
- [ ] I generated complete tool file and consumer inventories.
- [ ] I captured the GitHub issue body and comments.
- [ ] I created a traceability table mapping issue requirements to plan phases.
- [ ] I verified A2A server tool consumer usage (getToolRegistry/ToolRegistry).
- [ ] No production code was changed in this phase.

## Success Criteria

- Preflight results exist and include actual command outputs.
- Approved missing-packages decision is recorded with the tools-owned interface/core-adapter path.
- MCP ownership is decided.
- No unapproved tools-to-core dependency pathway exists in the approved design.

## Failure Recovery

Do not proceed to P01. Fix evidence collection or seek coordinator approval for the missing-packages decision. Note: UNCOVERED traceability items should be resolved by updating the plan, not by halting implementation indefinitely.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P00a.md` with actual files changed, commands run, outputs, and semantic assessment.

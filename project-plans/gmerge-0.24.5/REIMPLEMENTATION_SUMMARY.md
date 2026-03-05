# SHA-Plan Playbook Reimplementation Summary

All 8 playbooks have been reimplemented based on deepthinker review findings.

## Playbooks Fixed

### Policy Engine Playbooks

1. **37be16243557-plan.md** - Shell command allowlisting
   - Added LLxprt File Existence Map with verified paths
   - Removed vague language ("if exists", "or equivalent")
   - Added preflight checks section
   - Added inter-playbook dependencies
   - Added deterministic verification commands

2. **d3c206c6770d-plan.md** - Unify shell security policy
   - Split into 3 phased checkpoints (14 files is too large)
   - Added comprehensive file existence map
   - Verified shell-utils functions exist in LLxprt
   - Resolved all conditional/vague language
   - Added phase-by-phase verification commands

### Extension Management Playbooks

3. **563d81e08e73-plan.md** - Extension install/uninstall
   - Resolved command layer ambiguity (UI slash commands vs yargs CLI)
   - Verified extensionsCommand.ts location
   - Added file existence map with ExtensionLoader verification
   - Concrete paths for all files

4. **ec11b8afbf38-plan.md** - Extension settings display
   - Fixed upstream branding: uses GeminiCLIExtension (legacy name retained)
   - Added search-based discovery for UI component paths
   - Verified core config types exist
   - Concrete verification steps

5. **4c67eef0f299-plan.md** - Missing settings warning
   - Fixed upstream package reference leakage
   - Verified extensionSettings.ts infrastructure
   - Added comprehensive test suite template
   - Checked for coreEvents.emitFeedback (may need debugLogger fallback)

6. **7edd8030344e-plan.md** - Settings command exit fix
   - Verified yargs command structure
   - Added search steps to locate exitCli utility
   - Comprehensive test suite for set/list subcommands
   - Manual verification steps

## Common Fixes Applied to ALL Playbooks

1. **LLxprt File Existence Map**
   - Every upstream file mapped to verified LLxprt path
   - Existence verified via file system checks and searches
   - Action column: create/modify/skip with reason

2. **Removed Vague Language**
   - Replaced "if exists" → verified actual paths
   - Replaced "or equivalent" → concrete LLxprt paths
   - Replaced "copy upstream" → specific modification steps

3. **Fixed Branding Leakage**
   - Replaced `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`
   - Kept `GeminiCLIExtension` (legacy upstream naming verified in codebase)
   - Updated command names: "gemini extensions settings" → "llxprt extensions settings"

4. **Added Preflight Checks**
   - Concrete bash commands to verify files exist
   - Check for required functions/symbols
   - Verify dependencies before implementation

5. **Added Inter-Playbook Dependencies**
   - Exact files/symbols consumed from prior playbooks
   - Clear dependency chains
   - Breaking changes documented

6. **Added Deterministic Verification**
   - `npm run typecheck`
   - `npm run test -- <specific-path>`
   - `npm run lint`
   - Targeted tests for each modified file
   - Integration tests where applicable

## Already Passing Playbooks (Not Modified)

- `dcd2449b1a16-plan.md` - Deprecate legacy (PASSED review)
- `ec79fe1ab269-plan.md` - Update notification (PASSED review)

## Verification Summary

All playbooks now include:
- File existence verification (no speculation)
- Concrete LLxprt paths (no "upstream equivalent")
- Preflight checks (verify before implementing)
- Inter-playbook contracts (explicit dependencies)
- Deterministic verification (repeatable test commands)
- No time estimates (removed all min/hours/days references)

## Key Findings from Codebase Analysis

1. **Extension System**: Uses `GeminiCLIExtension` (upstream legacy naming)
2. **Command Structure**: 
   - Yargs CLI: `packages/cli/src/commands/extensions/`
   - Interactive slash: `packages/cli/src/ui/commands/extensionsCommand.ts`
3. **Shell Utils**: Functions verified at `packages/core/src/utils/shell-utils.ts`
4. **Policy Engine**: Exists at `packages/core/src/policy/policy-engine.ts`
5. **Extension Settings**: Infrastructure at `packages/cli/src/config/extensions/`

## Implementation Order

1. **Policy**: 37be16243557 → d3c206c6770d (Phase 1, 2, 3)
2. **Extensions**: 563d81e08e73 → ec11b8afbf38 → 4c67eef0f299 → 7edd8030344e

All playbooks are now ready for implementation.

# Main → Agentic Merge Plan (2025-11-01)

## Executive Summary

**Objective:** Complete the in-progress merge of origin/main (v0.4.7 + bug fixes) into the agentic branch (subagent runtime architecture).

**Status:**
- Merge started by Codex, left incomplete with 56 unmerged files
- Currently merging commit `e170bc6ed` from origin/main
- Merge base: `5dcebb0f6`
- Target version: **0.5.0** (reflects major architectural changes in agentic)

**Strategy:** Parallel subagent execution across independent subsystems, followed by sequential integration and validation.

## Current State Analysis

### Branch Divergence
- **origin/main:** ~70 commits ahead of merge base
  - v0.4.7 release
  - Provider aliases feature (#382)
  - Auth status improvements (#403)
  - Bug fixes (mixed content #415, context limits #386, etc.)

- **agentic:** ~96 commits ahead of merge base
  - Subagent orchestrator runtime flow
  - Per-agent tool governance
  - Runtime context isolation
  - Agent ID propagation through tool pipeline
  - Stateless provider runtime contexts

### Conflicts Summary
- **56 files** with unmerged conflicts (UU or AA status)
- **65 conflict markers** remaining in packages/
- Categories:
  - Package manifests: 6 files
  - Core runtime: 8 files
  - Providers: 9 files
  - Auth/OAuth: 5 files
  - CLI config/settings: 6 files
  - UI/commands: 11 files
  - Tests: 8 files
  - Docs: 3 files

### Merge Philosophy

**Default Strategies:**
1. **Runtime Architecture:** KEEP agentic (runtime isolation, subagent orchestration, tool governance)
2. **Bug Fixes:** MERGE from main (mixed content fix, context limits, etc.)
3. **New Features:** MERGE from main (provider aliases, --set flag, auth improvements)
4. **Branding:** KEEP llxprt-code (main already has this)
5. **Version:** SET to 0.5.0 (new major version for agentic features)

## Execution Phases

### Phase 1: Foundations (Sequential) - 30 minutes

**Must complete before Phase 2 begins.**

#### Task 1a: Package Manifests & Version Bump

**Files:**
- `package.json` (root)
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/test-utils/package.json`
- `packages/a2a-server/package.json`
- `packages/vscode-ide-companion/package.json`

**Strategy:**
1. Check current versions in both branches:
   - agentic: likely 0.4.5
   - main: 0.4.7
2. Set ALL to `0.5.0` in resolved version
3. Merge dependency changes from both sides:
   - Keep any new dependencies from main
   - Keep any new dependencies from agentic
   - For version conflicts, prefer main's versions (more recently tested)
4. Keep any new scripts from both sides
5. **DO NOT resolve package-lock.json yet** - will regenerate in Phase 5

**Decision Criteria:**
- If a dependency exists in both with different versions, take main's version
- If a dependency is only in agentic, keep it
- If a dependency is only in main, add it
- Preserve all workspaces, engines, postinstall scripts

**Output:** All package.json files resolved and staged

#### Task 1b: Core Type Definitions

**Files:**
- `packages/core/src/types/modelParams.ts`
- `packages/core/src/index.ts`

**Strategy:**
1. `modelParams.ts`:
   - Keep agentic's runtime context types (RuntimeContext, AgentId, etc.)
   - Merge any new model parameter types from main
   - Preserve both sets of exports

2. `index.ts`:
   - Export everything from both branches
   - Keep agentic's new exports (runtime APIs, agent types)
   - Keep main's new exports (any new utilities or types)

**Decision Criteria:**
- Both files typically add exports, rarely remove them
- If there are conflicting type definitions, keep agentic's (it's the more recent architecture)
- If main added new utilities that don't conflict, include them

**Output:** Type files resolved and staged

**Checkpoint:** After Phase 1, run `npm run typecheck` on resolved files to verify no breaking changes.

---

### Phase 2: Core Systems (PARALLEL) - 2-3 hours

**Launch 5 agents in parallel. Each agent works independently.**

#### Agent 2a: Core Runtime Engine

**Responsibility:** Preserve agentic's runtime architecture while merging main's bug fixes

**Files:**
- `packages/core/src/core/geminiChat.ts` (CRITICAL)
- `packages/core/src/core/client.ts` (CRITICAL)
- `packages/core/src/core/geminiChat.test.ts`
- `packages/core/src/core/client.test.ts`

**Agentic Features to PRESERVE:**
- Runtime context passing through all methods
- Agent ID propagation
- Stateless provider contexts
- Tool governance integration
- Subagent orchestration hooks

**Main Features to MERGE:**
- Fix for mixed content tool responses (#415) - in client.ts
- Context limit enforcement improvements (#386)
- Any streaming fixes
- Test coverage improvements

**Strategy:**
1. `geminiChat.ts`:
   - Keep agentic's constructor signature (adds runtime context)
   - Keep agentic's method signatures (runtime context parameters)
   - Merge main's bug fixes in method bodies
   - Preserve agentic's tool filtering logic
   - Merge main's context window logic improvements

2. `client.ts`:
   - Keep agentic's runtime context APIs
   - CRITICAL: Merge main's mixed content fix (#415) - this prevents tool responses being misidentified as user messages
   - Keep agentic's agent context propagation
   - Merge any streaming improvements from main

3. Tests:
   - Combine test coverage from both
   - Update tests to match merged implementation signatures
   - Keep agentic's runtime context test cases
   - Keep main's new bug fix test cases

**Red Flags:**
- If main removed runtime context parameters → DON'T accept that change
- If main simplified APIs that agentic made more complex for runtime isolation → Keep agentic's version
- If you see tool response handling changes in main → Carefully merge to preserve both fixes

**Validation:**
- After resolving, run: `npx vitest packages/core/src/core/geminiChat.test.ts`
- After resolving, run: `npx vitest packages/core/src/core/client.test.ts`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase2a-runtime.md`

---

#### Agent 2b: Provider System

**Responsibility:** Merge provider improvements while maintaining runtime context architecture

**Files:**
- `packages/core/src/providers/BaseProvider.ts`
- `packages/core/src/providers/IProvider.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.oauth.test.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.toolFormatDetection.test.ts`
- `packages/core/src/providers/gemini/GeminiProvider.ts`
- `packages/core/src/providers/openai/OpenAIProvider.ts`
- `packages/core/src/providers/openai/OpenAIProvider.modelParamsAndHeaders.test.ts`
- `packages/core/src/providers/openai/OpenAIProvider.toolFormatDetection.test.ts`
- `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`

**Agentic Features to PRESERVE:**
- Runtime context in provider interfaces
- Stateless provider design
- Context-scoped authentication
- Agent-aware provider selection

**Main Features to MERGE:**
- Provider base URL reporting (for /about command)
- OAuth improvements
- Tool format detection tests
- Any model parameter handling improvements

**Strategy:**
1. `IProvider.ts` & `BaseProvider.ts`:
   - Keep agentic's interface additions (runtime context params)
   - Merge any new methods from main
   - Preserve abstract base implementation from agentic

2. Provider implementations (Anthropic, Gemini, OpenAI):
   - Keep agentic's runtime context passing
   - Merge main's auth status improvements
   - Merge main's base URL reporting
   - Keep both sets of test improvements

**Decision Criteria:**
- If method signatures conflict, prefer agentic's (has runtime context)
- If method bodies have different logic, merge both improvements
- If main added new methods without runtime context, add the context parameter

**Validation:**
- Run provider tests: `npx vitest packages/core/src/providers/`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase2b-providers.md`

---

#### Agent 2c: Auth & OAuth System

**Responsibility:** Merge OAuth and auth improvements from both branches

**Files:**
- `packages/cli/src/auth/oauth-manager.ts`
- `packages/cli/src/auth/oauth-manager.spec.ts`
- `packages/cli/src/providers/oauth-provider-registration.ts`
- `packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts`
- `packages/core/src/auth/precedence.ts`
- `packages/core/src/auth/precedence.test.ts`

**Agentic Features to PRESERVE:**
- Context-aware OAuth registration
- Runtime-scoped auth handling

**Main Features to MERGE:**
- Auth status reporting improvements (#403)
- Any OAuth flow fixes
- Token handling improvements

**Strategy:**
1. `oauth-manager.ts`:
   - Merge both implementations
   - Keep agentic's context awareness
   - Merge main's status reporting

2. `oauth-provider-registration.ts`:
   - This is a "both added" (AA) file
   - Compare implementations from both branches
   - Take the more complete version or merge features

3. Auth precedence:
   - Merge precedence rule improvements from both
   - Keep test coverage from both

**Decision Criteria:**
- For AA files: read both versions, determine which is more complete
- Prefer preserving context-aware patterns from agentic
- Merge any new OAuth providers from main

**Validation:**
- Run: `npx vitest packages/cli/src/auth/`
- Run: `npx vitest packages/core/src/auth/`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase2c-auth.md`

---

#### Agent 2d: Tools & Services

**Responsibility:** Merge tool and service improvements

**Files:**
- `packages/core/src/tools/todo-read.ts`
- `packages/core/src/tools/todo-write.ts`
- `packages/core/src/tools/todo-write.test.ts`
- `packages/core/src/services/complexity-analyzer.ts`
- `packages/core/src/services/complexity-analyzer.test.ts`

**Agentic Features to PRESERVE:**
- Any runtime context integration in tools
- Agent-aware tool execution

**Main Features to MERGE:**
- Todo tool schema improvements
- Complexity analyzer enhancements
- Test improvements

**Strategy:**
1. Todo tools:
   - Keep agentic's implementations
   - Merge any schema fixes from main
   - Merge test improvements

2. Complexity analyzer:
   - This may be a "both added" (AA) file
   - If so, take the more feature-complete version
   - Merge test coverage from both

**Decision Criteria:**
- If both changed the same tool, prefer agentic but merge main's bug fixes
- For AA files, compare and take the better implementation

**Validation:**
- Run: `npx vitest packages/core/src/tools/`
- Run: `npx vitest packages/core/src/services/complexity-analyzer`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase2d-tools.md`

---

#### Agent 2e: Prompt Configs & Docs

**Responsibility:** Merge documentation and prompt configurations

**Files:**
- `packages/core/src/prompt-config/defaults/core.md`
- `packages/core/src/prompt-config/defaults/providers/gemini/core.md`
- `packages/core/src/prompt-config/defaults/providers/anthropic/core.md` (DU - deleted in upstream)
- `packages/core/src/prompt-config/defaults/providers/openai/core.md` (DU - deleted in upstream)
- `packages/core/src/prompt-config/defaults/providers/openai/tools/todo-pause.md` (DU)
- `docs/settings-and-profiles.md`

**Strategy:**
1. `core.md` files:
   - Merge content from both
   - Keep agentic's additions about runtime/subagents
   - Keep main's improvements to existing content

2. Provider-specific prompts:
   - If main deleted them (DU status), check if this is intentional consolidation
   - If they consolidated to just `core.md`, accept the deletion
   - Otherwise preserve if they contain valuable context

3. `settings-and-profiles.md`:
   - Merge both documentation updates
   - Combine feature descriptions from both

**Decision Criteria:**
- Documentation conflicts are usually easy - combine both
- If main deleted provider-specific prompts, likely consolidating to single core.md
- Preserve any subagent/runtime documentation from agentic

**Validation:**
- Visual inspection of resolved docs
- Check for broken markdown syntax

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase2e-docs.md`

---

### Phase 3: Platform Layer (PARALLEL) - 1-2 hours

**Launch 3 agents in parallel. Wait for Phase 2 to complete first.**

#### Agent 3a: Config & Settings

**Responsibility:** Merge CLI configuration and settings features

**Files:**
- `packages/cli/src/config/config.ts`
- `packages/cli/src/settings/ephemeralSettings.ts` (AA - both added)

**Agentic Features to PRESERVE:**
- Runtime context initialization
- Runtime settings integration
- Any agent-aware config

**Main Features to MERGE:**
- `--set` flag for ephemeral settings (#382)
- `--dumponerror` flag
- Profile loading improvements
- Any CLI argument additions

**Strategy:**
1. `config.ts`:
   - Merge imports from both
   - Keep agentic's runtime initialization calls
   - Merge main's new CLI arguments (--set, --dumponerror)
   - Merge main's argument parsing logic
   - Keep agentic's provider switching logic
   - Preserve runtime context setup from agentic

2. `ephemeralSettings.ts` (AA):
   - Both branches added this file
   - Read both versions
   - Take the more complete version
   - If they're different approaches, prefer main's (likely more tested)

**Key Merge Points:**
- Around line 290: main adds --dumponerror option
- Around line 456: main adds --set option with coerce logic
- Look for runtime context setup in agentic version - preserve it
- Parse bootstrap args integration from agentic - preserve it

**Decision Criteria:**
- CLI features: merge from main
- Runtime integration: preserve from agentic
- For AA files: compare both, take better implementation

**Validation:**
- Build the CLI package: `cd packages/cli && npm run build`
- Check help output: `node packages/cli/dist/index.js --help`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase3a-config.md`

---

#### Agent 3b: UI & Commands

**Responsibility:** Merge UI improvements and command features

**Files:**
- `packages/cli/src/ui/App.tsx`
- `packages/cli/src/ui/commands/aboutCommand.ts`
- `packages/cli/src/ui/commands/profileCommand.ts`
- `packages/cli/src/ui/commands/profileCommand.test.ts`
- `packages/cli/src/ui/commands/providerCommand.ts`
- `packages/cli/src/ui/commands/setCommand.ts`
- `packages/cli/src/ui/commands/setCommand.test.ts`
- `packages/cli/src/ui/commands/toolsCommand.ts`
- `packages/cli/src/ui/commands/toolsCommand.tsx` (DU - one version is .tsx, might be rename)
- `packages/cli/src/ui/components/AuthDialog.tsx`
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`
- `packages/cli/src/ui/containers/SessionController.tsx`

**Agentic Features to PRESERVE:**
- Runtime context in UI components
- Agent-aware UI updates
- Tool governance display

**Main Features to MERGE:**
- /about command showing provider and base URL (#406)
- Auth status display improvements (#403)
- /set command implementation
- Profile command improvements
- Provider command improvements

**Strategy:**
1. `App.tsx`:
   - Merge both import lists
   - Keep agentic's runtime provider integration
   - Merge main's UI improvements
   - Combine component additions from both

2. Commands:
   - `/about`: Merge main's provider/base URL display into agentic's version
   - `/profile`: Merge improvements from both
   - `/provider`: Merge improvements from both
   - `/set`: This is new from main - merge it in
   - `/tools`: Check if .ts vs .tsx is just extension change

3. Components:
   - Merge auth dialog improvements from both
   - Merge tool group message improvements
   - Merge session controller improvements

**Decision Criteria:**
- UI features: merge from main
- Runtime integration: preserve from agentic
- If both improved same command, combine improvements

**Validation:**
- Build: `cd packages/cli && npm run build`
- Test commands: `npx vitest packages/cli/src/ui/commands/`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase3b-ui.md`

---

#### Agent 3c: Provider Management & Integration

**Responsibility:** Merge provider management and integration layers

**Files:**
- `packages/cli/src/providers/providerManagerInstance.ts`
- `packages/cli/src/gemini.tsx`
- `packages/cli/src/zed-integration/zedIntegration.ts`

**Agentic Features to PRESERVE:**
- Runtime context in provider management
- Agent-aware provider selection
- Tool governance integration

**Main Features to MERGE:**
- Provider alias system (#382)
- Provider fallback fixes (#390)
- Any provider registration improvements

**Strategy:**
1. `providerManagerInstance.ts`:
   - Keep agentic's runtime context integration
   - Merge main's provider alias support
   - Merge main's fallback prevention logic
   - Combine initialization logic from both

2. `gemini.tsx`:
   - Merge both main entry point improvements
   - Keep agentic's runtime initialization
   - Merge main's provider setup

3. `zedIntegration.ts`:
   - Merge improvements from both
   - Keep runtime context if present in agentic

**Decision Criteria:**
- Provider management logic: keep agentic's architecture
- New features (aliases): merge from main
- Bug fixes (fallback): merge from main

**Validation:**
- Build: `npm run build`
- Test provider loading: `npx vitest packages/cli/src/providers/`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase3c-provider-mgmt.md`

---

### Phase 4: Test Infrastructure (Quick) - 15 minutes

**Single agent, runs after Phase 3**

#### Agent 4: Test Setup

**Responsibility:** Merge test configuration

**Files:**
- `packages/cli/test-setup.ts`
- `packages/cli/vitest.config.ts`

**Strategy:**
1. Merge both test setup configurations
2. Keep any test utilities from both
3. Merge vitest config from both

**Decision Criteria:**
- Test configs usually accumulate, rarely conflict
- Keep all test utilities from both sides

**Validation:**
- Run: `npx vitest --version`
- Try running a test: `npx vitest packages/cli/src/config/settings.test.ts`

**Output:** Write results to `project-plans/20251101mainmergeclaude/phase4-tests.md`

---

### Phase 5: Final Integration (Sequential) - 1-2 hours

**Single agent, runs after all previous phases complete**

#### Agent 5: Integration & Validation

**Responsibility:** Final integration, package-lock regeneration, and full validation

**Tasks:**

**Step 1: Regenerate package-lock.json (10 min)**
```bash
# Delete the conflicted package-lock.json
git rm package-lock.json

# Regenerate from resolved package.json files
npm install

# Stage the new file
git add package-lock.json
```

**Step 2: Fix TypeScript Errors (30-60 min)**
```bash
npm run typecheck 2>&1 | tee project-plans/20251101mainmergeclaude/typecheck-errors.log
```

Common expected errors:
- Import path mismatches
- Missing runtime context parameters in function calls
- Type mismatches from merged interfaces
- Missing exports

Fix each error systematically. For each error:
1. Identify which file
2. Check if it's from incomplete merge resolution
3. Fix and re-run typecheck
4. Document fix in `phase5-integration.md`

**Step 3: Linting (15 min)**
```bash
npm run lint 2>&1 | tee project-plans/20251101mainmergeclaude/lint-errors.log
```

Fix lint errors:
- Unused imports from merge
- Formatting issues
- Any lint rule violations

**Step 4: Format (5 min)**
```bash
npm run format
git add -A
```

**Step 5: Run Tests (30-45 min)**
```bash
# Kill any running vitest instances first (per user instructions)
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9

# Run full test suite
npm run test:ci 2>&1 | tee project-plans/20251101mainmergeclaude/test-results.log

# Check for remaining vitest processes and kill them
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9
```

Expected outcome:
- Some tests may fail initially
- Fix test failures related to merge conflicts
- Existing failing tests (pre-merge) can be noted but not blocking

**Step 6: Build (10 min)**
```bash
npm run build 2>&1 | tee project-plans/20251101mainmergeclaude/build.log
```

Must succeed with no errors.

**Step 7: Smoke Test (5 min)**
```bash
DEBUG=llxprt:* node scripts/start.js --profile-load synthetic --prompt "have joethecoder analyze the codebase and give 5 recommendations but make no changes"
```

Expected behavior:
- CLI starts successfully
- Profile loads (synthetic provider)
- Agent executes (joethecoder)
- Makes no changes (read-only operations)
- Returns 5 recommendations
- Exits cleanly

If this fails, document the failure and investigate.

**Step 8: Final Verification Checklist**

Check off each item:
- [ ] All conflicts resolved (git status shows no UU or AA)
- [ ] package-lock.json regenerated
- [ ] npm run typecheck passes (0 errors)
- [ ] npm run lint passes (0 errors)
- [ ] npm run format completed
- [ ] npm run test:ci passes (or documents expected failures)
- [ ] npm run build succeeds
- [ ] Smoke test completes successfully
- [ ] All staged files reviewed

**Step 9: Create Merge Commit**

```bash
# Review all changes
git status

# Commit the merge
git commit -S -m "$(cat <<'EOF'
Merge main (v0.4.7) into agentic branch

This merge integrates ~70 commits from origin/main into the agentic branch,
combining main's v0.4.7 release features with agentic's subagent runtime
architecture. Version bumped to 0.5.0 to reflect major architectural changes.

Features merged from main:
- Provider alias system (#382)
- Auth status reporting improvements (#403, #395)
- Mixed content tool response fix (#415)
- Context limit enforcement (#386)
- Markdown table wrapping (#404)
- Environment variable updates (#392)
- Provider fallback fixes (#390)
- --set flag for ephemeral settings
- --dumponerror flag for debugging
- Improved /about command with provider details (#406)

Features preserved from agentic:
- Subagent orchestrator runtime flow
- Per-agent tool governance
- Runtime context isolation
- Agent ID propagation through tool pipeline
- Stateless provider runtime contexts
- Tool execution scheduling and queuing
- Subagent delegation policy enforcement

Version: 0.5.0
Merge base: 5dcebb0f6
Main commit: e170bc6ed
Agentic commit: b8b3bfa9a
EOF
)"
```

**Output:** Write comprehensive results to `project-plans/20251101mainmergeclaude/phase5-integration.md`

---

## Recovery Instructions

If execution is interrupted at any phase:

### Phase 1 Incomplete
- Check which package.json files are resolved: `git status | grep package.json`
- Resume with remaining files
- Re-run type exports resolution if needed

### Phase 2 Incomplete
- Check phase reports: `ls project-plans/20251101mainmergeclaude/phase2*.md`
- Identify which agents completed
- Re-launch incomplete agents

### Phase 3 Incomplete
- Check phase reports: `ls project-plans/20251101mainmergeclaude/phase3*.md`
- Verify Phase 2 completed first
- Re-launch incomplete agents

### Phase 4 Incomplete
- Quick to re-run, just resolve test files

### Phase 5 Incomplete
- Check which step failed in phase5-integration.md
- Resume from that step
- Most steps are idempotent (can re-run safely)

### General Recovery
1. Check git status: `git status --porcelain | grep "^UU\|^AA"`
2. Check phase reports: `ls project-plans/20251101mainmergeclaude/`
3. Identify last completed phase
4. Resume from next phase

### Abort and Restart
If merge is completely corrupted:
```bash
git merge --abort
git merge origin/main
# Start from Phase 1 again
```

---

## Success Criteria

Merge is complete when:
1. ✅ All 56 files resolved (no UU or AA in git status)
2. ✅ Version set to 0.5.0 in all package.json files
3. ✅ package-lock.json regenerated cleanly
4. ✅ npm run typecheck passes (0 errors)
5. ✅ npm run lint passes (0 errors)
6. ✅ npm run format completed and changes staged
7. ✅ npm run test:ci passes (or documents acceptable failures)
8. ✅ npm run build succeeds
9. ✅ Smoke test with synthetic profile succeeds
10. ✅ Merge commit created with detailed message
11. ✅ Both main features and agentic features functional

---

## Key Files Reference

### Most Critical (High Risk)
- `packages/core/src/core/geminiChat.ts` - Core runtime engine
- `packages/core/src/core/client.ts` - Client with mixed content fix
- `packages/core/src/providers/BaseProvider.ts` - Provider base
- `packages/cli/src/config/config.ts` - CLI configuration
- `packages/cli/src/ui/App.tsx` - Main UI component

### Important Context
- Agentic branch has been developing runtime isolation architecture
- Main branch has been accumulating bug fixes and features
- Both branches are production-quality, just diverged in focus
- User wants both sets of features, not one or the other

### Testing Priority
1. Core runtime tests must pass
2. Provider tests must pass
3. UI/command tests should pass
4. Integration smoke test must succeed

---

## Execution Notes

- Each agent should write a detailed report of their work
- Each agent should note any unexpected conflicts or decisions
- Each agent should validate their work before reporting complete
- Phase 5 agent coordinates final integration and must not skip steps
- All git operations must use GPG signing (-S flag)

---

## Timeline Estimate

- Phase 1: 30 minutes (sequential)
- Phase 2: 2-3 hours (parallel, 5 agents)
- Phase 3: 1-2 hours (parallel, 3 agents)
- Phase 4: 15 minutes (sequential)
- Phase 5: 1-2 hours (sequential)

**Total: 5-8 hours of agent work time**
**Wall clock time: ~3-4 hours (due to parallelization)**

---

## Files Checklist

Complete list of 56 unmerged files to resolve:

### Package Manifests (6)
- [ ] package.json
- [ ] package-lock.json
- [ ] packages/cli/package.json
- [ ] packages/core/package.json
- [ ] packages/test-utils/package.json
- [ ] packages/a2a-server/package.json
- [ ] packages/vscode-ide-companion/package.json

### Core Runtime (8)
- [ ] packages/core/src/core/geminiChat.ts
- [ ] packages/core/src/core/geminiChat.test.ts
- [ ] packages/core/src/core/client.ts
- [ ] packages/core/src/core/client.test.ts
- [ ] packages/core/src/types/modelParams.ts
- [ ] packages/core/src/index.ts

### Providers (10)
- [ ] packages/core/src/providers/BaseProvider.ts
- [ ] packages/core/src/providers/IProvider.ts
- [ ] packages/core/src/providers/anthropic/AnthropicProvider.ts
- [ ] packages/core/src/providers/anthropic/AnthropicProvider.oauth.test.ts
- [ ] packages/core/src/providers/gemini/GeminiProvider.ts
- [ ] packages/core/src/providers/openai/OpenAIProvider.ts
- [ ] packages/core/src/providers/openai/OpenAIProvider.modelParamsAndHeaders.test.ts
- [ ] packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts
- [ ] packages/cli/src/providers/providerManagerInstance.ts

### Auth/OAuth (5)
- [ ] packages/cli/src/auth/oauth-manager.ts
- [ ] packages/cli/src/auth/oauth-manager.spec.ts
- [ ] packages/cli/src/providers/oauth-provider-registration.ts (AA)
- [ ] packages/core/src/auth/precedence.ts
- [ ] packages/core/src/auth/precedence.test.ts

### Config/Settings (4)
- [ ] packages/cli/src/config/config.ts
- [ ] packages/cli/src/settings/ephemeralSettings.ts (AA)
- [ ] packages/cli/src/gemini.tsx

### UI/Commands (11)
- [ ] packages/cli/src/ui/App.tsx
- [ ] packages/cli/src/ui/commands/aboutCommand.ts
- [ ] packages/cli/src/ui/commands/profileCommand.ts
- [ ] packages/cli/src/ui/commands/profileCommand.test.ts
- [ ] packages/cli/src/ui/commands/providerCommand.ts
- [ ] packages/cli/src/ui/commands/setCommand.ts
- [ ] packages/cli/src/ui/commands/setCommand.test.ts
- [ ] packages/cli/src/ui/commands/toolsCommand.ts
- [ ] packages/cli/src/ui/components/AuthDialog.tsx
- [ ] packages/cli/src/ui/components/messages/ToolGroupMessage.tsx
- [ ] packages/cli/src/ui/containers/SessionController.tsx

### Tools/Services (5)
- [ ] packages/core/src/tools/todo-read.ts
- [ ] packages/core/src/tools/todo-write.ts
- [ ] packages/core/src/tools/todo-write.test.ts
- [ ] packages/core/src/services/complexity-analyzer.ts (AA)
- [ ] packages/core/src/services/complexity-analyzer.test.ts (AA)

### Tests (3)
- [ ] packages/cli/test-setup.ts
- [ ] packages/cli/vitest.config.ts
- [ ] packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts (AA)

### Docs/Prompts (6)
- [ ] docs/settings-and-profiles.md
- [ ] packages/core/src/prompt-config/defaults/core.md
- [ ] packages/core/src/prompt-config/defaults/providers/gemini/core.md
- [ ] packages/core/src/prompt-config/defaults/providers/anthropic/core.md (DU)
- [ ] packages/core/src/prompt-config/defaults/providers/openai/core.md (DU)
- [ ] packages/core/src/prompt-config/defaults/providers/openai/tools/todo-pause.md (DU)

### Integration (1)
- [ ] packages/cli/src/zed-integration/zedIntegration.ts

**Total: 56 files**

Legend:
- UU = Unmerged, updated in both branches
- AA = Both added (new file in both branches)
- DU = Deleted in upstream (main), updated in agentic

---

End of Plan

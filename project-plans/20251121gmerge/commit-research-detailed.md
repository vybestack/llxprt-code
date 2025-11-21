# Upstream Commit Research: Detailed Analysis

Research date: 2025-11-21
Upstream: google-gemini/gemini-cli

## 1. Commit 74447fcff - VSCode IDE Companion Release Script

**Commit:** `74447fcff2c71a11a07149b4c302d5e3c0ed469b`
**Title:** feat(vscode-ide-companion): add script to check for new release (#9160)
**Author:** Shreya Keshive

### What It Does
Adds a Node.js script at `packages/vscode-ide-companion/scripts/check-vscode-release.js` that:
- Queries Google Cloud Storage bucket (`gs://gemini-cli-vscode-extension/release/1p/signed`) for the latest signed VSIX file
- Extracts version number and commit hash from the filename pattern `signed-gemini-cli-vscode-ide-companion-X.Y.Z-HASH.vsix`
- Runs `git log` to find commits since the last release in the `packages/vscode-ide-companion` directory
- Checks for dependency changes by diffing `NOTICES.txt`
- Reports whether a new release is needed

This is specifically for Google's internal release process for their VS Code extension.

### What We Currently Have
We have a `packages/vscode-ide-companion/scripts/` directory with only:
- `generate-notices.js` - for generating license notices

We do NOT have a release checking script.

### Conflicts/Compatibility
None. This is purely a Google-internal release automation tool.

### Recommendation: **SKIP**

**Reasoning:**
- This script is tightly coupled to Google's Cloud Storage infrastructure
- We use GitHub for releases, not GCS
- We don't have the same signed VSIX publishing workflow
- If we need release automation, we should build it for our own infrastructure

---

## 2. Commit 80a414be9 - Mac Required Test

**Commit:** `80a414be975b257eb97bb173bfffdb5afb6d2dc4`
**Title:** Mac required (#10007)
**Author:** matt korwel

### What It Does
Changes GitHub Actions CI workflow to make Mac tests required for CI to pass:
1. Renames job from `test_slow_platforms` to `test_mac`
2. Removes `continue-on-error: true` from Mac e2e tests
3. Adds `test_mac` to the list of jobs that must succeed in the final check
4. Increases wait time in one flaky test from default to 200ms: `InputPrompt.test.tsx` line with `stdin.write('\u001B[C')`

Previously Mac tests could fail without blocking CI. Now they're required.

### What We Currently Have
Our CI in `.github/workflows/ci.yml`:
- Has a `test` job that runs on a matrix including `macos-latest`
- Mac tests are already part of the required test matrix
- We don't have a separate "slow platforms" job
- Mac tests are already required to pass

### Conflicts/Compatibility
No conflicts. We already require Mac tests to pass.

### Recommendation: **SKIP**

**Reasoning:**
- We already require Mac tests as part of our test matrix
- Our CI structure is different - we use a unified test job rather than separate fast/slow platform jobs
- The test timing fix might be relevant if we encounter the same flaky test, but we should handle that when/if it occurs

---

## 3. Commit 62e969137 - MCP SA Impersonation Documentation

**Commit:** `62e969137393717b2589250dbc1805937b2a3c92`
**Title:** chore(docs): Add documentation for MCP Servers using SA Impersonation (#10245)
**Author:** Adam Weidman

### What It Does
Adds documentation for Service Account Impersonation feature in `docs/tools/mcp-server.md`:
- Documents the `service_account_impersonation` auth provider type
- Explains how to use it with IAP-protected Cloud Run services
- Adds two new config properties: `targetAudience` and `targetServiceAccount`
- Provides setup instructions for configuring IAP, service accounts, and OAuth clients

This documents the feature added in commit `db51e3f4c`.

### What We Currently Have
Searched for:
- `service_account_impersonation` - Not found
- `targetAudience` - Not found
- `sa-impersonation-provider.ts` - Not found

We have commit `db51e3f4c` in our git history, but we DON'T have the actual implementation files.

### Conflicts/Compatibility
We're missing the underlying feature implementation from commit `db51e3f4c`.

### Recommendation: **SKIP** (for now)

**Reasoning:**
- The documentation is useless without the implementation
- We need to first decide if we want to pick commit `db51e3f4c` (the implementation)
- This is Google Cloud specific functionality for IAP-protected services
- If we pick the implementation later, we should pick this docs commit too
- Not urgent unless we have users requesting IAP support

**Future Action:** If we pick `db51e3f4c`, also pick this commit.

---

## 4. Commit 65e7ccd1d - Witty Loading Phrases Documentation

**Commit:** `65e7ccd1d4367cf6ff7444d23d5c0578a648eeb7`
**Title:** docs: document custom witty loading phrases feature (#8006)
**Author:** JAYADITYA

### What It Does
Adds documentation in `docs/cli/configuration.md` for the `ui.customWittyPhrases` setting:
- Documents that users can provide custom loading phrases
- Shows example in settings.json
- Explains that when provided, CLI cycles through these instead of default phrases

### What We Currently Have
Searched `packages/cli/src/config/settingsSchema.ts`:
```typescript
customWittyPhrases: {
  // ... exists in our codebase
}
```

We ALREADY HAVE the `customWittyPhrases` feature implemented!

### Conflicts/Compatibility
None - we already have the feature.

### Recommendation: **PICK**

**Reasoning:**
- We have the feature but might be missing documentation
- Good user-facing documentation for an existing feature
- Low risk, pure documentation change
- Enhances discoverability of our existing feature

**Implementation Notes:**
- Check if we already have this documented in our docs
- If not, add this documentation
- Verify the examples match our implementation

---

## 5. Commit 8abe7e151 - baseLLMClient Retry Logic

**Commit:** `8abe7e151c67e70aff69499be47e7ac63aa40fd5`
**Title:** fix(core): plumb max attempts for retry to generate options in baseLLMClient (#9518)
**Author:** anthony bushong

### What It Does
Changes in `packages/core/src/core/baseLlmClient.ts`:
1. Adds `maxAttempts?: number` parameter to `GenerateJsonOptions` interface
2. Passes `maxAttempts` from options to `retryWithBackoff()`
3. Updates `retry.ts` to validate `maxAttempts` is positive
4. Adds test coverage for the new parameter

Previously, `baseLlmClient.generateJson()` couldn't control retry attempts. Now callers can specify.

Also updates `llm-edit-fixer.ts` to use `maxAttempts: 1`.

### What We Currently Have
Searched for `baseLlmClient` or `baseLLMClient`:
- No files found in our codebase

We do NOT have a `baseLlmClient.ts` file.

### Conflicts/Compatibility
We don't have this architecture component.

### Recommendation: **REIMPLEMENT**

**Reasoning:**
- Upstream created `baseLlmClient` to extract utility LLM calls (generateJson, generateEmbedding) from their main client
- Our `client.ts` is a 1,991-line god object mixing conversational and utility methods
- We should implement the same separation pattern but with multi-provider support
- This commit and related commits improve the baseLlmClient architecture
- We'll reimplement the entire baseLlmClient pattern as a separate task after cherry-picking

**Implementation Plan:**
- Create new `packages/core/src/core/baseLlmClient.ts`
- Extract stateless utility methods from client.ts
- Implement multi-provider support (not Gemini-only like upstream)
- Update all call sites (llm-edit-fixer.ts, etc.)

---

## 6. Commit e8a065cb9 - --allowed-tools in Non-Interactive Mode

**Commit:** `e8a065cb9f23c85b4adaa391b5ee0947228224ea`
**Title:** Make --allowed-tools work in non-interactive mode (#9114)
**Author:** mistergarrison

### What It Does
Major feature addition: Makes `--allowed-tools` flag work in non-interactive mode with sophisticated shell command filtering.

Changes in `packages/cli/src/config/config.ts`:
- Adds parsing for `--allowed-tools=run_shell_command(wc)` syntax
- Supports tool-level and sub-command level filtering
- Multiple `--allowed-tools` flags can be combined
- Works with aliases like `ShellTool`

Changes in `packages/core/src/tools/shell.ts`:
- Adds allowlist/denylist logic for shell subcommands
- Only allows commands that match the filter in non-interactive mode

Integration tests added for various scenarios:
- `run_shell_command(wc)` - specific command only
- `run_shell_command` - all shell commands
- `--yolo` mode
- Multiple flags combining

### What We Currently Have
Searched our codebase:
- We HAVE `allowedTools` in `packages/cli/src/config/config.ts`
- We HAVE the config parsing
- We HAVE tool filtering

Checked key locations:
- `packages/cli/src/config/config.ts` has `allowedTools` handling
- Settings schema has `allowedTools` definition

### Conflicts/Compatibility

**CRITICAL CONFLICTS:**
1. We have an "ephemerals" system that might conflict
2. We have a `/tools` command that enables/disables tools dynamically
3. Precedence rules need to be defined:
   - What wins: `--allowed-tools`, model profile settings, `/tools` commands, or ephemeral settings?

### Recommendation: **PICK CAREFULLY**

**Reasoning:**
- This is a valuable feature for non-interactive automation
- Makes the CLI more scriptable
- Good security posture for automated workflows
- BUT: We need to integrate it with our existing systems

**Implementation Notes:**
1. First map out precedence rules:
   - Command-line `--allowed-tools` should override model profile
   - Dynamic `/tools` commands should override `--allowed-tools` during session
   - Ephemeral settings should be respected
2. Test interactions with:
   - Model profiles (do they have tool restrictions?)
   - `/tools enable/disable` commands
   - Ephemeral system
3. Review shell.ts changes to ensure subcommand filtering doesn't break our existing shell tool
4. Add integration tests for precedence scenarios
5. Document the precedence hierarchy

**Risk Level:** Medium - Complex interactions with existing systems

---

## 7. Commit ffcd99636 - lastPromptTokenCount Compression

**Commit:** `ffcd9963667ffc792f0591df93ee70ec2a287f9a`
**Title:** feat(core): Use lastPromptTokenCount to determine if we need to compress (#10000)
**Author:** Sandy Tao

### What It Does
Major optimization to compression logic in `packages/core/src/core/client.ts`:

**Key Change:** Instead of calling `countTokens()` API before and after compression, uses cached `lastPromptTokenCount` from telemetry service.

Benefits:
- Eliminates one API call per compression check
- Faster compression decisions
- Uses actual token count from last successful API call

Changes:
- Removes `mockContentGenerator.countTokens` calls from compression flow
- Uses `uiTelemetryService.getLastPromptTokenCount()` instead
- Calculates new token count by estimating: `Math.floor(totalChars / 4)`

### What We Currently Have
Searched for `lastPromptTokenCount`:
- Found in `packages/core/src/telemetry/uiTelemetry.ts`
- Found in `packages/core/src/core/geminiChat.ts`

We HAVE `lastPromptTokenCount` tracking in our telemetry!

Checked our compression code in `packages/core/src/core/client.ts`:
- We have `findCompressSplitPoint()` function
- Our implementation is similar but may differ in token counting approach

### Conflicts/Compatibility
Low risk - this is an optimization that uses existing telemetry data.

### Recommendation: **PICK**

**Reasoning:**
- Reduces API calls (saves quota and latency)
- We already have the telemetry infrastructure
- Smart optimization that improves performance
- Well-tested with extensive test coverage

**Implementation Notes:**
1. Review our current compression flow in `client.ts`
2. Check if we're already doing something similar or if we're making unnecessary `countTokens()` calls
3. Verify `uiTelemetryService.getLastPromptTokenCount()` returns valid data in our implementation
4. Port the token estimation logic: `Math.floor(totalChars / 4)`
5. Update tests to match new flow
6. Benchmark to confirm it improves performance

**Risk Level:** Low - Pure optimization, well-tested

---

## 8. Commit d37fff7fd - /tool and /mcp Commands Terminal Escape Codes

**Commit:** `d37fff7fd60fd1e9b69f487d5f23b1121792d331`
**Title:** Fix `/tool` and `/mcp` commands to not write terminal escape codes directly (#10010)
**Author:** Jacob Richman

### What It Does
Architectural improvement: Refactors `/tool` and `/mcp` commands to use structured data instead of raw terminal escape codes.

**Before:** Commands built strings with ANSI codes like `\u001b[36m` for colors
**After:** Commands emit structured data (new message types), let UI layer handle rendering

New types in `packages/cli/src/ui/types.ts`:
- `HistoryItemToolsList` - structured tool list data
- `HistoryItemMcpStatus` - structured MCP status data

New React components:
- `packages/cli/src/ui/components/views/ToolsList.tsx` - renders tool list
- `packages/cli/src/ui/components/views/McpStatus.tsx` - renders MCP status

Benefits:
- Separation of concerns (data vs presentation)
- Better testability
- IDE integration can render differently
- No hardcoded colors in command logic

### What We Currently Have
Checked `packages/cli/src/ui/commands/toolsCommand.ts`:
- Our implementation is simpler
- We don't have the raw ANSI escape codes issue (or we might!)
- We may or may not have structured message types

### Conflicts/Compatibility

**POTENTIAL CONFLICT:**
- We may have already customized these commands
- Need to check if we use structured types or ANSI codes
- UI rendering layer differences

### Recommendation: **PICK CAREFULLY**

**Reasoning:**
- This is good architectural practice
- Better for IDE integration
- More maintainable
- BUT: We need to verify compatibility with our UI layer

**Implementation Notes:**
1. Review our current `/tools` and `/mcp` command implementations
2. Check if we already use structured message types
3. If we have ANSI codes, this refactor is valuable
4. Verify our UI layer can handle new message types
5. Port the React components if needed
6. Test in both terminal and IDE contexts
7. Check if we've added custom functionality that needs preserving

**Risk Level:** Medium - UI layer changes, need compatibility check

---

## 9. Commit ec08129fb - Regex Smart Edit

**Commit:** `ec08129fba0af03a2c6e352a82ab5535b56a8613`
**Title:** Regex Search/Replace for Smart Edit Tool (#10178)
**Author:** Victor May

### What It Does
Adds a third fallback strategy to smart-edit tool: regex-based flexible matching.

In `packages/core/src/tools/smart-edit.ts`:

**New function:** `calculateRegexReplacement()`
- Tokenizes the search string by splitting on delimiters and whitespace
- Escapes regex special characters in tokens
- Joins tokens with `\s*` (flexible whitespace)
- Captures leading indentation with `^(\s*)`
- Applies indentation to all lines in replacement

**Matching hierarchy:**
1. `calculateExactReplacement()` - exact string match
2. `calculateFlexibleReplacement()` - whitespace-normalized match
3. **NEW:** `calculateRegexReplacement()` - regex-based flexible match
4. Return failure (0 occurrences)

Example: Can match code even if whitespace differs significantly.

### What We Currently Have
We have `packages/core/src/tools/smart-edit.ts`.

**CRITICAL QUESTION:** Did we delete or disable the smart-edit tool in favor of fuzzy and range editors?

Checked the file - it exists and has similar functions.

### Conflicts/Compatibility

**NEED TO VERIFY:**
- Is smart-edit still enabled in our codebase?
- Did we replace it with fuzzy-edit or range-edit?
- If disabled, this commit is irrelevant

### Recommendation: **CONDITIONAL PICK**

**Reasoning:**
- IF smart-edit is still active: **PICK** - This improves the tool
- IF we disabled smart-edit: **SKIP** - Don't resurrect a tool we intentionally removed
- IF we replaced it: Consider adapting this logic for our replacement tool

**Implementation Notes:**
1. **FIRST:** Check if smart-edit is in our enabled tools list
2. Check git history: Did we intentionally remove/disable smart-edit?
3. If active: Port the `calculateRegexReplacement()` function
4. Add tests for regex matching
5. Verify it doesn't break existing exact/flexible matching
6. Test with various whitespace scenarios

**Decision Required:** Is smart-edit enabled in llxprt?

---

## 10. Commit 794d92a79 - Declarative Agent Framework (MAJOR)

**Commit:** `794d92a79dd25361f535ffa36a83aa9cc309cf21`
**Title:** refactor(agents): Introduce Declarative Agent Framework (#9778)
**Author:** Abhi

### What It Does
**MASSIVE COMMIT:** Adds 2,746 lines implementing a declarative agent framework.

New files in `packages/core/src/agents/`:
- `types.ts` - Core types: `AgentDefinition`, `AgentTerminateMode`, `OutputObject`, etc.
- `executor.ts` (574 lines) - Executes agents with turn management and tool calling
- `invocation.ts` - Handles agent invocation from tool calls
- `registry.ts` - Registry pattern for agent discovery
- `schema-utils.ts` - JSON schema generation from agent definitions
- `subagent-tool-wrapper.ts` - Wraps agents as callable tools
- `utils.ts` - Helper utilities
- `codebase-investigator.ts` - Example agent implementation

**Key Concepts:**

1. **AgentDefinition Interface:**
   ```typescript
   {
     name: string;
     description: string;
     promptConfig: { systemPrompt, initialMessages };
     modelConfig: { model, temp, top_p, thinkingBudget };
     runConfig: { max_time_minutes, max_turns };
     toolConfig: { tools };
     inputConfig: { inputs };
     outputConfig: { description, completion_criteria };
   }
   ```

2. **Automatic Tool Wrapping:**
   - Agents automatically exposed as callable tools
   - Schema generation from agent definitions
   - Parent agents can call child agents as tools

3. **Structured Invocation:**
   - Input validation via JSON schema
   - Template-based prompt construction
   - Structured output with termination reasons

### What We Currently Have
We have `packages/core/src/core/subagent.ts` with:
- `SubagentConfig` interface
- `runSubagent()` function
- Manual configuration approach

Searched for `packages/core/src/agents/`:
- No agents directory found

**Our Approach:**
- Imperative: Explicitly call `runSubagent()` with config
- Less structured input validation
- Manual tool composition

**Their Approach:**
- Declarative: Define agents, framework handles execution
- Automatic tool wrapping
- Registry-based discovery

### Differences

| Aspect | Our Implementation | Upstream DAF |
|--------|-------------------|--------------|
| Configuration | Imperative, code-based | Declarative, data-based |
| Tool wrapping | Manual | Automatic |
| Discovery | Direct imports | Registry pattern |
| Input validation | Loose | JSON Schema based |
| Nesting | Manual setup | Automatic composition |
| Triggering | Explicit calls | Can be tool-triggered |

### Conflicts/Compatibility

**MAJOR ARCHITECTURAL DIVERGENCE:**
- Our subagent system is working but less structured
- DAF is more sophisticated and maintainable
- BUT: Significant refactoring required to adopt

### Recommendation: **ADAPT (Long-term)**

**Reasoning:**
- DAF is architecturally superior
- Better separation of concerns
- More maintainable and testable
- Automatic tool composition is powerful
- BUT: Large refactoring effort

**Implementation Strategy:**

**Phase 1: Research & Planning (Now)**
- Study the DAF implementation in detail
- Map our current subagent usages
- Identify migration path
- Estimate effort

**Phase 2: Parallel Implementation (1-2 sprints)**
- Implement DAF alongside existing system
- Create adapters for backward compatibility
- Port example agents (like codebase-investigator)
- Extensive testing

**Phase 3: Migration (2-3 sprints)**
- Convert existing subagent configs to AgentDefinitions
- Update tool calling code
- Switch to registry-based discovery
- Remove old subagent implementation

**Phase 4: Enhancement (Ongoing)**
- Add automatic triggering
- Build agent library
- Improve tooling

**Immediate Action:**
- Create PLAN document: `project-plans/daf-migration.md`
- NOT for this merge cycle - too large
- Consider for Q1 2026

**Can We Adapt Automatic Triggering Now?**
- No - requires the full DAF infrastructure
- Tool wrapping depends on schema generation
- Registry pattern needed for discovery
- All-or-nothing architecture

**Risk Level:** High (major refactor) - defer to dedicated effort

---

## 11. Commit 8a2c2dc73 - Enable Tool Output Truncation by Default

**Commit:** `8a2c2dc73feaca0a5f868e658e001d08fdbcc861`
**Title:** feat(core): Enable tool output truncation by default (#9983)
**Author:** Sandy Tao

### What It Does
Simple change: Flips default value of `enableToolOutputTruncation` from `false` to `true`.

Changes in:
- `packages/cli/src/config/settingsSchema.ts`: `default: false` → `default: true`
- `packages/core/src/config/config.ts`: `?? false` → `?? true`

This makes tool output truncation opt-out instead of opt-in.

### What We Currently Have
Searched for `enableToolOutputTruncation`:
- Not found in our codebase

Searched for `truncateToolOutput`:
- Not found

We likely have different setting names or don't have this feature.

### Conflicts/Compatibility

**NEED TO VERIFY:**
- Do we have tool output truncation?
- What's our setting called?
- What's our default?

### Recommendation: **INVESTIGATE & ADAPT**

**Reasoning:**
- Tool output truncation is important for managing context window
- Should be enabled by default for most users
- BUT: We need to find our equivalent setting first

**Implementation Notes:**
1. Search for truncation-related settings in our codebase
2. Check `packages/core/src/utils/toolOutputLimiter.ts` (if exists)
3. Verify what our default is
4. If we have it disabled by default, consider changing to match upstream
5. Document the change in release notes

**Action Items:**
1. Find our equivalent setting
2. Check current default
3. Consider flipping to true
4. Test with various tools (especially Bash, Read, etc.)

---

## 12. Commits 93694c6a6 + ffcd99636 - Compression Changes

**Commit 1:** `93694c6a65dab0ac431b77bf6caadfea4c0e3c78` - Make compression algo slightly more aggressive
**Commit 2:** `ffcd9963667ffc792f0591df93ee70ec2a287f9a` - Use lastPromptTokenCount

### What They Do Together

These two commits work together to improve compression:

**Commit 93694c6a6 (Algorithm Change):**
Changes `findCompressSplitPoint()` logic:
- **Before:** Added char count to cumulative BEFORE checking split point
- **After:** Checks split point BEFORE adding char count to cumulative
- Result: More aggressive compression - finds split points earlier

Example: With 50% fraction target
- **Old:** Would skip a valid split point if adding it would exceed 50%
- **New:** Considers that split point, then adds to cumulative

**Commit ffcd99636 (Token Counting):**
Already covered in section 7 - uses cached token count instead of API call.

### What We Currently Have

Checked `packages/core/src/core/client.ts`:
```typescript
export function findCompressSplitPoint(contents: Content[], fraction: number): number {
  // ...
  for (let i = 0; i < contents.length; i++) {
    cumulativeCharCount += charCounts[i];  // <-- Our version adds FIRST
    const content = contents[i];
    if (content.role === 'user' && !hasFunctionResponse) {
      if (cumulativeCharCount >= targetCharCount) {
        return i;
      }
      lastSplitPoint = i;
    }
  }
}
```

We have the OLD (less aggressive) algorithm.

### Impact of Algorithm Change

**Scenario:** History is 100 chars total, target is 50% (50 chars)
- Message 1: 30 chars
- Message 2: 25 chars
- Message 3: 45 chars

**Old Algorithm:**
- i=0: cumulative=30, check message 1, 30 < 50, mark split
- i=1: cumulative=55, check message 2, 55 > 50, return 2

**New Algorithm:**
- i=0: check message 1, 30 < 50, mark split, cumulative=30
- i=1: check message 2, 55 < 50... wait, this is wrong

Actually looking at the code more carefully:

**Old:**
```typescript
cumulativeCharCount += charCounts[i];  // Add first
// Then check if this message is a valid split point
```

**New:**
```typescript
// Check if this message is a valid split point first
// Then add to cumulative
cumulativeCharCount += charCounts[i];  // Add after
```

The test expectations changed: `expect(findCompressSplitPoint(history, 0.5)).toBe(2)` → `.toBe(4)`

This means the new version keeps MORE history (split at index 4 instead of 2).

### Relationship to Flash Model

The commit message for `ffcd99636` mentions:
> "This also removes the hack to use Flash for compression summarization"

They removed Flash-specific code. We don't use Flash, so this doesn't affect us.

### Conflicts/Compatibility

Low risk - algorithmic improvement.

### Recommendation: **PICK BOTH**

**Reasoning:**
- Commit 93694c6a6: Better compression algorithm, keeps more context
- Commit ffcd99636: Reduces API calls, better performance
- They work well together
- No Flash model dependency
- Well-tested

**Implementation Notes:**
1. First apply commit 93694c6a6:
   - Move `cumulativeCharCount += charCounts[i];` to AFTER split point check
   - Update tests to expect different split points
   - Run compression tests to verify behavior
2. Then apply commit ffcd99636:
   - Replace `countTokens()` calls with cached `lastPromptTokenCount`
   - Add token estimation: `Math.floor(totalChars / 4)`
   - Update test mocks
3. Integration testing:
   - Test compression with various history lengths
   - Verify token counting is accurate
   - Check that compression improves performance

**Risk Level:** Low - Algorithmic improvements, well-tested

---

## Summary Table

| # | Commit | Title | Recommendation | Risk | Priority |
|---|--------|-------|----------------|------|----------|
| 1 | 74447fcff | VSCode release script | SKIP | None | N/A |
| 2 | 80a414be9 | Mac required test | SKIP | None | N/A |
| 3 | 62e969137 | MCP SA impersonation docs | SKIP | None | Low |
| 4 | 65e7ccd1d | Witty loading phrases docs | PICK | Low | Medium |
| 5 | 8abe7e151 | baseLLMClient retry logic | REIMPLEMENT | Medium | High |
| 6 | e8a065cb9 | --allowed-tools flag | PICK CAREFULLY | Medium | High |
| 7 | ffcd99636 | lastPromptTokenCount compression | PICK | Low | High |
| 8 | d37fff7fd | /tool command refactor | PICK CAREFULLY | Medium | Medium |
| 9 | ec08129fb | Regex smart edit | CONDITIONAL | Medium | Low |
| 10 | 794d92a79 | Declarative Agent Framework | ADAPT (defer) | High | High |
| 11 | 8a2c2dc73 | Tool output truncation default | INVESTIGATE | Low | Medium |
| 12 | 93694c6a6 | Compression algo improvement | PICK | Low | High |

## Recommended Pick Order

**This Merge Cycle:**
1. **93694c6a6** + **ffcd99636** - Compression improvements (pick together)
2. **65e7ccd1d** - Witty phrases docs (easy win)
3. **8a2c2dc73** - Tool truncation default (after investigation)
4. **e8a065cb9** - allowed-tools flag (careful integration)
5. **d37fff7fd** - /tool refactor (after compatibility check)
6. **ec08129fb** - Regex smart edit (if smart-edit still active)

**Future Work:**
- **794d92a79** - DAF (requires dedicated project, Q1 2026)
- **62e969137** - SA impersonation docs (only if we pick implementation)

**Reimplement:**
- **8abe7e151** - baseLlmClient extraction (reimplement with multi-provider support)

**Skip:**
- **74447fcff** - Google-specific tooling
- **80a414be9** - Already handled differently

## Investigation Required

Before picking certain commits, investigate:

1. **Smart-edit status:** Is it enabled? Did we replace it?
2. **Tool truncation:** What's our setting name? Current default?
3. **Allowed-tools integration:** Map precedence rules with ephemerals and /tools
4. **Terminal escape codes:** Do we have this issue in our /tools command?

## Notes on Implementation

### Compression Commits (High Priority)
- Pick both 93694c6a6 and ffcd99636 together
- Test thoroughly with various history sizes
- Verify token estimation accuracy
- Measure performance improvement

### Allowed-Tools Flag (High Value, Medium Risk)
- Map out precedence hierarchy first
- Document interaction with existing systems
- Add integration tests
- Consider security implications

### DAF (Future Major Project)
- Don't attempt in this merge cycle
- Create detailed migration plan
- Schedule for Q1 2026
- Significant architectural benefits long-term

# Issue 3174: Compression memory exclusion

## Accepted contract

Adopt option 1 from the issue: compression requests exclude caller memory and MCP-server instructions.

The compression agent still receives the normal assembled base instruction appropriate to its model and interaction mode, plus the existing compression request content that requires a `<state_snapshot>` result. This change does not alter provider transport rules. In particular, Claude Code (Anthropic OAuth) must continue to put its required Claude Code identity string in the Anthropic `system` field while transporting the assembled compression instruction through the existing context-prefix path.

## Acceptance criteria

### AC1: Core memory is absent from compression requests

- **Given** a real `.llxprt/.LLXPRT_SYSTEM` file containing a unique sentinel under the compression process working directory,
- **When** a compression request is assembled,
- **Then** its captured `systemInstruction` does not contain the sentinel or a core-memory wrapper.
- **And** omission is not used to express suppression: the compression assembler explicitly supplies an empty core-memory value so the disk fallback cannot run.

### AC2: MCP instructions are absent from compression requests

- **Given** the compression configuration exposes MCP instructions containing a unique sentinel,
- **When** a compression request is assembled,
- **Then** its captured `systemInstruction` does not contain the MCP sentinel.
- **And** the compression assembler does not forward MCP instructions into core prompt assembly.

### AC3: Compression behavior remains intact

- The captured request still contains the existing compression instructions requiring the `<state_snapshot>` XML structure.
- A provider response containing a valid `<state_snapshot>` still produces an applied compression result whose summary retains that structure.
- Initial compression and the optional verification pass continue to receive a non-empty assembled instruction.

### AC4: Other prompt paths and provider placement are unchanged

- Main-agent and subagent prompt assemblers are not modified.
- The shared `undefined`-loads-from-disk convention is not changed in this issue.
- `clientLlmUtilities.ts` and audit finding D7 are not changed.
- Anthropic OAuth system-prompt placement and its required Claude Code identity string are not changed.

## Relevant inputs and boundaries

| Input or boundary | Accepted behavior |
| --- | --- |
| `.LLXPRT_SYSTEM` absent | Compression request is assembled normally without memory. |
| `.LLXPRT_SYSTEM` present and non-empty | Its content is not read into or emitted in the compression instruction. |
| MCP manager absent or returns no instructions | Compression request is assembled normally. |
| MCP manager returns non-empty instructions | The instructions are not forwarded or emitted. |
| Interactive/non-interactive configuration | Existing interaction-mode selection is preserved. |
| Initial compression vs. verification pass | Both continue to use the shared compression instruction path and exclude memory/MCP content. |
| Claude Code (Anthropic OAuth) transport | Required Claude Code identity remains in the provider `system` field; this issue changes only compression instruction content. |

## Test-first implementation plan

1. **RED:** Add a Bun behavioral test that creates a real temporary project core-memory file, supplies MCP instructions, captures a compression request, and proves both sentinels currently leak into its assembled instruction. The test must exercise the real compression prompt assembler rather than mock `getCoreSystemPromptAsync`.
2. **GREEN:** In `packages/agents/src/compression/compressionSystemPrompt.ts`, pass explicit empty `coreMemory` and stop obtaining/forwarding MCP instructions. Make no changes to shared core prompt resolution.
3. Assert the captured request still contains the `<state_snapshot>` compression template and that a valid snapshot response remains an applied compression result. Preserve coverage for the verification pass and all shared compression call sites.
4. Run the focused Bun tests, then the repository verification suite.

## Scope

Planned production change:

- `packages/agents/src/compression/compressionSystemPrompt.ts`

Planned behavioral tests:

- compression-system-prompt tests under `packages/agents/src/compression/`

No public abstraction, dependency, workflow, agent-memory mechanism, shared prompt API, main-agent assembly path, subagent assembly path, or unrelated refactor is accepted into scope.

## Review triage policy

Every finding is classified before action:

- **Blocker-Fix:** Prevents an accepted criterion, required verification, safety/architecture invariant, correct ancestry, or conflict-free merge.
- **In-scope-Fix:** Improves correctness, behavioral evidence, or maintainability within the files and contract above.
- **Reject:** Factually incorrect, already covered, or conflicts with the accepted contract.
- **Defer:** Valid but belongs to shared fallback cleanup, auxiliary LLM behavior, another subsystem, or optional hardening outside this issue.

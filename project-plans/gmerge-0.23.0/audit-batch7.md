# Upstream Gemini-CLI Audit: Batch 7 of 7

## 948401a450 — "chore: update a2a-js to 0.3.7 (#15197)"
**Verdict:** PICK
**Confidence:** HIGH
**Evidence:** 
- Upstream: packages/a2a-server/package.json: `"@a2a-js/sdk": "^0.3.2"` → `"^0.3.7"`
- LLxprt: packages/a2a-server/package.json: `"@a2a-js/sdk": "^0.3.2"`
**Rationale:** This is a straightforward dependency update from 0.3.2 to 0.3.7 for the A2A SDK. LLxprt has an a2a-server package with the same 0.3.2 version. Since A2A is a standard protocol and we're using the same SDK, this update is beneficial and should apply cleanly. The upgrade is likely to include bug fixes and improvements to the A2A protocol implementation.
**Conflicts expected:** NO - Clean version bump in package.json

---

## d02f3f6809 — "feat(core): introduce remote agent infrastructure and rename local executor (#15110)"
**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Upstream changes:
  1. Renames `executor.ts` → `local-executor.ts` and `invocation.ts` → `local-invocation.ts`
  2. Adds `AgentDefinition.kind: 'local' | 'remote'` discriminator
  3. Creates `LocalAgentDefinition` and `RemoteAgentDefinition` types
  4. Adds `remote-invocation.ts` (stub implementation throwing "not implemented")
  5. Adds `subagent-tool-wrapper.ts` to dispatch to local vs remote invocations
  6. Changes all `AgentDefinition` → `LocalAgentDefinition` in executor/invocation
  7. Updates `registry.ts` to only register model configs for `kind === 'local'`
- LLxprt current state:
  - Has `executor.ts` (NOT using Gemini's agent framework)
  - Has dedicated subagent infrastructure: `subagentOrchestrator.ts` + `subagent.ts`
  - Subagent system uses profile-based runtime loading, NOT the Gemini agent registry
  - No `invocation.ts` - uses direct `SubagentOrchestrator.launch()`
  - Registry is minimal (no built-in agents, no model config registration)
**Rationale:** 
This commit introduces Gemini's remote A2A agent infrastructure, which is fundamentally incompatible with LLxprt's architecture:
1. **Divergent agent systems**: Gemini uses AgentDefinition + AgentExecutor + AgentRegistry. LLxprt uses SubagentConfig + SubagentOrchestrator + profile-based loading.
2. **Different invocation patterns**: Gemini's `SubagentInvocation` wraps `AgentExecutor`. LLxprt's `SubagentOrchestrator.launch()` returns a `SubAgentScope`.
3. **Registry incompatibility**: Gemini's registry manages model configs and agent definitions. LLxprt's registry is a minimal stub with no built-in agents.
4. **The rename is cosmetic**: Gemini renames executor to "local-executor" but LLxprt's executor.ts is NOT Gemini's executor - it's a completely different implementation.

If we want remote agent capability in LLxprt, it should be implemented in `SubagentOrchestrator.ts` using LLxprt's profile/config architecture, NOT by copying Gemini's agent framework.

**Conflicts expected:** N/A (skipping entirely)

---

## 2b426c1d91 — "feat: add agent toml parser (#15112)"
**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Upstream changes:
  1. Adds `packages/core/src/agents/toml-loader.ts` with TOML parsing for agent definitions
  2. Adds `packages/core/src/agents/toml-loader.test.ts` with comprehensive tests
  3. Modifies `registry.ts` to load agents from `~/.gemini/agents/` and `.gemini/agents/`
  4. Adds `Storage.getUserAgentsDir()` and `getProjectAgentsDir()` methods
  5. Adds `experimental.enableAgents` setting with YOLO mode warning
  6. Updates `local-executor.ts` to remove tool allowlist validation (YOLO mode)
  7. Forces `ApprovalMode.YOLO` for all subagent tool calls
  8. Changes `complete_task` to require a "result" parameter when no outputConfig exists
  9. Supports `model: "inherit"` in TOML to inherit from main model
  10. Adds `AgentRegistry.refreshAgents()` to update inherited models when main model changes
- LLxprt current state:
  - Agent registry is minimal stub (no loading logic)
  - Subagents are defined in JSON in `.llxprt/subagents/` directory (SubagentManager)
  - Subagent config schema: `{ name, profile, systemPrompt, capabilities }`
  - Uses profile-based model selection, NOT direct model names
  - No concept of "inherit" - subagents reference profiles explicitly
  - SubagentOrchestrator handles all loading/launching
**Rationale:**
This commit adds TOML-based agent definition loading for Gemini's agent framework. It's tightly coupled to:
1. **AgentDefinition structure**: TOML schema maps to `LocalAgentDefinition` with `modelConfig`, `runConfig`, `toolConfig`, `promptConfig` - LLxprt uses `SubagentConfig` with `profile`, `systemPrompt`, `capabilities`.
2. **Registry-based loading**: Loads into `AgentRegistry` which manages model configs - LLxprt uses `SubagentManager` which just provides config lookups.
3. **Model inheritance**: "inherit" resolves to `config.getModel()` - LLxprt doesn't have a "current model" concept (multi-provider architecture uses profiles).
4. **YOLO mode**: Forces all subagent tools to skip confirmation - LLxprt has its own approval/confirmation infrastructure.
5. **Different config format**: TOML vs LLxprt's JSON subagent configs.

The TOML parser itself is generic and well-structured, but it produces AgentDefinitions for Gemini's executor, not SubagentConfigs for LLxprt's orchestrator. If we wanted user-defined subagents in LLxprt, we should:
- Keep LLxprt's JSON format in `.llxprt/subagents/`
- Enhance `SubagentManager` to support user/project directories
- Use profile references, NOT direct model names or "inherit"

**Conflicts expected:** N/A (skipping entirely)

---

## Summary

**Batch 7 Disposition:**
- **PICK (1)**: a2a-js update to 0.3.7 - clean dependency upgrade
- **SKIP (2)**: Remote agent infrastructure and TOML parser - both tightly coupled to Gemini's agent framework which LLxprt doesn't use

**Key Architectural Insight:**
Upstream is heavily investing in their unified "agent framework" (AgentDefinition + AgentExecutor + AgentRegistry + TOML config). LLxprt has a different architecture (SubagentConfig + SubagentOrchestrator + profile-based runtime + JSON config). The two approaches are fundamentally incompatible - we can't cherry-pick agent framework features without adopting the entire framework, which would break LLxprt's multi-provider design.

**Recommendations:**
1. **PICK the a2a-js update** - straightforward and valuable
2. **Document the agent framework divergence** - Add to architecture docs that LLxprt uses profile-based subagents instead of Gemini's agent framework
3. **Consider feature parity, not code parity** - If we want TOML configs or remote agents, implement them in SubagentOrchestrator using LLxprt's patterns, don't adopt Gemini's framework

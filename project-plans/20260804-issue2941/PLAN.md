# Issue #2941 — `docs/policy-configuration.md`

Rewrite the policy configuration page so it leads with the interactive policy
manager, teaches TOML that actually validates, describes discovery by
directory, and records decisions on `tools.policyPath` and per-project policy
discovery.

## Goal

A reader who wants to change what a tool is allowed to do can follow this page
and succeed. Today they cannot: the page's central instructions produce a
policy file that the loader rejects, and they point at a setting that nothing
reads.

## Accepted behavior

### AC1 — the manager is the primary path

The page opens with `/policies menu` (add, edit, delete, duplicate a rule) and
`/policies list` (read-only view of the active stack). Hand-authored TOML is
documented after that as the path for version-controlled or bulk rules.

### AC2 — authored vs resolved priority

`priority` in a file is an **integer 0–999**. The engine resolves it to
`tier + priority / 1000` and it is the resolved decimal that `/policies` shows
and that rule precedence compares. Every rule shown on the page uses the
integer form.

### AC3 — every TOML example on the page loads

Every fenced ` ```toml ` block on the page that contains `[[rule]]` was loaded
through the real policy loader during authoring and produced zero load errors.
Deliberately-wrong snippets in the troubleshooting section use a non-`toml`
fence so a reader cannot mistake them for working examples.

### AC4 — discovery is described by directory and tier

Three directories, matching `getPolicyDirectories`: built-in (tier 1), the user
policy directory (tier 2), the system policy directory (tier 3). No file-path
setting, no per-project directory.

### AC5 — one coherent story for the three writers of user-tier rules

- The manager writes only the managed file `auto-saved.toml`.
- Hand-written `.toml` files sit beside it in the same directory and load at
  the same tier.
- "Allow for all future sessions" at a confirmation prompt appends to the same
  managed file.
- What happens to hand edits of the managed file, and whether the manager is
  safe to use afterwards.

### AC6 — decisions recorded

`tools.policyPath` and per-project discovery are each decided here, and the
documentation states plainly that setting `tools.policyPath` has no effect so
a reader who meets it in the settings reference is not misled.

### AC7 — gates

`npm run lint:doc-links` and `npm run lint:doc-placement` stay green, plus the
repository's standard verification suite.

## Decisions

### D1 — `tools.policyPath`: neither implement nor remove here; document that it does nothing

`tools.policyPath` is declared in `packages/cli/src/config/settings-schema/schema-security.ts`.
The only reader is the optional `getUserPolicyPath()` on `PolicyConfigSource`;
the sole implementer is the test double in `packages/core/src/policy/config.test.ts`.
No production code supplies it, so setting the key does nothing.

Decision: **document the dead setting; defer implementing or removing it.**

Removing it was drafted and then withdrawn. Both options are code changes, and
this is a documentation issue:

- Implementing it would require inventing a tier for an arbitrary path, since
  discovery is deliberately directory-based and tier-based. That is a security
  decision (a user-writable file that can auto-approve tools), not a
  documentation one.
- Removing it touches the settings schema, two generated artifacts, and the
  orphaned plumbing across three packages. That is a behavioral change to a
  subsystem inherited from upstream, and it should be decided against the
  upstream comparison rather than in isolation.

The dead key is one of several findings pointing at the policy subsystem as a
whole rather than at this page. They are collected for the 0.12.0 policy-system
evaluation (#3025) instead of being fixed piecemeal here. Because
`docs/cli/configuration.md` is generated from the settings schema, it cannot be
corrected without the code change; the page therefore names the setting and
states plainly that nothing reads it, so a reader who meets it in the settings
reference is not misled in the meantime.

### D2 — per-project policy discovery: not implemented

Decision: **do not implement**; document the limitation.

Rationale: a repository-local file that can auto-approve tool execution is a
trust-boundary change, not a documentation change. It needs its own design
(interaction with folder trust, tier assignment relative to the user tier, and
what happens when an untrusted checkout ships one). The migration guide already
records the limitation; this page is made consistent with it. If per-project
discovery is wanted, it belongs in its own issue.

## Verification

| Check | How |
| ----- | --- |
| AC2, AC3 | Every `toml` block on the page was written to a temporary policy directory and loaded through `loadPoliciesFromToml` at tier 2 during authoring: zero load errors, every authored priority an integer 0–999, every resolved priority inside the user tier |
| AC1, AC5 | Each quoted string, menu entry, prompt, and validation message was read out of `policiesCommand.ts`, `PoliciesDialog.tsx`, `policiesDialogViews.tsx`, and `userPolicyStore.ts` |
| AC6 | Both decisions are recorded above, and the page states that `tools.policyPath` has no effect |
| AC7 | `npm run lint:doc-links`, `npm run lint:doc-placement`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run format` |

## Verification log

Claims the existing page made that source did not support. Each is corrected
rather than carried forward.

| Claim as documented | Source consulted | Result |
| ------------------- | ---------------- | ------ |
| `priority` accepts decimals such as `2.5`, `2.6`, `1.05` | `toml-loader.ts` `PolicyRuleSchema` — `.int()`, `.min(0)`, `.max(999)` | False; every example rewritten to the authored integer form |
| `priority` is optional and defaults to `0` | `PolicyRuleSchema` — `priority` has no `.optional()` and carries `required_error: 'priority is required'` | False; documented as required |
| Set `tools.policyPath` to point the loader at a file | No production implementer of `getUserPolicyPath` | False; the instruction is removed and the key is documented as having no effect (D1) |
| "Priority Bands Reference" tables list authorable values | The tabled values are resolved priorities | Conflated; split into authored vs resolved |
| Built-in tools include `edit`, `shell`, `grep`, `ls`, `memory`, `ripgrep`, `write_todos`, `notebook_edit`, `slash_command`, `skill`, `mcp_tool` | `packages/tools/src/tools/*` `static readonly Name`, `read-only.toml`, `write.toml` | Wrong names; corrected to `replace`, `run_shell_command`, `search_file_content`, `list_directory`, `save_memory`, `todo_write`, `activate_skill` |
| MCP tools are matched by `toolName = "server__"` prefix | `policy-engine.ts` `findMatchingRule` — TOML `toolName` produces an exact match; only `toolNamePrefix` (from `mcpName`) prefixes | False; corrected to use `mcpName` |
| An MCP tool is matched under the name the model uses | Policy evaluates `invocation.getPolicyContext()` (`tools.ts`), and `DiscoveredMCPToolInvocation.getToolName()` returns `<server>__<tool>` — not the longer registry name `generateMcpToolName` builds. `policy-engine.ts` `validateServerName` additionally requires the `<server>__` prefix | Two distinct names exist; the page documents the one policy actually matches, confirmed by evaluating the example through `PolicyEngine` |
| A rule may be written for tool `discovered_tool_` prefixes | `resolveToolMatcher` — no prefix semantics for `toolName` | Removed |
| Policy files can be project-specific | `getPolicyDirectories` scans three fixed directories | False (D2); documented as a limitation |
| Built-in examples live under `packages/core/src/policy/policies` | `DEFAULT_CORE_POLICIES_DIR` resolves to `packages/policy/src/policies` | Wrong path, and source paths do not belong in `docs/` per the style guide; replaced with a user-facing pointer |
| "Priority Out of Range" — `priority = 4.5` wrong, `priority = 2.5` correct | Both are rejected; the schema requires an integer | False; rewritten |
| Dynamic reload is a future `/reload-policies` command | `PoliciesDialog` refresh calls `reloadUserPolicyRules`, which re-reads the whole user directory and replaces user-tier rules in place | Stale; corrected to describe the manager's live reload |
| Args-pattern examples for `toolName = "shell"` | The write policy names `run_shell_command`; `shell` matches nothing | Silently non-matching; corrected |

## Defects found and documented rather than fixed

Verifying the page against source surfaced four code defects. Each is
documented accurately so the page is truthful, and none is repaired here: this
is a documentation issue, and the policy subsystem came from upstream
gemini-cli, so these belong to the 0.12.0 policy-system evaluation (#3025)
where they can be judged against the upstream implementation rather than
patched piecemeal.

| Defect | Evidence | How the page handles it |
| ------ | -------- | ----------------------- |
| The policy manager turns a `toolName` array into a wildcard. `userPolicyStore.ts` `toEditableRule` maps a non-string `toolName` to `''`, and `updateEditableRule` then deletes the field, so editing `toolName = ["replace", "write_file"]` widens the rule to every tool | Reproduced against the real store: the listed rule reads back as `toolName: ''` and the rewritten file has no `toolName` | Documented under "Hand-editing the managed file", with the recommendation to keep such rules in your own file |
| A permanent confirmation replaces a managed file it cannot parse. `config.ts` `readExistingTomlPolicy` swallows any non-ENOENT parse error and returns `{}`, after which only the new rule is written | `@iarna/toml` throws on malformed input, and the catch is unconditional | Documented in the same list |
| The manager's form validates only that a pattern compiles, while the loader also applies a length limit and a nested-quantifier check | `policiesDialogViews.tsx` `useFormState` versus `utils.ts` `validatePolicyRegex` | Documented in the quick start and under `argsPattern` |
| `tools.policyPath` is declared but unread (D1) | `git grep getUserPolicyPath` finds the interface member, one consumer, and a test double — no production implementer | The page names the setting and states that nothing reads it |

Two structural observations for the same evaluation, neither of which affects
the page: the built-in policy files are duplicated under
`packages/core/src/policy/policies` and `packages/policy/src/policies` and have
drifted apart, and `yolo.toml` sets `allow_redirection` while the schema field
is `allowRedirection`, so the key is silently discarded.

## Non-goals

- Any code change. The page is corrected against the implementation as it
  stands; every defect above is recorded for the evaluation instead.
- Implementing per-project policy discovery (D2).
- Any change to `docs/tool-permissions.md` or
  `docs/migration/approval-mode-to-policies.md` beyond what link or consistency
  checks force.

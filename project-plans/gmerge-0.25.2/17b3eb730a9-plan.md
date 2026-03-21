# Playbook: Add Hooks-in-Extensions Documentation

**Upstream SHA:** `17b3eb730a9`
**Upstream Subject:** docs: add docs for hooks + extensions (#16073)
**Upstream Stats:** ~3 files, moderate insertions (documentation only)

## What Upstream Does

Upstream adds documentation explaining how hooks and extensions interact — specifically how extensions can bundle hooks, how hook configuration is scoped across system/user/project/extension boundaries, and how users should evaluate extension-provided hooks from a security standpoint. The commit adds new documentation pages covering the hooks+extensions integration story.

## Why REIMPLEMENT in LLxprt

1. LLxprt already has `docs/hooks/index.md` (225 lines) and `docs/extension.md` (372 lines) which separately document hooks and extensions with LLxprt branding, `.llxprt/` paths, and LLxprt-specific trust semantics.
2. Upstream docs reference `Gemini CLI`, `.gemini/`, `GEMINI_*` env vars, and upstream's trust model. LLxprt needs `.llxprt/`, `LLXPRT_*`, and LLxprt's trust flow.
3. Rather than copying upstream docs verbatim, LLxprt should add a **hooks-in-extensions guidance section** to the existing `docs/extension.md` and a cross-link from `docs/hooks/index.md`. This keeps documentation centralized and avoids duplication.
4. LLxprt extensions use `llxprt-extension.json` (with `gemini-extension.json` fallback) and the extension consent/trust system in `packages/cli/src/config/extensions/consent.ts` — docs must reflect this.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `docs/hooks/index.md` — Hooks documentation (225 lines), includes Security and Risks section, Hook Events table, Quick Start
- [OK] `docs/hooks/best-practices.md` — Hook best practices with "Using Hooks Securely" and "Authoring Secure Hooks" sections
- [OK] `docs/extension.md` — Extension documentation (372 lines), covers install/uninstall/enable/disable/update/link/settings/security

**Must NOT create:**
- Do not create a separate `docs/hooks-and-extensions.md` or `docs/hooks/extensions.md` — keep guidance inline in existing files.

## Files to Modify / Create

### 1. Modify: `docs/extension.md`

Add a new section **"Hooks in Extensions"** after the existing "Extension Security" section (or near the end, before any appendices). This section should cover:

- **How extensions can bundle hooks:** An extension's `llxprt-extension.json` can include a `hooks` key with hook definitions that are loaded when the extension is enabled.
- **Hook scope precedence:** System hooks → User hooks → Extension hooks → Project hooks (matching the trust hierarchy in `docs/hooks/best-practices.md`).
- **Security considerations for extension hooks:** Extension hooks run with the same privileges as any other hook. Users should review extension hook definitions before installing. Link to `docs/hooks/best-practices.md#using-hooks-securely`.
- **Example:** Show a minimal `llxprt-extension.json` with a `hooks` section:

```json
{
  "name": "my-security-extension",
  "version": "1.0.0",
  "hooks": {
    "BeforeTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "./hooks/validate-tool.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

- **Enabling/disabling extension hooks:** Extension hooks are active when the extension is enabled and inactive when disabled. Users can control this with `llxprt extensions disable <name>`.
- **Hook consent:** When an extension with hooks is first loaded, LLxprt checks hook consent status. New or modified hooks trigger a consent prompt (same as project-level hooks).

### 2. Modify: `docs/hooks/index.md`

Add a cross-link to the new extension hooks section. Insert after the "Hook Events" table (around line 149), before "Next Steps":

```markdown
## Hooks in Extensions

Extensions can bundle hooks alongside MCP servers and prompts. When you install
an extension that includes hooks, those hooks are loaded automatically when the
extension is enabled.

For details on how extension hooks work, including scope precedence and security
considerations, see [Hooks in Extensions](../extension.md#hooks-in-extensions).
```

### 3. (Optional) Modify: `docs/hooks/best-practices.md`

If the "Using Hooks Securely" → "Threat Model" table does not already mention extensions as a hook source, add an "Extensions" row:

| Hook Source    | Description |
|:--------------|:------------|
| **Extensions** | Hooks bundled with installed extensions. Security depends on the extension author and your review before installation. |

Verify this row exists before adding — it was added by a prior playbook (006de1dd318d).

## Preflight Checks

```bash
# Verify docs exist
test -f docs/hooks/index.md && echo "OK: hooks index"
test -f docs/extension.md && echo "OK: extension doc"
test -f docs/hooks/best-practices.md && echo "OK: best-practices"

# Check if extension.md already has a hooks section
grep -c "Hooks in Extensions" docs/extension.md
# Expected: 0

# Check if hooks/index.md already cross-links to extension hooks
grep -c "extension.md#hooks" docs/hooks/index.md
# Expected: 0

# Verify extensions row in best-practices threat model
grep -c "Extensions" docs/hooks/best-practices.md
```

## Implementation Steps

1. **Read** `docs/extension.md` to identify the correct insertion point (after "Extension Security" section or before final sections).
2. **Add** the "Hooks in Extensions" section (~40-60 lines) to `docs/extension.md` with the content described above, using LLxprt branding throughout (`llxprt-extension.json`, `.llxprt/`, `llxprt extensions` commands).
3. **Read** `docs/hooks/index.md` to identify insertion point (before "Next Steps" at line 150).
4. **Add** the cross-link paragraph (~8 lines) to `docs/hooks/index.md`.
5. **Read** `docs/hooks/best-practices.md` to check if "Extensions" row exists in the threat model table.
6. **If missing**, add the "Extensions" row to the threat model table.
7. **Review** all three files for coherent cross-references and consistent branding.

## Verification

```bash
# Verify the new sections exist
grep "Hooks in Extensions" docs/extension.md
grep "extension.md#hooks" docs/hooks/index.md

# Verify no broken Gemini branding snuck in
grep -ri "gemini cli" docs/hooks/index.md docs/extension.md || echo "OK: no Gemini CLI refs"
grep -ri "\.gemini/" docs/hooks/index.md docs/extension.md || echo "OK: no .gemini/ refs"

# These are docs-only changes, no code verification needed
```

## Execution Notes / Risks

- **Risk: Low** — documentation only, no code changes.
- **Do NOT** create new documentation files. Add content to existing `docs/extension.md` and `docs/hooks/index.md`.
- **Do NOT** copy upstream documentation verbatim — upstream uses Gemini branding and may reference features (like upstream's hook-in-extension auto-discovery) that work differently in LLxprt.
- **Branding:** All references must use `LLxprt Code`, `.llxprt/`, `llxprt-extension.json`, `LLXPRT_*` environment variables.
- **Cross-links:** Ensure `docs/hooks/index.md` links to `docs/extension.md#hooks-in-extensions` and `docs/extension.md` links back to `docs/hooks/best-practices.md#using-hooks-securely`.
- **Extension hooks format:** LLxprt extensions use `llxprt-extension.json` (with `gemini-extension.json` fallback per `docs/extension.md` line 8). The hooks key in extensions follows the same schema as `settings.json` hooks.

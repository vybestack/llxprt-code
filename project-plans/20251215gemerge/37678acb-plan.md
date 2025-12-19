# Implementation Plan: 37678acb - Docs Restructure (deployment→installation)

## Decision: SKIP

This commit should be **SKIPPED** for the following reasons:

### Upstream Changes Summary

Upstream commit `37678acb` ("Update deployment.md -> installation.md and sidebar links. (#10662)"):
- Creates new `docs/get-started/installation.md` with 141 lines
- Deprecates `docs/get-started/deployment.md` with a redirect notice
- Updates `docs/sidebar.json` to rename "Deployment" → "Installation"
- Updates references in `docs/get-started/index.md` and `docs/index.md`
- Changes are purely structural/navigational for upstream's documentation site

### Why SKIP is Appropriate

1. **Structural incompatibility**:
   - Upstream has `docs/get-started/` subdirectory structure - LLxprt does not
   - Upstream uses `docs/sidebar.json` for navigation - LLxprt has no sidebar.json
   - LLxprt's flat docs structure (`docs/deployment.md` at root) serves a different purpose

2. **Content already covered**:
   - LLxprt's `docs/deployment.md` (118 lines) already comprehensively covers:
     - Standard installation (npm global, npx)
     - Sandbox/Docker execution
     - Running from source (dev mode, linked package)
     - Running latest from GitHub
     - Deployment architecture
     - Release process
   - The content in upstream's new `installation.md` is functionally identical to what LLxprt already has
   - LLxprt version is properly branded with @vybestack/llxprt-code references

3. **No value-add for LLxprt users**:
   - The upstream change is about documentation navigation/organization, not content
   - LLxprt's current `deployment.md` title and location work well for its doc structure
   - Creating parallel structure would be unnecessary complexity

### Affected Files (None)

No files will be modified as part of this SKIP decision.

## Rationale

This is a documentation infrastructure change specific to upstream's multi-level navigation system. Since LLxprt:
- Uses a flat documentation structure without subdirectories like `get-started/`
- Has no sidebar.json navigation system
- Already has comprehensive installation/deployment documentation in the correct location
- Properly maintains LLxprt-specific branding and package names

...there is no benefit to porting this change. The commit represents organizational differences between the two projects rather than content that needs to be synchronized.

## Verification

Confirmed by comparing:
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/deployment.md` (LLxprt current)
- `git show 37678acb` (upstream changes)

Result: LLxprt already has equivalent and appropriately branded content.

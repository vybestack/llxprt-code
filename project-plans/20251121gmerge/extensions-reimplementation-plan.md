## Extension System Feature Gaps (Research Subagent Summary)

Source commits in the v0.7.0→v0.8.2 window were skipped because llxprt’s extension manager diverged from gemini-cli. We still need the user-facing behaviours they introduced. This note captures the functionality to recreate inside llxprt’s architecture.

| Commit | Upstream Title | Desired Behaviour |
|--------|----------------|-------------------|
| `a0c8e3bf2` | Re-request consent when updating extensions | When a previously consented extension’s manifest changes permissions/scopes, surface a new consent dialog before applying updates. Applies to both CLI prompts and IDE overlay. |
| `defda3a97` | Fix duplicate info messages for extension updates | De-duplicate the “extension updated” info banners emitted during `/extensions update`. Should only show one success message per extension per invocation. |
| `2d76cdf2c` | Throw error for invalid extension names | Reject install/update commands that reference extension names outside `[a-z0-9-_]` (or whatever pattern gemini-cli enforced). Provide actionable error message. |
| `53434d860` | Update enablement behavior + info | Align `/extensions enable|disable` UX so that state changes are reflected immediately in `extension list`, and we display a short capability summary plus trust reminder when toggling. |
| `ea061f52b` | Fix `-e <extension>` for disabled extensions | When launching with `-e someExtension`, force-load that extension even if disabled in settings, or error clearly if disabled and cannot be autoloaded. |
| `cea1a867b` | Extension update confirm dialog | Before applying updates initiated by the CLI, show a dialog summarizing version bump + changelog link, with Accept/Reject options. |
| `ae51bbdae` | Add extension name auto-complete | Provide completion suggestions for `/extensions update|enable|disable <name>` using installed extension IDs. |
| `42436d2ed` | Don’t log error when passing `-e none` | Treat `-e none` as “start with no extensions” without emitting spurious warnings. |
| `6c54746e2` | Restore case insensitivity for extension enablement | Allow `/extensions enable Foo-Bar` to match `foo-bar`. Normalise extension names before persistence. |

### Proposed llxprt Implementations (Implementation Subagent TODOs)

1. **Extension Metadata Store Enhancements**
   - Track `requestedPermissions` hash per extension to compare during updates (needed for consent re-check).
   - Persist normalised (`toLowerCase()`) IDs alongside display names for case-insensitive lookup.

2. **CLI UX Updates**
   - Extend `/extensions` Ink components with auto-complete provider fed by the extension registry.
   - Inject consent/update dialogs into the existing modal system (similar to trust dialogs).
   - Update error messaging for invalid IDs and `-e none`.

3. **Startup Flag Handling**
   - Update argument parser so `-e none` short-circuits extension loading without warning.
   - When `-e <name>` targets a disabled extension, temporarily load it for that session (record ephemeral override).

Implementation subagent will create individual tasks for each bullet once architecture review signs off.

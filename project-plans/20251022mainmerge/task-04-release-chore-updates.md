++BEGIN_FILE+++
++END_FILE+++
## Task 04 – Cherry-pick Release Chore Updates

### Scope
Cherry-pick the following upstream commits:

1. `f08588c07` – `chore: update version to 0.4.3`
2. `011300fe7` – `chore: credit external contributors in release notes`
3. `634d2a8dd` – `chore: publish sandbox image as part of release`

### Key Files to Watch
- Top-level `package.json` and workspace package manifests (`version` fields)
- `CHANGELOG.md` / release notes
- CI or release scripts (e.g., `.github/workflows/release.yml`)

### Acceptance Notes
- Merge version bumps carefully with any local version numbers (ensure we keep/adjust as per our release cadence).
- Add contributor credits without discarding our own notes.
- Ensure sandbox publication changes don’t conflict with our pipeline customizations.

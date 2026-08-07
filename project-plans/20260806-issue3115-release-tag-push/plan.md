# Issue #3115 — Release workflow 403s creating the GitHub Release when main moves mid-run

## Problem

`.github/workflows/release.yml`, step `Create GitHub Release and Tag`, runs:

    gh release create "$RELEASE_TAG" "$CLI_TARBALL" --target "$TARGET_REF" \
      --title "Release $RELEASE_TAG" --notes-file release-notes.md

`--target` makes the **Releases API** materialize the tag. Since GitHub's Nov-2023
"Enforcing workflow scope when creating a release" change, `POST /repos/{o}/{r}/releases`
advertises:

    X-Accepted-GitHub-Permissions: contents=write; contents=write,workflows=write

When `--target <sha>` names a commit whose `.github/workflows/` tree has drifted from the
default branch tip, the endpoint additionally demands `workflows: write`. That scope cannot
be granted to `GITHUB_TOKEN` through a `permissions:` block — it exists only on PATs and
GitHub App installation tokens. The refusal surfaces as the opaque:

    HTTP 403: Resource not accessible by integration

## Evidence

Run 31112396891 (failure issue #3106), tag `v0.11.0-nightly.260806.904a0d062`:

    14:45:09Z  dispatched on 904a0d062       (main's tip at that moment)
    14:58:14Z  05d50c1e89 merged to main     (PR #3103, changed .github/workflows/ci.yml)
    15:48:16Z  gh release create --target 904a0d062  ->  HTTP 403

Negative control — during the last successful run (8/5 16:35Z–17:39Z) `main` never moved,
so the target stayed at the default branch tip and the identical command succeeded. The
workflow file is byte-identical between the two runs.

Consequence of the failure: npm and ghcr publishes had already completed, so the release
split — npm carries `0.11.0-nightly.260806.904a0d062` with the `nightly` dist-tag pointing
at it, while the repo has no tag and no GitHub Release.

This is a race with a roughly one-hour exposure window on every release run, not a
regression.

## Fix

Create the tag through the Git References REST API, then create the release from the
pre-existing tag. A smart-HTTP git tag push does not bypass the workflow-file guard:
[actions/checkout#1421](https://github.com/actions/checkout/issues/1421) documents the same
race when the branch advances before a tag is pushed. `POST /repos/{owner}/{repo}/git/refs`
requires `contents: write` and does not pass through receive-pack, so it can create the ref
without requiring an unavailable `workflows` permission. Dropping `--target` alone is wrong:
the Releases API would fall back to the default branch tip and tag a different commit than
the one that was built and published.

Shape of the replacement (illustrative, not prescriptive):

    TARGET_SHA="$(git rev-parse "${TARGET_REF}^{commit}")"

    query git/matching-refs/tags/${RELEASE_TAG} with gh api and exact-name jq filtering
    if tag exists:
      peel an annotated tag object; if its commit differs from TARGET_SHA -> hard error
      otherwise reuse it
    else:
      create refs/tags/${RELEASE_TAG} at TARGET_SHA with POST git/refs

    gh release create "${RELEASE_TAG}" "${CLI_TARBALL}" [ "${VSIX_PATH}" ] \
      --title "Release ${RELEASE_TAG}" --notes-file release-notes.md

## Constraints

- Both `TARGET_REF` paths must keep working: the release-branch path (`SHOULD_CREATE_BRANCH
  == true`, `TARGET_REF` is the already-pushed `release/<tag>` branch) and the nightly path
  (`TARGET_REF` is `git rev-parse HEAD`).
- The step's existing `if:` guard already excludes dry runs and duplicate nightlies; tag
  creation must stay inside that guard so a dry run never writes a tag.
- Fail fast. A tag that already exists at the wrong commit is a hard error, not something to
  paper over. No retry loops, no `|| true`.
- Version values stay threaded through `env:`, never inline `${{ }}` expansion in the shell
  body — the current step does this deliberately to avoid shell injection.
- No new secrets, no GitHub App token, no lint/complexity rule changes, no suppression
  directives.

## Tests

Behavioral coverage over the workflow step, in the style of the existing
`scripts/tests/*workflow*.test.ts` files. New tests must be Bun (`bun:test`), not Vitest.

At minimum:

1. The step no longer passes `--target` to `gh release create`.
2. The step creates `refs/tags/$RELEASE_TAG` through `gh api` before invoking
   `gh release create`, verified from the API simulator's state at release-creation time.
3. Executing the step body under `bash` against a throwaway git repository with a stateful
   fake `gh` on `PATH`:
   - creates the tag at exactly `TARGET_REF`'s commit through the Git References API;
   - reuses lightweight and annotated tags that resolve to the release commit;
   - rejects an existing tag at another commit;
   - distinguishes an exact tag from names that merely share its prefix;
   - fails fast when the matching-refs API lookup fails;
   - still fails before GitHub calls when the CLI tarball is missing.
4. Both the VSIX and non-VSIX branches retain their exact release assets and options without
   `--target`.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

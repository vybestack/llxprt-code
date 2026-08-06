# Issue 2903: Remove `gh` from the default sandbox image

Plan ID: ISSUE-2903-SANDBOX-GH
Generated: 2026-08-05

## Sequencing evidence

Issue 1663 was closed by merged PR 2919. Its merge commit,
`9169c2948c920c705b5e3f513d4951587baf4a41`, is an ancestor of this branch's
`main`. The supported GitHub host broker and `github` tool therefore exist
before this issue removes the sandbox-local binary.

## Accepted behavior

### AC1: Default sandbox excludes `gh`

- **Given** the repository's default `Dockerfile`
- **When** its operating-system package installation is evaluated or the image
  is built
- **Then** `gh` is not requested as a package and `command -v gh` in the built
  image fails.

This is a usability and path-clarity change. It is not a containment or network
security control.

### AC2: `jq` remains available

- **Given** the same default sandbox image
- **When** its package installation is evaluated or the image is built
- **Then** `jq` remains requested and `jq --version` succeeds in the image.

`jq` is retained because its usefulness is not limited to parsing GitHub
responses. Existing user-facing hook examples, debug-log documentation,
telemetry inspection, and arbitrary shell workflows use it.

### AC3: Broker and custom-image boundaries remain unchanged

- Host-side `gh`, the GitHub broker, the `github` tool, broker credentials,
  network tools such as `curl`, and custom user-provided sandbox images are not
  modified.
- The change must not claim or imply that binary absence is a security boundary.

## Boundary cases

- Match package names as complete apt-list entries so unrelated text containing
  `gh` cannot satisfy or fail the contract.
- Assert `jq` independently from `gh`; removing both would violate AC2.
- Do not scan or rewrite host scripts and developer workflows that legitimately
  use host-side `gh`.

## Test-first implementation

1. Add a Bun test in `scripts/tests/` that reads the apt-install block from the
   root `Dockerfile`, extracts complete package entries, and fails on current
   `main` because `gh` is present.
2. Keep an assertion that `jq` remains in that package set.
3. Remove only the `gh` package entry from `Dockerfile` and make the test pass.
4. Build the candidate sandbox image with the established sandbox build path.
5. Run the built image and capture behavioral evidence that:
   - `command -v gh` exits nonzero;
   - `jq --version` exits zero.
6. Run the complete project verification suite and smoke test required by the
   repository.

## Review triage policy

Every finding will be classified as one of:

- **Blocker-Fix**: breaks accepted behavior, required gates, ancestry, or
  conflict-free delivery.
- **In-scope-Fix**: improves correctness or evidence for AC1-AC3 without adding
  a new subsystem, workflow, dependency, abstraction, or unrelated behavior.
- **Reject**: factually incorrect or contradicts the accepted behavior.
- **Defer**: potentially valid but outside AC1-AC3.

Local and PR Open Code Review runs are capped at two each.

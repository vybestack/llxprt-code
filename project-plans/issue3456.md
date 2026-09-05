# Issue #3456: sandbox image dependency verification

## Root cause

The CLI bundle externalizes `@ast-grep/napi` and other native packages. Before
commit `3d0364edb`, `packages/cli/package.json` did not declare those packages
directly. npm could therefore nest them under another globally installed
workspace package. `bundle/llxprt.js` then failed to resolve
`@ast-grep/napi` from the image-global CLI location.

The reported Docker and Podman containers were also different image artifacts.
The mutable `0.11.0` tag had been rebuilt, and each engine retained its own local
copy. The inspected copies had different image IDs, repository digests, and
creation times even though both were tagged `0.11.0` and both were
`linux/arm64`. The Docker cache could therefore retain the pre-fix artifact while
Podman used the rebuilt artifact.

The direct dependency declarations are already present on this branch through
`3d0364edb`. Issue #3456 exposed three remaining publication gaps:

1. The completed Dockerfile did not load the externalized native modules or run
   the image-global CLI after the final global install transaction.
2. The manual sandbox workflow omitted four tarballs required by the Dockerfile
   and packed workspace metadata without first binding release dependency
   versions.
3. Smoke failures did not report the engine version, image ID and repository
   digest, image platform, requested platform, or runtime architecture.

## Test-first plan

1. Add a behavioral Bun test that executes a runtime verification program against
   the real installed production and native modules.
2. Add behavioral process tests for a sandbox image probe. A fake executable at
   the container-engine boundary supplies success and failure results. Assert the
   probe's user-visible result and diagnostics, not command interactions.
3. Require release workflows to use the probe for loaded amd64, arm64, and
   runner-native candidates.
4. Verify the completed Dockerfile after every install layer with the image-global
   `llxprt --version`, a complete production dependency-tree check, and
   functional native-module loading.
5. Make the manual image workflow pack every Dockerfile workspace tarball with
   release-bound dependency metadata and guaranteed restoration.
6. Build locally and run the completed image through each available real engine.
7. Run focused quality checks, the test-audit scanner, and the repository
   verification cycle.

## Acceptance criteria

1. **Fresh Docker container:** a locally built `linux/arm64` image completed and
   `scripts/sandbox-image-probe.ts` ran it in a new Docker container. The
   image-global CLI printed `0.11.0`.
2. **Docker and Podman parity:** the inspected `linux/arm64` production images
   under both engines loaded `@ast-grep/napi`, `sharp`, `@napi-rs/keyring`, and
   `@lydell/node-pty`. Their complete production dependency trees had the same
   SHA-256 value,
   `01340eeceb684043947902432cd56872fa860bf88529c867b874e168c9015625`.
   Their different image IDs and creation times identified the stale mutable-tag
   condition.
3. **Completed-image verification:** the final Dockerfile layer runs the packaged
   native-module verifier, `npm ls --global --omit=dev --all`, and
   `llxprt --version` after the UI install. Both publication workflows run the
   diagnostic probe against each loaded candidate before pushing.
4. **Comparable failure output:** the behavioral failure test verifies engine,
   image reference, requested platform, image ID, repository digest, image
   platform, runtime architecture, engine version, runtime probe status, and the
   original module-load failure.

## TDD evidence

### RED

- `tmp/verify3456/red.log`: 0 pass, 5 fail before the runtime verifier, image
  probe, Dockerfile gate, and workflow wiring existed.
- `tmp/verify3456/red-manual-workflow.log`: the added package-closure behavior
  failed because the manual workflow did not pack
  `@vybestack/llxprt-code-storage` and the other omitted workspaces.

### GREEN

- `tmp/verify3456/green-focused.log`: 5 pass, 0 fail after the runtime verifier,
  image probe, Dockerfile gate, and workflow wiring were implemented.
- `tmp/verify3456/green-manual-workflow.log`: 25 pass, 0 fail after the manual
  workflow packed all required tarballs with release-bound metadata.
- `tmp/verify3456-final/focused-tests.log`: 56 pass, 0 fail across the issue test,
  Dockerfile retry behavior, bundle-external ownership, and release process
  suites.
- `tmp/verify3456-final/test-audit.log`: 2,759 files scanned with no finding for
  the new issue test.

## Real-engine evidence

- Docker built `llxprt-sandbox-issue3456:local` as `linux/arm64`. The resulting
  image digest was
  `sha256:190fa4140ab5c713880ecb5ae54a3784db1257ba1fc87e1546ec1204d51b085f`.
- `tmp/verify3456/docker-probe.log` records `llxprt --version` as `0.11.0`, all
  four native modules loading, production dependency-tree SHA-256
  `1eb672058c92ea375f978108318d3f03799bf068de40849cbf7ae1c4bdbb3eab`, and
  the Docker image digest and platform.
- Podman completed the same Dockerfile and final verification layer as
  `localhost/llxprt-sandbox-issue3456:local`, image ID
  `aa1194929aebb6d945bff991a5122d943fa53da592e63e7fcb7d99705d81609b`.
  Its build output records `llxprt --version` as `0.11.0` and successful loading
  of all four native modules.
- Docker and Podman are not currently reachable, so final verification uses the
  retained successful real-engine logs rather than restarting either host VM.

## Final verification

- `npm run format`: passed.
- Targeted ESLint over all changed TypeScript files: passed with no warnings.
- Full `npm run lint`: the foreground harness was terminated by signal 15 before
  ESLint returned. A detached full-tree ESLint process then completed with no
  diagnostics in its log, but the detached shell did not retain its exit code.
- `actionlint` reports the same existing `SC2016` finding at
  `.github/workflows/release.yml:563` on both `HEAD` and the completed file. The
  changed workflow steps add no actionlint finding.
- `npm run typecheck`: passed across all workspaces, scripts, and evals.
- `npm run build`: passed across all workspaces.
- `npm run test`: all issue-related and CLI tests passed, including 725/725 CLI
  files and 584/584 provider files. The repository run finished with one
  unrelated failure out of 385 agents files. The provider-agnostic naming test
  rejects every absolute path when a worktree is beneath a `tmp` directory, then
  incorrectly observes zero source files. This location-sensitive defect is
  tracked as issue #3502. No other test file failed.
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing
  else"`: passed and returned a three-line haiku.
- `bun scripts/test-audit/scan.ts tmp/verify3456-final/test-audit`: scanned 2,759
  files with no scanner errors and no finding for the new issue test.
- `git diff --check`: passed.
- No lockfile changed.

# Pseudocode: Release And Trusted Publishing Updates

Plan ID: PLAN-20260608-ISSUE1585
Phase: P02 Contract-First Pseudocode

## Interface Contracts

Inputs:

- New workspace package `@vybestack/llxprt-code-tools`.
- Existing npm/package-lock release flow.
- Existing release process tests in `scripts/tests/release-process.test.js`.
- Existing sandbox packaging flow in `.github/workflows/build-sandbox.yml`, `scripts/build_sandbox.js`, and `Dockerfile`.

Outputs:

- Release and sandbox pseudocode publishes/packs/installs tools before core, providers, and CLI.
- Release tests assert tools ordering and file coverage.
- Manual trusted publishing checklist exists for tools package setup.
- `packages/tools/package.json` follows provider package conventions.

## Numbered Pseudocode

10: METHOD updateReleaseProcessForToolsPackage()
11:   EDIT `.github/workflows/release.yml`
12:     ADD step named `Publish @vybestack/llxprt-code-tools` before existing core/providers/cli publish steps
13:     ADD command `npm publish --workspace=@vybestack/llxprt-code-tools --access public --provenance`
14:     ADD tarball prep step before dependent package tarball prep: `npm pack -w @vybestack/llxprt-code-tools`
15:     ENSURE publish order is tools before `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, and CLI package
16:   EDIT `.github/workflows/build-sandbox.yml`
17:     ADD command `npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist` before existing pack commands
18:     ENSURE build-sandbox pack sequence is tools → core → providers → cli
19:   EDIT `scripts/tests/release-process.test.js`
20:     ADD `@vybestack/llxprt-code-tools` to `expectedPublishOrder` array before core/providers/cli
21:     ADD assertion that release workflow prepares tools tarball with `npm pack -w @vybestack/llxprt-code-tools`
22:     ADD assertion that tools appears in sandbox pack list
23:     ADD assertion that `Dockerfile` includes tools tarball install
24:     ADD assertion that `.github/workflows/build-sandbox.yml` includes tools pack step
25:     ADD assertion that tools appears before core in build-sandbox pack sequence
26:     ADD assertion that tools appears before core in Dockerfile COPY order
27:     ADD assertion that tools appears before core in Dockerfile npm install order
28:     ADD assertion that release workflow publishes tools before core/providers/cli
29:     ADD assertion that `scripts/version.js` includes tools in canonical workspace order
30:     ADD assertion that `scripts/prepare-package.js` copies tools package files
31:   EDIT `scripts/build_sandbox.js`
32:     ADD `toolsPackageDir` for `packages/tools/dist`
33:     ADD `npm pack -w @vybestack/llxprt-code-tools` before existing pack commands for core/providers/cli
34:     ADD tools tarball to generated COPY statements before core/providers/cli tarballs
35:     ADD tools tarball to generated npm install transaction before core/providers/cli tarballs
36:     ADD any existing tarball permission handling, such as `chmodSync(tarballPath, 0o755)`, consistently for tools
37:   EDIT `Dockerfile`
38:     ADD `COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz /tmp/` before existing package tarball COPY lines
39:     ADD tools tarball as first argument in npm install transaction:
40:       `/tmp/vybestack-llxprt-code-tools-*.tgz /tmp/vybestack-llxprt-code-core-*.tgz /tmp/vybestack-llxprt-code-providers-*.tgz /tmp/vybestack-llxprt-code-*.tgz`
41:     ENSURE Dockerfile order is tools → core → providers → cli
42:     DO NOT add `toolsPackageDir` or `chmodSync` text to Dockerfile; those belong only in `scripts/build_sandbox.js`
43:   EDIT root `package.json`
44:     ADD `packages/tools` to `workspaces` array following existing workspace ordering conventions
45:   RUN `npm install`
46:     UPDATE `package-lock.json` through the existing npm/package-lock process
47:   EDIT `scripts/version.js`
48:     ADD `@vybestack/llxprt-code-tools` to `actualWorkspaces` array after core and before providers
49:     PRESERVE canonical package order used by release/version scripts
50:   EDIT `scripts/prepare-package.js`
51:     ADD `copyFiles('tools', { README.md, LICENSE, .npmrc })` or the exact local equivalent matching existing `copyFiles` call shape
52:     ENSURE tools package receives README, LICENSE, and `.npmrc` preparation like other publishable packages
53:   INSPECT `scripts/build.js`
54:     VERIFY `npm run build --workspaces` covers `packages/tools` automatically once the workspace is present
55:     EDIT only if inspection proves tools is excluded from workspace builds
56:   EDIT `packages/tools/package.json`
57:     FOLLOW `packages/providers/package.json` conventions exactly for `name`
58:     FOLLOW `packages/providers/package.json` conventions exactly for `version`
59:     FOLLOW `packages/providers/package.json` conventions exactly for `license`
60:     FOLLOW `packages/providers/package.json` conventions exactly for `repository`
61:     FOLLOW `packages/providers/package.json` conventions exactly for `type`
62:     FOLLOW `packages/providers/package.json` conventions exactly for `main`
63:     FOLLOW `packages/providers/package.json` conventions exactly for `types`
64:     FOLLOW `packages/providers/package.json` conventions exactly for `exports`
65:     FOLLOW `packages/providers/package.json` conventions exactly for `scripts`
66:     FOLLOW `packages/providers/package.json` conventions exactly for `files`
67:     FOLLOW `packages/providers/package.json` conventions exactly for `dependencies`
68:     FOLLOW `packages/providers/package.json` conventions exactly for `devDependencies`
69:     FOLLOW `packages/providers/package.json` conventions exactly for `engines`
70:     INCLUDE runtime dependency `zod-to-json-schema` if moved tool/formatter code requires it
71:     INCLUDE `@vybestack/llxprt-code-test-utils` only as `devDependency`, never runtime dependency
72:   CREATE `project-plans/issue1585/manual-trusted-publishing.md`
73:     DOCUMENT npm trusted publisher setup for `@vybestack/llxprt-code-tools`
74:     DOCUMENT maintainer verification that `--provenance` is present in release workflow
75:     DOCUMENT tools package publish order before dependent packages
76:   RUN `npm run test:scripts`
77:   RUN `node scripts/bind-release-deps.js --dry-run`
78:   RETURN release process ready

## Verification Pseudocode

90: RUN `rg -n "@vybestack/llxprt-code-tools|llxprt-code-tools|packages/tools" .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json scripts/version.js scripts/prepare-package.js packages/tools/package.json`
91: EXPECT each release/sandbox/package metadata file references tools where required
92: RUN `npm run test:scripts`
93: EXPECT release process tests pass after implementation phase
94: RUN `node scripts/bind-release-deps.js --dry-run`
95: EXPECT dependency binding order accepts tools before dependent packages

## Anti-Pattern Warnings

[ERROR] DO NOT: create a package without adding it to release publishing.
[ERROR] DO NOT: assume `--provenance` configures npm trusted publishing by itself.
[ERROR] DO NOT: add tools to workspaces but omit `package-lock.json` update.
[ERROR] DO NOT: pack/copy/install tools after core/providers/cli; dependents require tools first.
[ERROR] DO NOT: omit `.github/workflows/build-sandbox.yml` tools pack step.
[ERROR] DO NOT: omit `scripts/version.js` `actualWorkspaces` update.
[ERROR] DO NOT: omit `scripts/prepare-package.js` `copyFiles` update for tools.
[ERROR] DO NOT: put `toolsPackageDir` or `chmodSync` in Dockerfile pseudocode as Dockerfile edits.
[OK] DO: include a manual maintainer checklist for npm trusted publisher setup.
[OK] DO: ensure Dockerfile install order is tools → core → providers → cli.

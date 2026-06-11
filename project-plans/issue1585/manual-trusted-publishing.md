# Manual Trusted Publishing Setup for @vybestack/llxprt-code-tools

Issue: #1585
Package: `@vybestack/llxprt-code-tools`

## Purpose

`packages/tools` is a new publishable workspace package. The release workflow now publishes it before `core`, `lsp`, `providers`, and `cli`, and uses npm provenance. npm trusted publishing must also be configured manually for the new package because that registry-side setup cannot be represented fully in repository source.

## Manual npm Checklist

- [ ] Confirm the npm package exists or will be created as `@vybestack/llxprt-code-tools`.
- [ ] In npm package settings, configure trusted publishing for this repository and release workflow.
- [ ] Repository owner/name: `vybestack/llxprt-code`.
- [ ] Workflow file: `.github/workflows/release.yml`.
- [ ] Environment/tag settings match the existing trusted publishing setup used by sibling publishable packages.
- [ ] Confirm package access is public.
- [ ] Confirm publish provenance is enabled/accepted for the workflow's `npm publish --provenance` command.
- [ ] Confirm first dry-run release logs a tools publish step before core/providers/cli publish steps.

## Source-Controlled Release Wiring To Verify

- `.github/workflows/release.yml` publishes `@vybestack/llxprt-code-tools` before `@vybestack/llxprt-code-core`.
- `.github/workflows/release.yml` packs sandbox tarballs in tools, core, providers, CLI order.
- `.github/workflows/build-sandbox.yml` packs sandbox tarballs in tools, core, providers, CLI order.
- `scripts/build_sandbox.js` locally packs/chmods tools before dependent tarballs.
- `Dockerfile` copies and installs the tools tarball before dependent tarballs.
- `scripts/tests/release-process.test.js` covers publish, sandbox, Dockerfile, versioning, package preparation, and bind-release-deps order.

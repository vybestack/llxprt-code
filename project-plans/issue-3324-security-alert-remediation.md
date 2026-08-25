# Plan: Remediate open security alerts for 0.11.0

Plan ID: PLAN-20260825-SECALERTS

Tracking issue: https://github.com/vybestack/llxprt-code/issues/3324

Generated: 2026-08-25

## Objective

Resolve every open Dependabot alert present in the 2026-08-25 audit, remove the unsafe ZIP extractor, and keep npm and Bun dependency graphs aligned. Review the two open CodeQL alerts and dismiss only findings that do not represent vulnerabilities.

## Alert disposition

### Fix in this change

- Dependabot-195: https://github.com/vybestack/llxprt-code/security/dependabot/195
- Dependabot-196: https://github.com/vybestack/llxprt-code/security/dependabot/196
- Dependabot-197: https://github.com/vybestack/llxprt-code/security/dependabot/197
- Dependabot-198: https://github.com/vybestack/llxprt-code/security/dependabot/198
- Dependabot-199: https://github.com/vybestack/llxprt-code/security/dependabot/199
- Dependabot-200: https://github.com/vybestack/llxprt-code/security/dependabot/200
- Dependabot-201: https://github.com/vybestack/llxprt-code/security/dependabot/201
- Dependabot-202: https://github.com/vybestack/llxprt-code/security/dependabot/202
- Dependabot-203: https://github.com/vybestack/llxprt-code/security/dependabot/203
- Dependabot-205: https://github.com/vybestack/llxprt-code/security/dependabot/205
- Dependabot-206: https://github.com/vybestack/llxprt-code/security/dependabot/206
- Dependabot-208: https://github.com/vybestack/llxprt-code/security/dependabot/208
- Dependabot-209: https://github.com/vybestack/llxprt-code/security/dependabot/209
- Dependabot-210: https://github.com/vybestack/llxprt-code/security/dependabot/210
- Dependabot-211: https://github.com/vybestack/llxprt-code/security/dependabot/211
- Dependabot-213: https://github.com/vybestack/llxprt-code/security/dependabot/213
- Dependabot-218: https://github.com/vybestack/llxprt-code/security/dependabot/218
- Dependabot-219: https://github.com/vybestack/llxprt-code/security/dependabot/219
- Dependabot-220: https://github.com/vybestack/llxprt-code/security/dependabot/220
- Dependabot-221: https://github.com/vybestack/llxprt-code/security/dependabot/221
- Dependabot-222: https://github.com/vybestack/llxprt-code/security/dependabot/222
- Dependabot-223: https://github.com/vybestack/llxprt-code/security/dependabot/223
- Dependabot-224: https://github.com/vybestack/llxprt-code/security/dependabot/224
- Dependabot-225: https://github.com/vybestack/llxprt-code/security/dependabot/225
- Dependabot-226: https://github.com/vybestack/llxprt-code/security/dependabot/226
- Dependabot-227: https://github.com/vybestack/llxprt-code/security/dependabot/227
- Dependabot-228: https://github.com/vybestack/llxprt-code/security/dependabot/228
- Dependabot-229: https://github.com/vybestack/llxprt-code/security/dependabot/229
- Dependabot-230: https://github.com/vybestack/llxprt-code/security/dependabot/230
- Dependabot-231: https://github.com/vybestack/llxprt-code/security/dependabot/231
- Dependabot-232: https://github.com/vybestack/llxprt-code/security/dependabot/232
- Dependabot-233: https://github.com/vybestack/llxprt-code/security/dependabot/233
- Dependabot-234: https://github.com/vybestack/llxprt-code/security/dependabot/234
- Dependabot-236: https://github.com/vybestack/llxprt-code/security/dependabot/236
- Dependabot-237: https://github.com/vybestack/llxprt-code/security/dependabot/237
- Dependabot-238: https://github.com/vybestack/llxprt-code/security/dependabot/238
- Dependabot-239: https://github.com/vybestack/llxprt-code/security/dependabot/239

Each alert names a package and affected version present in at least one committed lockfile. Compatible patched releases exist for all alerts except Dependabot-238. That alert concerns `extract-zip`, which has no patched release, so the package must be removed.

### Dismiss as false positives

- CodeQL-190: https://github.com/vybestack/llxprt-code/security/code-scanning/190
- CodeQL-191: https://github.com/vybestack/llxprt-code/security/code-scanning/191

CodeQL-190 identifies `singleQuoteForShell` as an unsafe string construction even though the function applies standard POSIX single-quote escaping. CodeQL-191 identifies the shell tool's intentional command payload as injected data. The shell tool accepts an exact Bash command, checks it through command permissions, and then executes it. Quoting the command would disable required shell syntax. Both alerts were dismissed as false positives with these facts in the dismissal comments.

Both dismissals were preserved from the original issue3324 change and remain untouched by the remediation follow-up.

## Dependency changes

| Package | Required result | Implementation |
| --- | --- | --- |
| `nanoid` | 3.3.18 or later in 3.x | Major-scoped root override to 3.3.18 |
| `@hono/node-server` | 1.19.15 or later in 1.x | Raise direct floor to `^1.19.15` |
| `hono` | 4.12.34 or later in 4.x | Raise root override to `>=4.12.34 <5` |
| `js-yaml` | 3.15.1 in 3.x and 4.3.1 in 4.x | Raise major-scoped root overrides, direct 4.x declaration, and VS Code companion overrides |
| `ip-address` | 10.3.1 or later in 10.x | Raise root override to `>=10.3.1 <11` |
| `undici` | 7.29.0 or later in 7.x | Raise direct workspace floors to `^7.29.0` |
| `fast-uri` | 3.1.5 or later in 3.x | Raise direct floor to `^3.1.5` |
| `postcss` | 8.5.23 or later in 8.x | Raise root override to `>=8.5.23 <9` |
| `brace-expansion` | 1.1.18, 2.1.4, and 5.0.9 | Use separate root overrides for each constrained major |
| `tar` | 7.5.22 or later in 7.x | Raise direct floors in root, CLI, and A2A server |
| `fast-xml-parser` | 5.10.1 or later in 5.x | Raise root override to `>=5.10.1 <6` |
| `linkify-it` | 5.0.2 in 5.x | Keep `markdown-it` on compatible 14.x and override 5.x to 5.0.2 |
| `shell-quote` | 1.10.0 | Raise workspace declarations and use one exact root override |
| `extract-zip` | Absent | Replace direct use and update `@lvce-editor/ripgrep` to an extract-zip-free release |
| `yauzl` | 3.x (compatible with `^3.4.0`) | Root mandatory dependency mirrors the CLI workspace declaration so the shipped CLI's runtime import is covered by the publish-integrity root-manifest guard |

Both `package-lock.json` and `bun.lock` must be regenerated. npm retains compatible transitive versions unless explicitly updated, so the lockfile procedure includes targeted transitive updates. Bun must be regenerated from scratch with `rm bun.lock && bun install`, as documented in `dev-docs/bun.md`. `yauzl` was added to the root manifest and both lockfiles were regenerated; `extract-zip` is absent from both.

## ZIP extraction design

`@lvce-editor/ripgrep` moves from `^1.6.0` to `^5.1.0`. Releases from 5.1.0 onward delegate to `@vscode/ripgrep`, preserve the `rgPath` export, and do not depend on `extract-zip`.

Direct ZIP extraction moves to `yauzl@^3.4.0`. The selected release exposes promise-based, lazy entry iteration and streams each file without buffering the archive.

`extractZipSafe` (packages/cli/src/utils/zipExtract.ts) follows this sequence:

1. Resolve `destDir` to an absolute path on entry so `ZipExtractResult.files` is always absolute.
2. Create the destination if needed, then create a private staging directory *inside* it.
3. Read entries lazily with strict file-name validation and `validateEntrySizes` off, enforcing resource ceilings: max entry count, max file-name length, and declared per-entry and cumulative uncompressed bytes before an entry's output is opened.
4. Reject symlink entries based on Unix mode bits.
5. Canonicalize repeated slash and internal `.` segments, then reject parent traversal, absolute paths, drive-qualified paths, and backslashes. Contained names that merely start with two dots, such as `..valid/file.txt`, remain valid.
6. Track every complete canonical archive path case-insensitively before writing. Exact duplicates, normalized aliases, nested case-only aliases, and file/directory conflicts fail before publication.
7. Stream regular file contents into staging through a byte-counting transform that enforces the same per-entry and cumulative ceilings against the bytes actually decompressed. Reject an entry when its streamed byte count differs from its declared uncompressed size.
8. Preserve safe regular-file rwx bits from Unix ZIP metadata, default regular files to 0644, and never preserve special bits. Record explicit directory modes while keeping staging directories owner-writable and searchable.
9. Preserve explicit empty and nested-empty directory entries.
10. Publish each staged top-level output with filesystem-enforced exclusive creation. Regular files use `copyFile` with `COPYFILE_EXCL`. Directories use non-recursive `mkdir` and remain private at mode 0700 while their staged descendants are copied with the same exclusive operations. Apply archived safe directory modes deepest-first after publication. A lower-cased destination snapshot also rejects case-only top-level collisions on case-sensitive hosts.
11. Record a root for rollback only after its exclusive file copy or directory creation succeeds. If a later publication fails, remove only the roots created by this invocation.
12. Remove staging. If cleanup or rollback fails, report those errors with the original failure via `AggregateError`.

Staging inside the destination prevents a preexisting destination symlink from redirecting entry writes. Exclusive publication preserves existing destination content. The extractor is shared by `.skill` installation and GitHub release ZIP extraction.

## Behavioral tests

The co-located Bun test uses real ZIP archives and the production extractor. It covers:

- normal files and nested directories;
- symmetric rejection of parent traversal, absolute, drive-qualified, and backslash entries;
- acceptance of a contained `..valid/file.txt` name;
- symlink rejection;
- partial output removal with a preserved preexisting destination sentinel on failure;
- removal of a destination this call created when nothing is published;
- refusal to write through a preexisting destination symlink directory;
- collision with a preexisting file (exact and case-insensitive) that never replaces the existing content;
- two archive roots differing only by case publishing neither;
- exact duplicates, nested case-only duplicates, normalized repeated-slash and internal-dot aliases, and file/directory conflicts publishing none of the affected root;
- rollback of an earlier published root when a later exclusive publication fails;
- a preserved unrelated sentinel on success;
- absolute return paths for a relative `destDir`;
- preserved explicit and nested-empty directories, including safe directory modes on POSIX;
- staging children beneath an explicit directory whose archived final mode is read-only;
- each practical resource limit: entry count, file-name length, declared per-entry bytes, declared cumulative bytes, actual streamed per-entry bytes, and actual streamed cumulative bytes, plus declared-to-streamed size integrity, each with cleanup assertions;
- an injected rollback/cleanup removal failure proving the primary plus rollback and cleanup errors are retained in an `AggregateError`.

## Independent review and OCR

The first independent review found one High, five Medium, and four Low issues. The implementation was updated to declare `yauzl` in the published root manifest, use exclusive publication with rollback, enforce archive expansion limits, preserve safe permission bits and empty directories, accept valid `..valid` names, align the documented result contract, and test cleanup failures without swallowing filesystem errors.

A second fresh independent review found two Medium issues. Explicit directory mode 0555 was being applied during staging, which prevented later child extraction. Complete-path collision checks also covered case aliases only at the top level. The implementation now records directory modes during staging, applies them deepest-first after publication, and checks complete archive paths case-insensitively. Behavioral regressions reproduce both original failures and pass after the changes. No third broad review was run because the workflow permits two rounds.

The wrapper OCR run is recorded at `/Users/acoliver/Library/Logs/llxprt-code/opencodereview/runs/20260825T223049Z-375b980f`. Its embedded manifest reports all 14 selected items completed, but the wrapper reports coverage as `unknown` because upstream manifest support is incomplete. The run used `zai-anthropic/glm-5.2`, not the configured StepFun model, and `stderr.log` records one invalid line-range tool request. These limitations prevent describing the OCR as StepFun-backed or exhaustively complete.

OCR produced three hypotheses:

1. **Valid Medium:** repeated slash and internal `.` path aliases had different collision keys even though filesystem path construction mapped them to the same staged target. A real-ZIP regression failed before the change. Entry names are now canonicalized before collision checks and extraction; the regression passes for both alias forms.
2. **Invalid Low:** OCR described `publishRootExclusive` and `copyTreeExclusive` as duplicate recursive publication logic. Root publication already delegates child copying to `copyTreeExclusive`; the remaining root bookkeeping controls rollback ownership and ordering.
3. **Invalid Low:** OCR described the non-recursive `fs.rmdir(destDir)` call as deprecated by DEP0147. DEP0147 applies to recursive `fs.rmdir`; this call removes only a verified-empty directory and is not affected.

Pull request review produced two additional hypotheses. CodeRabbit identified a valid Medium integrity gap: streamed entry bytes were bounded but not required to equal the declared uncompressed size. A real-ZIP regression failed before the fix, and the extractor now rejects either truncated or padded entries before publication. The GitHub OCR review alleged that calling `close()` after yauzl's `autoClose` would throw and mask failures. The installed yauzl 3.4.0 implementation makes `ZipFile.close()` idempotent by returning immediately when `isOpen` is false, so that finding was rejected against the exact dependency source.

### Local verification results

- `yauzl` is a mandatory root dependency (`^3.4.0`). `package-lock.json` was regenerated with the repository npm procedure, and `bun.lock` was regenerated from scratch with `rm bun.lock && bun install`.
- The issue-scoped `npm ls` query exits successfully and resolves every in-scope package at or above its required security floor. Full `npm ls --all --json` still reports baseline extraneous `@emnapi/runtime` and `@img/sharp-wasm32` packages plus existing invalid `@types/node` and overridden `uuid` records that are also present on `HEAD`.
- `npm run check:lockfile` passes, and the Bun workspace parity suite passes 18 tests with 203 assertions.
- `extract-zip` is absent from `package-lock.json` and `bun.lock`.
- `npm audit` reports four Low vulnerabilities and no Moderate, High, or Critical vulnerabilities. The remaining AI SDK advisories require out-of-scope semver-major upgrades. `bun audit` reports one Low advisory from the same dependency family.
- After review remediation, the ZIP suite passes 35 tests with 90 assertions. The ZIP, skill, and GitHub extension suites pass 75 tests with 147 assertions. The broader archive, caller, publication, and ripgrep run passes 217 tests across 10 files with one platform-specific test skipped.
- The test-audit scanner completed over 2,706 files with no scanner error and no finding for `zipExtract.test.ts`.
- Full typecheck and build pass after the pull request review remediation. Focused Prettier and ESLint checks pass for the changed ZIP source and test, and `git diff --check` passes apart from Git's existing NOTICES line-ending warning.
- An earlier full repository lint passed before review remediation. Three final full-lint attempts after remediation reached the 900-second command ceiling without diagnostics and were terminated. Scoped repository lint over every changed TypeScript file passed. This plan does not claim a final completed full-lint run.
- Five full repository test attempts did not produce a green local result. Different runs timed out in different agents files; a reduced-agents-concurrency run instead timed out in one provider tokenizer file and later in agents. The post-review attempt passed providers 579/579 and every package after agents, but four agents files hit their existing per-file timeout. Every previously implicated agents file passed separately, the full agents package passed 376/376 plus 6/6 isolated files, and the provider tokenizer rerun passed 33/33. The failures vary with loaded workspace execution, but their cause is not established. No security-remediation test failed, and this plan does not claim a green local full-suite run.
- The required `stepfun-37` smoke command reached the configured provider but exited with HTTP 400 because the account has no active Step plan subscription. The local environment could not complete the external inference step.

Evidence still required after this update:

- pull request CI and review-thread status.

## Acceptance criteria

- All 37 Dependabot alerts listed above resolve through patched package versions or removal of the affected package.
- CodeQL dismissals include evidence and use the `false positive` reason.
- Neither lockfile contains `extract-zip`.
- Both lockfiles contain no affected version named by the in-scope alerts.
- ZIP extraction does not write through archive symlinks, traversal paths, absolute paths, drive-qualified paths, or preexisting destination symlink directories.
- Failure preserves preexisting destination content and does not leave newly staged output.
- ZIP extraction enforces documented entry-count, name-length, per-entry, and cumulative size limits against both declared and streamed bytes, and rejects entries whose streamed byte count differs from the declared uncompressed size.
- npm and Bun lockfiles agree with every workspace manifest.
- Focused security tests, static checks, build, lockfile checks, and scoped lint pass; incomplete full-suite, full-lint, and external smoke results are reported without claiming success.
- The pull request closes tracking issue 3324 and reports alerts as `Dependabot-N` or `CodeQL-N`, never as bare issue references.

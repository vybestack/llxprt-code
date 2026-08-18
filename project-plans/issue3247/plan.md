# Plan: Restore Codex OAuth URL Delivery to macOS Browsers (Issue #3247)

Plan ID: PLAN-20260818-ISSUE3247
Generated: 2026-08-18
Issue: #3247
Status: Ready for test-first implementation

## Problem statement

Codex OAuth still generates and displays the correct authorization URL, copies it to the clipboard, and invokes the browser launcher. On macOS, a Codex bucket associated with a Chrome or Firefox profile opens the selected browser but does not reliably navigate to that URL, leaving terminal copy/paste as the only usable path.

## Root cause

1. `CodexOAuthProvider.displayAuthUrlAndOpenBrowser()` passes the generated `authUrl` unchanged to `openBrowserSecurely(authUrl, browserOpts)`. URL generation and provider-to-launcher forwarding are intact.
2. The failure occurs in the macOS specific-browser launch plans in `packages/core/src/utils/secure-browser-launcher-internal.ts`.
3. For Chrome with a profile, the launcher currently builds:

   ```text
   open -a "Google Chrome" --args --profile-directory=<profile> <oauth-url>
   ```

   Firefox profile launches have the same ordering defect.
4. macOS `open -h` defines `--args` as: “All remaining arguments are passed in argv to the application's main() function instead of opened.” Because the OAuth URL is appended after `--args`, Launch Services does not receive it as the URL/document to open. The application may activate or start while ignoring that trailing application argument, matching the reported symptom.
5. The browser-profile feature introduced this order in commit `0af53065f` on 2026-07-12 and it reached `main` through the 0.11.0 integration. The browser-launch test asserted only the malformed argv sequence rather than the behavioral contract that the URL must remain on the `open` side of the `--args` boundary.
6. Default-browser and Safari launches do not use `--args` and already place the URL correctly. Linux, BSD, and Windows invoke browser executables directly, where the URL is correctly an application argument. They must remain unchanged.

## Accepted behavior

### REQ-3247-1: macOS Chrome profile login opens the OAuth URL

**Full text:** A macOS specific-Chrome launch with a profile must give the URL to `open` before the `--args` delimiter and pass only Chrome-specific profile flags after the delimiter.

- GIVEN Codex OAuth has generated an HTTPS authorization URL
- AND the selected Codex bucket is associated with a Chrome profile
- WHEN the browser launcher executes on macOS
- THEN the launch is equivalent to `open -a "Google Chrome" <oauth-url> --args --profile-directory=<profile>`
- AND the exact URL remains a distinct argv value
- AND terminal display and clipboard fallback behavior remain unchanged

### REQ-3247-2: macOS Firefox profile login preserves the same URL boundary

**Full text:** A macOS specific-Firefox launch with a profile must give the URL to `open` before the `--args` delimiter and pass only Firefox profile flags after the delimiter.

- GIVEN a valid authorization URL and Firefox profile selection
- WHEN the browser launcher executes on macOS
- THEN the URL precedes `--args`
- AND `-P <name>` or `-profile <absolute-path>` follows `--args`
- AND existing new-instance behavior remains intact

### REQ-3247-3: unaffected launch paths remain stable

**Full text:** The fix must not alter default-browser, Safari, Linux/BSD, Windows, URL validation, profile validation, test-process browser guards, or provider fallback behavior.

## Test-first implementation sequence

### Phase 1: RED — encode the macOS `open` argument boundary

Modify the existing Bun behavioral tests in `packages/core/src/utils/secure-browser-launcher.test.ts` before changing production code.

1. Change the Chrome-with-profile expectation to require the exact sequence:
   `['-a', 'Google Chrome', url, '--args', '--profile-directory=Profile 1']`.
2. Change the Firefox named-profile expectation to require the exact sequence:
   `['-n', '-a', 'Firefox', url, '--args', '-P', 'myprofile']`.
3. Change the Firefox absolute-profile expectation similarly, with `-profile` and the absolute path after `--args`.
4. Run the focused test and retain the failing evidence. The current production code must fail because it places the URL after `--args`.

These tests exercise the real public browser-launch behavior with an injected process-execution boundary; they do not mock the launcher under test or launch a real user browser.

### Phase 2: GREEN — minimally reorder macOS launch arguments

Modify only the macOS branches of `buildChromeLaunchArgs()` and `buildFirefoxLaunchArgs()` in `packages/core/src/utils/secure-browser-launcher-internal.ts`.

1. Chrome with a profile: place `url` before `--args`; leave the profile flag after it.
2. Chrome without a profile: retain `open -a "Google Chrome" <url>`.
3. Firefox with a profile: place `url` before `--args`; retain `-n`, profile flag selection, and profile value.
4. Firefox without a profile: retain `open -a Firefox <url>`.
5. Do not add guards, fallbacks, new APIs, provider changes, or platform-wide refactors.

### Phase 3: verification and bounded review

1. Run the focused browser-launcher Bun test.
2. Run the complete verification cycle:

   ```bash
   npm run test
   npm run lint
   npm run typecheck
   npm run format
   npm run build
   bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
   git diff --check
   ```

3. Run a full DeepThinker compliance/intent review and Open Code Review.
4. Apply at most two combined remediation rounds for DeepThinker/OCR findings, rerunning the full verification cycle after each round. If accepted findings remain after the second remediation round, stop and report them rather than looping indefinitely.
5. Commit, push, create a detailed PR that fixes #3247, watch CI, and resolve actionable CodeRabbit threads subject to the same user-requested bounded remediation policy.

## Behavioral evidence required for completion

- The pre-fix focused test fails because the OAuth URL is after `--args`.
- The post-fix focused test proves the URL precedes `--args` for macOS Chrome, Firefox named profiles, and Firefox absolute profile paths.
- Existing tests prove default-browser, Safari, Linux/BSD, Windows, validation, and test guards remain unchanged.
- The complete local verification cycle and smoke test pass.
- CI passes and all review findings are either resolved within the two-round remediation cap or explicitly reported.

## Scope boundaries

- No Codex authorization URL generation changes.
- No `/auth` command parsing or OAuth callback changes.
- No browser-profile persistence/discovery changes.
- No real browser launch from automated tests.
- No changes to non-macOS browser command construction.
- No removal of the terminal URL or clipboard fallback.
- No unrelated browser launcher refactor.

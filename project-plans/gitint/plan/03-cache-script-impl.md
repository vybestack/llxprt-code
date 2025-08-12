# Phase 2a: Implementation for Cache Update Script

**Objective:** Create the standalone background script that fetches issues from GitHub and populates the local cache.

## Action

1.  **Create File:** Create a new executable Node.js script at `scripts/update-issue-cache.js`.
2.  **Implement Script Logic:**
    *   The script must be executable directly with `node`.
    *   Use `child_process.execSync` within a `try...catch` block to get the repository slug from `git config --get remote.origin.url`.
    *   Parse the URL to extract the `owner/repo` format. Handle non-GitHub URLs gracefully by logging an error to the console and exiting.
    *   Construct the full `gh` command: `gh issue list --state open --repo <slug> --limit <limit> --json number,title,author,state`. The limit should be read from an environment variable or a default (10000).
    *   Use `child_process.exec` to run the `gh` command.
    *   In the callback, check for errors. If an error occurs (e.g., `gh` not installed, not authenticated), log the error to `console.log` and exit.
    *   On success, use `fs.mkdirSync` with `{ recursive: true }` to create the `.llxprt/ghcache/` directory.
    *   Use `fs.writeFileSync` to write the JSON output from the `gh` command to `.llxprt/ghcache/issues.json`.

## Verification

*   This script's correctness is verified behaviorally by the tests in a later phase (`04-autocomplete-tdd.md`). No unit tests are required for this script itself.
*   Manual verification can be performed by running `node scripts/update-issue-cache.js` and inspecting the created `.llxprt/ghcache/issues.json` file.

# Issue #4024: Keep the footer status poll from locking the index

`git status --porcelain` may refresh the index stat cache. The footer runs it as a background poll and watches `.git/index`, so a status refresh can take `.git/index.lock`, rewrite the index, and trigger another poll.

Use `git --no-optional-locks status --porcelain` for the status query. This is visible at the call site and directly tells Git not to take optional locks or write the index. Keep the branch `git rev-parse` queries unchanged; no environment override is needed.

A Bun integration test will initialize and commit in a temporary real Git repository, make a tracked file's stat stale, and verify the production status path leaves the index content and mtime unchanged while reporting clean and untracked states correctly. First run the same preservation assertion against plain `git status --porcelain` to establish that the stale-stat setup detects the rewrite. Update the mocked hook tests to match the new command while preserving their existing behavior assertions.

`--no-optional-locks` and `GIT_OPTIONAL_LOCKS` were introduced in Git 2.15.0 (2017). Older Git versions reject the unknown global option, so the command errors. Under the existing error-to-clean policy, the star then shows clean while the branch name still displays. This is accepted on purpose. There is no fallback to plain `git status`, because that would bring back the lock and the index rewrite.

# Task Results Template

Copy this file for each task (`results/task-XX.md`) and fill in every section **before** running the quality gate script.

## Commits Picked / Ported
- Upstream hash, subject, local hash, and summary of adaptations for each commit.

## Original Diffs
- Fenced code blocks with `git show <upstream-hash>` output.

## Our Committed Diffs
- Fenced code blocks with `git show <local-hash>` output.

## Test Results
- Command: `npm run test`
- Summarize outcome; link to log under `.quality-logs/` if large.

## Lint Results
- Command: `npm run lint:ci`
- Confirm zero warnings/errors.

## Typecheck Results
- Command: `npm run typecheck`
- Confirm zero errors.

## Build Results
- Command: `npm run build`
- Confirm success; note any manual checks.

## Format Check
- Command: `npm run format:check`
- Confirm no changes required.

## Lines of Code Analysis
- Compare upstream vs local diff stats (±20% tolerance). Explain variances.

## Conflicts & Resolutions
- Detail every conflict encountered and how it was resolved.
- Include justification for any adaptations (branding, multi-provider changes, etc.).

## Manual Verification Notes
- Any targeted testing, screenshots, or manual steps taken.
- Record unresolved follow-ups or tech debt.

---

Store the completed file at `project-plans/20250916-cherries-v2/results/task-XX.md` and rerun the quality gate after updates.

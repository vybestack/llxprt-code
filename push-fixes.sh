#!/bin/bash
cd /Users/acoliver/projects/gemini-code/gemini-cli
git add .github/workflows/ci.yml .github/workflows/e2e.yml
git commit -m "Fix rollup platform dependency issue in CI

- Add explicit installation of @rollup/rollup-linux-x64-gnu
- Workaround for npm optional dependency bug
- Fixes test failures in Node.js 24.x
- Remove unnecessary debug steps from E2E workflow"
git push origin main
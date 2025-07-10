# Phase 1a – Verification of Remove Trademarks (trademarks)

## Verification Steps

1. Run `npm run preflight` and confirm it passes.
2. Grep recursively for `gemini` and `google`, e.g.:  
   `grep -i 'gemini\|google' . | less`
   - Manually inspect to ensure all matches are listed in `project-plans/trademarks/ALLOWED-FAIR-USE.txt` and are truly required for fair use (such as `GeminiProvider`).
   - There must be no branding, logo, or product name uses beyond fair use in code, CLI, docs, or assets.
3. Visually inspect README.md, UI screens, and images for accidental branding remains. Compare design with "LLxprt Code" branding requirements.
4. Check that `project-plans/trademarks/ALLOWED-FAIR-USE.txt` exists and explicitly lists all remaining trademarked identifiers/uses.
5. All checklist boxes in `01-remove-trademarks.md` must be ticked `[x]`.

## Outcome

If ALL steps are satisfied and no unauthorised branding remains, emit:

✅

If any item fails, emit a numbered list of ❌ with exact grep lines or issues to fix.

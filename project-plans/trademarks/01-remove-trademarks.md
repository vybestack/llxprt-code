# Phase 1 – Remove Trademarks (trademarks)

---

**Goal:**
Identify and remove all occurrences of Google- or Gemini-specific branding, including all forms of the word "Gemini" (e.g., Gemini CLI, gemini-cli, GeminiCLI, @google/gemini-cli, etc.) and "Google" (or "Google AI", "GoogleCloudPlatform", etc.), as well as related logos and images. Uses of "CLI" or "cli" alone are NOT affected and are considered generic/common property and must NOT be changed or removed.

Allowed exceptions for the word "Gemini" or "Google" are only where API-level compatibility or legal requirements dictate (such as GeminiProvider for compatibility, or copyright/license notices). All cases must be explicitly listed in ALLOWED-FAIR-USE.txt.

**Deliverables:**

- All files updated to remove or replace all instances of "Gemini", "Google", and all their variants/brandings from code, UI, tests, docs, and package metadata, except where fair use is documented.
- Replace all main branding/text references in CLI, docs, and UI from "Gemini" to "LLxprt Code" (but DO NOT remove or change generic use of "cli").
- Remove or substitute all Gemini/Google-branded images, logos, and screenshots with LLxprt equivalents.
- Update project identity in README.md, package.json, and all documentation from Gemini-centric text to "LLxprt Code" branding.
- Maintain a whitelist of allowed fair use cases for "Gemini"/"Google" in `project-plans/trademarks/ALLOWED-FAIR-USE.txt`.

**Checklist (implementer):**

- [ ] Searched and listed all direct trademark mentions ("Gemini", "Google", etc.)
- [ ] Removed/replaced unintended occurrences per guidelines
- [ ] Updated README, package.json, doc branding
- [ ] Updated/replaced all trademarked images/assets
- [ ] Assembled `ALLOWED-FAIR-USE.txt` with all permitted exceptions
- [ ] Full build, type-check, linter pass

**Self-verify:**

- `npm run preflight`
- `grep -i --color=always 'google\|gemini' . | less` (confirm only fair use, as documented in ALLOWED-FAIR-USE.txt)

_End note:_
STOP. Wait for Phase 1a verification.

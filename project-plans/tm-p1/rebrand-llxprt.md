# Phase 01 – Rebrand to LLxprt Code (tm-p1)

> **STOP.** Complete ONLY the tasks in _this_ file, tick every box in **Checklist (implementer)**, write the required progress report, then stop. Wait for Phase 01a verification before moving on.

## Goal

Rebrand the gemini-cli project to llxprt-code by changing the package name, ASCII art banner, and CLI prompt directive while maintaining the same visual style and functionality.

## Scope (self-contained)

1. **Update package name**  
   • Change `@google/gemini-cli` to `llxprt-code` in all package.json files  
   • Update package-lock.json to reflect new package name  
   • Verify internal dependencies reference the new package name

2. **Replace ASCII art banner**  
   • Locate the GEMINI ASCII art in the codebase (likely in a constants or UI file)  
   • Create new ASCII art spelling "LLXPRT" maintaining the same artistic style  
   • The new banner should have the same height and similar width characteristics

3. **Update CLI prompt directive**  
   • Find all instances of "you are gemini-cli" in the codebase  
   • Replace with "you are LLxprt Code" maintaining exact capitalization  
   • Ensure this change is made in all directive/prompt files

4. **NO functional changes** – This is purely a branding update. No logic, features, or behavior should change.

5. **Reporting** – Write progress log to **reports/tm-p1/phase01-worker.md**, append for every action/finding, and finish with `### DONE`.

## ASCII Art Design

Current GEMINI art:
```
 ███            █████████  ██████████ ██████   ██████ █████ ██████   █████ █████
░░░███         ███░░░░░███░░███░░░░░█░░██████ ██████ ░░███ ░░██████ ░░███ ░░███
  ░░░███      ███     ░░░  ░███  █ ░  ░███░█████░███  ░███  ░███░███ ░███  ░███
    ░░░███   ░███          ░██████    ░███░░███ ░███  ░███  ░███░░███░███  ░███
     ███░    ░███    █████ ░███░░█    ░███ ░░░  ░███  ░███  ░███ ░░██████  ░███
   ███░      ░░███  ░░███  ░███ ░   █ ░███      ░███  ░███  ░███  ░░█████  ░███
 ███░         ░░█████████  ██████████ █████     █████ █████ █████  ░░█████ █████
░░░            ░░░░░░░░░  ░░░░░░░░░░ ░░░░░     ░░░░░ ░░░░░ ░░░░░    ░░░░░ ░░░░░
```

New LLXPRT art (to be implemented):
```
     ░██        ░██        ░██    ░██░█████████ ░█████████░██████████
░██  ░██        ░██         ░██  ░██ ░██     ░██░██     ░██   ░██    
 ░██ ░██        ░██          ░██░██  ░██     ░██░██     ░██   ░██    
  ░██░██        ░██           ░███   ░█████████ ░█████████    ░██    
 ░██ ░██        ░██          ░██░██  ░██        ░██   ░██     ░██    
░██  ░██        ░██         ░██  ░██ ░██        ░██    ░██    ░██    
     ░██████████░██████████░██    ░██░██        ░██     ░██   ░██    
```

## Deliverables

- Updated package.json files with new package name `llxprt-code`
- Updated package-lock.json reflecting the rebrand
- Replaced ASCII art banner from GEMINI to LLXPRT
- Updated CLI directive from "you are gemini-cli" to "you are LLxprt Code"
- Progress report `reports/tm-p1/phase01-worker.md` ending with `### DONE`

## Checklist (implementer)

- [ ] Found and updated all package.json files with new package name
- [ ] Regenerated package-lock.json with new package references
- [ ] Located ASCII art file(s) and replaced GEMINI with LLXPRT art
- [ ] Found and replaced all "you are gemini-cli" directives with "you are LLxprt Code"
- [ ] Code builds: `npm run build` ↦ exit 0
- [ ] Progress report exists and ends with `### DONE`

## Self-verify (run locally)

```bash
npm ci
npm run build
grep -r "@google/gemini-cli" . --exclude-dir=node_modules || echo "Old package name removed"
grep -r "you are gemini-cli" . --exclude-dir=node_modules || echo "Old directive removed"
```

All build commands must exit with status 0, and grep commands should find no matches.

---

**STOP. Wait for Phase 01a verification.**
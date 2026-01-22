# Execution Plan: v0.12.0 → v0.13.0

## Non-Negotiables

See `dev-docs/cherrypicking.md` for full criteria. Key points:
- **Privacy**: No ClearcutLogger/Google telemetry
- **Multi-provider**: Preserve LLxprt's multi-provider architecture
- **Tool batching**: Keep LLxprt's superior parallel batching
- **Branding**: Use `@vybestack/llxprt-code-core` not `@google/gemini-cli-core`
- **Smart Edit removed**: Skip all smart-edit related commits
- **NextSpeakerChecker removed**: Skip any next-speaker functionality
- **Model Routing**: LLxprt does NOT support Google's model routing
- **Todo System**: LLxprt has completely different todo implementation

## File Existence Pre-Check

Before starting, verify these files exist in LLxprt (used by REIMPLEMENT plans):

```bash
# Policy Engine
ls packages/core/src/policy/
ls packages/cli/src/config/policy.ts

# Hooks (new system - may not exist)
ls packages/core/src/hooks/ 2>/dev/null || echo "Hooks dir not present - expected"

# Extension Manager
ls packages/cli/src/config/extension-manager.ts

# Settings Schema
ls packages/cli/src/config/settingsSchema.ts
ls schemas/settings.schema.json
```

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `gemini-cli` | `llxprt-code` |
| `.geminiignore` | `.llxprtignore` (also accept `.geminiignore`) |
| `GEMINI_` env vars | Preserve both `GEMINI_` and provider-specific |

## Related Issues

- **Subagent Recovery Turn**: https://github.com/vybestack/llxprt-code/issues/1133

---

## Batch Schedule

Total: 63 PICK commits → 13 batches of 5 (last batch has 3)
Plus 8 REIMPLEMENT commits → 8 solo batches

### Batch 1 (PICK #1-5)
**Type:** PICK  
**Upstream SHAs:**
```
706834ecd3c6449266de412539294f16c68473ce - @command path handling
6e026bd9500d0ce5045b2e952daedf8c4af60324 - security emitFeedback
c60d8ef5a861685f6f20a4e776aaaefdc1879b63 - unskip read_many_files
3e9701861e9dc10fc6a28470069a63ebf6823c39 - getPackageJson to core
42a265d2900a250bf75535bdcaba2a35c3eb609b - atprocessor test Windows
```

**Command:**
```bash
git cherry-pick 706834ecd3c6449266de412539294f16c68473ce 6e026bd9500d0ce5045b2e952daedf8c4af60324 c60d8ef5a861685f6f20a4e776aaaefdc1879b63 3e9701861e9dc10fc6a28470069a63ebf6823c39 42a265d2900a250bf75535bdcaba2a35c3eb609b
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 2 (PICK #6-10)
**Type:** PICK  
**Upstream SHAs:**
```
82c10421a06f0e4934f44ce44e37f0a95e693b02 - alt key mappings Mac
99f75f32184ecfc85bdef65f9ecb8d423479801f - deprecated flag message
523274dbf34c6ea31c1060eae759aa06673b2f07 - standardize error logging
77df6d48e23812e35272c4a21d89077a8cfcd049 - keyboard shortcuts docs
1d9e6870befa21b9d4ca6c7d884c0a21a8549c7a - granular memory loaders
```

**Command:**
```bash
git cherry-pick 82c10421a06f0e4934f44ce44e37f0a95e693b02 99f75f32184ecfc85bdef65f9ecb8d423479801f 523274dbf34c6ea31c1060eae759aa06673b2f07 77df6d48e23812e35272c4a21d89077a8cfcd049 1d9e6870befa21b9d4ca6c7d884c0a21a8549c7a
```

**Full Verify (Batch 2):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 3 (PICK #11-15)
**Type:** PICK  
**Upstream SHAs:**
```
c583b510e09ddf9d58cca5b6132bf19a8f5a8091 - refactor ui tests
b8330b626ef9a134bee5089669751289a3c025c4 - fix misreported lines
7d03151cd5b6a8ac208f0b22ad6e1f5fa3471390 - install/link messages
a3370ac86bce6df706d9c57db15533db657ae823 - validate command
b8969cceffbbba58b228d9c9bf12bfdd236efb0b - fix docs extension install
```

**Command:**
```bash
git cherry-pick c583b510e09ddf9d58cca5b6132bf19a8f5a8091 b8330b626ef9a134bee5089669751289a3c025c4 7d03151cd5b6a8ac208f0b22ad6e1f5fa3471390 a3370ac86bce6df706d9c57db15533db657ae823 b8969cceffbbba58b228d9c9bf12bfdd236efb0b
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 4 (PICK #16-20)
**Type:** PICK  
**Upstream SHAs:**
```
d4cad0cdcc9a777e729e97d80a6f129dc267ba60 - canned response JSON test
cc081337b7207df6640318931301101a846539b6 - reload extensions MCP
54fa26ef0e2d77a0fbc2c4d3d110243d886d9b28 - tests use act
b382ae6803ce21ead2a91682fc58126f3786f15b - prevent self-imports
68afb7200e06507056b3321f9f1d9056ba95da45 - compression threshold default
```

**Command:**
```bash
git cherry-pick d4cad0cdcc9a777e729e97d80a6f129dc267ba60 cc081337b7207df6640318931301101a846539b6 54fa26ef0e2d77a0fbc2c4d3d110243d886d9b28 b382ae6803ce21ead2a91682fc58126f3786f15b 68afb7200e06507056b3321f9f1d9056ba95da45
```

**Full Verify (Batch 4):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 5 (PICK #21-25)
**Type:** PICK  
**Upstream SHAs:**
```
322feaafa62a1630ae1750d32efbb24ea9194463 - decouple GeminiChat telemetry
ab8c24f5eab534697f26cf7da7a4f182c7665f3e - Ink 6.4.0 fixes
f8ff921c426712232864ecd3fa2675c2c68a4580 - update mcp-server.md
f875911af7d49055d583d86239e6fa2a01bdc471 - remove testing-library/react
01ad74a8700d50356dff60719d761d5550f643dd - user.email Google auth
```

**Command:**
```bash
git cherry-pick 322feaafa62a1630ae1750d32efbb24ea9194463 ab8c24f5eab534697f26cf7da7a4f182c7665f3e f8ff921c426712232864ecd3fa2675c2c68a4580 f875911af7d49055d583d86239e6fa2a01bdc471 01ad74a8700d50356dff60719d761d5550f643dd
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 6 (PICK #26-30)
**Type:** PICK  
**Upstream SHAs:**
```
f4ee245bf9c2383add94a76a12fbae9fb9225e5d - ink@ 6.4.0
c158923b278685d99d340623dc2412b492721e58 - policy engine docs
adddafe6d07eea74561bd71e88aef0ce2a546b4a - untrusted folders
6ee7165e39bd4ee2ce68781c5a735a262cd160a1 - slow rendering logging
d72f8453cbe4ebd2b0facc5dca9d87894ac214f4 - remove jsdom dep
```

**Command:**
```bash
git cherry-pick f4ee245bf9c2383add94a76a12fbae9fb9225e5d c158923b278685d99d340623dc2412b492721e58 adddafe6d07eea74561bd71e88aef0ce2a546b4a 6ee7165e39bd4ee2ce68781c5a735a262cd160a1 d72f8453cbe4ebd2b0facc5dca9d87894ac214f4
```

**Full Verify (Batch 6):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 7 (PICK #31-35)
**Type:** PICK  
**Upstream SHAs:**
```
4b53b3a6e6e4e994195d569dc5a342f808382de5 - telemetry.md flags
9478bca67db3e7966d6ab21f8ad1694695f20037 - policy docs indexes
8b93a5f27d7c703f420001988f4cbd9beba7508b - package-lock gitignore
f9df4153921034f276d3059f08af9849b3918798 - release channel detection
61207fc2cbaa9a2e13845272f7edf0f15970d5fb - string width Ink
```

**Command:**
```bash
git cherry-pick 4b53b3a6e6e4e994195d569dc5a342f808382de5 9478bca67db3e7966d6ab21f8ad1694695f20037 8b93a5f27d7c703f420001988f4cbd9beba7508b f9df4153921034f276d3059f08af9849b3918798 61207fc2cbaa9a2e13845272f7edf0f15970d5fb
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 8 (PICK #36-40)
**Type:** PICK  
**Upstream SHAs:**
```
f8ce3585eb60be197874f7d0641ee80f1e900b24 - Ink updates
caf2ca1438c1a413ee978c97a41ce4e9f818fa9f - kitty function keys
e3262f8766d73a281fbc913c7a7f6d876c7cb136 - gitignore/geminiignore
d7243fb81f749ff32b9d37bfe2eb61068b0b2af3 - DarkGray ColorTheme
02518d2927d16513dfa05257e1a2025d9123f3d1 - command-line flag docs
```

**Command:**
```bash
git cherry-pick f8ce3585eb60be197874f7d0641ee80f1e900b24 caf2ca1438c1a413ee978c97a41ce4e9f818fa9f e3262f8766d73a281fbc913c7a7f6d876c7cb136 d7243fb81f749ff32b9d37bfe2eb61068b0b2af3 02518d2927d16513dfa05257e1a2025d9123f3d1
```

**Full Verify (Batch 8):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 9 (PICK #41-45)
**Type:** PICK  
**Upstream SHAs:**
```
9187f6f6d1b96c36d4d2321af46f1deedab60aa3 - OAuth issuer URLs
462c7d350257d45981e69c39a38a087c812fa019 - response semantic color
1ef34261e09a6b28177c2a46384b19cfa0b5bea0 - bump tar 7.5.2
93f14ce626f68a7bf962e7ac8423bfb70a62c6f2 - split system prompt
19ea68b838e10fe16950ac0193f3de49f067e669 - refactor ui tests
```

**Command:**
```bash
git cherry-pick 9187f6f6d1b96c36d4d2321af46f1deedab60aa3 462c7d350257d45981e69c39a38a087c812fa019 1ef34261e09a6b28177c2a46384b19cfa0b5bea0 93f14ce626f68a7bf962e7ac8423bfb70a62c6f2 19ea68b838e10fe16950ac0193f3de49f067e669
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 10 (PICK #46-50)
**Type:** PICK  
**Upstream SHAs:**
```
9d642f3bb1dcf8380822b025adabb06262364ef2 - setGlobalProxy error
c4377c1b1af84086f888915a93b56b5910396049 - persist settings ESC
1c044ba8afa9e51ba5485394541c8739ba6be110 - ctrl+c NonInteractive
2144d25885b408bb88531fbc2ad44a98aeb1481d - empty map token file
ad33c22374fd88656f0785d1f9ad728bdac9075d - nav shortcuts no scroll
```

**Command:**
```bash
git cherry-pick 9d642f3bb1dcf8380822b025adabb06262364ef2 c4377c1b1af84086f888915a93b56b5910396049 1c044ba8afa9e51ba5485394541c8739ba6be110 2144d25885b408bb88531fbc2ad44a98aeb1481d ad33c22374fd88656f0785d1f9ad728bdac9075d
```

**Full Verify (Batch 10):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 11 (PICK #51-55)
**Type:** PICK  
**Upstream SHAs:**
```
bd06e5b161f72add52958f5cdc336c78ba401134 - bump vite 7.1.12
fc42c4613f05d9ffc17fa403d0b8e87737f2269d - screen reader once
f0c3c81e94f04720daf0661b28369e8699a1266a - loop detection patterns
b5315bfc208c754eea1204260bdbe0d10c14819b - alt+left ghostty
ab73051298b53d7748e93b88d439e775b08a7bac - dynamic MCP OAuth port
```

**Command:**
```bash
git cherry-pick bd06e5b161f72add52958f5cdc336c78ba401134 fc42c4613f05d9ffc17fa403d0b8e87737f2269d f0c3c81e94f04720daf0661b28369e8699a1266a b5315bfc208c754eea1204260bdbe0d10c14819b ab73051298b53d7748e93b88d439e775b08a7bac
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 12 (PICK #56-60)
**Type:** PICK  
**Upstream SHAs:**
```
6ab1b239ca8d89d689e2b863181a9d041159728c - refactor telemetry tests
96d7eb296601e3da583f8c2da6bcac3745fbef68 - canned flicker test
b8b6620365ba494780c4172fcd21782e25796d77 - bash shell options
460c3debf5ec73f0652a496254ad9b5b3622caf7 - screen reader flicker
f79665012231a7979c3c6c5b652614d0f928ab33 - shift+tab non-kitty
```

**Command:**
```bash
git cherry-pick 6ab1b239ca8d89d689e2b863181a9d041159728c 96d7eb296601e3da583f8c2da6bcac3745fbef68 b8b6620365ba494780c4172fcd21782e25796d77 460c3debf5ec73f0652a496254ad9b5b3622caf7 f79665012231a7979c3c6c5b652614d0f928ab33
```

**Full Verify (Batch 12):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 13 (PICK #61-63)
**Type:** PICK  
**Upstream SHAs:**
```
75c2769b322dfd2834a4b0379ae0c6002eebbc33 - extension install tests
fd885a3e50e3c88bba6b5b2ee03a76b7c514ff29 - googleQuotaErrors fix
ece06155cc49776839a137bef87f05c3909312be - shell execution fixes
```

**Command:**
```bash
git cherry-pick 75c2769b322dfd2834a4b0379ae0c6002eebbc33 fd885a3e50e3c88bba6b5b2ee03a76b7c514ff29 ece06155cc49776839a137bef87f05c3909312be
```

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 14 (REIMPLEMENT - Hook Config)
**Type:** REIMPLEMENT  
**Upstream SHA:** `c0495ce2f93a48dff801acdd58743f138e5b419c`  
**Subject:** feat(hooks): Hook Configuration Schema and Types (#9074)

**Plan:** See `project-plans/20260114gmerge/c0495ce2-plan.md`

**Full Verify (Batch 14):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 15 (REIMPLEMENT - Settings Autogen)
**Type:** REIMPLEMENT  
**Upstream SHA:** `5062fadf8767de5531a0a1577946d0e8227117a6`  
**Subject:** chore: autogenerate settings documentation (#12451)

**Plan:** See `project-plans/20260114gmerge/5062fadf-plan.md`

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 16 (REIMPLEMENT - Hook Translator)
**Type:** REIMPLEMENT  
**Upstream SHA:** `80673a0c0c11a69d3b3b60a5e8d8050459f0574d`  
**Subject:** feat(hooks): Hook Type Decoupling and Translation (#9078)

**Plan:** See `project-plans/20260114gmerge/80673a0c-plan.md`

**Full Verify (Batch 16):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 17 (REIMPLEMENT - Alternate Buffer)
**Type:** REIMPLEMENT  
**Upstream SHA:** `4fc9b1cde298f7681beb93485c1c9993482ed717`  
**Subject:** alternate buffer support (#12471)

**Plan:** See `project-plans/20260114gmerge/4fc9b1cd-plan.md`

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 18 (REIMPLEMENT - Hook I/O)
**Type:** REIMPLEMENT  
**Upstream SHA:** `b25915340325fbb72366fce3e9db82580136c3a4`  
**Subject:** feat(hooks): Hook Input/Output Contracts (#9080)

**Plan:** See `project-plans/20260114gmerge/b2591534-plan.md`

**Full Verify (Batch 18):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 19 (REIMPLEMENT - Hook Planner)
**Type:** REIMPLEMENT  
**Upstream SHA:** `cb2880cb93e9797f3b97319323ce437a7fee9671`  
**Subject:** feat(hooks): Hook Execution Planning and Matching (#9090)

**Plan:** See `project-plans/20260114gmerge/cb2880cb-plan.md`

**Quick Verify:**
```bash
npm run lint && npm run typecheck
```

---

### Batch 20 (REIMPLEMENT - Extensions MCP)
**Type:** REIMPLEMENT  
**Upstream SHA:** `da4fa5ad75ccea4d8e320b1c0d552614e654f806`  
**Subject:** Extensions MCP refactor (#12413)

**Plan:** See `project-plans/20260114gmerge/da4fa5ad-plan.md`

**Full Verify (Batch 20):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

### Batch 21 (REIMPLEMENT - PolicyEngine to Core) - FINAL
**Type:** REIMPLEMENT  
**Upstream SHA:** `ffc5e4d048ffa5e93af56848aa315fd4338094bb`  
**Subject:** Refactor PolicyEngine to Core Package (#12325)

**Plan:** See `project-plans/20260114gmerge/ffc5e4d0-plan.md`

**Full Verify (Batch 21 - FINAL):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

## Failure Recovery

### Cherry-pick conflict
```bash
# Abort and restart
git cherry-pick --abort

# Or resolve conflicts manually
# After resolving:
git add -A
git cherry-pick --continue
```

### Test/lint failures after batch
1. Fix the issue
2. Create a follow-up fix commit:
```bash
git add -A
git commit -m "fix: post-batch N verification"
```
3. Proceed to next batch

### REIMPLEMENT failures
1. Abort current attempt
2. Review the upstream commit diff
3. Manually adapt changes to LLxprt architecture
4. Commit with reference to upstream SHA

---

## Note-Taking Requirement

After each batch:
1. Update `PROGRESS.md` with batch status and LLxprt commit hash
2. Append to `NOTES.md` any conflicts, deviations, or follow-ups
3. Update `AUDIT.md` with final reconciliation entry

---

## Commit Message Templates

### PICK batch
```
cherry-pick: upstream v0.12.0..v0.13.0 batch N

Upstream commits:
- <sha1> <subject>
- <sha2> <subject>
...
```

### REIMPLEMENT
```
reimplement: <upstream subject> (upstream <sha>)

Adapted for LLxprt's:
- <specific adaptation 1>
- <specific adaptation 2>
```

### Follow-up fix
```
fix: post-batch N verification

- <specific fix>
```

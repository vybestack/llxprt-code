# REIMPLEMENT Playbook: a81500a — Add security consent prompts for skill installation

## Upstream Change Summary

This commit adds security consent prompts when installing skills. The changes:

1. Adds `--consent` flag to the skill install command to skip the confirmation prompt
2. Adds `requestConsent` callback parameter to `installSkill()` function
3. Creates `skillsConsentString()` function to generate consent prompt text
4. Shows consent prompt before installing skills with security warnings
5. Aborts installation if consent is denied
6. Updates consent text formatting for skills in extension consent prompts
7. Adds tests for consent flow

**Files changed upstream:**
- `packages/cli/src/commands/skills/install.test.ts`
- `packages/cli/src/commands/skills/install.ts`
- `packages/cli/src/config/extension.test.ts`
- `packages/cli/src/config/extensions/consent.test.ts`
- `packages/cli/src/config/extensions/consent.ts`
- `packages/cli/src/utils/skillUtils.test.ts`
- `packages/cli/src/utils/skillUtils.ts`

## LLxprt Current State

LLxprt has all the required files:
- `packages/cli/src/commands/skills/install.ts` — CLI install command with `handleInstall()`
- `packages/cli/src/utils/skillUtils.ts` — `installSkill()` function (no consent param yet)
- `packages/cli/src/config/extensions/consent.ts` — consent utilities including
  `requestConsentNonInteractive()`, `SKILLS_WARNING_MESSAGE`, and `maybeRequestConsentOrFail()`

The `install.ts` CLI already uses `debugLogger` from `@vybestack/llxprt-code-core`.
The `consent.ts` already imports `SkillDefinition` from `@vybestack/llxprt-code-core` and has
`SKILLS_WARNING_MESSAGE` defined.

**Note**: `consent.ts` does NOT yet have a standalone `skillsConsentString()` function —
the skill rendering is currently embedded inline in `extensionConsentString()`. This must be
extracted.

## Adaptation Plan

### Step 1: Add `consent?: boolean` to `InstallArgs` in `packages/cli/src/commands/skills/install.ts`

```typescript
interface InstallArgs {
  source: string;
  scope?: 'user' | 'workspace';
  path?: string;
  consent?: boolean;  // ADD
}
```

### Step 2: Add `--consent` boolean yargs option to the command builder in `install.ts`

```typescript
.option('consent', {
  describe:
    'Acknowledge the security risks of installing a skill and skip the confirmation prompt.',
  type: 'boolean',
  default: false,
})
```

Also pass it through in the `handler`:
```typescript
handler: async (argv) => {
  await handleInstall({
    source: argv['source'] as string,
    scope: argv['scope'] as 'user' | 'workspace',
    path: argv['path'] as string | undefined,
    consent: argv['consent'] as boolean | undefined,  // ADD
  });
  await exitCli();
},
```

### Step 3: Add `requestConsent` callback in `handleInstall()` in `install.ts`

Import `skillsConsentString` and `requestConsentNonInteractive` from consent module:
```typescript
import {
  skillsConsentString,
  requestConsentNonInteractive,
} from '../config/extensions/consent.js';
import type { SkillDefinition } from '@vybestack/llxprt-code-core';
```

Create the callback inside `handleInstall()`:
```typescript
const { source, consent } = args;
const scope = args.scope ?? 'user';
const subpath = args.path;

const requestConsentCallback = async (
  skills: SkillDefinition[],
  targetDir: string,
): Promise<boolean> => {
  const consentText = await skillsConsentString(skills, source, targetDir);
  if (consent) {
    debugLogger.log('You have consented to the following:');
    debugLogger.log(consentText);
    return true;
  }
  return requestConsentNonInteractive(consentText);
};
```

### Step 4: Pass the callback into `installSkill()` in `install.ts`

```typescript
const installedSkills = await installSkill(
  source,
  scope,
  subpath,
  (msg) => { debugLogger.log(msg); },
  requestConsentCallback,  // ADD
);
```

### Step 5: Add `requestConsent` parameter to `installSkill()` in `packages/cli/src/utils/skillUtils.ts`

Update the function signature (add optional parameter with a permissive default so existing
callers are unaffected):
```typescript
export async function installSkill(
  source: string,
  scope: 'user' | 'workspace',
  subpath: string | undefined,
  onLog: (msg: string) => void,
  requestConsent: (
    skills: SkillDefinition[],
    targetDir: string,
  ) => Promise<boolean> = () => Promise.resolve(true),
): Promise<Array<{ name: string; location: string }>>
```

Add the import at the top of `skillUtils.ts`:
```typescript
import type { SkillDefinition } from '@vybestack/llxprt-code-core';
```
(Check if already imported via `loadSkillsFromDir` — if so, add `SkillDefinition` to the
existing import.)

### Step 6: Invoke consent gate before filesystem copy in `installSkill()`

Insert the consent check **after** skills are loaded and `targetDir` is resolved, but **before**
`fs.mkdir` and the copy loop:

```typescript
// After: const targetDir = ...

if (!(await requestConsent(skills, targetDir))) {
  if (tempDirToClean) {
    await fs.rm(tempDirToClean, { recursive: true, force: true });
  }
  throw new Error('Skill installation cancelled by user.');
}

await fs.mkdir(targetDir, { recursive: true });
// ... copy loop unchanged
```

### Step 7: Add `skillsConsentString()` to `packages/cli/src/config/extensions/consent.ts`

Extract the skill rendering logic from `extensionConsentString()` into a reusable helper, and
add a standalone `skillsConsentString()` export:

```typescript
/**
 * Renders a list of skills for a consent prompt.
 */
async function renderSkillsList(skills: SkillDefinition[]): Promise<string[]> {
  const output: string[] = [];
  for (const skill of skills) {
    output.push(`  * ${chalk.bold(skill.name)}: ${skill.description}`);
    const skillDir = path.dirname(skill.location);
    let fileCountStr = '';
    try {
      const skillDirItems = await fs.readdir(skillDir);
      fileCountStr = ` (${skillDirItems.length} items in directory)`;
    } catch {
      fileCountStr = ` ${chalk.red('(Could not count items in directory)')}`;
    }
    output.push(`    (Location: ${skill.location})${fileCountStr}`);
    output.push('');
  }
  return output;
}

/**
 * Builds a consent string for installing standalone skills (not via extension).
 */
export async function skillsConsentString(
  skills: SkillDefinition[],
  source: string,
  targetDir?: string,
): Promise<string> {
  const output: string[] = [];
  output.push(`Installing agent skill(s) from "${source}".`);
  output.push('\nThe following agent skill(s) will be installed:\n');
  output.push(...(await renderSkillsList(skills)));
  if (targetDir) {
    output.push(`Install Destination: ${targetDir}`);
  }
  output.push('\n' + SKILLS_WARNING_MESSAGE);
  return output.join('\n');
}
```

Update `extensionConsentString()` to delegate to `renderSkillsList()` instead of duplicating
the skill rendering inline.

## Files to Read

1. `packages/cli/src/commands/skills/install.ts`
2. `packages/cli/src/utils/skillUtils.ts`
3. `packages/cli/src/config/extensions/consent.ts`
4. `packages/cli/src/commands/skills/install.test.ts` (if it exists)

## Files to Modify

1. `packages/cli/src/commands/skills/install.ts` — add `consent` arg, yargs option, callback
2. `packages/cli/src/utils/skillUtils.ts` — add `requestConsent` parameter, invoke gate
3. `packages/cli/src/config/extensions/consent.ts` — add `skillsConsentString()` export,
   extract `renderSkillsList()` helper

## Step 8: Update Tests

Test boundaries to target:

**`packages/cli/src/commands/skills/install.test.ts`** (create if it doesn't exist):
- `--consent` flag set → `requestConsentCallback` returns `true` without prompting
- `--consent` flag not set → `requestConsentNonInteractive` is called with consent text
- `requestConsentNonInteractive` returns `false` → `installSkill` receives a callback that
  rejects, and `handleInstall` surfaces the cancellation error

**`packages/cli/src/utils/skillUtils.test.ts`** (add to existing tests):
- When `requestConsent` callback returns `false`, `installSkill` throws
  `'Skill installation cancelled by user.'` before any `fs.mkdir` or `fs.cp` call
- When `requestConsent` callback returns `true`, installation proceeds normally
- Default behavior (no `requestConsent` argument) still works — existing tests must not break

**`packages/cli/src/config/extensions/consent.test.ts`** (or existing consent test file):
- `skillsConsentString()` output includes source, skill names, target dir, and
  `SKILLS_WARNING_MESSAGE`
- After refactor, `extensionConsentString()` with skills still produces equivalent output

## Specific Verification

Run the full verification suite:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Additional checks:
- Without `--consent`: Prompt is shown, asks for confirmation
- With `--consent`: Skips prompt, logs consent message
- Consent denied: Installation is aborted cleanly

## Notes

This adds important security UX by ensuring users acknowledge the security implications of
installing skills (which inject instructions into the agent's system prompt).

The consent gate in `installSkill()` must be placed after `targetDir` is computed but before
any filesystem write operations (`fs.mkdir`, `fs.cp`). This ensures temp directories are
cleaned up properly on cancellation.

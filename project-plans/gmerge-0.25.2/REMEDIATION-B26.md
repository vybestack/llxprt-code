# Remediation Plan: B26 - Agent Skills Branding (FINAL)

## Comprehensive Search Scope

### Phase 1: Discovery Commands
```bash
# All TypeScript/JavaScript files
echo "=== All Source Files ==="
rg -n "Agent [Ss]kills?|agent [Ss]kills?" packages/ --type ts --type js

# Documentation (all formats)
echo "=== Documentation ==="
rg -n "Agent [Ss]kills?|agent [Ss]kills?" docs/

# Tests (all variants)
echo "=== Tests ==="
rg -n "Agent [Ss]kills?|agent [Ss]kills?" packages/ --type ts -g "*.test.ts"

# Snapshots
echo "=== Snapshots ==="
rg -n "Agent [Ss]kills?|agent [Ss]kills?" packages/ -g "*.snap"

# Help text and constants
echo "=== Help/Constants ==="
rg -n "Agent [Ss]kills?|agent [Ss]kills?" packages/cli/src/constants/ packages/cli/src/help/
```

## Classification Rules (Strict)

| Location Type | Action | Examples |
|--------------|--------|----------|
| CLI user output (stdout, stderr) | CHANGE | `console.log()`, `logger.info()` |
| Error messages | CHANGE | `throw new Error()` with user text |
| Command descriptions | CHANGE | `yargs.describe()`, `describe:` |
| Help text | CHANGE | Help files, `--help` output |
| Documentation | CHANGE | docs/ files |
| Test assertions on user output | CHANGE | `expect(output).toContain()` |
| Snapshots of user output | CHANGE | `.snap` files with user text |
| Type definitions | KEEP | `interface AgentSkill`, `type AgentSkillConfig` |
| Internal variable names | KEEP | `const agentSkills`, `agentSkillMap` |
| Comments about implementation | KEEP | `// AgentSkill processing` |
| Comments about user-facing behavior | CHANGE | `// Shows "Agent Skills" to user` |

## Case Guidelines (Clarified)

| Context | Example |
|---------|---------|
| Sentence start, normal text | "Skills are disabled..." |
| In sentence | "discovered skills" |
| Activity/status message | "Reloading skills..." (lowercase in flowing text) |
| UI label/heading | "Skills" (title case) |
| Command name | `/skills` (lowercase) |

## Files to Check and Update

### Primary Targets
1. `packages/cli/src/commands/skills/list.ts` - description, output
2. `packages/cli/src/ui/commands/skillsCommand.ts` - all messages
3. `packages/cli/src/commands/skills/enable.ts` - descriptions
4. `packages/cli/src/commands/skills/disable.ts` - descriptions
5. `packages/cli/src/commands/skills/install.ts` - descriptions
6. `packages/cli/src/commands/skills/uninstall.ts` - descriptions

### Secondary Targets (search results)
- Any help text files
- Error message definitions
- Test assertions
- Snapshot files

## Test Updates Required

### Find Tests to Update
```bash
rg -n "Agent [Ss]kills" packages/cli/src/**/*.test.ts
```

### Update Pattern
```typescript
// BEFORE
expect(consoleOutput).toContain('Agent Skills');

// AFTER
expect(consoleOutput).toContain('Skills');
```

### Snapshot Updates
```bash
# Update snapshots after string changes
npm test -- --update-snapshots packages/cli/src/commands/skills/
```

## Verification

```bash
# Should return zero matches in user-facing locations
echo "Checking user-facing strings..."
rg -n "Agent [Ss]kills" packages/cli/src/commands/skills/ packages/cli/src/ui/commands/skillsCommand.ts | grep -v "AgentSkill" | grep -v "// "

# Verify docs
echo "Checking docs..."
rg -n "Agent [Ss]kills" docs/

# Verify tests updated
echo "Checking test assertions..."
rg -n "toContain.*Agent [Ss]kills" packages/cli/src/
```

## Final Check
- [ ] All CLI user output uses "skills" not "Agent Skills"
- [ ] All docs updated
- [ ] All tests pass
- [ ] Snapshots updated
- [ ] No internal code broken (types still work)

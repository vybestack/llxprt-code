# Remediation Plan: B39 - Built-in Skills Loader (FINAL)

## Recursive Discovery Implementation

The built-in skills use nested directory structure. Must be truly recursive.

```typescript
/**
 * Recursively discover built-in skills from nested directories
 */
async discoverBuiltinSkills(): Promise<Skill[]> {
  const builtinDir = this.resolveBuiltinSkillsDir();
  
  if (!await fs.pathExists(builtinDir)) {
    return [];
  }
  
  const skills: Skill[] = [];
  await this.discoverSkillsRecursive(builtinDir, skills);
  
  return skills;
}

/**
 * Recursively walk skill directories
 */
private async discoverSkillsRecursive(dir: string, skills: Skill[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Check for config.json in this directory
      const configPath = path.join(fullPath, 'config.json');
      
      if (await fs.pathExists(configPath)) {
        // This is a skill directory
        try {
          const skill = await this.loadSkillFromConfig(configPath, fullPath, entry.name);
          if (skill) {
            skills.push(skill);
          }
        } catch (error) {
          console.warn(`Failed to load builtin skill ${entry.name}:`, error);
          // Continue with other skills
        }
      } else {
        // Recurse into subdirectories
        await this.discoverSkillsRecursive(fullPath, skills);
      }
    }
  }
}

/**
 * Load a skill from its config file
 */
private async loadSkillFromConfig(
  configPath: string, 
  skillPath: string, 
  name: string
): Promise<Skill | null> {
  const config = await fs.readJson(configPath);
  
  // Validate required fields
  if (!config || typeof config !== 'object') {
    console.warn(`Invalid config for skill ${name}: not an object`);
    return null;
  }
  
  // Construct skill with validation
  const skill: Skill = {
    name,
    description: config.description || '',
    version: config.version || '1.0.0',
    source: 'builtin',
    path: skillPath,
    // Copy other validated fields
    ...this.pickValidFields(config, ['author', 'license', 'keywords']),
  };
  
  return skill;
}

/**
 * Pick only valid/allowed fields from config
 */
private pickValidFields(config: any, allowed: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of allowed) {
    if (config[key] !== undefined) {
      result[key] = config[key];
    }
  }
  return result;
}
```

## Directory Resolution (Multiple Strategies)

```typescript
private resolveBuiltinSkillsDir(): string {
  // Strategy 1: CLI root from environment (production)
  if (process.env.LLXPRT_CLI_ROOT) {
    const envPath = path.join(process.env.LLXPRT_CLI_ROOT, 'skills', 'builtin');
    if (fs.existsSync(envPath)) return envPath;
  }
  
  // Strategy 2: Relative to this file (development)
  const devPath = path.join(__dirname, '..', '..', 'skills', 'builtin');
  if (fs.existsSync(devPath)) return devPath;
  
  // Strategy 3: Packaged assets location
  const assetsPath = path.join(__dirname, '..', 'assets', 'skills', 'builtin');
  if (fs.existsSync(assetsPath)) return assetsPath;
  
  // Strategy 4: Process cwd fallback
  return path.join(process.cwd(), 'skills', 'builtin');
}
```

## Testing (Specific Cases)

### Test 1: Nested Discovery
```typescript
it('discovers skills from nested directories', async () => {
  mockFs({
    '/skills/builtin/pr-creator/config.json': '{"description": "PR creator"}',
    '/skills/builtin/category/nested-skill/config.json': '{"description": "Nested"}',
  });
  
  const skills = await manager.discoverBuiltinSkills();
  
  expect(skills).toHaveLength(2);
  expect(skills.map(s => s.name)).toContain('pr-creator');
  expect(skills.map(s => s.name)).toContain('nested-skill');
});
```

### Test 2: Malformed Config Handling
```typescript
it('warns and continues on malformed config', async () => {
  mockFs({
    '/skills/builtin/good/config.json': '{"description": "Good"}',
    '/skills/builtin/bad/config.json': 'not valid json',
  });
  
  const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
  
  const skills = await manager.discoverBuiltinSkills();
  
  expect(skills).toHaveLength(1);
  expect(skills[0].name).toBe('good');
  expect(consoleSpy).toHaveBeenCalledWith(
    expect.stringContaining('Failed to load builtin skill bad'),
    expect.anything()
  );
});
```

### Test 3: User Skills Override
```typescript
it('user skills override builtin with same name', async () => {
  // Setup both user and builtin skill with same name
  const userSkill: Skill = { name: 'test', source: 'user', version: '2.0' };
  const builtinSkill: Skill = { name: 'test', source: 'builtin', version: '1.0' };
  
  mockUserSkills([userSkill]);
  mockBuiltinSkills([builtinSkill]);
  
  const skills = await manager.loadAllSkills();
  
  const testSkill = skills.find(s => s.name === 'test');
  expect(testSkill?.source).toBe('user');
  expect(testSkill?.version).toBe('2.0');
});
```

## Files to Modify

1. `packages/core/src/skills/skillManager.ts`
   - Add `discoverBuiltinSkills()`
   - Add `discoverSkillsRecursive()`
   - Add `loadSkillFromConfig()`
   - Add `pickValidFields()`
   - Add `resolveBuiltinSkillsDir()`
   - Update `loadAllSkills()` to merge builtins

2. `packages/core/src/skills/skillManager.test.ts`
   - Add tests for recursive discovery
   - Add tests for malformed config handling
   - Add tests for user override
   - Add tests for path resolution

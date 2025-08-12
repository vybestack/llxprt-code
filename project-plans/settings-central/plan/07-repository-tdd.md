# Phase 7: Settings Repository TDD

## Objective

Write behavioral tests for SettingsRepository persistence operations.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for SettingsRepository.

Create packages/core/test/settings/SettingsRepository.spec.ts:

/**
 * @requirement REQ-001.2
 * @scenario Load settings from file
 * @given Settings file exists with valid JSON
 * @when load() called
 * @then Returns parsed settings object
 */
test('should load settings from file', async () => {
  const repository = new SettingsRepository('/tmp/test-settings.json');
  
  const settings = await repository.load();
  
  expect(settings.activeProvider).toBe('openai');
  expect(settings.providers.openai.model).toBe('gpt-4');
  expect(settings.providers.qwen.baseUrl).toBe('https://portal.qwen.ai/v1');
});

/**
 * @requirement REQ-001.2
 * @scenario Save settings to file
 * @given Valid settings object
 * @when save() called
 * @then Settings persisted to file system
 */
test('should persist settings to file', async () => {
  const repository = new SettingsRepository('/tmp/test-settings.json');
  const settings = {
    activeProvider: 'qwen',
    providers: {
      qwen: {
        provider: 'qwen',
        model: 'qwen3-coder-plus',
        baseUrl: 'https://portal.qwen.ai/v1'
      }
    }
  };
  
  await repository.save(settings);
  
  const loaded = await repository.load();
  expect(loaded.activeProvider).toBe('qwen');
  expect(loaded.providers.qwen.model).toBe('qwen3-coder-plus');
});

/**
 * @requirement REQ-004.3
 * @scenario Create backup before save
 * @given Existing settings file
 * @when save() called with new settings
 * @then Backup created before overwriting
 */
test('should backup before saving', async () => {
  const repository = new SettingsRepository('/tmp/test-settings.json');
  const original = await repository.load();
  
  const newSettings = { ...original, activeProvider: 'gemini' };
  await repository.save(newSettings);
  
  const backupPath = '/tmp/test-settings.json.backup';
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  expect(backup.activeProvider).toBe(original.activeProvider);
});

/**
 * @requirement REQ-004.4
 * @scenario Restore from backup on corruption
 * @given Corrupted settings file
 * @when load() called
 * @then Restores from backup and returns valid settings
 */
test('should restore from backup on corrupt file', async () => {
  const repository = new SettingsRepository('/tmp/corrupt-settings.json');
  // Simulate corrupt file
  await fs.writeFile('/tmp/corrupt-settings.json', 'invalid json{');
  
  const settings = await repository.load();
  
  expect(settings).toBeDefined();
  expect(settings.activeProvider).toBeDefined();
});

/**
 * @requirement REQ-001.2
 * @scenario Return defaults when no file
 * @given Settings file doesn't exist
 * @when load() called
 * @then Returns default settings structure
 */
test('should return defaults when file missing', async () => {
  const repository = new SettingsRepository('/tmp/nonexistent.json');
  
  const settings = await repository.load();
  
  expect(settings.activeProvider).toBe('openai');
  expect(settings.providers).toBeDefined();
  expect(settings.providers.openai).toBeDefined();
});

/**
 * @requirement REQ-004.1
 * @scenario Atomic file write
 * @given Concurrent save operations
 * @when Multiple saves called
 * @then Last write wins, no corruption
 */
test('should handle concurrent saves atomically', async () => {
  const repository = new SettingsRepository('/tmp/concurrent.json');
  
  const save1 = repository.save({ activeProvider: 'openai', providers: {} });
  const save2 = repository.save({ activeProvider: 'qwen', providers: {} });
  
  await Promise.all([save1, save2]);
  
  const final = await repository.load();
  expect(['openai', 'qwen']).toContain(final.activeProvider);
});

// Add more tests for:
// - Validation before save
// - Backup rotation (keep last 5)
// - File permission errors
// - Disk full errors
// - Invalid JSON in file

IMPORTANT:
- Test actual file operations behavior
- No mocking file system
- Use temp directories for isolation
- Clean up test files after
"
```

## Verification

```bash
# Run tests
npm test packages/core/test/settings/SettingsRepository.spec.ts

# Check file operations tested
grep -c "readFile\|writeFile" SettingsRepository.spec.ts
# Should reference actual operations

# Verify temp file cleanup
ls /tmp/test-settings*.json 2>/dev/null
[ $? -ne 0 ] || echo "WARNING: Test files not cleaned"
```
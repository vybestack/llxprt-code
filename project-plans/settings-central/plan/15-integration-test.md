# Phase 15: End-to-End Integration Testing

## Objective

Comprehensive integration tests for entire settings system.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write end-to-end integration tests for settings centralization.

Create packages/core/test/integration/settings-e2e.spec.ts:

/**
 * @requirement REQ-001.1 REQ-002.1 REQ-003.3
 * @scenario Complete provider switch flow
 * @given User using openai provider
 * @when User executes /provider qwen command
 * @then Settings updated, provider switched, UI reflects change
 */
test('e2e: provider switch via CLI command', async () => {
  // Setup
  const settingsService = new SettingsService(repository);
  const providerManager = new ProviderManager(settingsService);
  const providerCommand = new ProviderCommand(settingsService, providerManager);
  
  // Initial state
  expect(settingsService.getSettings().activeProvider).toBe('openai');
  
  // Execute command
  await providerCommand.execute(['qwen']);
  
  // Verify settings updated
  const settings = settingsService.getSettings();
  expect(settings.activeProvider).toBe('qwen');
  expect(settings.providers.qwen.baseUrl).toBe('https://portal.qwen.ai/v1');
  expect(settings.providers.qwen.model).toBe('qwen3-coder-plus');
  
  // Verify provider active
  const active = providerManager.getActiveProvider();
  expect(active.type).toBe('qwen');
  
  // Verify persistence
  const loaded = await repository.load();
  expect(loaded.activeProvider).toBe('qwen');
});

/**
 * @requirement REQ-002.3 REQ-002.4
 * @scenario Settings sync across components
 * @given Multiple components using settings
 * @when Settings updated externally
 * @then All components see updated values
 */
test('e2e: settings sync across all components', async () => {
  const settingsService = new SettingsService(repository);
  const provider = new OpenAIProvider();
  const diagnostics = new DiagnosticsCommand(settingsService);
  const modelCommand = new ModelCommand(settingsService);
  
  // Register components
  provider.initialize(settingsService);
  
  // External update
  await fs.writeFile(settingsPath, JSON.stringify({
    activeProvider: 'openai',
    providers: {
      openai: {
        model: 'gpt-5',
        temperature: 0.9
      }
    }
  }));
  
  await sleep(100); // Wait for file watcher
  
  // All components see update
  expect(provider.getCurrentConfig().model).toBe('gpt-5');
  expect(await diagnostics.execute()).toContain('gpt-5');
  expect(await modelCommand.getCurrentModel()).toBe('gpt-5');
});

/**
 * @requirement REQ-004.1 REQ-004.3
 * @scenario Error recovery flow
 * @given Settings update in progress
 * @when Disk write fails
 * @then Rollback occurs, backup preserved
 */
test('e2e: error recovery and rollback', async () => {
  const settingsService = new SettingsService(repository);
  const original = settingsService.getSettings();
  
  // Simulate disk error
  jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('ENOSPC'));
  
  // Attempt update
  await expect(
    settingsService.updateSettings('openai', { model: 'gpt-6' })
  ).rejects.toThrow('ENOSPC');
  
  // Verify rollback
  expect(settingsService.getSettings()).toEqual(original);
  
  // Verify backup exists
  const backup = await fs.readFile(backupPath);
  expect(JSON.parse(backup)).toEqual(original);
});

/**
 * @requirement REQ-001.4 REQ-002.1
 * @scenario Atomic multi-provider update
 * @given Multiple providers configured
 * @when Batch update executed
 * @then All or none updated atomically
 */
test('e2e: atomic batch updates', async () => {
  const settingsService = new SettingsService(repository);
  
  const batchUpdate = {
    openai: { temperature: 0.7 },
    qwen: { model: 'qwen3-coder-plus' },
    gemini: { maxTokens: 2000 }
  };
  
  await settingsService.batchUpdate(batchUpdate);
  
  const settings = settingsService.getSettings();
  expect(settings.providers.openai.temperature).toBe(0.7);
  expect(settings.providers.qwen.model).toBe('qwen3-coder-plus');
  expect(settings.providers.gemini.maxTokens).toBe(2000);
});

// Add more e2e tests for:
// - Concurrent operations
// - Settings migration from v1 to v2
// - Memory leak prevention
// - Performance under load
// - Cleanup on shutdown

Run all integration tests and verify:
npm test packages/core/test/integration/

Output results to workers/phase-15.json
"
```

## Verification

```bash
# Run all integration tests
npm test packages/core/test/integration/

# Check coverage
npm test -- --coverage packages/core/test/integration/

# Verify no memory leaks
node --expose-gc test-memory-leaks.js

# Performance benchmark
npm run benchmark:settings
```
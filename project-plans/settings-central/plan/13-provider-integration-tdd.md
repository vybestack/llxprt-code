# Phase 13: Provider Integration TDD

## Objective

Write behavioral tests for provider-settings integration.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for provider integration.

Create packages/core/test/integration/provider-settings.spec.ts:

/**
 * @requirement REQ-002.1
 * @scenario Provider auto-updates on settings change
 * @given Provider instance with initial settings
 * @when Settings updated via service
 * @then Provider uses new settings immediately
 */
test('provider should auto-update when settings change', async () => {
  const settingsService = new SettingsService(repository);
  const provider = new OpenAIProvider();
  provider.initialize(settingsService);
  
  await settingsService.updateSettings('openai', {
    temperature: 0.8,
    model: 'gpt-5'
  });
  
  const config = provider.getCurrentConfig();
  expect(config.temperature).toBe(0.8);
  expect(config.model).toBe('gpt-5');
});

/**
 * @requirement REQ-002.3
 * @scenario UI commands read fresh settings
 * @given Settings changed externally
 * @when /diagnostics command executed
 * @then Shows current settings not cached
 */
test('diagnostics should show current settings', async () => {
  const settingsService = new SettingsService(repository);
  const diagnostics = new DiagnosticsCommand(settingsService);
  
  await settingsService.updateSettings('qwen', {
    baseUrl: 'https://new-url.com/v1'
  });
  
  const output = await diagnostics.execute();
  expect(output).toContain('https://new-url.com/v1');
  expect(output).not.toContain('https://portal.qwen.ai/v1');
});

/**
 * @requirement REQ-003.3
 * @scenario Provider switch updates active instance
 * @given Active provider is openai
 * @when switchProvider('qwen') called
 * @then ProviderManager uses qwen instance
 */
test('provider switch should change active instance', async () => {
  const settingsService = new SettingsService(repository);
  const providerManager = new ProviderManager(settingsService);
  
  await settingsService.switchProvider('qwen');
  
  const activeProvider = providerManager.getActiveProvider();
  expect(activeProvider.type).toBe('qwen');
  expect(activeProvider.baseUrl).toBe('https://portal.qwen.ai/v1');
});

/**
 * @requirement REQ-002.4
 * @scenario File change triggers reload
 * @given External process modifies settings file
 * @when File watcher detects change
 * @then Settings service reloads and notifies
 */
test('file changes should trigger settings reload', async () => {
  const settingsService = new SettingsService(repository);
  let eventReceived = false;
  
  settingsService.on('settings-reload', () => {
    eventReceived = true;
  });
  
  // Simulate external file change
  await fs.writeFile(settingsPath, JSON.stringify({
    activeProvider: 'gemini',
    providers: {}
  }));
  
  await sleep(100); // Wait for watcher
  
  expect(eventReceived).toBe(true);
  expect(settingsService.getSettings().activeProvider).toBe('gemini');
});

/**
 * @requirement REQ-001.3
 * @scenario Multiple listeners receive events
 * @given Multiple components listening
 * @when Settings change occurs
 * @then All listeners notified with same data
 */
test('all listeners should receive settings events', async () => {
  const settingsService = new SettingsService(repository);
  const received = [];
  
  settingsService.on('settings-update', (e) => received.push({a: e}));
  settingsService.on('settings-update', (e) => received.push({b: e}));
  settingsService.on('settings-update', (e) => received.push({c: e}));
  
  await settingsService.updateSettings('openai', { model: 'gpt-4' });
  
  expect(received).toHaveLength(3);
  expect(received[0].a.provider).toBe('openai');
  expect(received[1].b.provider).toBe('openai');
  expect(received[2].c.provider).toBe('openai');
});

// Add more integration tests for:
// - Provider reinitialization on critical changes
// - Settings migration from old format
// - Concurrent provider switches
// - Error recovery in provider updates
// - Memory leak prevention in listeners

IMPORTANT:
- Test real integration behavior
- Use actual components not mocks
- Verify end-to-end flows
"
```

## Verification

```bash
# Run integration tests
npm test packages/core/test/integration/provider-settings.spec.ts

# Check real components used
grep -c "mock" provider-settings.spec.ts
# Should be minimal/none

# Verify async handling
grep -c "async\|await" provider-settings.spec.ts
# Should be high for integration tests
```
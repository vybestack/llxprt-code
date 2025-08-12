# Phase 4: Settings Service TDD

## Objective

Write comprehensive behavioral tests for SettingsService before implementation.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for SettingsService based on requirements.

UPDATE packages/core/test/settings/SettingsService.spec.ts:
(If file doesn't exist, create it)

/**
 * @requirement REQ-001.1
 * @scenario Get settings for specific provider
 * @given Settings with qwen and openai configured
 * @when getSettings('qwen') is called
 * @then Returns qwen settings with baseUrl and model
 */
test('should return settings for specific provider', () => {
  const service = new SettingsService(mockRepository);
  const settings = service.getSettings('qwen');
  expect(settings.provider).toBe('qwen');
  expect(settings.baseUrl).toBe('https://portal.qwen.ai/v1');
  expect(settings.model).toBe('qwen3-coder-plus');
});

/**
 * @requirement REQ-002.1
 * @scenario Provider receives settings update event
 * @given Provider registered for events
 * @when Settings updated for that provider
 * @then Provider receives new settings in event
 */
test('should notify providers when settings change', async () => {
  const service = new SettingsService(repository);
  const eventData = await captureEvent(service, 'settings-update');
  
  await service.updateSettings('openai', { temperature: 0.7 });
  
  expect(eventData.provider).toBe('openai');
  expect(eventData.changes.temperature).toBe(0.7);
});

/**
 * @requirement REQ-003.2
 * @scenario Update settings with validation
 * @given Valid temperature value
 * @when updateSettings called
 * @then Settings persisted and event emitted
 */
test('should update and persist valid settings', async () => {
  const service = new SettingsService(repository);
  
  await service.updateSettings('openai', { temperature: 1.5 });
  
  const updated = service.getSettings('openai');
  expect(updated.temperature).toBe(1.5);
  
  const persisted = await repository.load();
  expect(persisted.providers.openai.temperature).toBe(1.5);
});

/**
 * @requirement REQ-004.1
 * @scenario Reject invalid settings
 * @given Temperature value > 2
 * @when updateSettings called
 * @then Throws validation error and no state change
 */
test('should reject invalid temperature settings', async () => {
  const service = new SettingsService(repository);
  const original = service.getSettings('openai');
  
  await expect(
    service.updateSettings('openai', { temperature: 3.5 })
  ).rejects.toThrow('Temperature must be between 0 and 2');
  
  const current = service.getSettings('openai');
  expect(current).toEqual(original);
});

/**
 * @requirement REQ-003.3
 * @scenario Switch to qwen provider
 * @given Current provider is openai
 * @when switchProvider('qwen') called
 * @then Active provider updated and qwen defaults set
 */
test('should switch provider and set defaults for qwen', async () => {
  const service = new SettingsService(repository);
  
  const result = await service.switchProvider('qwen');
  
  expect(result.provider).toBe('qwen');
  expect(result.baseUrl).toBe('https://portal.qwen.ai/v1');
  expect(result.model).toBe('qwen3-coder-plus');
  
  const settings = service.getSettings();
  expect(settings.activeProvider).toBe('qwen');
});

/**
 * @requirement REQ-004.3
 * @scenario Rollback on persistence failure
 * @given Repository fails to save
 * @when updateSettings called
 * @then Memory state rolled back to original
 */
test('should rollback on save failure', async () => {
  const failingRepo = {
    load: jest.fn().mockResolvedValue(initialSettings),
    save: jest.fn().mockRejectedValue(new Error('Disk full'))
  };
  
  const service = new SettingsService(failingRepo);
  const original = service.getSettings('openai');
  
  await expect(
    service.updateSettings('openai', { model: 'gpt-5' })
  ).rejects.toThrow('Disk full');
  
  const current = service.getSettings('openai');
  expect(current).toEqual(original);
});

// PROPERTY-BASED TESTS (30% minimum per PLAN.md)

/**
 * @requirement REQ-004.1
 * @property Valid settings always persist
 */
test.prop([fc.record({
  temperature: fc.float({ min: 0, max: 2 }),
  maxTokens: fc.integer({ min: 1, max: 8192 }),
  model: fc.constantFrom('gpt-4', 'gpt-5', 'qwen3-coder-plus')
})])('any valid settings should persist', async (settings) => {
  const service = new SettingsService(repository);
  
  await service.updateSettings('openai', settings);
  
  const retrieved = service.getSettings('openai');
  expect(retrieved).toMatchObject(settings);
});

/**
 * @requirement REQ-001.4
 * @property Atomic operations maintain consistency
 */
test.prop([fc.array(fc.record({
  provider: fc.constantFrom('openai', 'qwen', 'gemini'),
  changes: fc.record({
    temperature: fc.float({ min: 0, max: 2 })
  })
}))])('concurrent updates maintain consistency', async (updates) => {
  const service = new SettingsService(repository);
  
  const promises = updates.map(u => 
    service.updateSettings(u.provider, u.changes)
  );
  
  await Promise.allSettled(promises);
  
  const settings = service.getSettings();
  expect(settings).toBeDefined();
  expect(settings.activeProvider).toBeDefined();
});

// Add 10+ more behavioral tests covering all requirements

CRITICAL:
- DO NOT test for 'NotYetImplemented' - tests should fail naturally
- Tests expect REAL BEHAVIOR that doesn't exist yet
- No reverse testing (expect().not.toThrow for stubs)
- Test the actual requirements, not the absence of implementation
- Tests will naturally fail when implementation is missing
"
```

## Verification

```bash
# Run tests - should fail because implementation missing (NOT because of NotYetImplemented)
npm test packages/core/test/settings/SettingsService.spec.ts 2>&1 | head -20
# Should see failures like "Cannot read property 'getSettings' of undefined"
# Or "service.getSettings is not a function"
# NOT "Error: NotYetImplemented"

# Check for reverse tests (FORBIDDEN)
grep -E "toThrow\('NotYetImplemented'\)|toBe\('NotYetImplemented'\)" packages/core/test/settings/SettingsService.spec.ts
if [ $? -eq 0 ]; then
  echo "FAIL: Tests are testing for NotYetImplemented (reverse testing)"
  exit 1
fi

# Check for behavioral assertions
grep -c "toBe\|toEqual\|toThrow" packages/core/test/settings/SettingsService.spec.ts
# Should be 15+

# Check no mock theater
grep "toHaveBeenCalled" packages/core/test/settings/SettingsService.spec.ts
[ $? -ne 0 ] || echo "FAIL: Mock verification found"

# Verify property-based tests (30% minimum)
TOTAL_TESTS=$(grep -c "test\\(" packages/core/test/settings/SettingsService.spec.ts)
PROPERTY_TESTS=$(grep -c "test\\.prop\\(" packages/core/test/settings/SettingsService.spec.ts)
PERCENTAGE=$(echo "scale=2; $PROPERTY_TESTS / $TOTAL_TESTS * 100" | bc)
[ $(echo "$PERCENTAGE >= 30" | bc) -eq 1 ] || echo "FAIL: Only $PERCENTAGE% property tests (need 30%)"

# Verify requirement coverage
for req in REQ-001.1 REQ-001.2 REQ-002.1 REQ-003.2 REQ-004.1; do
  grep "@requirement $req" packages/core/test/settings/SettingsService.spec.ts || \
    echo "MISSING: $req"
done

# Check for behavioral contract verification
npx tsx verification/behavioral-contract.ts packages/core/test/settings/SettingsService.spec.ts
[ $? -eq 0 ] || echo "FAIL: Behavioral contracts invalid"
```
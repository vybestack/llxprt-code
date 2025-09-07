import { OpenAIProvider } from './packages/core/dist/src/providers/openai/OpenAIProvider.js';
import { getSettingsService } from './packages/core/dist/src/settings/settingsServiceInstance.js';

async function testEphemeralBaseUrl() {
  console.log('Testing ephemeral base URL...\n');

  const settingsService = getSettingsService();

  // Set ephemeral base URL
  const testBaseUrl = 'https://api.cerebras.ai/v1';
  settingsService.set('base-url', testBaseUrl);
  console.log('Set ephemeral base-url to:', testBaseUrl);

  // Check it was set
  const ephemeralValue = settingsService.get('base-url');
  console.log('Ephemeral base-url value:', ephemeralValue);

  // Create provider and check if it uses the ephemeral value
  const provider = new OpenAIProvider('test-key');

  // Access the protected method through reflection (for testing)
  const baseURL = provider.getBaseURL
    ? provider.getBaseURL()
    : 'method not accessible';
  console.log('Provider getBaseURL() returns:', baseURL);

  // Try to create a client (this will use getBaseURL internally)
  try {
    // This will trigger getClient() which uses getBaseURL()
    const client = await provider.getClient();
    console.log('Client created successfully');
    console.log('Client baseURL:', client.baseURL);
  } catch (error) {
    console.log('Error creating client (expected if no auth):', error.message);
  }

  console.log('\nTest complete!');
}

testEphemeralBaseUrl().catch(console.error);

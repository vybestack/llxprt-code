/**
 * @vitest-environment node
 *
 * End-to-end integration tests for the llxprt adapter.
 * These tests actually send messages to real providers and verify responses.
 * They require a valid synthetic profile to be configured.
 */
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigSession, type ConfigSession } from './configSession';
import { sendMessageWithSession, type AdapterEvent } from './llxprtAdapter';

const SYNTHETIC_PROFILE_PATH = path.join(
  os.homedir(),
  '.llxprt/profiles/synthetic.json',
);

interface ProfileData {
  provider?: string;
  model?: string;
  baseUrl?: string;
  authKeyfile?: string;
  ephemeralSettings?: Record<string, unknown>;
}

function loadSyntheticProfile(): ProfileData | null {
  if (!existsSync(SYNTHETIC_PROFILE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(
      readFileSync(SYNTHETIC_PROFILE_PATH, 'utf8'),
    ) as ProfileData;
  } catch {
    return null;
  }
}

function readApiKey(keyfilePath: string): string | undefined {
  try {
    return readFileSync(keyfilePath, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function createSessionFromProfile(profile: ProfileData): ConfigSession | null {
  const ephemeral = profile.ephemeralSettings ?? {};
  const provider = profile.provider;
  const baseUrl = (ephemeral['base-url'] ??
    ephemeral.baseUrl ??
    profile.baseUrl) as string | undefined;
  const keyFilePath = (ephemeral['auth-keyfile'] ??
    ephemeral.authKeyfile ??
    profile.authKeyfile) as string | undefined;
  const model = (ephemeral.model ?? profile.model) as string | undefined;

  if (!provider || !baseUrl || !model) {
    return null;
  }

  // Read the API key from keyfile if provided
  const apiKey = keyFilePath ? readApiKey(keyFilePath) : undefined;
  if (keyFilePath && !apiKey) {
    return null; // Keyfile specified but couldn't read it
  }

  return createConfigSession({
    model,
    provider,
    baseUrl,
    apiKey,
    workingDir: process.cwd(),
  });
}

const syntheticProfile = loadSyntheticProfile();
const describeSynthetic = syntheticProfile ? describe : describe.skip;

describe('llxprtAdapter end-to-end', () => {
  describeSynthetic('with synthetic profile', () => {
    /**
     * This is the CRITICAL end-to-end test that verifies the complete flow:
     * 1. Create ConfigSession from profile
     * 2. Initialize session (sets up auth, ProviderManager if needed)
     * 3. Send a message via sendMessageWithSession
     * 4. Receive streaming events
     * 5. Verify we get actual text content
     *
     * This test would catch:
     * - Authentication configuration errors
     * - ProviderManager setup issues
     * - Authorization header format issues
     * - API key reading issues
     * - Any HTTP/streaming issues
     */
    it('sends a message and receives streaming response', async () => {
      const session = createSessionFromProfile(syntheticProfile!);
      expect(session).not.toBeNull();

      // Initialize the session - this is where auth errors would surface
      await session!.initialize();

      const events: AdapterEvent[] = [];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);

      try {
        for await (const event of sendMessageWithSession(
          session!,
          'Say exactly: Hello from integration test',
          controller.signal,
        )) {
          events.push(event);

          // Stop after getting some text to avoid running up API costs
          const textDeltaCount = events.filter(
            (e) => e.type === 'text_delta',
          ).length;
          if (textDeltaCount >= 3) {
            controller.abort();
            break;
          }
        }
      } catch (error) {
        // AbortError is expected when we manually abort
        if (error instanceof Error && error.name !== 'AbortError') {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
        session!.dispose();
      }

      // Verify we got text events
      const textDeltas = events.filter(
        (e): e is Extract<AdapterEvent, { type: 'text_delta' }> =>
          e.type === 'text_delta',
      );
      expect(textDeltas.length).toBeGreaterThan(0);

      // Verify the combined text is non-empty
      const combinedText = textDeltas.map((e) => e.text).join('');
      expect(combinedText.length).toBeGreaterThan(0);
    }, 60000);

    /**
     * Test that session initialization works without sending a message.
     * This catches auth setup issues faster than the full message test.
     */
    it('initializes session successfully', async () => {
      const session = createSessionFromProfile(syntheticProfile!);
      expect(session).not.toBeNull();

      // This should NOT throw any errors
      await session!.initialize();

      // Client should be available
      const client = session!.getClient();
      expect(client).toBeDefined();

      session!.dispose();
    }, 30000);

    /**
     * Test that tools are registered after initialization.
     */
    it('has tools registered after initialization', async () => {
      const session = createSessionFromProfile(syntheticProfile!);
      expect(session).not.toBeNull();

      await session!.initialize();

      const registry = session!.config.getToolRegistry();
      const tools = registry.getFunctionDeclarations();
      expect(tools.length).toBeGreaterThan(0);

      session!.dispose();
    }, 30000);

    /**
     * Test that model is correctly propagated through Config.
     */
    it('uses correct model from profile', async () => {
      const session = createSessionFromProfile(syntheticProfile!);
      expect(session).not.toBeNull();

      // Check model before and after initialization
      const modelBeforeInit = session!.config.getModel();
      expect(modelBeforeInit).toBe(syntheticProfile!.model);

      await session!.initialize();

      const modelAfterInit = session!.config.getModel();
      expect(modelAfterInit).toBe(syntheticProfile!.model);

      session!.dispose();
    }, 30000);
  });
});

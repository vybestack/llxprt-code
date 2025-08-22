/**
 * Local AI server utilities for LM Studio and similar local servers
 * Provides undici Agent configuration and fetch wrapper to prevent connection termination
 */
import { Agent, fetch as undiciFetch } from 'undici';

// Singleton instance
let localAIAgentInstance: Agent | null = null;

/**
 * Default API key for local AI servers
 * Used as a placeholder since OpenAI SDK requires a key
 */
export const LOCAL_AI_DEFAULT_KEY = 'lmstudio';

/**
 * Configuration for local AI server connections
 * These settings are optimized to prevent the "terminated" errors
 * that occur with local AI servers like LM Studio
 */
const LOCAL_AI_AGENT_CONFIG = {
  keepAliveTimeout: 4000,       // 4s (under local server's 5s limit)
  keepAliveMaxTimeout: 60000,   // 1min max keep-alive duration  
  headersTimeout: 90000,        // 90s for headers
  bodyTimeout: 300000,          // 5min for streaming responses
  connectTimeout: 90000,        // 90s connection timeout
  connections: 2,               // Conservative connection pooling
  pipelining: 1,                // Enable pipelining for better performance
};

/**
 * Checks if a URL is pointing to a local server
 * @param url The URL to check
 * @returns true if the URL is localhost or 127.0.0.1
 */
export function isLocalServerUrl(url: string | undefined): boolean {
  return !!(url && (url.includes('localhost') || url.includes('127.0.0.1')));
}

/**
 * Creates or returns a singleton undici Agent configured for local AI servers
 * @returns Agent configured for local AI server compatibility
 */
export function getLocalAIAgent(): Agent {
  if (!localAIAgentInstance) {
    localAIAgentInstance = new Agent(LOCAL_AI_AGENT_CONFIG);
  }
  return localAIAgentInstance;
}

/**
 * Resets the singleton instance (mainly for testing)
 */
export function resetLocalAIAgent(): void {
  if (localAIAgentInstance) {
    localAIAgentInstance.close();
    localAIAgentInstance = null;
  }
}

/**
 * Creates a fetch function that uses undici with our custom Agent for local servers
 * This is a simpler approach that wraps fetch for local server compatibility
 */
export function createLocalAIFetch(): typeof fetch {
  console.log('[LocalAI] Creating custom fetch wrapper');
  
  return async function localAIFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Get URL string from input
    const url = typeof input === 'string' ? input : 
                input instanceof URL ? input.toString() :
                (input as Request).url;
    
    console.log(`[LocalAI] Fetch called for URL: ${url}`);
    
    // Check if this is a local server request
    if (isLocalServerUrl(url)) {
      // Use undici fetch with our custom Agent
      const localAgent = getLocalAIAgent();
      
      console.log(`[LocalAI] Using custom fetch for local server ${url}`);
      console.log(`[LocalAI] Agent config:`, LOCAL_AI_AGENT_CONFIG);
      
      // Use undici's fetch directly with our Agent
      // The 'as any' casts handle TypeScript's strict type checking between
      // Node's global fetch and undici's fetch
      return undiciFetch(input as any, {
        ...init,
        dispatcher: localAgent
      } as any) as unknown as Response;
    }
    
    console.log(`[LocalAI] Using default fetch for non-local URL: ${url}`);
    // For non-local servers, use the default fetch
    return fetch(input, init);
  };
}

/**
 * Get fetch function appropriate for the base URL
 * Returns custom fetch for local servers, standard fetch otherwise
 */
export function getFetchForUrl(baseUrl?: string): typeof fetch {
  if (isLocalServerUrl(baseUrl)) {
    return createLocalAIFetch();
  }
  return fetch;
}

/**
 * Get the appropriate API key for a given base URL
 * Returns default key for local servers if no key is provided
 */
export function getApiKeyForUrl(baseUrl?: string, providedKey?: string): string {
  // If a key is provided, use it
  if (providedKey && providedKey !== 'placeholder') {
    return providedKey;
  }
  
  // For local servers, use the default key
  if (isLocalServerUrl(baseUrl)) {
    return LOCAL_AI_DEFAULT_KEY;
  }
  
  // Otherwise return the provided key or placeholder
  return providedKey || 'placeholder';
}
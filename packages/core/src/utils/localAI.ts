/**
 * Local AI server utilities for LM Studio and similar local servers
 * Provides undici Agent configuration and fetch wrapper to prevent connection termination
 */
import { Agent } from 'undici';
import * as http from 'http';
import * as https from 'https';

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
    // Create Agent with socket configuration interceptor
    localAIAgentInstance = new Agent({
      ...LOCAL_AI_AGENT_CONFIG,
      connect: {
        timeout: LOCAL_AI_AGENT_CONFIG.connectTimeout,
        // Apply socket configuration on connect
        lookup: undefined,
        // Note: We'll handle socket config in the dispatcher intercept below
      }
    });
    
    // Intercept dispatcher to configure sockets
    const originalDispatch = localAIAgentInstance.dispatch.bind(localAIAgentInstance);
    (localAIAgentInstance as any).dispatch = function(opts: any, handler: any) {
      const originalOnConnect = handler.onConnect;
      handler.onConnect = function(abort: any, context: any) {
        if (context?.socket) {
          console.log('[LocalAI] Configuring socket in undici dispatcher');
          context.socket.setNoDelay(true);
          context.socket.setKeepAlive(true, 1000);
        }
        return originalOnConnect?.call(this, abort, context);
      };
      return originalDispatch(opts, handler);
    };
  }
  return localAIAgentInstance;
}

/**
 * Resets the singleton instances (mainly for testing)
 */
export function resetLocalAIAgent(): void {
  if (localAIAgentInstance) {
    localAIAgentInstance.close();
    localAIAgentInstance = null;
  }
  
  // Also reset configured agents
  if (configuredAgents) {
    // Destroy the agents to clean up resources
    if (configuredAgents.httpAgent && typeof configuredAgents.httpAgent.destroy === 'function') {
      configuredAgents.httpAgent.destroy();
    }
    if (configuredAgents.httpsAgent && typeof configuredAgents.httpsAgent.destroy === 'function') {
      configuredAgents.httpsAgent.destroy();
    }
    configuredAgents = null;
  }
}

// Singleton socket-configured agents
let configuredAgents: { httpAgent: any; httpsAgent: any } | null = null;

/**
 * Creates HTTP/HTTPS agents with socket configuration for local servers
 * This ensures proper TCP socket settings (NoDelay and KeepAlive)
 * Returns singleton instances to avoid creating multiple event listeners
 */
export function getConfiguredAgents() {
  if (!configuredAgents) {
    
    const httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
    });
    
    const httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
    });
    
    // Configure sockets when created - this is the critical fix
    httpAgent.on('socket', (socket: any) => {
      console.log('[LocalAI] Socket event fired for HTTP agent');
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
      console.log('[LocalAI] Configured HTTP socket with NoDelay and KeepAlive - success');
    });
    
    httpsAgent.on('socket', (socket: any) => {
      console.log('[LocalAI] Socket event fired for HTTPS agent');
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
      console.log('[LocalAI] Configured HTTPS socket with NoDelay and KeepAlive - success');
    });
    
    configuredAgents = { httpAgent, httpsAgent };
  }
  
  return configuredAgents;
}

/**
 * Creates a fetch function that uses Node's native http/https with socket configuration
 * This gives us direct control over socket settings for local AI servers
 */
export function createLocalAIFetch(): typeof fetch {
  console.log('[LocalAI] Creating custom fetch wrapper with socket configuration');
  
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
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      
      console.log(`[LocalAI] Using Node.js http/https for local server ${url} with socket configuration`);
      
      // Use Node's native http/https with socket configuration
      return new Promise((resolve, reject) => {
        const httpModule = isHttps ? https : http;
        
        // Parse request options
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: init?.method || 'GET',
          headers: {
            ...(init?.headers as any || {}),
          },
          // Use our configured agent with socket settings
          agent: isHttps ? getConfiguredAgents().httpsAgent : getConfiguredAgents().httpAgent,
        };
        
        console.log(`[LocalAI] Making ${options.method} request to ${options.hostname}:${options.port}${options.path}`);
        
        const req = httpModule.request(options, (res) => {
          console.log(`[LocalAI] Response received: ${res.statusCode}`);
          
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            
            // Create a Response-like object
            const response = new Response(body, {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers as any,
            });
            
            resolve(response);
          });
        });
        
        // CRITICAL: Configure socket when it's assigned
        req.on('socket', (socket) => {
          console.log('[LocalAI] Socket event fired - configuring socket');
          socket.setNoDelay(true);
          socket.setKeepAlive(true, 1000);
          console.log('[LocalAI] Socket configured with NoDelay and KeepAlive');
        });
        
        req.on('error', (error) => {
          console.error('[LocalAI] Request error:', error);
          reject(error);
        });
        
        // Write request body if present
        if (init?.body) {
          const bodyData = typeof init.body === 'string' ? init.body :
                          init.body instanceof Buffer ? init.body :
                          JSON.stringify(init.body);
          req.write(bodyData);
        }
        
        req.end();
      });
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

/**
 * Get the appropriate HTTP agent for OpenAI SDK
 * Returns socket-configured agent for local servers
 * This is for the httpAgent option (which might work even though undocumented)
 */
export function getHttpAgentForUrl(baseUrl?: string): any {
  if (baseUrl && isLocalServerUrl(baseUrl)) {
    const urlObj = new URL(baseUrl);
    const isHttps = urlObj.protocol === 'https:';
    const { httpAgent, httpsAgent } = getConfiguredAgents();
    return isHttps ? httpsAgent : httpAgent;
  }
  return undefined;
}
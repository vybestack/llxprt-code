// Type definitions for global OAuth state variables
declare global {
  namespace NodeJS {
    interface Global {
      __oauth_needs_code?: boolean;
      __oauth_provider?: string;
    }
  }
}

export {};

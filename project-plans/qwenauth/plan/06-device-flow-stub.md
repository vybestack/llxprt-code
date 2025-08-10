# Phase 06: Qwen Device Flow Stub

## Objective
Create minimal skeleton for Qwen OAuth device flow implementation.

## Input
- specification.md [REQ-002]
- analysis/pseudocode/qwen-device-flow.md

## Tasks
1. Create packages/core/src/auth/qwen-device-flow.ts
2. Define QwenDeviceFlow class with all methods
3. All methods throw new Error('NotYetImplemented')

## Required Structure
```typescript
interface DeviceFlowConfig {
  clientId: string
  authorizationEndpoint: string
  tokenEndpoint: string
  scopes: string[]
}

class QwenDeviceFlow {
  constructor(config: DeviceFlowConfig) {
    // Store config
  }
  
  async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    throw new Error('NotYetImplemented')
  }
  
  async pollForToken(deviceCode: string): Promise<OAuthToken> {
    throw new Error('NotYetImplemented')
  }
  
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    throw new Error('NotYetImplemented')
  }
  
  private generatePKCE(): { verifier: string, challenge: string } {
    throw new Error('NotYetImplemented')
  }
}
```

## Files to Create
- packages/core/src/auth/qwen-device-flow.ts

## Verification
- TypeScript compiles
- All methods present
- No implementation logic
- PKCE generation method included
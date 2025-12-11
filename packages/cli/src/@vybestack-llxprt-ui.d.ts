declare module '@vybestack/llxprt-ui' {
  export interface UILaunchConfig {
    profile?: string;
    sessionConfig?: Record<string, unknown>;
    workingDir: string;
    args: string[];
  }

  export function startNui(config: UILaunchConfig): Promise<void>;
}

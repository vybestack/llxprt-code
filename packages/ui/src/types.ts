/**
 * Configuration for launching the NUI
 */
export interface UILaunchConfig {
  /** Pre-loaded profile name */
  profile?: string;
  /** Pre-built config from CLI bootstrap */
  sessionConfig?: Record<string, unknown>;
  /** Working directory */
  workingDir: string;
  /** Pass-through command line arguments */
  args: string[];
}

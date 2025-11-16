import { z } from 'zod';

// Template variable schema from specification.md
export const TemplateVariablesSchema = z
  .object({
    TOOL_NAME: z.string().optional(),
    MODEL: z.string(),
    PROVIDER: z.string(),
  })
  .passthrough();

export type TemplateVariables = z.infer<typeof TemplateVariablesSchema>;

// Additional types that may be needed by TemplateEngine
export interface TemplateProcessingOptions {
  debug?: boolean;
}

// Environment context for prompt resolution
export interface PromptEnvironment {
  isGitRepository: boolean;
  isSandboxed: boolean;
  hasIdeCompanion: boolean;
  sessionStartedAt?: string;
  sandboxType?: 'macos-seatbelt' | 'generic';
  workspaceName?: string;
  workspaceRoot?: string;
  workspaceDirectories?: string[];
  workingDirectory?: string;
  folderStructure?: string;
}

// Runtime context for prompt assembly
export interface PromptContext {
  provider: string;
  model: string;
  enabledTools: string[];
  environment: PromptEnvironment;
}

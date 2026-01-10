import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TemplateEngine } from './TemplateEngine.js';
import type {
  TemplateVariables,
  TemplateProcessingOptions,
  PromptContext,
} from './types.js';

describe('TemplateEngine', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  describe('createVariablesFromContext environment metadata', () => {
    it('should expose workspace and sandbox details when provided', () => {
      const context: PromptContext = {
        provider: 'anthropic',
        model: 'claude-3',
        enabledTools: [],
        environment: {
          isGitRepository: true,
          isSandboxed: true,
          sandboxType: 'macos-seatbelt',
          hasIdeCompanion: false,
          workingDirectory: '/tmp/workspace-project',
          workspaceName: 'workspace-project',
          workspaceRoot: '/tmp/workspace-project',
          workspaceDirectories: ['/tmp/workspace-project', '/tmp/secondary'],
          folderStructure: 'mock structure',
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.IS_GIT_REPO).toBe('true');
      expect(vars.IS_SANDBOXED).toBe('true');
      expect(vars.SANDBOX_TYPE).toBe('macos-seatbelt');
      expect(vars.HAS_IDE).toBe('false');
      expect(vars.WORKSPACE_NAME).toBe('workspace-project');
      expect(vars.WORKSPACE_ROOT).toBe('/tmp/workspace-project');
      expect(vars.WORKSPACE_DIRECTORIES).toBe(
        '/tmp/workspace-project, /tmp/secondary',
      );
    });

    it('should provide sensible defaults when metadata is missing', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.IS_GIT_REPO).toBe('false');
      expect(vars.IS_SANDBOXED).toBe('false');
      expect(vars.SANDBOX_TYPE).toBe('none');
      expect(vars.HAS_IDE).toBe('false');
      expect(vars.WORKSPACE_NAME).toBe('unknown');
      expect(vars.WORKSPACE_ROOT).toBe('unknown');
      expect(vars.WORKSPACE_DIRECTORIES).toBe('unknown');
    });

    it('should expose the captured session start timestamp when provided', () => {
      const context: PromptContext = {
        provider: 'gemini',
        model: 'flash',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
          sessionStartedAt: 'Jan 02, 2025 08:00 AM UTC',
        } as PromptContext['environment'],
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars['SESSION_STARTED_AT']).toBe('Jan 02, 2025 08:00 AM UTC');
    });

    it('falls back to CURRENT_DATETIME when session start timestamp is missing', () => {
      const context: PromptContext = {
        provider: 'gemini',
        model: 'flash',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars['SESSION_STARTED_AT']).toBe(vars['CURRENT_DATETIME']);
    });
  });

  describe('SUBAGENT_DELEGATION variable', () => {
    it('should include SUBAGENT_DELEGATION when includeSubagentDelegation is true and tools include Task and ListSubagents', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['Task', 'ListSubagents', 'ReadFile'],
        includeSubagentDelegation: true,
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.SUBAGENT_DELEGATION).toBeDefined();
      expect(typeof vars.SUBAGENT_DELEGATION).toBe('string');
      expect(vars.SUBAGENT_DELEGATION).toContain('Subagent Delegation');
    });

    it('should be empty string when includeSubagentDelegation is false', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['Task', 'ListSubagents', 'ReadFile'],
        includeSubagentDelegation: false,
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.SUBAGENT_DELEGATION).toBe('');
    });

    it('should be empty string when includeSubagentDelegation is undefined', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['Task', 'ListSubagents', 'ReadFile'],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.SUBAGENT_DELEGATION).toBe('');
    });

    it('should be empty string when Task tool is not in enabled tools', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['ListSubagents', 'ReadFile'],
        includeSubagentDelegation: true,
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.SUBAGENT_DELEGATION).toBe('');
    });

    it('should be empty string when ListSubagents tool is not in enabled tools', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['Task', 'ReadFile'],
        includeSubagentDelegation: true,
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);

      expect(vars.SUBAGENT_DELEGATION).toBe('');
    });

    it('should substitute {{SUBAGENT_DELEGATION}} in template content', () => {
      const template = `Core content.

{{SUBAGENT_DELEGATION}}

More content`;
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['Task', 'ListSubagents'],
        includeSubagentDelegation: true,
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);
      const result = engine.processTemplate(template, vars);

      expect(result).toContain('Core content.');
      expect(result).toContain('Subagent Delegation');
      expect(result).toContain('More content');
      expect(result).not.toContain('{{SUBAGENT_DELEGATION}}');
    });

    it('should remove {{SUBAGENT_DELEGATION}} from template when variable is empty', () => {
      const template = `Core content.

{{SUBAGENT_DELEGATION}}

More content`;
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['ReadFile'],
        includeSubagentDelegation: false,
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };

      const vars = engine.createVariablesFromContext(context);
      const result = engine.processTemplate(template, vars);

      expect(result).toContain('Core content.');
      expect(result).not.toContain('Subagent Delegation');
      expect(result).toContain('More content');
      expect(result).not.toContain('{{SUBAGENT_DELEGATION}}');
    });
  });

  describe('basic variable substitution', () => {
    it('should substitute known variables with actual values', () => {
      /**
       * @requirement REQ-004.1, REQ-004.2
       * @scenario Template contains MODEL and PROVIDER variables
       * @given Template: "You are running on {{PROVIDER}} using model {{MODEL}}"
       * @when processTemplate() called with variables
       * @then Returns: "You are running on anthropic using model claude-3-opus"
       */
      const template = 'You are running on {{PROVIDER}} using model {{MODEL}}';
      const variables: TemplateVariables = {
        PROVIDER: 'anthropic',
        MODEL: 'claude-3-opus',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe(
        'You are running on anthropic using model claude-3-opus',
      );
    });

    it('should handle single variable substitution', () => {
      /**
       * @requirement REQ-004.1, REQ-004.2
       * @scenario Template with only MODEL variable
       * @given Template: "Current model: {{MODEL}}"
       * @when processTemplate() called with MODEL value
       * @then Returns: "Current model: gpt-4"
       */
      const template = 'Current model: {{MODEL}}';
      const variables: TemplateVariables = {
        MODEL: 'gpt-4',
        PROVIDER: 'openai',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Current model: gpt-4');
    });
  });

  describe('optional variable handling', () => {
    it('should handle optional TOOL_NAME variable when provided', () => {
      /**
       * @requirement REQ-004.2
       * @scenario Template with optional TOOL_NAME
       * @given Template with TOOL_NAME variable
       * @when Variable provided in context
       * @then Substitutes the tool name
       */
      const template = 'Use the {{TOOL_NAME}} tool carefully';
      const variables: TemplateVariables = {
        PROVIDER: 'gemini',
        MODEL: 'gemini-pro',
        TOOL_NAME: 'ReadFile',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Use the ReadFile tool carefully');
    });

    it('should handle missing optional variables by replacing with empty string', () => {
      /**
       * @requirement REQ-004.2
       * @scenario Template with optional variable not provided
       * @given Template with TOOL_NAME but no value provided
       * @when processTemplate called
       * @then Replaces with empty string
       */
      const template = 'Tool: {{TOOL_NAME}} for {{PROVIDER}}';
      const variables: TemplateVariables = {
        PROVIDER: 'ollama',
        MODEL: 'llama2',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Tool:  for ollama');
    });

    it('should handle undefined variable values as empty strings', () => {
      /**
       * @requirement REQ-004.2
       * @scenario Variable exists but value is undefined
       * @given Template with variable whose value is undefined
       * @when processTemplate called
       * @then Treats undefined as empty string
       */
      const template = 'Provider: {{PROVIDER}}, Tool: {{TOOL_NAME}}';
      const variables: TemplateVariables = {
        PROVIDER: 'azure',
        MODEL: 'gpt-35-turbo',
        TOOL_NAME: undefined as unknown as string,
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Provider: azure, Tool: ');
    });
  });

  describe('malformed variable handling', () => {
    it('should leave malformed variables unchanged', () => {
      /**
       * @requirement REQ-004.3
       * @scenario Template contains malformed variable syntax
       * @given Various malformed patterns
       * @when processTemplate called
       * @then Malformed parts remain unchanged
       */
      const template = 'Valid {{MODEL}} but {{BROKEN and {{UNCLOSED';
      const variables: TemplateVariables = {
        MODEL: 'gpt-4',
        PROVIDER: 'openai',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Valid gpt-4 but {{BROKEN and {{UNCLOSED');
    });

    it('should handle nested brackets without processing inner content', () => {
      /**
       * @requirement REQ-004.3
       * @scenario Nested variable brackets
       * @given Template with {{{{VAR}}}}
       * @when processTemplate called
       * @then Only outer brackets processed
       */
      const template = 'Nested {{{{MODEL}}}} here';
      const variables: TemplateVariables = {
        MODEL: 'claude',
        PROVIDER: 'anthropic',
      };

      const result = engine.processTemplate(template, variables);

      // Should process outer brackets, leaving {{claude}}
      expect(result).toBe('Nested {{claude}} here');
    });

    it('should handle mismatched brackets', () => {
      /**
       * @requirement REQ-004.3
       * @scenario Template with mismatched brackets
       * @given }}{{MODEL}}{{ pattern
       * @when processTemplate called
       * @then Only properly formed variables substituted
       */
      const template = '}}Start {{MODEL}} End{{';
      const variables: TemplateVariables = {
        MODEL: 'llama-2',
        PROVIDER: 'meta',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('}}Start llama-2 End{{');
    });
  });

  describe('edge cases', () => {
    it('should handle empty template', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Empty template string
       * @given Empty string template
       * @when processTemplate called
       * @then Returns empty string
       */
      const result = engine.processTemplate('', {
        MODEL: 'test',
        PROVIDER: 'test',
      });
      expect(result).toBe('');
    });

    it('should handle template with no variables', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Template without any variables
       * @given Plain text template
       * @when processTemplate called
       * @then Returns unchanged template
       */
      const template = 'This is plain text with no variables';
      const result = engine.processTemplate(template, {
        MODEL: 'test',
        PROVIDER: 'test',
      });
      expect(result).toBe(template);
    });

    it('should handle variables at start and end of template', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variables at boundaries
       * @given Template starting and ending with variables
       * @when processTemplate called
       * @then All variables substituted correctly
       */
      const template = '{{PROVIDER}} is the provider and model is {{MODEL}}';
      const variables: TemplateVariables = {
        PROVIDER: 'azure',
        MODEL: 'gpt-35-turbo',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('azure is the provider and model is gpt-35-turbo');
    });

    it('should handle null content', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Null template content
       * @given null passed as template
       * @when processTemplate called
       * @then Returns empty string
       */
      const result = engine.processTemplate(null as unknown as string, {
        MODEL: 'test',
        PROVIDER: 'test',
      });
      expect(result).toBe('');
    });

    it('should handle undefined content', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Undefined template content
       * @given undefined passed as template
       * @when processTemplate called
       * @then Returns empty string
       */
      const result = engine.processTemplate(undefined as unknown as string, {
        MODEL: 'test',
        PROVIDER: 'test',
      });
      expect(result).toBe('');
    });

    it('should handle null variables map', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Null variables map
       * @given Valid template but null variables
       * @when processTemplate called
       * @then Variables treated as missing (empty string)
       */
      const template = 'Model: {{MODEL}}';
      const result = engine.processTemplate(
        template,
        null as unknown as TemplateVariables,
      );
      expect(result).toBe('Model: ');
    });

    it('should handle undefined variables map', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Undefined variables map
       * @given Valid template but undefined variables
       * @when processTemplate called
       * @then Variables treated as missing (empty string)
       */
      const template = 'Provider: {{PROVIDER}}';
      const result = engine.processTemplate(
        template,
        undefined as unknown as TemplateVariables,
      );
      expect(result).toBe('Provider: ');
    });
  });

  describe('complex templates', () => {
    it('should handle multiple occurrences of same variable', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Same variable appears multiple times
       * @given Template with repeated variables
       * @when processTemplate called
       * @then All occurrences substituted
       */
      const template = '{{MODEL}} is great. I repeat, {{MODEL}} is great!';
      const variables: TemplateVariables = {
        MODEL: 'claude-3',
        PROVIDER: 'anthropic',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('claude-3 is great. I repeat, claude-3 is great!');
    });

    it('should handle adjacent variables', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variables with no space between
       * @given {{VAR1}}{{VAR2}}
       * @when processTemplate called
       * @then Both substituted correctly
       */
      const template = '{{PROVIDER}}{{MODEL}}';
      const variables: TemplateVariables = {
        PROVIDER: 'google/',
        MODEL: 'palm2',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('google/palm2');
    });

    it('should handle all three variables in one template', () => {
      /**
       * @requirement REQ-004.2
       * @scenario Template using all supported variables
       * @given Template with PROVIDER, MODEL, and TOOL_NAME
       * @when processTemplate called
       * @then All variables substituted
       */
      const template =
        'Using {{PROVIDER}} provider with {{MODEL}} model for {{TOOL_NAME}} tool';
      const variables: TemplateVariables = {
        PROVIDER: 'anthropic',
        MODEL: 'claude-3-sonnet',
        TOOL_NAME: 'WebSearch',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe(
        'Using anthropic provider with claude-3-sonnet model for WebSearch tool',
      );
    });

    it('should handle variables with whitespace inside brackets', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variables with internal whitespace
       * @given {{ MODEL }} with spaces
       * @when processTemplate called
       * @then Whitespace trimmed, variable substituted
       */
      const template = 'Model: {{ MODEL }} and {{  PROVIDER  }}';
      const variables: TemplateVariables = {
        MODEL: 'gpt-4',
        PROVIDER: 'openai',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Model: gpt-4 and openai');
    });
  });

  describe('special characters in values', () => {
    it('should handle special characters in variable values', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variable values contain special characters
       * @given Values with quotes, brackets, etc
       * @when processTemplate called
       * @then Values inserted as-is
       */
      const template = 'Model: {{MODEL}}';
      const variables: TemplateVariables = {
        MODEL: 'model-with-"quotes"-and-{brackets}',
        PROVIDER: 'test',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Model: model-with-"quotes"-and-{brackets}');
    });

    it('should handle newlines in variable values', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variable values contain newlines
       * @given Values with line breaks
       * @when processTemplate called
       * @then Values inserted preserving newlines
       */
      const template = 'Description: {{MODEL}}';
      const variables: TemplateVariables = {
        MODEL: 'line1\nline2\nline3',
        PROVIDER: 'test',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Description: line1\nline2\nline3');
    });

    it('should handle unicode in variable values', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variable values contain unicode
       * @given Values with emoji and unicode characters
       * @when processTemplate called
       * @then Values inserted preserving unicode
       */
      const template = 'Model: {{MODEL}}';
      const variables: TemplateVariables = {
        MODEL: 'claude-3-🚀-日本語',
        PROVIDER: 'anthropic',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Model: claude-3-🚀-日本語');
    });
  });

  describe('debug logging', () => {
    let originalDebug: string | undefined;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      originalDebug = process.env.DEBUG;
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.env.DEBUG = originalDebug;
      consoleSpy.mockRestore();
    });

    it('should log substitutions when DEBUG=1', () => {
      /**
       * @requirement REQ-010.4
       * @scenario DEBUG environment variable is set
       * @given DEBUG=1 and template with variables
       * @when processTemplate called
       * @then Logs variable substitutions
       */
      process.env.DEBUG = '1';

      const template = 'Provider: {{PROVIDER}}';
      const variables: TemplateVariables = {
        PROVIDER: 'anthropic',
        MODEL: 'claude',
      };

      engine.processTemplate(template, variables);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('PROVIDER'),
      );
    });

    it('should not log when DEBUG is not set', () => {
      /**
       * @requirement REQ-010.4
       * @scenario DEBUG environment variable is not set
       * @given No DEBUG and template with variables
       * @when processTemplate called
       * @then No logging occurs
       */
      delete process.env.DEBUG;

      const template = 'Provider: {{PROVIDER}}';
      const variables: TemplateVariables = {
        PROVIDER: 'anthropic',
        MODEL: 'claude',
      };

      engine.processTemplate(template, variables);

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log through options when debug option is true', () => {
      /**
       * @requirement REQ-010.4
       * @scenario Debug option passed explicitly
       * @given options.debug = true
       * @when processTemplate called
       * @then Logs variable substitutions
       */
      const template = 'Model: {{MODEL}}';
      const variables: TemplateVariables = {
        MODEL: 'gpt-4',
        PROVIDER: 'openai',
      };
      const options: TemplateProcessingOptions = { debug: true };

      engine.processTemplate(template, variables, options);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MODEL'));
    });

    it('should log multiple substitutions', () => {
      /**
       * @requirement REQ-010.4
       * @scenario Multiple variables substituted
       * @given Template with multiple variables and DEBUG=1
       * @when processTemplate called
       * @then Logs each substitution
       */
      process.env.DEBUG = '1';

      const template = '{{PROVIDER}} uses {{MODEL}} with {{TOOL_NAME}}';
      const variables: TemplateVariables = {
        PROVIDER: 'google',
        MODEL: 'gemini-pro',
        TOOL_NAME: 'Search',
      };

      engine.processTemplate(template, variables);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('PROVIDER'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MODEL'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TOOL_NAME'),
      );
    });
  });

  describe('variable extraction edge cases', () => {
    it('should handle empty variable names', () => {
      /**
       * @requirement REQ-004.3
       * @scenario Empty variable name between brackets
       * @given Template with {{}}
       * @when processTemplate called
       * @then Empty brackets left unchanged
       */
      const template = 'Empty {{}} variable';
      const variables: TemplateVariables = { MODEL: 'test', PROVIDER: 'test' };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Empty {{}} variable');
    });

    it('should handle very long variable names', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Variable with very long name
       * @given Template with 100+ character variable name
       * @when processTemplate called
       * @then Variable processed normally
       */
      const longVarName = 'A'.repeat(100);
      const template = `Long {{${longVarName}}} variable`;
      const variables: TemplateVariables = {
        [longVarName]: 'replaced',
        MODEL: 'test',
        PROVIDER: 'test',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('Long replaced variable');
    });

    it('should handle consecutive bracket patterns', () => {
      /**
       * @requirement REQ-004.1
       * @scenario Multiple {{ }} patterns in sequence
       * @given {{{{}}}}{{MODEL}}{{{{}}}}
       * @when processTemplate called
       * @then Only valid variables substituted
       */
      const template = '{{{{}}}}{{MODEL}}{{{{}}}}';
      const variables: TemplateVariables = {
        MODEL: 'claude',
        PROVIDER: 'anthropic',
      };

      const result = engine.processTemplate(template, variables);

      expect(result).toBe('{{{{}}}}claude{{{{}}}}');
    });
  });
});

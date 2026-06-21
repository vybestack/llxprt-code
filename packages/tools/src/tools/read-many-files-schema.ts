/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the JSON schema for the ReadManyFiles tool parameters.
 */
export function buildParameterSchema() {
  return {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
        },
        minItems: 1,
        description:
          "Required. An array of glob patterns or paths relative to the tool's target directory. Examples: ['src/**/*.ts'], ['README.md', 'docs/']",
      },
      include: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
        },
        description:
          'Optional. Additional glob patterns to include. These are merged with `paths`. Example: "*.test.ts" to specifically add test files if they were broadly excluded.',
        default: [],
      },
      exclude: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
        },
        description:
          'Optional. Glob patterns for files/directories to exclude. Added to default excludes if useDefaultExcludes is true. Example: "**/*.log", "temp/"',
        default: [],
      },
      recursive: {
        type: 'boolean',
        description:
          'Optional. Whether to search recursively (primarily controlled by `**` in glob patterns). Defaults to true.',
        default: true,
      },
      useDefaultExcludes: {
        type: 'boolean',
        description:
          'Optional. Whether to apply a list of default exclusion patterns (e.g., node_modules, .git, binary files). Defaults to true.',
        default: true,
      },
      file_filtering_options: {
        description:
          'Whether to respect ignore patterns from .gitignore or .llxprtignore',
        type: 'object',
        properties: {
          respect_git_ignore: {
            description:
              'Optional: Whether to respect .gitignore patterns when listing files. Only available in git repositories. Defaults to true.',
            type: 'boolean',
          },
          respect_llxprt_ignore: {
            description:
              'Optional: Whether to respect .llxprtignore patterns when listing files. Defaults to true.',
            type: 'boolean',
          },
        },
      },
    },
    required: ['paths'],
  };
}

/**
 * Formats the exclude patterns description string.
 */
export function formatExcludePatterns(patterns: string[]): string {
  const preview = patterns.slice(0, 2).join('`, `');
  const suffix = patterns.length > 2 ? '...`' : '`';
  return `Excluding: patterns like \n${preview}${suffix}`;
}

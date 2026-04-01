/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import yaml from 'js-yaml';
import { debugLogger } from '../utils/debugLogger.js';
import { coreEvents } from '../utils/events.js';

/**
 * The source/origin of a skill.
 */
export type SkillSource = 'builtin' | 'extension' | 'user' | 'project';

/**
 * Represents the definition of an Agent Skill.
 */
export interface SkillDefinition {
  /** The unique name of the skill. */
  name: string;
  /** A concise description of what the skill does. */
  description: string;
  /** The absolute path to the skill's source file on disk. */
  location: string;
  /** The core logic/instructions of the skill. */
  body: string;
  /** Whether the skill is currently disabled. */
  disabled?: boolean;
  /** The source/origin of this skill. */
  source?: SkillSource;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/;

/**
 * Parses frontmatter content using YAML with a fallback to simple key-value parsing.
 * This handles cases where description contains colons that would break YAML parsing.
 */
function parseFrontmatter(
  content: string,
): { name: string; description: string } | null {
  try {
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object') {
      const { name, description } = parsed as Record<string, unknown>;
      if (typeof name === 'string' && typeof description === 'string') {
        return { name, description };
      }
    }
  } catch (yamlError) {
    debugLogger.debug(
      'YAML frontmatter parsing failed, falling back to simple parser:',
      yamlError,
    );
  }

  return parseSimpleFrontmatter(content);
}

/**
 * Simple frontmatter parser that extracts name and description fields.
 * Handles cases where values contain colons that would break YAML parsing.
 */
function parseSimpleFrontmatter(
  content: string,
): { name: string; description: string } | null {
  const lines = content.split(/\r?\n/);
  let name: string | undefined;
  let description: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match "name:" at the start of the line (optional whitespace)
    const nameMatch = line.match(/^\s*name:\s*(.*)$/);
    if (nameMatch) {
      name = nameMatch[1].trim();
      continue;
    }

    // Match "description:" at the start of the line (optional whitespace)
    const descMatch = line.match(/^\s*description:\s*(.*)$/);
    if (descMatch) {
      const descLines = [descMatch[1].trim()];

      // Check for multi-line description (indented continuation lines)
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        // If next line is indented, it's a continuation of the description
        if (nextLine.match(/^[ \t]+\S/)) {
          descLines.push(nextLine.trim());
          i++;
        } else {
          break;
        }
      }

      description = descLines.filter(Boolean).join(' ');
      continue;
    }
  }

  if (name !== undefined && description !== undefined) {
    return { name, description };
  }
  return null;
}

/**
 * Discovers and loads all skills in the provided directory.
 */
export async function loadSkillsFromDir(
  dir: string,
  source?: SkillSource,
): Promise<SkillDefinition[]> {
  const discoveredSkills: SkillDefinition[] = [];

  try {
    const absoluteSearchPath = path.resolve(dir);
    const stats = await fs.stat(absoluteSearchPath).catch(() => null);
    if (!(stats?.isDirectory() ?? false)) {
      return [];
    }

    const skillFiles = await glob(['SKILL.md', '*/SKILL.md'], {
      cwd: absoluteSearchPath,
      absolute: true,
      nodir: true,
    });

    for (const skillFile of skillFiles) {
      const metadata = await loadSkillFromFile(skillFile, source);
      if (metadata != null) {
        discoveredSkills.push(metadata);
      }
    }

    if (discoveredSkills.length === 0) {
      const files = await fs.readdir(absoluteSearchPath);
      if (files.length > 0) {
        debugLogger.debug(
          `Failed to load skills from ${absoluteSearchPath}. The directory is not empty but no valid skills were discovered. Please ensure SKILL.md files are present in subdirectories and have valid frontmatter.`,
        );
      }
    }
  } catch (error) {
    coreEvents.emitFeedback(
      'warning',
      `Error discovering skills in ${dir}:`,
      error,
    );
  }

  return discoveredSkills;
}

/**
 * Loads a single skill from a SKILL.md file.
 */
export async function loadSkillFromFile(
  filePath: string,
  source?: SkillSource,
): Promise<SkillDefinition | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const match = RegExp(FRONTMATTER_REGEX).exec(content);
    if (match == null) {
      return null;
    }

    const frontmatter = parseFrontmatter(match[1]);
    if (!frontmatter) {
      return null;
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      location: filePath,
      body: match[2]?.trim() ?? '',
      source,
    };
  } catch (error) {
    debugLogger.log(`Error parsing skill file ${filePath}:`, error);
    return null;
  }
}

function loadSkillFromFileSync(
  filePath: string,
  source?: SkillSource,
): SkillDefinition | null {
  try {
    const content = fsSync.readFileSync(filePath, 'utf-8');
    const match = RegExp(FRONTMATTER_REGEX).exec(content);
    if (match == null) {
      return null;
    }

    const frontmatter = yaml.load(match[1]);
    if (!frontmatter || typeof frontmatter !== 'object') {
      return null;
    }

    const { name, description } = frontmatter as Record<string, unknown>;
    if (typeof name !== 'string' || typeof description !== 'string') {
      return null;
    }

    return {
      name,
      description,
      location: filePath,
      body: match[2].trim(),
      source,
    };
  } catch (error) {
    debugLogger.log(`Error parsing skill file ${filePath}:`, error);
    return null;
  }
}

export function loadSkillsFromDirSync(
  dir: string,
  source?: SkillSource,
): SkillDefinition[] {
  const discoveredSkills: SkillDefinition[] = [];

  try {
    const absoluteSearchPath = path.resolve(dir);
    if (
      !fsSync.existsSync(absoluteSearchPath) ||
      !fsSync.statSync(absoluteSearchPath).isDirectory()
    ) {
      return [];
    }

    const entries = fsSync.readdirSync(absoluteSearchPath, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFile = path.join(absoluteSearchPath, entry.name, 'SKILL.md');
      if (!fsSync.existsSync(skillFile)) {
        continue;
      }
      const skill = loadSkillFromFileSync(skillFile, source);
      if (skill != null) {
        discoveredSkills.push(skill);
      }
    }
  } catch (error) {
    debugLogger.log(`Error discovering skills in ${dir}:`, error);
  }

  return discoveredSkills;
}

/**
 * Returns the path to the built-in skills directory.
 * The built-in skills are shipped with the CLI in the core package.
 */
export function getBuiltinSkillsDir(): string {
  // The built-in skills directory is located at packages/core/src/skills/builtin
  // At runtime, this will be resolved relative to this file's location
  return path.join(path.dirname(new URL(import.meta.url).pathname), 'builtin');
}

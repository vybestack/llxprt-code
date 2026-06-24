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

/**
 * Extracts frontmatter (between `---` delimiters) and body from skill content.
 * Returns [frontmatter, body] or null if no frontmatter block is found.
 */
function extractFrontmatter(content: string): [string, string] | null {
  // Must start with ---\n (or ---\r\n)
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null;
  }
  const firstLineEnd = content.indexOf('\n') + 1;
  let searchStart = firstLineEnd;

  while (searchStart < content.length) {
    const closeMarker = content.indexOf('\n---', searchStart);
    if (closeMarker === -1) {
      return null;
    }

    const markerEnd = closeMarker + '\n---'.length;
    const nextChar = content[markerEnd];
    if (nextChar === '\n') {
      return [
        content.slice(firstLineEnd, closeMarker + 1),
        content.slice(markerEnd + 1),
      ];
    }
    if (nextChar === '\r' && content[markerEnd + 1] === '\n') {
      return [
        content.slice(firstLineEnd, closeMarker + 1),
        content.slice(markerEnd + 2),
      ];
    }

    searchStart = markerEnd;
  }

  return null;
}

/**
 * Matches a "key:" prefix at the start of a line (with optional leading
 * whitespace) and returns the remainder, or undefined if the line does not
 * start with `key:`.
 */
function matchPrefixedField(line: string, field: string): string | undefined {
  const trimmed = line.trimStart();
  const prefix = field + ':';
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length);
  }
  return undefined;
}

/**
 * Returns true if the line starts with whitespace and contains at least one
 * non-whitespace character (used to detect indented continuation lines).
 */
function isIndentedNonEmptyLine(line: string): boolean {
  if (line.length === 0) {
    return false;
  }
  const first = line[0];
  if (first !== ' ' && first !== '\t') {
    return false;
  }
  return line.trim().length > 0;
}

function collectMultilineDescription(
  lines: string[],
  startIndex: number,
  firstLine: string,
): string {
  const descLines = [firstLine];
  for (let j = startIndex + 1; j < lines.length; j++) {
    if (!isIndentedNonEmptyLine(lines[j])) {
      break;
    }
    descLines.push(lines[j].trim());
  }
  return descLines.filter(Boolean).join(' ');
}

/**
 * Parses frontmatter content using YAML with a fallback to simple key-value parsing.
 * This handles cases where description contains colons that would break YAML parsing.
 */
function parseFrontmatter(
  content: string,
): { name: string; description: string } | null {
  try {
    const parsed = yaml.load(content);
    if (parsed !== null && parsed !== undefined && typeof parsed === 'object') {
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
    const nameMatch = matchPrefixedField(line, 'name');
    if (nameMatch !== undefined) {
      name = nameMatch.trim();
    } else {
      const descResult = tryExtractDescription(lines, i);
      if (descResult) {
        description = descResult.description;
        i = descResult.nextIndex;
      }
    }
  }

  if (name !== undefined && description !== undefined) {
    return { name, description };
  }
  return null;
}

function tryExtractDescription(
  lines: string[],
  i: number,
): { description: string; nextIndex: number } | null {
  const line = lines[i];
  const descMatch = matchPrefixedField(line, 'description');
  if (descMatch === undefined) {
    return null;
  }
  const description = collectMultilineDescription(lines, i, descMatch.trim());
  let skip = i + 1;
  while (skip < lines.length && isIndentedNonEmptyLine(lines[skip])) {
    i = skip;
    skip++;
  }
  return { description, nextIndex: i };
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
    if (stats === null || stats.isDirectory() !== true) {
      return [];
    }

    const skillFiles = await glob(['SKILL.md', '*/SKILL.md'], {
      cwd: absoluteSearchPath,
      absolute: true,
      nodir: true,
    });

    for (const skillFile of skillFiles) {
      const metadata = await loadSkillFromFile(skillFile, source);
      if (metadata) {
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
    const parts = extractFrontmatter(content);
    if (!parts) {
      return null;
    }

    const frontmatter = parseFrontmatter(parts[0]);
    if (!frontmatter) {
      return null;
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      location: filePath,
      body: parts[1].trim(),
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
    const parts = extractFrontmatter(content);
    if (!parts) {
      return null;
    }

    const frontmatter = yaml.load(parts[0]);
    if (
      frontmatter === null ||
      frontmatter === undefined ||
      typeof frontmatter !== 'object'
    ) {
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
      body: parts[1].trim(),
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
      const skill = loadSkillFromDirEntry(
        absoluteSearchPath,
        entry.name,
        source,
      );
      if (skill) {
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

function loadSkillFromDirEntry(
  searchPath: string,
  dirName: string,
  source?: SkillSource,
): SkillDefinition | null {
  const skillFile = path.join(searchPath, dirName, 'SKILL.md');
  if (!fsSync.existsSync(skillFile)) {
    return null;
  }
  return loadSkillFromFileSync(skillFile, source);
}

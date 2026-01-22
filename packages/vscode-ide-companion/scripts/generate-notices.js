/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
);
const packagePath = path.join(projectRoot, 'packages', 'vscode-ide-companion');
const noticeFilePath = path.join(packagePath, 'NOTICES.txt');

/**
 * Extract copyright information from LICENSE file content.
 * Based on common copyright patterns in open source licenses.
 *
 * @param {string} licenseContent - The content of the LICENSE file
 * @returns {{year: string, holder: string} | null} - Parsed copyright info or null
 */
function extractCopyrightFromLicense(licenseContent) {
  const COPYRIGHT_PATTERNS = [
    /Copyright\s+(?:\(c\)|©)?\s*(\d{4}(?:\s*[-–,]\s*\d{4})?)\s+(.+)/i,
    /©\s*(\d{4}(?:\s*[-–,]\s*\d{4})?)\s+(.+)/i,
    /Copyright\s+(\d{4}(?:\s*[-–,]\s*\d{4})?)\s+by\s+(.+)/i,
  ];

  const lines = licenseContent.split('\n').slice(0, 5);
  for (const line of lines) {
    for (const pattern of COPYRIGHT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        return {
          year: match[1],
          holder: match[2].trim(),
        };
      }
    }
  }
  return null;
}

/**
 * Special copyright mappings for packages that don't have proper
 * copyright information in their package.json or LICENSE files.
 */
const SPECIAL_COPYRIGHT_MAPPINGS = {
  '@dqbd/tiktoken': {
    copyright: '2022 OpenAI, Shantanu Jain',
    source: 'upstream tiktoken library',
  },
};

/**
 * Get the first publish year of a package from npm registry.
 * Returns the current year if query fails.
 *
 * @param {string} packageName - Name of the npm package
 * @returns {Promise<number>} - First publish year
 */
async function getFirstPublishYear(packageName) {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync(
      'npm',
      ['view', packageName, 'time', '--json'],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
    const timeData = JSON.parse(stdout);
    const firstPublishYear = new Date(timeData.created).getFullYear();
    return firstPublishYear;
  } catch (e) {
    console.warn(
      `Warning: Could not get first publish year for ${packageName}: ${e.message}`,
    );
    return new Date().getFullYear(); // Fallback to current year
  }
}

/**
 * Format the author field from package.json.
 * Handles both string and object formats.
 *
 * @param {string|object|null} author - The author field from package.json
 * @returns {string|null} - Formatted author string or null
 */
function formatAuthor(author) {
  if (!author) return null;

  if (typeof author === 'string') {
    return author.trim();
  }

  if (typeof author === 'object' && author !== null) {
    const parts = [];
    if (author.name) parts.push(author.name);
    if (author.email) parts.push(`<${author.email}>`);
    if (author.url) parts.push(`(${author.url})`);
    return parts.join(' ').trim();
  }

  return null;
}

/**
 * Extract all contributors from maintainers and contributors fields.
 *
 * @param {object} packageJson - Parsed package.json content
 * @returns {string[] | null} - Array of formatted contributors or null
 */
function extractContributors(packageJson) {
  const contributors = [];

  if (packageJson.maintainers) {
    const maintainers = Array.isArray(packageJson.maintainers)
      ? packageJson.maintainers
      : [packageJson.maintainers];
    maintainers.forEach((m) => {
      const formatted = formatAuthor(m);
      if (formatted) contributors.push(formatted);
    });
  }

  if (packageJson.contributors) {
    const contributorsArray = Array.isArray(packageJson.contributors)
      ? packageJson.contributors
      : [packageJson.contributors];
    contributorsArray.forEach((c) => {
      const formatted = formatAuthor(c);
      if (formatted) contributors.push(formatted);
    });
  }

  return contributors.length > 0 ? contributors : null;
}

// Standard license templates
function getStandardLicenseText(
  licenseType,
  packageName,
  customCopyright = null,
) {
  const copyrightNotice =
    customCopyright ||
    `Copyright (c) ${new Date().getFullYear()} ${packageName} contributors`;

  let normalizedLicenseType;
  if (typeof licenseType === 'string') {
    normalizedLicenseType = licenseType;
  } else if (typeof licenseType === 'object' && licenseType !== null) {
    normalizedLicenseType = licenseType.type || String(licenseType);
  } else {
    normalizedLicenseType = String(licenseType);
  }

  switch (normalizedLicenseType.toLowerCase()) {
    case 'mit':
      return `MIT License

${copyrightNotice}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

    case 'apache-2.0':
    case 'apache 2.0':
      return `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`;

    default:
      return `License: ${normalizedLicenseType}`;
  }
}

async function getDependencyLicense(depName, depVersion) {
  let depPackageJsonPath;
  let licenseContent = 'License text not found.';
  let repositoryUrl = 'No repository found';

  try {
    // Prioritize workspace dependencies (packagePath/node_modules) over root node_modules
    const localDepPath = path.join(
      packagePath,
      'node_modules',
      depName,
      'package.json',
    );
    const rootDepPath = path.join(
      projectRoot,
      'node_modules',
      depName,
      'package.json',
    );

    if (await fs.stat(localDepPath).catch(() => false)) {
      depPackageJsonPath = localDepPath;
    } else if (await fs.stat(rootDepPath).catch(() => false)) {
      depPackageJsonPath = rootDepPath;
    } else {
      console.warn(
        `Warning: Could not find package.json for ${depName} in workspace or root node_modules`,
      );
      return {
        name: depName,
        version: depVersion,
        repository: repositoryUrl,
        license: licenseContent,
      };
    }

    const depPackageJsonContent = await fs.readFile(
      depPackageJsonPath,
      'utf-8',
    );
    const depPackageJson = JSON.parse(depPackageJsonContent);

    repositoryUrl = depPackageJson.repository?.url || repositoryUrl;

    const packageDir = path.dirname(depPackageJsonPath);

    const noticeFileCandidates = [
      'NOTICE',
      'NOTICE.txt',
      'NOTICE.md',
      'notice',
      'notice.txt',
    ];

    let noticeFile = null;
    for (const candidate of noticeFileCandidates) {
      const potentialFile = path.join(packageDir, candidate);
      if (await fs.stat(potentialFile).catch(() => false)) {
        noticeFile = potentialFile;
        break;
      }
    }

    const licenseFileCandidates = [
      depPackageJson.licenseFile,
      'LICENSE',
      'LICENSE.md',
      'LICENSE.txt',
      'LICENSE-MIT.txt',
      'license.md',
      'license',
    ].filter(Boolean);

    let licenseFile;
    for (const candidate of licenseFileCandidates) {
      const potentialFile = path.join(packageDir, candidate);
      if (await fs.stat(potentialFile).catch(() => false)) {
        licenseFile = potentialFile;
        break;
      }
    }

    const specialMapping = SPECIAL_COPYRIGHT_MAPPINGS[depName];

    if (licenseFile) {
      try {
        licenseContent = await fs.readFile(licenseFile, 'utf-8');

        const copyrightInfo = extractCopyrightFromLicense(licenseContent);
        if (copyrightInfo) {
          console.log(
            `✓ Extracted copyright from LICENSE file for ${depName}: ${copyrightInfo.year} ${copyrightInfo.holder}`,
          );
        }
      } catch (e) {
        console.warn(
          `Warning: Failed to read license file for ${depName}: ${e.message}`,
        );
      }
    } else {
      const formattedAuthor = formatAuthor(depPackageJson.author);
      const contributors = extractContributors(depPackageJson);

      if (depPackageJson.license) {
        let copyrightNotice;

        if (specialMapping) {
          copyrightNotice = `Copyright (c) ${specialMapping.copyright}`;
          console.log(
            `✓ Using special copyright mapping for ${depName} (from ${specialMapping.source})`,
          );
        } else if (formattedAuthor) {
          const firstPublishYear = await getFirstPublishYear(depName);
          const currentYear = new Date().getFullYear();
          const yearRange =
            firstPublishYear === currentYear
              ? `${currentYear}`
              : `${firstPublishYear}-${currentYear}`;

          copyrightNotice = `Copyright (c) ${yearRange} ${formattedAuthor}`;
          console.log(
            `✓ Using author field for ${depName}: ${formattedAuthor}`,
          );
        } else if (contributors) {
          const firstPublishYear = await getFirstPublishYear(depName);
          const currentYear = new Date().getFullYear();
          const yearRange =
            firstPublishYear === currentYear
              ? `${currentYear}`
              : `${firstPublishYear}-${currentYear}`;

          copyrightNotice = `Copyright (c) ${yearRange} ${contributors.join(', ')}`;
          console.log(
            `✓ Using contributors for ${depName}: ${contributors.join(', ')}`,
          );
        } else {
          const firstPublishYear = await getFirstPublishYear(depName);
          const currentYear = new Date().getFullYear();
          const yearRange =
            firstPublishYear === currentYear
              ? `${currentYear}`
              : `${firstPublishYear}-${currentYear}`;

          copyrightNotice = `Copyright (c) ${yearRange} ${depName} contributors`;
          console.warn(
            `Warning: Using standard license text for ${depName} (no LICENSE file, no author, no contributors)`,
          );
        }

        licenseContent = getStandardLicenseText(
          depPackageJson.license,
          depName,
          copyrightNotice,
        );
      } else {
        console.warn(
          `Warning: Could not find license file or license field for ${depName}`,
        );
      }
    }

    if (noticeFile) {
      try {
        const noticeContent = await fs.readFile(noticeFile, 'utf-8');
        licenseContent = `${licenseContent}\n\n---\n\nNOTICE\n\n${noticeContent}`;
        console.log(`✓ Attached NOTICE file for ${depName}`);
      } catch (e) {
        console.warn(
          `Warning: Failed to read notice file for ${depName}: ${e.message}`,
        );
      }
    }
  } catch (e) {
    console.warn(
      `Warning: Could not find package.json for ${depName}: ${e.message}`,
    );
  }

  return {
    name: depName,
    version: depVersion,
    repository: repositoryUrl,
    license: licenseContent,
  };
}

function collectDependencies(packageName, packageLock, dependenciesMap) {
  if (dependenciesMap.has(packageName)) {
    return;
  }

  const packageInfo = packageLock.packages[`node_modules/${packageName}`];
  if (!packageInfo) {
    console.warn(
      `Warning: Could not find package info for ${packageName} in package-lock.json.`,
    );
    return;
  }

  dependenciesMap.set(packageName, packageInfo.version);

  if (packageInfo.dependencies) {
    for (const depName of Object.keys(packageInfo.dependencies)) {
      collectDependencies(depName, packageLock, dependenciesMap);
    }
  }
}

async function main() {
  try {
    const packageJsonPath = path.join(packagePath, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    const packageLockJsonPath = path.join(projectRoot, 'package-lock.json');
    const packageLockJsonContent = await fs.readFile(
      packageLockJsonPath,
      'utf-8',
    );
    const packageLockJson = JSON.parse(packageLockJsonContent);

    const allDependencies = new Map();
    const directDependencies = Object.keys(packageJson.dependencies);

    for (const depName of directDependencies) {
      collectDependencies(depName, packageLockJson, allDependencies);
    }

    const dependencyEntries = Array.from(allDependencies.entries());

    const licensePromises = dependencyEntries.map(([depName, depVersion]) =>
      getDependencyLicense(depName, depVersion),
    );

    const dependencyLicenses = await Promise.all(licensePromises);

    let noticeText =
      'This file contains third-party software notices and license terms.\n\n';

    for (const dep of dependencyLicenses) {
      noticeText +=
        '============================================================\n';
      noticeText += `${dep.name}@${dep.version}\n`;
      noticeText += `(${dep.repository})\n\n`;
      noticeText += `${dep.license}\n\n`;
    }

    await fs.writeFile(noticeFilePath, noticeText);
    console.log(`NOTICES.txt generated at ${noticeFilePath}`);
  } catch (error) {
    console.error('Error generating NOTICES.txt:', error);
    process.exit(1);
  }
}

main().catch(console.error);

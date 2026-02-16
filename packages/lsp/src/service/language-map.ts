/**
 * @plan:PLAN-20250212-LSP.P04
 * @requirement:REQ-LANG-010
 * @pseudocode:language-map.md lines 01-62
 */

const extensionToLanguageId: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescriptreact'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascriptreact'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.pyi', 'python'],
  ['.pyw', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
  ['.swift', 'swift'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.i', 'c'],
  ['.ii', 'cpp'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.hxx', 'cpp'],
  ['.cs', 'csharp'],
  ['.vb', 'vb'],
  ['.fs', 'fsharp'],
  ['.fsx', 'fsharp'],
  ['.php', 'php'],
  ['.rb', 'ruby'],
  ['.rake', 'ruby'],
  ['.gemspec', 'ruby'],
  ['.pl', 'perl'],
  ['.pm', 'perl'],
  ['.lua', 'lua'],
  ['.sh', 'shellscript'],
  ['.bash', 'shellscript'],
  ['.zsh', 'shellscript'],
  ['.fish', 'fish'],
  ['.ps1', 'powershell'],
  ['.psm1', 'powershell'],
  ['.psd1', 'powershell'],
  ['.r', 'r'],
  ['.R', 'r'],
  ['.scala', 'scala'],
  ['.sc', 'scala'],
  ['.clj', 'clojure'],
  ['.cljs', 'clojure'],
  ['.cljc', 'clojure'],
  ['.groovy', 'groovy'],
  ['.gvy', 'groovy'],
  ['.gradle', 'groovy'],
  ['.sql', 'sql'],
  ['.json', 'json'],
  ['.jsonc', 'jsonc'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.xml', 'xml'],
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.css', 'css'],
  ['.scss', 'scss'],
  ['.less', 'less'],
  ['.md', 'markdown'],
  ['.mdx', 'mdx'],
  ['.toml', 'toml'],
  ['.ini', 'ini'],
  ['.cfg', 'ini'],
  ['.conf', 'ini'],
  ['.proto', 'proto3'],
  ['.dart', 'dart'],
  ['.ex', 'elixir'],
  ['.exs', 'elixir'],
  ['.erl', 'erlang'],
  ['.hrl', 'erlang'],
  ['.zig', 'zig'],
  ['.nim', 'nim'],
  ['.sol', 'solidity'],
  ['.vue', 'vue'],
  ['.svelte', 'svelte'],
  ['.dockerfile', 'dockerfile'],
  ['dockerfile', 'dockerfile'],
  ['makefile', 'makefile'],
]);

const languageIdToExtensions: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>(
  (() => {
    const grouped = new Map<string, string[]>();
    for (const [extension, languageId] of extensionToLanguageId.entries()) {
      const extensions = grouped.get(languageId);
      if (extensions) {
        extensions.push(extension);
      } else {
        grouped.set(languageId, [extension]);
      }
    }

    return Array.from(grouped.entries()).map(
      ([languageId, extensions]) =>
        [languageId, Object.freeze([...extensions])] as const,
    );
  })(),
);

export function getLanguageId(extension: string): string | undefined {
  if (!extension) {
    return undefined;
  }

  const normalized = extension.toLowerCase();
  if (normalized.startsWith('.')) {
    return extensionToLanguageId.get(normalized);
  }

  return (
    extensionToLanguageId.get(`.${normalized}`) ??
    extensionToLanguageId.get(normalized)
  );
}

export function getExtensionsForLanguage(
  languageId: string,
): readonly string[] {
  return languageIdToExtensions.get(languageId) ?? [];
}

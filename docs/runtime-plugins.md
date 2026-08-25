# Runtime plugins

A runtime plugin is an npm package that contributes provider factories to
LLxprt Code at startup. Provider aliases can then name the contributed provider
as their `baseProvider`, exactly as they name a built-in one.

## Runtime plugins are trusted, unsandboxed code

Loading a runtime plugin imports and executes the package in the LLxprt process.
There is no sandbox, no permission prompt, and no capability restriction. A
plugin can read your files, read your credentials, and make network requests
with the same authority as the CLI itself.

Treat a runtime plugin the way you would treat a shell profile script: install
one only if you would run its author's code on your machine without asking.

Two consequences follow from that trust model:

- `runtimePlugins` may only be set in user (global) or system settings. A value
  in a project's `.llxprt/settings.json` is rejected and startup fails. Opening
  a repository must never be enough to make LLxprt execute that repository's
  code.
- Only bare package roots are accepted. Paths, URLs, subpaths, and Node built-in
  module names are rejected, so the value cannot point at an arbitrary file.

## Configuring plugins

Add `runtimePlugins` to your user settings file (`~/.llxprt/settings.json`) or
to the system settings file:

```json
{
  "runtimePlugins": ["my-llxprt-provider", "@acme/llxprt-gateway"]
}
```

Plugins load once, at startup, in the order listed. The setting requires a
restart to take effect; there is no reload.

When several trusted layers set `runtimePlugins`, the entries are concatenated
in a fixed order: system defaults, then system, then user.

### Accepted and rejected values

| Value                   | Result                               |
| ----------------------- | ------------------------------------ |
| `my-plugin`             | accepted                             |
| `@scope/my-plugin`      | accepted                             |
| `""` or `"   "`         | rejected, empty                      |
| `fs`, `node:fs`         | rejected, Node built-in module       |
| `https://example.com/p` | rejected, URL                        |
| `./p`, `/abs/p`, `~/p`  | rejected, filesystem path            |
| `pkg/sub`               | rejected, package subpath            |
| `Upper`, `_leading`     | rejected, malformed npm package name |

## Writing a plugin

A plugin package exports a named binding called `llxprtRuntimePlugin`. There is
no default export and no alternative export name.

```ts
import type {
  ProviderAliasEntry,
  ProviderFactoryContext,
  RuntimePluginManifest,
} from '@vybestack/llxprt-code-providers/composition.js';

export const llxprtRuntimePlugin: RuntimePluginManifest = {
  apiVersion: 1,
  id: 'acme-gateway',
  providers: [
    {
      providerId: 'acme',
      createProvider(
        entry: ProviderAliasEntry,
        context: ProviderFactoryContext,
      ) {
        return new AcmeProvider(entry.alias, entry.config['base-url']);
      },
      builtinAliases: [
        {
          alias: 'acme-fast',
          config: {
            baseProvider: 'acme',
            'base-url': 'https://api.acme.example/v1',
          },
        },
      ],
    },
  ],
};
```

### Manifest v1

| Field        | Required | Meaning                                                 |
| ------------ | -------- | ------------------------------------------------------- |
| `apiVersion` | yes      | Must be `1`. Any other value is an incompatible plugin. |
| `id`         | yes      | Non-empty, unique across the configured plugins.        |
| `providers`  | yes      | At least one provider contribution.                     |

Each provider contribution:

| Field            | Required | Meaning                                                |
| ---------------- | -------- | ------------------------------------------------------ |
| `providerId`     | yes      | The base provider id an alias names. Case-insensitive. |
| `createProvider` | yes      | Factory called once per alias entry.                   |
| `builtinAliases` | no       | Alias configurations the plugin ships with.            |

The manifest is validated with a strict schema: unknown fields are an error, not
a warning. The validated manifest is deep-frozen before use.

### The factory contract

`createProvider(entry, context)` receives the resolved alias entry and a context
carrying the shared OpenAI credentials and base URL, the OpenAI provider config,
the OAuth manager, the `Config` when one exists, and the auth-only flag. Return
the provider instance, or `null` when the entry cannot produce one.

The plugin module itself is imported once per process. A factory runs whenever
alias providers are constructed, which includes alias refreshes, so it may be
called more than once for the same alias.

### Alias precedence

Aliases from your own alias files always win. A `builtinAliases` entry whose
name matches a user or built-in alias file is not registered; the file's
definition is used instead. Two plugins contributing the same alias name is an
error.

## Failure modes

Startup fails, with an error naming the offending package, when:

- the package cannot be imported;
- the package does not export `llxprtRuntimePlugin`;
- the manifest fails validation;
- `apiVersion` is not `1`;
- two configured plugins declare the same `id`;
- two contributions declare the same `providerId`, or a contribution reuses a
  built-in provider id;
- two plugins contribute the same alias name;
- an alias names a `baseProvider` that no built-in provider and no loaded plugin
  contributes.

Nothing is skipped with a warning. A misconfigured plugin stops the CLI so the
problem is visible rather than silently changing which providers exist.

## Non-goals

Runtime plugins contribute providers and nothing else. They do not contribute
tools, commands, agents, or MCP servers, they are not discovered by scanning,
and they are not reloaded while the CLI runs. For packaging and distributing
broader functionality, see [Extensions](./extension.md).

# Runtime plugins

A runtime plugin is an npm package that contributes provider factories to
LLxprt. Installing the package is what makes the provider available. There is
no setting to edit and no list of approved packages.

```bash
npm i -g llxprt-kookoo-provider     # or: bun add -g llxprt-kookoo-provider
```

Start LLxprt and the provider is there. Uninstall the package and it is gone,
along with any aliases it contributed. Nothing else changes.

## Security

**Runtime plugins are trusted, unsandboxed executable code.** A plugin runs in
the LLxprt process with the full privileges of the user who started it. It can
read and write any file that user can, open network connections, and read
credentials. There is no permission prompt and no isolation boundary.

Install a plugin only if you would run its author's code directly, because that
is what you are doing. Discovery is limited to packages installed alongside
LLxprt itself, so a project cannot introduce a plugin into your session by
committing a file.

## Declaring a plugin

A package opts in by setting a marker in its own `package.json`:

```json
{
  "name": "llxprt-kookoo-provider",
  "llxprt": { "runtimePlugin": true }
}
```

The marker is an explicit declaration rather than a naming convention, so a
package is never picked up by accident and a plugin can be named anything.
Packages without the marker are ignored.

Discovery reads directory entries and manifests only. No package code runs
until a declared plugin is loaded.

## The manifest

A plugin exports a named `llxprtRuntimePlugin` binding. There is no default
export and no alternative name.

```ts
export const llxprtRuntimePlugin = {
  apiVersion: 1,
  id: 'kookoo',
  providers: [
    {
      providerId: 'kookoo',
      createProvider: (entry, context) => new KookooProvider(entry, context),
      builtinAliases: [
        { alias: 'kookoo-fast', config: { baseProvider: 'kookoo' } },
      ],
    },
  ],
};
```

| Field                        | Meaning                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `apiVersion`                 | Must be `1`. Any other value is an incompatible-plugin error.                              |
| `id`                         | Unique plugin id. Two plugins sharing an id is an error.                                   |
| `providers[].providerId`     | The base provider id aliases refer to. Must not collide with a built-in or another plugin. |
| `providers[].createProvider` | Factory returning an `IProvider`, or `null` when it cannot build one.                      |
| `providers[].builtinAliases` | Optional aliases the plugin ships.                                                         |

The manifest is validated with Zod and deep-frozen. Unknown keys are rejected.

`createProvider` receives the resolved alias entry and a context carrying the
OpenAI-family credentials, the provider config, the OAuth manager, the `Config`,
and the auth-only flag. It must return an `IProvider`, which is LLxprt's neutral
provider interface. Plugins do not see provider-specific SDK types and must not
return them.

## Load order and precedence

Discovered packages load in alphabetical order, so contributed-alias order is
deterministic across machines.

An alias defined in your own alias config file wins over a contributed alias of
the same name. Your local configuration is the higher-authority layer.

## Failures

Loading fails the startup rather than skipping the plugin, so a broken plugin is
never silently absent:

- the package cannot be imported
- it does not export `llxprtRuntimePlugin`
- the manifest is malformed or declares an unsupported `apiVersion`
- two plugins declare the same plugin id, provider id, or alias name
- a plugin declares a provider id that shadows a built-in
- an alias names a base provider that no built-in and no loaded plugin provides

Each error names the package and what to fix.

A neighbouring package with an unreadable `package.json` is ignored rather than
fatal. It never claimed to be a plugin, and a plugin must declare the marker to
be one.

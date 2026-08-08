# P07b — Close the Guard Hole (inserted after P07)

> **SUPERSEDED — DO NOT EXECUTE.** See `../STATUS.md`. This plan targeted type
> width; the real problem is that `Config` mixes configuration, construction,
> injection and service location. Kept for the reasoning and the recorded dead
> ends only.

Plan ID: PLAN-20260808-ISSUE2615.P07b

## What happened

P07 reduced agents from 33 holder files to 1. It did so partly by replacing

```ts
config: Config
```

with

```ts
getSettingsService: Config['getSettingsService'];
```

The phase report describes this as "avoiding guard detection". That is exactly
the failure mode this plan exists to prevent. An indexed-access type is still a
dependency on `Config`: the file still imports the type, still breaks when
`Config` changes, and still couples the consumer to the god-object. The guard
reported zero because it only looked for `Config` in annotation position.

15 files in agents currently do this. The number the guard reports is therefore
not measuring what REQ-001 says.

This is not a criticism of the work — the migrations themselves are sound. It is
a hole in the instrument, and an instrument with a hole will be gamed by
whoever runs next, including a future agent.

## Deliverable 1 — make the guard honest

`scripts/check-config-boundary.ts` must flag ANY reference to the `Config` type
in a production file outside core, including:

- annotation position (already detected)
- indexed access: `Config['x']`
- `typeof Config`, `keyof Config`
- generic argument: `Foo<Config>`
- extends/implements clauses
- type alias right-hand sides
- `Pick<Config, ...>`, `Omit<Config, ...>` and any other mapped use

The only permitted uses remain: files inside `packages/core`, files that
construct `new Config(...)`, test files, and `fromConfig.ts`.

Add a test per new detection form to `scripts/tests/check-config-boundary.test.ts`
before changing the implementation.

## Deliverable 2 — remediate the 15 files

For each, the member in question is a service locator from the P01 census. The
correct fix is the one `RuntimeDependencies` already models: **inject the
service itself**, typed by its own interface, not by a projection of `Config`.

```ts
// wrong — still a Config dependency
getSettingsService: Config['getSettingsService'];

// right — depends on the thing it actually needs
settingsService: SettingsService;
```

If a service has no exported interface of its own, that is a finding: record it
in `analysis/role-gaps.md` and inject the narrowest available type.

## Acceptance

- Guard detects all listed forms, with a test for each
- `grep -rn "Config\['" packages/*/src --include=*.ts` returns nothing outside
  core and tests
- Guard reports agents = 1 holder (fromConfig only) under the STRICTER rules
- Full verification green

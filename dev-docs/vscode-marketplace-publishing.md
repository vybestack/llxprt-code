# VS Code Marketplace Publishing

The release workflow publishes the `llxprt-code-vscode-ide-companion` extension
to the VS Code Marketplace using **Microsoft Entra ID** authentication via
**GitHub OIDC workload identity federation**. No long-lived token is stored.

This replaced a `VSCE_PAT` secret. Azure DevOps retires global Personal Access
Tokens on **2026-12-01**, after which PAT-based publishing stops working.

## How it works

```
GitHub Actions job          Entra ID                Azure DevOps / Marketplace
(environment:               (app registration       (publisher "vybestack")
 production-release)         + federated cred)
        |                          |                          |
        |--- OIDC id-token ------->|                          |
        |<-- Entra access token ---|                          |
        |------------------- vsce publish --azure-credential ->|
```

The `release` job already declares `id-token: write` and runs in the
`production-release` environment. The federated credential's subject must match
that pairing exactly.

## Current configuration

| Item                        | Value                                                       |
| --------------------------- | ----------------------------------------------------------- |
| Tenant ID                   | `dd0ef799-4aca-463c-b8d9-dacc48af7c72` (Default Directory)  |
| App registration            | `llxprt-code-vscode-marketplace-publish`                    |
| Client ID                   | `3d5bb8ad-9cd5-4e9f-bd3c-375878afc44c`                      |
| Service principal object ID | `6793600c-51b7-4abc-b6cf-bd7260c7997a`                      |
| Azure DevOps identity ID    | `3e18c1fb-5738-60ca-ac6f-1294cab9fd10`                      |
| Federated subject           | `repo:vybestack/llxprt-code:environment:production-release` |
| Publisher                   | `vybestack` (Owner: acoliver@gmail.com)                     |
| Marketplace role            | Creator                                                     |

GitHub environment secrets on `production-release`: `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`. Neither is sensitive in the usual sense — they are
identifiers, not credentials — but they are stored as secrets by convention.

No Azure subscription is required. Publishing is not an ARM operation, which is
why the login step passes `allow-no-subscriptions: true`.

## What the environment scoping does and does not guarantee

The federated credential subject names the `production-release` environment, so
only a job that declares that environment can exchange a GitHub OIDC token for
an Entra token.

That is weaker than it first appears. The `production-release` environment
currently has no protection rules and no deployment branch policy, so **any
branch** can declare it. GitHub evaluates environment access when the job
starts, and `release.yml` checks out `github.sha` rather than a release branch,
so the `release/*` branches the workflow creates mid-run are irrelevant here —
they are an output of the job, not the ref it launched from. In practice every
scheduled release runs from `main`, but manual dispatch accepts a `ref` input
and has been used from feature branches.

Mitigating factors: environment secrets are unavailable to fork pull requests,
and only collaborators with push access can dispatch workflows. The previous
`VSCE_PAT` secret sat behind exactly the same (absent) protections, so this is
not a regression introduced by OIDC.

To tighten it, restrict the environment to `main` via a deployment branch
policy. Note this would block releasing from a feature branch, which the
workflow's `ref` input otherwise permits.

## Reproducing the setup from scratch

```bash
az login --allow-no-subscriptions

az ad app create \
  --display-name "llxprt-code-vscode-marketplace-publish" \
  --sign-in-audience AzureADMyOrg

az ad sp create --id <APP_ID>

cat > fedcred.json <<'EOF'
{
  "name": "github-llxprt-code-production-release",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:vybestack/llxprt-code:environment:production-release",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
az ad app federated-credential create --id <APP_ID> --parameters @fedcred.json

gh secret set AZURE_CLIENT_ID -R vybestack/llxprt-code \
  --env production-release --body "<APP_ID>"
gh secret set AZURE_TENANT_ID -R vybestack/llxprt-code \
  --env production-release --body "<TENANT_ID>"
```

### Granting Marketplace access (manual)

The service principal must be a member of the publisher. The Members form wants
the **Azure DevOps identity ID**, which is not the client ID or object ID. Get
it by calling the profile API _as the service principal_ — easiest from a
throwaway CI job that logs in via the federated credential:

```bash
az rest \
  --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
  --resource 499b84ac-1321-427f-aa17-267ca6975798
```

`499b84ac-1321-427f-aa17-267ca6975798` is the well-known Azure DevOps resource
ID; the token must be scoped to it.

Then, signed in as the publisher Owner, go to
<https://marketplace.visualstudio.com/manage/publishers/vybestack> →
**Members** → **Add**, paste the identity ID, and assign **Creator**.

This step cannot be automated. The role-assignment REST endpoint returns
HTTP 403 (`VssServiceException`) for Entra bearer tokens even when the caller is
the publisher Owner; it is browser-session only.

## Verifying without publishing

```bash
vsce verify-pat vybestack --azure-credential
```

Checks publish rights and writes nothing. Run it from CI, not locally —
locally it authenticates as your user account rather than the service principal,
which is not a meaningful test of the CI path.

## Troubleshooting

| Symptom                                                             | Cause                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `AADSTS70021: No matching federated identity record found`          | Workflow's repo/environment does not match the federated credential subject |
| `Error: Could not get OIDC token`                                   | Job is missing `permissions: id-token: write`                               |
| `Access Denied: <guid> needs ... permission on resource /vybestack` | Identity is not a publisher member, or lacks the Creator role               |
| `--azure-credential is not a valid option`                          | `@vscode/vsce` older than 2.26.1                                            |
| `AADSTS5000225`                                                     | App registration inactive; sign in once to reactivate                       |

## Notes

- `azure/login` is pinned to a commit SHA. Its release tags are _annotated_, so
  the tag object SHA is not the commit SHA — dereference before pinning.
- Nightly releases skip Marketplace publishing entirely; see
  `should_publish_vscode` in `release.yml`.
- Manual dispatch supports `publish_vscode_only` to exercise this path without
  cutting a full release. A dry run skips publishing, so validating the
  credential path requires `dry_run: false`.

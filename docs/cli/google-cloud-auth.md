# Google Cloud Authentication

Most users should use OAuth (`/auth gemini enable`) or a Gemini API key (`/key save gemini <key>`). This page covers advanced Google Cloud authentication methods for enterprise and Workspace users.

## When You Need This

You need Google Cloud authentication if:

- You have a Google Workspace account (managed by an employer or school)
- You received a Gemini Code Assist license through the [Google Developer Program](https://developers.google.com/program/plans-and-pricing)
- You have a Gemini Code Assist standard or enterprise subscription
- You're using LLxprt Code outside [supported regions](https://developers.google.com/gemini-code-assist/resources/available-locations) for free individual usage
- You're under 18 with a Google account

## Google Cloud Project ID

If you fall into one of the categories above, you need to configure a Google Cloud Project ID. First, [enable the Gemini for Cloud API](https://cloud.google.com/gemini/docs/discover/set-up-gemini#enable-api) and [configure access permissions](https://cloud.google.com/gemini/docs/discover/set-up-gemini#grant-iam).

Then set the project ID:

```bash
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
```

For persistent use, add this to your shell config (`~/.bashrc`, `~/.zshrc`).

## Vertex AI

### API Key

Get an API key from [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys?usertype=newuser), then:

```bash
export GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"
```

> If you see "API keys are not supported by this API," your organization may restrict API key creation. Use [Application Default Credentials](#application-default-credentials) instead.

### Application Default Credentials (ADC)

> Unset any existing `GOOGLE_API_KEY` or `GEMINI_API_KEY` first — they take precedence over ADC.

**For local development** with `gcloud`:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
export GOOGLE_CLOUD_LOCATION="us-central1"
```

**With a service account** (for non-interactive environments):

1. [Create a service account](https://cloud.google.com/iam/docs/keys-create-delete) with the "Vertex AI User" role
2. Download the JSON key file
3. Set the path:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/keyfile.json"
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
export GOOGLE_CLOUD_LOCATION="us-central1"
```

## Cloud Shell

When running in Google Cloud Shell, authentication uses the logged-in user's credentials automatically. No configuration needed — this is the default when no other method is configured.

## Related

- [Authentication](./authentication.md) — Main authentication guide
- [OAuth Setup](../oauth-setup.md) — OAuth flows for all providers

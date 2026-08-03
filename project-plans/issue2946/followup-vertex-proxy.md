Split out from #2946. That issue stopped mounting `~/.config/gcloud` and the `GOOGLE_APPLICATION_CREDENTIALS` file into the container sandbox, on the issue author's explicit acceptance that gcloud/ADC material simply would not be available inside the container for now.

## Consequence

Vertex AI requests from inside a container sandbox no longer authenticate. `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `GOOGLE_GENAI_USE_VERTEXAI` are still forwarded (they are non-secret configuration), so `hasVertexAICredentials()` can still select `vertex-ai` mode inside the container — but the ADC material it would need is deliberately no longer there, so the request fails at call time.

An API key saved on the host with `/key save` and referenced by `auth-key-name` does resolve through the credential proxy inside the container, but `GeminiProvider.determineBestAuth()` classifies every resolver-supplied token as `gemini-api-key`, and `buildGoogleGenAIOptions()` sets `vertexai: true` only for the `vertex-ai` auth mode. So a proxy-resolved named key authenticates against the Gemini Developer API, not Vertex. `packages/providers/src/gemini/GeminiProvider.auth.test.ts` asserts this current behavior directly.

## Options

1. Mediate ADC through the credential proxy: add a host-side token exchange (`google-auth-library`) served as a new proxy op, so the container receives short-lived Google access tokens instead of the service-account file. This is the design-consistent answer and matches how OAuth already works.
2. Support Vertex-with-API-key: add an explicit auth mode that pairs a proxy-resolved named key with `vertexai: true` when the Vertex configuration variables are present.

Option 1 is the more general fix; option 2 is narrower but only covers deployments where a Vertex API key is viable.

## Acceptance criteria

- Vertex AI requests authenticate from inside a container sandbox without any gcloud directory or ADC file crossing the boundary.
- Whatever credential the container receives is short-lived, or is a named key fetched through the proxy — never a raw service-account file.
- Host behavior is unchanged.
- Behavioral coverage proves the end-to-end path, including that the resulting client is configured for Vertex rather than the Gemini Developer API.
- `docs/sandbox.md` is updated; it currently states plainly that Vertex/ADC does not work inside a container.

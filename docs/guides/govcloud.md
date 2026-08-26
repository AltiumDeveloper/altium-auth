# GovCloud considerations

Altium GovCloud is an isolated environment for ITAR/regulated workspaces. The authentication flows are the same as the [web](./web-and-server-apps.md) and [desktop](./desktop-apps.md) guides, with the differences outlined below. Contact Altium for GovCloud onboarding.

## Separate issuer

GovCloud uses its own issuer and endpoints under `auth.365-gov.altium.com` (distinct from Commercial `auth.altium.com`). A token's issuer (`iss`) determines whether it is a Commercial or a Gov token. **Commercial and Gov are kept strictly separate:** a Gov token must never be used against Commercial services, and a Commercial token must never be used against GovCloud.

**Gov hosts for authorize/token only.** Only `/connect/authorize` and `/connect/token` move to the gov host. The ActionWait poll service (`/await`) has no gov-specific DNS:

| Environment | Authorize / token | ActionWait poll |
| --- | --- | --- |
| Prod Gov | `auth.365-gov.altium.com` | `actionwait.altium.com/await` |

## The two-token model

Because a single self-contained JWT can be replayed wherever it travels, GovCloud restores a hard boundary using **two tokens**:

- A **global token** — used for requests to global services (for example, user profile or workspace info).
- A **secure token** — carries a `secure=1` attribute and is bound to GovCloud. Only GovCloud authorizes with it; Commercial workspaces reject it.

This guarantees a GovCloud (`secure=1`) token cannot be accepted by Commercial services.

## Identifying GovCloud workspaces

When you discover workspaces (`desWorkspaceInfos`), a GovCloud workspace reports `location.name = "US GovCloud"`. Use that to decide which `/token` endpoint to exchange on. Checking `location.name` is the current recommended way to tell Gov workspaces apart.

## Exchanging tokens for GovCloud workspaces

Following the [recommended flow](./overview.md#the-authentication-journey), you sign in once on Commercial `auth.altium.com` and then exchange the global token per workspace.

- **Commercial workspace**: exchange your Commercial global token at `auth.altium.com/connect/token` **without** `secure=1` to get a Commercial workspace token (`iss = auth.altium.com`). Requesting a Gov workspace here returns `access_denied`.
- **GovCloud workspace**: exchange your Commercial global token at `auth.365-gov.altium.com/connect/token` **with** `secure=1` to get a GovCloud workspace token (`iss = auth.365-gov.altium.com`). Requesting a Commercial workspace here returns `access_denied`.

Refresh each workspace token at the endpoint that issued it (a Gov workspace token refreshes on `auth.365-gov.altium.com` with `secure=1`).

**Rule of thumb:** send `secure=1` on token requests to the **Gov** `/token` endpoint and omit it on the **Commercial** `/token` endpoint — regardless of which side issued the token you present. `secure=1` is a token-endpoint parameter; it is not sent on `/authorize`.

## What this means for your application

Hold the **Commercial global token** from sign-in for global services, and use each **Gov workspace token** only for that workspace's GovCloud API calls. Never send a Gov token to global (Commercial) services, and never send a Commercial token to GovCloud.

## Related

- [Authentication overview](./overview.md)
- [Access token claims](./token-claims.md) (the `secure` claim)
- [Web and server application flow](./web-and-server-apps.md)
- [Desktop application flow](./desktop-apps.md)

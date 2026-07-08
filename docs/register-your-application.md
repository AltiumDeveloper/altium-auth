# Register your application

Application registration is currently a guided process handled together with Altium — there is no self-service registration portal. [Contact Altium](https://www.altium.com/contact) to register your application.

## What you provide

- **Client name and description** — shown to users on the consent screen.
- **Client type** — *confidential* (web/server apps that can keep a secret) or *public* (desktop, on-prem, native, or SPA apps that cannot). This determines whether you receive a client secret.
- **Redirect URL(s)** — the callback URL(s) where users return after sign-in, for example `https://your-app.example.com/oauth/callback`. Web and server apps register their own redirect URL. Desktop and on-prem apps do not host one — they use the [ActionWait pattern](./desktop-and-onprem-apps.md) with the fixed Altium-hosted redirect (`https://auth.altium.com/api/AuthComplete`).
- **Requested scopes** — the scopes your application needs (see [OAuth Scopes](https://www.altium.com/documentation/altium-developer-center/altium-365/key-concepts/oauth-scopes)).
- **Optional** — a client URL and logo image URL, shown on the consent screen.

## What you receive

- **Client ID** — public identifier for your application.
- **Client secret** — *confidential clients only* — a credential used to authenticate your application at the token endpoint. Public clients (desktop/on-prem/native/SPA) are registered **without** a secret and authenticate with PKCE instead.

> Keep your **client secret** confidential. Store and transmit it securely; never embed it in a public client or front-end code. If your app cannot guarantee this (a desktop, on-prem, native, or single-page app), register it as a **public client** and use PKCE — do not ship a secret.

## Next

- [Authenticate a web or server application](./web-and-server-apps.md)
- [Authenticate a desktop or on-prem application](./desktop-and-onprem-apps.md)

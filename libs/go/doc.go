// Package altiumauth is the Altium 365 OAuth2 / OpenID Connect authentication
// library for Go.
//
// It supports both client types, and Commercial Cloud, GovCloud, and AES
// (on-prem) deployments:
//
//   - Public clients (desktop, CLI, native) sign in through the browser with
//     PKCE over Altium's ActionWait long poll: [Config.SignIn].
//   - Confidential clients (web/server backends with a secret) use the standard
//     authorization-code redirect flow: [Config.CreateAuthorizationURL] followed
//     by [Config.ExchangeCode].
//   - Workspace tokens ([Config.SignIntoWorkspace]), refresh
//     ([Config.RefreshToken]), revocation ([Config.RevokeRefreshToken]), and
//     scope introspection ([GetClientScopes]).
//
// Only [Config.ClientID] and [Config.Scopes] are required; the endpoints default
// to [CommercialCloudEndpoints]. Use [GovCloudEndpoints] for GovCloud — the
// library detects the Gov token endpoint and sends secure=1 automatically — or
// [AESEndpoints] for an AES installation.
//
// Storage is the caller's concern: the functions return a [TokenSet] and never
// persist it. The package has no dependencies outside the standard library.
//
// The behavior is specified by the language-neutral spec at
// https://github.com/AltiumDeveloper/altium-auth/blob/main/spec/SPEC.md and
// verified by the shared conformance vectors.
package altiumauth

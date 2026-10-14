# Changelog

## Unreleased

Initial release. Implements the Altium 365 auth spec (`spec/SPEC.md`, contract 0.2.0)
at parity with the TypeScript, .NET, and Python libraries; passes the shared
conformance vectors. Standard library only — no dependencies.

- ActionWait sign-in for public clients (`Config.SignIn`), the authorization-code
  redirect flow for confidential clients (`CreateAuthorizationURL` + `ExchangeCode`),
  workspace token exchange, refresh, revocation, and ClientScopes introspection.
- Commercial Cloud, GovCloud (automatic `secure=1`), and AES (`AESEndpoints`).
- Typed errors: `*TokenError` (OAuth `error` code from the token endpoint),
  `*AuthorizationError` (OAuth error delivered via ActionWait), and the
  `ErrSignInCancelled` / `ErrStateMismatch` sentinels.
- `tools/signintest`, the live E2E harness, with the same CLI as the other libraries.
- Every request sends `User-Agent: altium-auth-go/<version>` (exported as `UserAgent`).

/**
 * OAuth2 configuration for the PKCE sign-in flow.
 *
 * Only `clientId` and `scopes` are required. The four endpoints default to
 * Altium's Commercial Cloud values (see `COMMERCIAL_CLOUD_ENDPOINTS`) and only
 * need to be set for Dev/UAT, GovCloud, or AES (on-prem) installations — for
 * AES, use `createAesEndpoints()` to derive them from your server's origin.
 * Any endpoint that is provided must be a valid URL.
 */
export interface OAuthConfig {
  /** OAuth2 client ID registered with the Altium identity provider. */
  clientId: string;

  /** Space-delimited OAuth2 scopes to request (must include "openid profile"). */
  scopes: string;

  /**
   * Client secret, for **confidential clients** (e.g. backend/server apps). When
   * set, token-endpoint requests authenticate with an HTTP Basic header. Omit it
   * for **public clients** (desktop/native/SPA), which rely on PKCE. Never embed
   * a secret in a public client.
   */
  clientSecret?: string;

  /**
   * Override automatic GovCloud detection. By default the library sends
   * `secure=1` on token requests when the token endpoint is a Gov host (e.g.
   * `auth.365-gov.altium.com`) and omits it on Commercial hosts — so you
   * normally leave this unset. Provide it only to force behavior for a
   * non-standard host: `true` always sends `secure=1`, `false` never does.
   */
  secure?: boolean;

  /**
   * Authorization endpoint URL.
   * @default COMMERCIAL_CLOUD_ENDPOINTS.authEndpoint
   */
  authEndpoint?: string;

  /**
   * Token exchange endpoint URL.
   * @default COMMERCIAL_CLOUD_ENDPOINTS.tokenEndpoint
   */
  tokenEndpoint?: string;

  /**
   * Altium ActionWait long-poll endpoint for receiving the authorization code.
   * @default COMMERCIAL_CLOUD_ENDPOINTS.actionWaitEndpoint
   */
  actionWaitEndpoint?: string;

  /**
   * Client scope introspection endpoint URL.
   */
  scopeEndpoint?: string;

  /**
   * Fixed redirect URI registered with the auth client.
   * @default COMMERCIAL_CLOUD_ENDPOINTS.redirectUri
   */
  redirectUri?: string;
}

/**
 * OAuth2 token response shape, as returned by the token endpoint.
 * Matches the standard RFC 6749 / OIDC ID Token conventions.
 */
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  /** Epoch seconds at which the access token expires (computed by the library). */
  expires_at?: number;
  scope?: string;
}

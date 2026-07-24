/**
 * @altium-developer/a365-auth — Altium 365 OAuth2 authentication library.
 *
 * Provides browser-based PKCE sign-in with ActionWait long-polling and
 * workspace-scoped token exchange. Storage is the caller's concern — the
 * functions return tokens; you persist them however you like. Zero runtime
 * dependencies.
 */

export {
  signIn,
  signIntoWorkspace,
  refreshToken,
  revokeRefreshToken,
  createAuthorizationUrl,
  exchangeCode,
  COMMERCIAL_CLOUD_ENDPOINTS,
  GOV_CLOUD_ENDPOINTS,
  createAesEndpoints,
  getClientScopes,
} from "./auth";
export type {
  SignInOptions,
  AuthorizationUrlOptions,
  AuthorizationRequest,
  ExchangeCodeParams,
} from "./auth";
export type { OAuthConfig, TokenSet } from "./types";

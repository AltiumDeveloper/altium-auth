namespace Altium.Auth;

/// <summary>
/// Altium 365 authentication client — OAuth2/OIDC + PKCE, the ActionWait desktop flow,
/// workspace token-exchange, refresh, and revocation. See <see cref="AltiumAuthClient"/>.
/// </summary>
public interface IAltiumAuthClient
{
    /// <summary>Build an authorization URL with PKCE for the redirect-based flow. Synchronous.</summary>
    AuthorizationRequest CreateAuthorizationUrl(string? redirectUri = null, string? state = null, string? codeVerifier = null, WorkspaceSelection selectWorkspace = WorkspaceSelection.None);

    /// <summary>Exchange an authorization code for tokens (OAuth2 <c>authorization_code</c> grant).</summary>
    Task<TokenSet> ExchangeCodeAsync(string code, string? codeVerifier = null, string? redirectUri = null, CancellationToken ct = default);

    /// <summary>Exchange a base access token for a workspace-scoped token (RFC 8693).</summary>
    Task<TokenSet> SignIntoWorkspaceAsync(string baseAccessToken, string workspaceAuthId, CancellationToken ct = default);

    /// <summary>Refresh an access token (OAuth2 <c>refresh_token</c> grant; retains the original scope).</summary>
    Task<TokenSet> RefreshTokenAsync(string refreshToken, CancellationToken ct = default);

    /// <summary>Public-client PKCE sign-in via the ActionWait long-poll (invokes <c>OpenBrowser</c>).</summary>
    Task<TokenSet> SignInAsync(CancellationToken ct = default);

    /// <summary>Public-client PKCE sign-in via the ActionWait long-poll (invokes <c>OpenBrowser</c>).</summary>
    Task<TokenSet> SignInAsync(WorkspaceSelection selectWorkspace, CancellationToken ct = default);

    /// <summary>Revoke a refresh token (RFC 7009); idempotent.</summary>
    Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct = default);
}

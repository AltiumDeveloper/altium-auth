namespace Altium.Auth;

/// <summary>
/// Configuration for the Altium 365 auth client. Only <see cref="ClientId"/> and
/// <see cref="Scopes"/> are required; endpoints default to the Commercial Cloud.
/// </summary>
public sealed class AltiumAuthOptions
{
    /// <summary>OAuth2 client id registered with Altium Identity.</summary>
    public required string ClientId { get; init; }

    /// <summary>Space-delimited scopes (must include "openid profile").</summary>
    public required string Scopes { get; init; }

    /// <summary>Confidential clients only → HTTP Basic. Omit for public clients (PKCE).</summary>
    public string? ClientSecret { get; init; }

    /// <summary>Endpoints for the target environment (default: Commercial Cloud).</summary>
    public AltiumEndpoints Endpoints { get; init; } = AltiumEndpoints.CommercialCloud;

    /// <summary>
    /// Override Gov-Cloud auto-detection. Null (default) = derive from the token
    /// endpoint host (a "gov" label ⇒ send secure=1). See SPEC §5.4 / §6.
    /// </summary>
    public bool? Secure { get; init; }

    /// <summary>Invoked by <c>SignInAsync</c> to open the authorize URL. No-op if null.</summary>
    public Action<string>? OpenBrowser { get; init; }

    /// <summary>Whether the client authenticates with a secret (HTTP Basic) vs. PKCE.</summary>
    public bool IsConfidential => !string.IsNullOrEmpty(ClientSecret);

    /// <summary>Whether token requests must carry secure=1 (SPEC §5.4).</summary>
    public bool UseSecure =>
        Secure ?? new Uri(Endpoints.TokenEndpoint).Host.Contains("gov", StringComparison.OrdinalIgnoreCase);
}

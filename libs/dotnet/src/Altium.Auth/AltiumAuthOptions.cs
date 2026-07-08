// Altium.Auth — client configuration + endpoint presets. See ../../README.md.
namespace Altium.Auth;

/// <summary>Endpoint set for one environment (mirrors the TS endpoint presets).</summary>
public sealed record AltiumEndpoints(
    string AuthorizeEndpoint,
    string TokenEndpoint,
    string ActionWaitEndpoint,
    string RedirectUri)
{
    /// <summary>Altium 365 Commercial Cloud (defaults; the non-Gov cloud).</summary>
    public static readonly AltiumEndpoints CommercialCloud = new(
        "https://auth.altium.com/connect/authorize",
        "https://auth.altium.com/connect/token",
        "https://actionwait.altium.com/await",
        "https://auth.altium.com/api/AuthComplete");

    /// <summary>
    /// Altium 365 Gov Cloud. Only authorize/token are gov-specific; ActionWait and
    /// the AuthComplete callback stay on the Commercial Cloud host (SPEC §1.1, §4.2).
    /// </summary>
    public static readonly AltiumEndpoints GovCloud = new(
        "https://auth.365-gov.altium.com/connect/authorize",
        "https://auth.365-gov.altium.com/connect/token",
        "https://actionwait.altium.com/await",
        "https://auth.altium.com/api/AuthComplete");
}

/// <summary>
/// Configuration for the Altium 365 auth client. Only <see cref="ClientId"/> and
/// <see cref="Scopes"/> are required; endpoints default to the Commercial Cloud.
/// </summary>
public sealed class AltiumAuthOptions
{
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

    public bool IsConfidential => !string.IsNullOrEmpty(ClientSecret);

    /// <summary>Whether token requests must carry secure=1 (SPEC §5.4).</summary>
    public bool UseSecure =>
        Secure ?? new Uri(Endpoints.TokenEndpoint).Host.Contains("gov", StringComparison.OrdinalIgnoreCase);
}

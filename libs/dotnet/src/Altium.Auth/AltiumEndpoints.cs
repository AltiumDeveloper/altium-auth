namespace Altium.Auth;

/// <summary>Endpoint set for one environment (mirrors the TS endpoint presets).</summary>
public sealed record AltiumEndpoints(
    string AuthorizeEndpoint,
    string TokenEndpoint,
    string ActionWaitEndpoint,
    string RedirectUri,
    string? ScopeEndpoint = null)
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

    /// <summary>
    /// Derives endpoints for an AES (on-prem) installation from its server origin.
    /// Unlike Commercial/Gov Cloud (fixed Altium-hosted domains), AES runs on a
    /// customer-controlled origin, so there is no fixed preset — pass your AES
    /// server's origin (scheme + host, plus port if non-default), e.g.
    /// <c>AltiumEndpoints.Aes("https://aes.example.com:9785")</c>.
    ///
    /// AES hosts its own ActionWait and AuthComplete callback (unlike Gov, which
    /// shares Commercial's) and does not use secure=1 (same rule as Commercial).
    ///
    /// <see cref="ScopeEndpoint"/> is set to this installation's scope-introspection
    /// endpoint — GET it with a <c>clientId</c> query parameter to discover the exact
    /// scopes available to that client, including its single workspace's
    /// <c>a365:workspace:{id}</c>. Cloud hosts expose the same endpoint but return no
    /// workspace scope, so the Cloud presets leave it null.
    /// </summary>
    public static AltiumEndpoints Aes(string origin)
    {
        var baseUrl = origin.TrimEnd('/');
        return new AltiumEndpoints(
            $"{baseUrl}/unifiedlogin/connect/authorize",
            $"{baseUrl}/unifiedlogin/connect/token",
            $"{baseUrl}/actionwait/await",
            $"{baseUrl}/unifiedlogin/api/AuthComplete",
            $"{baseUrl}/unifiedlogin/api/ClientScopes");
    }
}

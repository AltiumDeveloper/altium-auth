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

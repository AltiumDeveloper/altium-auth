namespace Altium.Auth;

/// <summary>A prepared authorization request (mirrors the TS <c>AuthorizationRequest</c>).</summary>
/// <param name="Url">The authorization URL to open in a browser.</param>
/// <param name="State">The CSRF <c>state</c> value; verify it on the callback.</param>
/// <param name="CodeVerifier">The PKCE code verifier to pass to the code exchange.</param>
public sealed record AuthorizationRequest(string Url, string State, string CodeVerifier);

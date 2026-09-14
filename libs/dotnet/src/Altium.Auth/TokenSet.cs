using System.Runtime.Serialization;

namespace Altium.Auth;

/// <summary>Token endpoint response (subset; see <c>spec/schemas/token-response.schema.json</c>).</summary>
[DataContract]
public sealed class TokenSet
{
    /// <summary>The access token (a signed JWT).</summary>
    [DataMember(Name = "access_token")] public string AccessToken { get; set; } = "";

    /// <summary>Token type, typically <c>Bearer</c>.</summary>
    [DataMember(Name = "token_type")] public string? TokenType { get; set; }

    /// <summary>Seconds until the access token expires, as returned by the server.</summary>
    [DataMember(Name = "expires_in")] public int? ExpiresIn { get; set; }

    /// <summary>Absolute expiry as Unix epoch seconds (computed from <c>expires_in</c> with a 30s skew buffer).</summary>
    [DataMember(Name = "expires_at")] public long? ExpiresAt { get; set; }

    /// <summary>Refresh token, when <c>offline_access</c> was granted.</summary>
    [DataMember(Name = "refresh_token")] public string? RefreshToken { get; set; }

    /// <summary>OpenID Connect ID token, when the <c>openid</c> scope was granted.</summary>
    [DataMember(Name = "id_token")] public string? IdToken { get; set; }

    /// <summary>The space-delimited scopes actually granted.</summary>
    [DataMember(Name = "scope")] public string? Scope { get; set; }
}

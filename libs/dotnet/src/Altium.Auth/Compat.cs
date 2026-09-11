using System.Security.Cryptography;

namespace Altium.Auth;

// The netstandard2.0 target predates the static crypto helpers, the cancellable
// ReadAsStringAsync, and the StringComparison overload of string.Contains.
internal static class Compat
{
#if NETSTANDARD2_0
    internal static byte[] Sha256(byte[] data)
    {
        using var sha = SHA256.Create();
        return sha.ComputeHash(data);
    }

    internal static byte[] RandomBytes(int count)
    {
        var bytes = new byte[count];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return bytes;
    }

    /// <summary>netstandard2.0 has no cancellable overload, so <paramref name="ct"/> is unused there.</summary>
    internal static Task<string> ReadStringAsync(HttpContent content, CancellationToken ct)
    {
        _ = ct;
        return content.ReadAsStringAsync();
    }

    internal static bool ContainsIgnoreCase(string value, string substring) =>
        value.IndexOf(substring, StringComparison.OrdinalIgnoreCase) >= 0;
#else
    internal static byte[] Sha256(byte[] data) => SHA256.HashData(data);

    internal static byte[] RandomBytes(int count) => RandomNumberGenerator.GetBytes(count);

    internal static Task<string> ReadStringAsync(HttpContent content, CancellationToken ct) =>
        content.ReadAsStringAsync(ct);

    internal static bool ContainsIgnoreCase(string value, string substring) =>
        value.Contains(substring, StringComparison.OrdinalIgnoreCase);
#endif
}

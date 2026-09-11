using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Xml;

namespace Altium.Auth;

// DataContractJsonSerializer, not System.Text.Json: it is in the BCL on every target
// including netstandard2.0, so the package stays dependency-free on .NET Framework.
internal static class Json
{
    /// <summary>Deserialize, or null when the body is not JSON of the expected shape.</summary>
    internal static T? ReadOrNull<T>(string body)
        where T : class
    {
        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(body));
            return (T?)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
        }
        catch (SerializationException)
        {
            return null;
        }
        catch (XmlException)
        {
            return null;
        }
    }

    internal static string Write<T>(T value)
    {
        using var stream = new MemoryStream();
        new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
        return Encoding.UTF8.GetString(stream.ToArray());
    }
}

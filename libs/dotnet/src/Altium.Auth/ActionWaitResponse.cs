using System.Runtime.Serialization;

namespace Altium.Auth;

/// <summary>ActionWait 200 envelope (SPEC §4.4); see <c>spec/schemas/actionwait.schema.json</c>.</summary>
[DataContract]
internal sealed class ActionWaitResponse
{
    [DataMember(Name = "data")]
    public ActionWaitData? Data { get; set; }
}

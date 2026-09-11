#if NETSTANDARD2_0
namespace System.Runtime.CompilerServices;

// Required by the compiler for `required` members on netstandard2.0.
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Field | AttributeTargets.Property, Inherited = false)]
internal sealed class RequiredMemberAttribute : Attribute
{
}
#endif

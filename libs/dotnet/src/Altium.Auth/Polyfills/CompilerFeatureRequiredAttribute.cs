#if NETSTANDARD2_0
namespace System.Runtime.CompilerServices;

// Emitted alongside RequiredMemberAttribute by the compiler on netstandard2.0.
[AttributeUsage(AttributeTargets.All, AllowMultiple = true, Inherited = false)]
internal sealed class CompilerFeatureRequiredAttribute : Attribute
{
    public CompilerFeatureRequiredAttribute(string featureName) => FeatureName = featureName;

    public string FeatureName { get; }
}
#endif

#!/usr/bin/env sh
# Offline build + run of the .NET conformance runner WITHOUT NuGet, by compiling
# with Roslyn (csc) against the on-disk framework reference assemblies.
#
# Use this ONLY where NuGet is unavailable (e.g. a locked-down sandbox). On a
# normal networked machine just use the SDK:
#
#   dotnet run --project tests/Altium.Auth.Conformance -- ../../spec/conformance/vectors.json
#
# Usage: sh build-offline.sh [path-to-vectors.json]
set -e
here=$(cd "$(dirname "$0")" && pwd)
vectors="${1:-$here/../../spec/conformance/vectors.json}"
out="${TMPDIR:-/tmp}/a365-dotnet-port"
mkdir -p "$out"

# Discover a net8.0 reference pack + a matching Roslyn compiler.
refroot=/usr/local/share/dotnet/packs/Microsoft.NETCore.App.Ref
ver=$(ls "$refroot" | grep '^8\.' | sort -V | tail -1)
ref="$refroot/$ver/ref/net8.0"
csc=$(ls /usr/local/share/dotnet/sdk/8.*/Roslyn/bincore/csc.dll | sort -V | tail -1)
[ -d "$ref" ] || { echo "net8.0 ref pack not found under $refroot"; exit 1; }
[ -f "$csc" ] || { echo "csc.dll not found"; exit 1; }

# Replicate the SDK's ImplicitUsings for the namespaces our sources rely on.
printf 'global using System;\nglobal using System.Collections.Generic;\nglobal using System.IO;\nglobal using System.Linq;\nglobal using System.Net.Http;\nglobal using System.Threading;\nglobal using System.Threading.Tasks;\n' > "$out/GlobalUsings.cs"

rsp="$out/args.rsp"; : > "$rsp"
for f in "$ref"/*.dll; do echo "-r:$f" >> "$rsp"; done
echo "$out/GlobalUsings.cs" >> "$rsp"
# All library sources (one type per file), plus the console conformance runner.
for f in "$here"/src/Altium.Auth/*.cs; do echo "$f" >> "$rsp"; done
echo "$here/tests/Altium.Auth.Conformance/Program.cs" >> "$rsp"

echo "Compiling with csc against ref pack $ver ..."
dotnet exec "$csc" -nologo -target:exe -langversion:latest -nullable:enable -out:"$out/App.dll" "@$rsp"

# Roll forward to whatever 8.0.x runtime is installed.
printf '{ "runtimeOptions": { "tfm": "net8.0", "rollForward": "latestMinor", "framework": { "name": "Microsoft.NETCore.App", "version": "8.0.0" } } }' > "$out/App.runtimeconfig.json"
exec dotnet exec "$out/App.dll" "$vectors"

package altiumauth

import "strings"

// Endpoints is the set of URLs a client talks to. Any field left empty in a
// [Config] falls back to [CommercialCloudEndpoints].
type Endpoints struct {
	// AuthEndpoint is the authorization endpoint (/connect/authorize).
	AuthEndpoint string
	// TokenEndpoint is the token endpoint (/connect/token). A Gov host here
	// switches on secure=1 for every token request.
	TokenEndpoint string
	// ActionWaitEndpoint is the ActionWait long-poll endpoint used by SignIn.
	ActionWaitEndpoint string
	// RedirectURI is the fixed redirect URI registered with the auth client.
	RedirectURI string
	// ScopeEndpoint is the client scope introspection endpoint
	// ({base}/api/ClientScopes). Optional; see GetClientScopes.
	ScopeEndpoint string
}

// CommercialCloudEndpoints are the Altium 365 Commercial Cloud (non-Gov)
// endpoints. They are the defaults for any endpoint a [Config] omits.
var CommercialCloudEndpoints = Endpoints{
	AuthEndpoint:       "https://auth.altium.com/connect/authorize",
	TokenEndpoint:      "https://auth.altium.com/connect/token",
	ActionWaitEndpoint: "https://actionwait.altium.com/await",
	RedirectURI:        "https://auth.altium.com/api/AuthComplete",
}

// GovCloudEndpoints are the Altium 365 GovCloud (Production) endpoints. The
// library detects the Gov token endpoint and adds secure=1 to token requests
// automatically.
//
// Only AuthEndpoint and TokenEndpoint are Gov-specific. ActionWait has no Gov
// DNS: both its poll endpoint and its AuthComplete callback are the Commercial
// Cloud hosts for the tier (a Gov-host callback is not registered and won't
// authorize).
var GovCloudEndpoints = Endpoints{
	AuthEndpoint:       "https://auth.365-gov.altium.com/connect/authorize",
	TokenEndpoint:      "https://auth.365-gov.altium.com/connect/token",
	ActionWaitEndpoint: "https://actionwait.altium.com/await",
	RedirectURI:        "https://auth.altium.com/api/AuthComplete",
}

// AESEndpoints derives the endpoints of an AES (on-prem) installation from its
// server origin (scheme + host, plus port if non-default), e.g.
// AESEndpoints("https://aes.example.com:9785").
//
// AES hosts its own ActionWait and AuthComplete callback (unlike Gov, which
// shares Commercial's) and never uses secure=1 (same rule as Commercial).
func AESEndpoints(origin string) Endpoints {
	base := strings.TrimRight(origin, "/")
	return Endpoints{
		AuthEndpoint:       base + "/unifiedlogin/connect/authorize",
		TokenEndpoint:      base + "/unifiedlogin/connect/token",
		ActionWaitEndpoint: base + "/actionwait/await",
		RedirectURI:        base + "/unifiedlogin/api/AuthComplete",
		ScopeEndpoint:      base + "/unifiedlogin/api/ClientScopes",
	}
}

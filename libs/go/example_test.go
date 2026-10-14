package altiumauth_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"

	altiumauth "github.com/AltiumDeveloper/altium-auth/libs/go"
)

// A desktop or CLI app (public client) signs in through the browser over
// ActionWait, then exchanges the global token for a workspace token.
func ExampleConfig_SignIn() {
	cfg := altiumauth.Config{ClientID: "your-client-id", Scopes: "openid profile offline_access"}
	ctx := context.Background()

	tokens, err := cfg.SignIn(ctx, altiumauth.SignInOptions{})
	if err != nil {
		log.Fatal(err)
	}
	// Persist tokens yourself (keychain, file, …).

	ws, err := cfg.SignIntoWorkspace(ctx, tokens.AccessToken, "workspace-auth-id")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(ws.AccessToken != "")
}

// A web/server app (confidential client) uses the redirect flow.
func ExampleConfig_CreateAuthorizationURL() {
	cfg := altiumauth.Config{
		ClientID:     "your-client-id",
		ClientSecret: "your-client-secret", // confidential client → HTTP Basic
		Scopes:       "openid profile offline_access",
	}
	redirectURI := "https://my-service.example.com/oauth/callback"

	http.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		authz, err := cfg.CreateAuthorizationURL(altiumauth.AuthorizationURLOptions{RedirectURI: redirectURI})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Stash authz.State and authz.CodeVerifier in the user's session, then:
		http.Redirect(w, r, authz.URL, http.StatusFound)
	})

	http.HandleFunc("/oauth/callback", func(w http.ResponseWriter, r *http.Request) {
		state, verifier := "from-session", "from-session"
		if r.URL.Query().Get("state") != state {
			http.Error(w, "state mismatch", http.StatusBadRequest)
			return
		}
		tokens, err := cfg.ExchangeCode(r.Context(), altiumauth.ExchangeCodeParams{
			Code:         r.URL.Query().Get("code"),
			CodeVerifier: verifier,
			RedirectURI:  redirectURI,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		_ = tokens // persist, then discover/exchange workspaces as usual
	})
}

// GovCloud: use the Gov endpoints; secure=1 is added to token requests
// automatically.
func ExampleGovCloudEndpoints() {
	cfg := altiumauth.Config{
		ClientID:  "your-gov-client-id",
		Scopes:    "openid profile",
		Endpoints: altiumauth.GovCloudEndpoints,
	}
	_ = cfg
}

// AES (on-prem): derive the endpoints from the server origin, discover the
// installation's workspace scope, and request it at sign-in (one trip).
func ExampleAESEndpoints() {
	ctx := context.Background()
	endpoints := altiumauth.AESEndpoints("https://aes.server.example:9785")
	scopes, err := altiumauth.GetClientScopes(ctx, nil, endpoints.ScopeEndpoint, "your-aes-client-id")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(scopes)
}

// Refresh an expired access token, and handle a revoked or expired refresh
// token by signing in again.
func ExampleConfig_RefreshToken() {
	cfg := altiumauth.Config{ClientID: "your-client-id", Scopes: "openid profile offline_access"}
	tokens := &altiumauth.TokenSet{ /* loaded from storage */ }

	if tokens.Expired() && tokens.RefreshToken != "" {
		refreshed, err := cfg.RefreshToken(context.Background(), tokens.RefreshToken)
		var te *altiumauth.TokenError
		if errors.As(err, &te) && te.Code == "invalid_grant" {
			// Refresh token expired or revoked: sign in again.
		} else if err != nil {
			log.Fatal(err)
		}
		_ = refreshed // persist, including a rotated refresh token
	}
}

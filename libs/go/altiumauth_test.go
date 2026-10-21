package altiumauth

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// roundTripFunc adapts a function to http.RoundTripper.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func reply(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}
}

func clientFunc(f roundTripFunc) *http.Client { return &http.Client{Transport: f} }

func TestCodeChallengeS256(t *testing.T) {
	// base64url(SHA256("verifier-123")), unpadded — cross-checked with openssl.
	got := codeChallenge("verifier-123")
	if want := "Ds3NpaREu9I2EYq6l0l3ZkFyv_Gt5O4EpGD6cZlY0Kg"; got != want {
		t.Errorf("codeChallenge = %q, want %q", got, want)
	}
}

func TestGenerateCodeVerifier(t *testing.T) {
	a, b := generateCodeVerifier(), generateCodeVerifier()
	if len(a) != 43 || a == b {
		t.Errorf("verifiers %q, %q: want distinct 43-char base64url strings", a, b)
	}
}

func TestNewUUID(t *testing.T) {
	u := newUUID()
	if len(u) != 36 || u[14] != '4' || strings.Count(u, "-") != 4 {
		t.Errorf("newUUID = %q, want a version-4 UUID", u)
	}
}

func TestResolveValidation(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  Config
		want string
	}{
		{"missing client id", Config{Scopes: "openid"}, "Config.ClientID is required"},
		{"blank scopes", Config{ClientID: "c", Scopes: "  "}, "Config.Scopes is required"},
		{"relative endpoint", Config{ClientID: "c", Scopes: "openid", Endpoints: Endpoints{TokenEndpoint: "/connect/token"}}, "Config.TokenEndpoint is not a valid URL"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.cfg.resolve(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
	cfg, err := Config{ClientID: "c", Scopes: "openid"}.resolve()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TokenEndpoint != CommercialCloudEndpoints.TokenEndpoint || cfg.HTTPClient != http.DefaultClient {
		t.Errorf("defaults not applied: %+v", cfg)
	}
}

func TestAESEndpoints(t *testing.T) {
	e := AESEndpoints("https://aes.example.com:9785/")
	if e.TokenEndpoint != "https://aes.example.com:9785/unifiedlogin/connect/token" ||
		e.ActionWaitEndpoint != "https://aes.example.com:9785/actionwait/await" ||
		e.ScopeEndpoint != "https://aes.example.com:9785/unifiedlogin/api/ClientScopes" {
		t.Errorf("AESEndpoints = %+v", e)
	}
}

func TestSecureOverride(t *testing.T) {
	yes, no := true, false
	for _, tc := range []struct {
		name     string
		endpoint string
		secure   *bool
		want     bool
	}{
		{"commercial auto", "https://auth.altium.com/connect/token", nil, false},
		{"gov auto", "https://auth.custom-gov.example/connect/token", nil, true},
		{"forced on", "https://auth.custom.example/connect/token", &yes, true},
		{"forced off", GovCloudEndpoints.TokenEndpoint, &no, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var form url.Values
			cfg := Config{ClientID: "c", Scopes: "openid", Secure: tc.secure, Endpoints: Endpoints{TokenEndpoint: tc.endpoint},
				HTTPClient: clientFunc(func(r *http.Request) (*http.Response, error) {
					b, _ := io.ReadAll(r.Body)
					form, _ = url.ParseQuery(string(b))
					return reply(200, `{"access_token":"AT"}`), nil
				})}
			if _, err := cfg.RefreshToken(context.Background(), "RT"); err != nil {
				t.Fatal(err)
			}
			if got := form.Get("secure") == "1"; got != tc.want {
				t.Errorf("secure=1 sent: %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRequestsCarryLibraryUserAgent(t *testing.T) {
	var uas []string
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		uas = append(uas, r.Header.Get("User-Agent"))
		if strings.Contains(r.URL.Path, "ClientScopes") {
			return reply(200, `[]`), nil
		}
		return reply(200, `{"access_token":"AT"}`), nil
	})
	cfg := Config{ClientID: "c", Scopes: "openid", HTTPClient: client}
	ctx := context.Background()
	_, _ = cfg.RefreshToken(ctx, "RT")
	_ = cfg.RevokeRefreshToken(ctx, "RT")
	_, _ = GetClientScopes(ctx, client, "https://aes.example.com/unifiedlogin/api/ClientScopes", "c")
	if len(uas) != 3 {
		t.Fatalf("got %d requests, want 3", len(uas))
	}
	for _, ua := range uas {
		if !strings.HasPrefix(ua, "altium-auth-go/") {
			t.Errorf("User-Agent = %q, want altium-auth-go/…", ua)
		}
	}
}

func TestTokenErrorIsTyped(t *testing.T) {
	cfg := Config{ClientID: "c", Scopes: "openid", HTTPClient: clientFunc(func(*http.Request) (*http.Response, error) {
		return reply(400, `{"error":"invalid_grant","error_description":"expired"}`), nil
	})}
	_, err := cfg.RefreshToken(context.Background(), "RT")
	var te *TokenError
	if !errors.As(err, &te) || te.Code != "invalid_grant" || te.Description != "expired" || te.StatusCode != 400 {
		t.Fatalf("err = %#v, want a *TokenError invalid_grant", err)
	}
}

func TestEmptyInputsRejected(t *testing.T) {
	cfg := Config{ClientID: "c", Scopes: "openid"}
	ctx := context.Background()
	if _, err := cfg.ExchangeCode(ctx, ExchangeCodeParams{}); err == nil {
		t.Error("ExchangeCode with empty code: want error")
	}
	if _, err := cfg.SignIntoWorkspace(ctx, "", "ws"); err == nil {
		t.Error("SignIntoWorkspace with empty token: want error")
	}
	if _, err := cfg.RefreshToken(ctx, ""); err == nil {
		t.Error("RefreshToken with empty token: want error")
	}
	if err := cfg.RevokeRefreshToken(ctx, ""); err == nil {
		t.Error("RevokeRefreshToken with empty token: want error")
	}
}

func TestInvalidSelectWorkspace(t *testing.T) {
	_, err := Config{ClientID: "c", Scopes: "openid"}.CreateAuthorizationURL(AuthorizationURLOptions{SelectWorkspace: "always"})
	if err == nil || !strings.Contains(err.Error(), "SelectWorkspace must be") {
		t.Errorf("err = %v, want SelectWorkspace validation error", err)
	}
}

func TestExpired(t *testing.T) {
	now := time.Now().Unix()
	if (&TokenSet{}).Expired() || (&TokenSet{ExpiresAt: now + 60}).Expired() || !(&TokenSet{ExpiresAt: now - 1}).Expired() {
		t.Error("Expired() mismatch")
	}
}

// holdingPoll answers every ActionWait poll with 408 after a short hold, the
// way a server with no sign-in result yet would.
func holdingPoll() *http.Client {
	return clientFunc(func(r *http.Request) (*http.Response, error) {
		select {
		case <-time.After(20 * time.Millisecond):
			return reply(408, ""), nil
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
	})
}

func TestSignInTimeout(t *testing.T) {
	cfg := Config{ClientID: "c", Scopes: "openid", HTTPClient: holdingPoll()}
	_, err := cfg.SignIn(context.Background(), SignInOptions{Timeout: 100 * time.Millisecond, OpenBrowser: func(string) error { return nil }})
	if err == nil || !strings.Contains(err.Error(), "timed out") || !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("err = %v, want a timeout wrapping context.DeadlineExceeded", err)
	}
}

func TestSignInCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := Config{ClientID: "c", Scopes: "openid", HTTPClient: holdingPoll()}
	time.AfterFunc(50*time.Millisecond, cancel)
	_, err := cfg.SignIn(ctx, SignInOptions{OpenBrowser: func(string) error { return nil }})
	if !errors.Is(err, ErrSignInCancelled) || !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want ErrSignInCancelled wrapping context.Canceled", err)
	}
}

func TestSignInPollsBeforeOpeningBrowserAndPropagatesOpenerError(t *testing.T) {
	polled := make(chan struct{}, 1)
	cfg := Config{ClientID: "c", Scopes: "openid", HTTPClient: clientFunc(func(r *http.Request) (*http.Response, error) {
		select {
		case polled <- struct{}{}:
		default:
		}
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}
	opener := errors.New("no browser")
	_, err := cfg.SignIn(context.Background(), SignInOptions{OpenBrowser: func(u string) error {
		if !strings.Contains(u, "code_challenge_method=S256") {
			t.Errorf("opener got URL %q", u)
		}
		select {
		case <-polled: // the long poll is already in flight
		case <-time.After(time.Second):
			t.Error("browser opened before the ActionWait poll started")
		}
		return opener
	}})
	if !errors.Is(err, opener) {
		t.Errorf("err = %v, want the opener's error", err)
	}
}

func TestSignInUnexpectedStatus(t *testing.T) {
	cfg := Config{ClientID: "c", Scopes: "openid", HTTPClient: clientFunc(func(*http.Request) (*http.Response, error) {
		return reply(503, "unavailable"), nil
	})}
	_, err := cfg.SignIn(context.Background(), SignInOptions{OpenBrowser: func(string) error { return nil }})
	if err == nil || !strings.Contains(err.Error(), "ActionWait returned 503: unavailable") {
		t.Errorf("err = %v", err)
	}
}

func TestGetClientScopesRejectsNonStringItems(t *testing.T) {
	client := clientFunc(func(*http.Request) (*http.Response, error) { return reply(200, `["openid", 7]`), nil })
	if _, err := GetClientScopes(context.Background(), client, "https://aes.example.com/unifiedlogin/api/ClientScopes", "c"); err == nil {
		t.Error("want error for a non-string array item")
	}
}

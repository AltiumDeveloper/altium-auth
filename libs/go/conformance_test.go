package altiumauth_test

// Conformance runner — drives the library with the language-neutral vectors in
// spec/conformance/vectors.json and asserts the outgoing requests and outcomes.
// Mirrors libs/typescript/test/conformance: a single HTTP seam (a recording
// RoundTripper on Config.HTTPClient) replies with the scripted responses.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	altiumauth "github.com/AltiumDeveloper/altium-auth/libs/go"
)

type vectorConfig struct {
	ClientID           string `json:"clientId"`
	ClientSecret       string `json:"clientSecret"`
	Scopes             string `json:"scopes"`
	AuthEndpoint       string `json:"authEndpoint"`
	TokenEndpoint      string `json:"tokenEndpoint"`
	ActionWaitEndpoint string `json:"actionWaitEndpoint"`
	RedirectURI        string `json:"redirectUri"`
}

type mockResponse struct {
	Status int             `json:"status"`
	JSON   json.RawMessage `json:"json"`
	Text   string          `json:"text"`
}

func (m mockResponse) body() string {
	if m.JSON != nil {
		return string(m.JSON)
	}
	return m.Text
}

type expectRequest struct {
	Endpoint         string            `json:"endpoint"`
	Method           string            `json:"method"`
	Authorization    string            `json:"authorization"`
	BodyParams       map[string]string `json:"bodyParams"`
	BodyParamsAbsent []string          `json:"bodyParamsAbsent"`
}

type vectors struct {
	AuthorizeURL []struct {
		ID      string       `json:"id"`
		Config  vectorConfig `json:"config"`
		Options struct {
			RedirectURI     string `json:"redirectUri"`
			State           string `json:"state"`
			CodeVerifier    string `json:"codeVerifier"`
			SelectWorkspace string `json:"selectWorkspace"`
		} `json:"options"`
		Expect struct {
			Origin      string            `json:"origin"`
			Pathname    string            `json:"pathname"`
			Query       map[string]string `json:"query"`
			QueryAbsent []string          `json:"queryAbsent"`
		} `json:"expect"`
	} `json:"authorizeUrl"`
	TokenRequest []struct {
		ID        string       `json:"id"`
		Operation string       `json:"operation"`
		Config    vectorConfig `json:"config"`
		Input     struct {
			Code            string `json:"code"`
			CodeVerifier    string `json:"codeVerifier"`
			RedirectURI     string `json:"redirectUri"`
			BaseAccessToken string `json:"baseAccessToken"`
			WorkspaceAuthID string `json:"workspaceAuthId"`
			RefreshToken    string `json:"refreshToken"`
		} `json:"input"`
		ExpectRequest       expectRequest  `json:"expectRequest"`
		MockResponse        mockResponse   `json:"mockResponse"`
		ExpectResult        map[string]any `json:"expectResult"`
		ExpectErrorContains string         `json:"expectErrorContains"`
	} `json:"tokenRequest"`
	Revocation []struct {
		ID     string       `json:"id"`
		Config vectorConfig `json:"config"`
		Input  struct {
			RefreshToken string `json:"refreshToken"`
		} `json:"input"`
		ExpectRequest *expectRequest `json:"expectRequest"`
		MockResponse  mockResponse   `json:"mockResponse"`
	} `json:"revocation"`
	ActionWait []struct {
		ID            string         `json:"id"`
		PollResponses []mockResponse `json:"pollResponses"`
		Expect        struct {
			Outcome       string `json:"outcome"`
			Code          string `json:"code"`
			ErrorContains string `json:"errorContains"`
		} `json:"expect"`
	} `json:"actionWait"`
	ClientScopes []struct {
		ID    string `json:"id"`
		Input struct {
			ScopeEndpoint string `json:"scopeEndpoint"`
			ClientID      string `json:"clientId"`
		} `json:"input"`
		MockResponse  mockResponse `json:"mockResponse"`
		ExpectRequest *struct {
			Endpoint string `json:"endpoint"`
			Method   string `json:"method"`
		} `json:"expectRequest"`
		ExpectResult        []string `json:"expectResult"`
		ExpectErrorContains string   `json:"expectErrorContains"`
	} `json:"clientScopes"`
	Userinfo   []struct{ ID string } `json:"userinfo"`
	LiveClaims []struct{ ID string } `json:"liveClaims"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "conformance", "vectors.json"))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	return v
}

func (c vectorConfig) toConfig(client *http.Client) altiumauth.Config {
	return altiumauth.Config{
		ClientID:     c.ClientID,
		ClientSecret: c.ClientSecret,
		Scopes:       c.Scopes,
		Endpoints: altiumauth.Endpoints{
			AuthEndpoint:       c.AuthEndpoint,
			TokenEndpoint:      c.TokenEndpoint,
			ActionWaitEndpoint: c.ActionWaitEndpoint,
			RedirectURI:        c.RedirectURI,
		},
		HTTPClient: client,
	}
}

// recorded is one request seen by the recorder.
type recorded struct {
	method, url, body string
	header            http.Header
}

// recorder is a RoundTripper that records requests and answers via reply.
type recorder struct {
	mu    sync.Mutex
	calls []recorded
	reply func(r recorded, idx int) (int, string)
}

func (rc *recorder) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
	}
	r := recorded{method: req.Method, url: req.URL.String(), body: string(body), header: req.Header}
	rc.mu.Lock()
	rc.calls = append(rc.calls, r)
	idx := len(rc.calls) - 1
	rc.mu.Unlock()
	status, text := rc.reply(r, idx)
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(text)),
		Header:     http.Header{},
		Request:    req,
	}, nil
}

func newRecorder(reply func(r recorded, idx int) (int, string)) (*recorder, *http.Client) {
	rc := &recorder{reply: reply}
	return rc, &http.Client{Transport: rc}
}

func matchValue(t *testing.T, what string, actual string, present bool, matcher string) {
	t.Helper()
	switch {
	case matcher == "<any>":
		if !present {
			t.Errorf("%s: expected present", what)
		}
	case strings.HasPrefix(matcher, "contains:"):
		if want := strings.TrimPrefix(matcher, "contains:"); !strings.Contains(actual, want) {
			t.Errorf("%s = %q, want it to contain %q", what, actual, want)
		}
	default:
		if !present || actual != matcher {
			t.Errorf("%s = %q (present=%v), want %q", what, actual, present, matcher)
		}
	}
}

func checkRequest(t *testing.T, call recorded, er expectRequest, cfg altiumauth.Config) {
	t.Helper()
	if er.Endpoint != "" && call.url != er.Endpoint {
		t.Errorf("endpoint = %q, want %q", call.url, er.Endpoint)
	}
	if er.Method != "" && call.method != er.Method {
		t.Errorf("method = %q, want %q", call.method, er.Method)
	}
	auth := call.header.Get("Authorization")
	switch {
	case er.Authorization == "none":
		if auth != "" {
			t.Errorf("Authorization header = %q, want absent", auth)
		}
	case strings.HasPrefix(er.Authorization, "basic("):
		want := "Basic " + base64.StdEncoding.EncodeToString([]byte(cfg.ClientID+":"+cfg.ClientSecret))
		if auth != want {
			t.Errorf("Authorization header = %q, want %q", auth, want)
		}
	}
	form, err := url.ParseQuery(call.body)
	if err != nil {
		t.Fatalf("parse form body %q: %v", call.body, err)
	}
	for k, m := range er.BodyParams {
		matchValue(t, "bodyParam "+k, form.Get(k), form.Has(k), m)
	}
	for _, k := range er.BodyParamsAbsent {
		if form.Has(k) {
			t.Errorf("bodyParam %s = %q, want absent", k, form.Get(k))
		}
	}
}

func TestConformanceAuthorizeURL(t *testing.T) {
	for _, v := range loadVectors(t).AuthorizeURL {
		t.Run(v.ID, func(t *testing.T) {
			authz, err := v.Config.toConfig(nil).CreateAuthorizationURL(altiumauth.AuthorizationURLOptions{
				RedirectURI:     v.Options.RedirectURI,
				State:           v.Options.State,
				CodeVerifier:    v.Options.CodeVerifier,
				SelectWorkspace: altiumauth.WorkspaceSelection(v.Options.SelectWorkspace),
			})
			if err != nil {
				t.Fatal(err)
			}
			u, err := url.Parse(authz.URL)
			if err != nil {
				t.Fatal(err)
			}
			if origin := u.Scheme + "://" + u.Host; origin != v.Expect.Origin {
				t.Errorf("origin = %q, want %q", origin, v.Expect.Origin)
			}
			if u.Path != v.Expect.Pathname {
				t.Errorf("pathname = %q, want %q", u.Path, v.Expect.Pathname)
			}
			q := u.Query()
			for k, m := range v.Expect.Query {
				matchValue(t, "query "+k, q.Get(k), q.Has(k), m)
			}
			for _, k := range v.Expect.QueryAbsent {
				if q.Has(k) {
					t.Errorf("query %s = %q, want absent", k, q.Get(k))
				}
			}
		})
	}
}

func TestConformanceTokenRequest(t *testing.T) {
	for _, v := range loadVectors(t).TokenRequest {
		t.Run(v.ID, func(t *testing.T) {
			rec, client := newRecorder(func(recorded, int) (int, string) {
				return v.MockResponse.Status, v.MockResponse.body()
			})
			cfg := v.Config.toConfig(client)
			ctx := context.Background()

			var tok *altiumauth.TokenSet
			var err error
			switch v.Operation {
			case "exchangeCode":
				tok, err = cfg.ExchangeCode(ctx, altiumauth.ExchangeCodeParams{
					Code: v.Input.Code, CodeVerifier: v.Input.CodeVerifier, RedirectURI: v.Input.RedirectURI,
				})
			case "signIntoWorkspace":
				tok, err = cfg.SignIntoWorkspace(ctx, v.Input.BaseAccessToken, v.Input.WorkspaceAuthID)
			case "refreshToken":
				tok, err = cfg.RefreshToken(ctx, v.Input.RefreshToken)
			default:
				t.Fatalf("unknown operation %q", v.Operation)
			}

			if v.ExpectErrorContains != "" {
				if err == nil || !strings.Contains(err.Error(), v.ExpectErrorContains) {
					t.Errorf("error = %v, want it to contain %q", err, v.ExpectErrorContains)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				// expectResult keys are the wire (JSON) names.
				raw, _ := json.Marshal(tok)
				var got map[string]any
				_ = json.Unmarshal(raw, &got)
				for k, want := range v.ExpectResult {
					actual, present := got[k]
					switch w, _ := want.(string); {
					case w == "<any>":
						if !present {
							t.Errorf("result %s: expected present", k)
						}
					case strings.HasPrefix(w, "epochWithin:"):
						parts := strings.Split(w, ":")
						offset, _ := strconv.ParseFloat(parts[1], 64)
						tol, _ := strconv.ParseFloat(parts[2], 64)
						n, _ := actual.(float64)
						if d := n - (float64(time.Now().Unix()) + offset); !present || d > tol || d < -tol {
							t.Errorf("result %s = %v, want now+%v ±%v", k, actual, offset, tol)
						}
					default:
						if actual != want {
							t.Errorf("result %s = %v, want %v", k, actual, want)
						}
					}
				}
			}

			if len(rec.calls) == 0 {
				t.Fatal("no request was sent")
			}
			checkRequest(t, rec.calls[0], v.ExpectRequest, cfg)
		})
	}
}

func TestConformanceRevocation(t *testing.T) {
	for _, v := range loadVectors(t).Revocation {
		t.Run(v.ID, func(t *testing.T) {
			if v.ExpectRequest == nil {
				t.Skip("behavioral reference (revoke → refresh → invalid_grant) — needs a live server")
			}
			rec, client := newRecorder(func(recorded, int) (int, string) {
				return v.MockResponse.Status, v.MockResponse.body()
			})
			cfg := v.Config.toConfig(client)
			if err := cfg.RevokeRefreshToken(context.Background(), v.Input.RefreshToken); err != nil {
				t.Fatal(err)
			}
			if len(rec.calls) == 0 {
				t.Fatal("no request was sent")
			}
			checkRequest(t, rec.calls[0], *v.ExpectRequest, cfg)
		})
	}
}

func TestConformanceActionWait(t *testing.T) {
	for _, v := range loadVectors(t).ActionWait {
		t.Run(v.ID, func(t *testing.T) {
			var polls int
			_, client := newRecorder(func(r recorded, _ int) (int, string) {
				if strings.HasPrefix(r.url, "https://actionwait") {
					m := v.PollResponses[min(polls, len(v.PollResponses)-1)]
					polls++
					var req struct{ Token string }
					_ = json.Unmarshal([]byte(r.body), &req)
					return m.Status, strings.ReplaceAll(m.body(), "<stateEchoesToken>", req.Token)
				}
				// Token endpoint: the success path exchanges the code.
				return 200, `{"access_token":"AT","token_type":"Bearer"}`
			})
			cfg := altiumauth.Config{ClientID: "c", Scopes: "openid profile", HTTPClient: client}
			tok, err := cfg.SignIn(context.Background(), altiumauth.SignInOptions{
				Timeout:     2 * time.Second,
				OpenBrowser: func(string) error { return nil },
			})
			if v.Expect.Outcome == "code" {
				if err != nil {
					t.Fatal(err)
				}
				if tok.AccessToken != "AT" { // the code flowed through to the exchange
					t.Errorf("access_token = %q, want AT", tok.AccessToken)
				}
			} else if err == nil || !strings.Contains(err.Error(), v.Expect.ErrorContains) {
				t.Errorf("error = %v, want it to contain %q", err, v.Expect.ErrorContains)
			}
		})
	}
}

func TestConformanceClientScopes(t *testing.T) {
	for _, v := range loadVectors(t).ClientScopes {
		t.Run(v.ID, func(t *testing.T) {
			rec, client := newRecorder(func(recorded, int) (int, string) {
				return v.MockResponse.Status, v.MockResponse.body()
			})
			scopes, err := altiumauth.GetClientScopes(context.Background(), client, v.Input.ScopeEndpoint, v.Input.ClientID)
			if v.ExpectErrorContains != "" {
				if err == nil || !strings.Contains(err.Error(), v.ExpectErrorContains) {
					t.Errorf("error = %v, want it to contain %q", err, v.ExpectErrorContains)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(scopes, v.ExpectResult) {
					t.Errorf("scopes = %#v, want %#v", scopes, v.ExpectResult)
				}
			}
			if len(rec.calls) == 0 {
				t.Fatal("no request was sent")
			}
			if er := v.ExpectRequest; er != nil {
				if er.Endpoint != "" && rec.calls[0].url != er.Endpoint {
					t.Errorf("endpoint = %q, want %q", rec.calls[0].url, er.Endpoint)
				}
				if er.Method != "" && rec.calls[0].method != er.Method {
					t.Errorf("method = %q, want %q", rec.calls[0].method, er.Method)
				}
			}
		})
	}
}

func TestConformanceReferenceOnly(t *testing.T) {
	v := loadVectors(t)
	for _, u := range v.Userinfo {
		t.Run(u.ID, func(t *testing.T) { t.Skip("reference response shape — not a library function") })
	}
	for _, c := range v.LiveClaims {
		t.Run(c.ID, func(t *testing.T) { t.Skip("golden decoded claims — require a live server") })
	}
}

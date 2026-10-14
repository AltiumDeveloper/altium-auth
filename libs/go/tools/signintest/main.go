// Command signintest verifies sign-in end to end against a live Altium
// environment.
//
// It drives the public (ActionWait) sign-in flow, and optionally the workspace
// exchange and refresh, against Production, GovCloud, or AES.
// Confidential clients are supported by supplying a secret (HTTP Basic). Its CLI
// is identical to the TypeScript, .NET, and Python harnesses.
//
// Usage (from libs/go):
//
//	go run ./tools/signintest [options] <clientId>
//
// Options:
//
//	--env <prod|gov|aes>              Sign-in environment           (default: prod)
//	--workspace-env <prod|gov>        Endpoint for the workspace exchange (default: --env).
//	                                  e.g. --env prod --workspace-env gov exercises the
//	                                  Commercial→Gov bridge (sign in Commercial, exchange on Gov).
//	                                  Not applicable to AES — an installation is a single
//	                                  environment, so it signs in and exchanges on itself.
//	--aes-origin <origin>             AES server origin, e.g. https://aes.example.com:9785
//	                                  (required when --env is "aes")
//	--secure / --no-secure            Force secure=1 on/off (default: auto from token endpoint)
//	--scopes "<scopes>"               Space-delimited scopes        (default: "openid profile")
//	--workspace <authId>              Workspace to obtain a token for. Exercises both routes: the
//	                                  two-trip exchange after a global sign-in, and the one-trip
//	                                  sign-in that requests a365:workspace:{authId} directly.
//	                                  On AES it can be omitted — the workspace scope is discovered
//	                                  from the installation's ClientScopes endpoint.
//	--select-workspace <none|strict|optional>  Login-into-workspace mode at /authorize (default: none)
//	                                  (not applicable to AES — no workspace-selection prompt;
//	                                   request the workspace scope at sign-in instead)
//	--refresh                         After sign-in, exercise RefreshToken (implies offline_access)
//	--userinfo                        After sign-in, GET /connect/userinfo and print the response
//	--revoke                          Revoke the (latest) refresh token, then prove it no longer works
//
// Confidential / custom-callback clients (that host their own redirect, not ActionWait):
//
//	--authorize-url                   Print the authorize URL (+ state, code_verifier) and exit
//	--redirect-uri <url>              Callback to embed in the authorize URL / code exchange
//	--exchange-code <code>            Exchange an authorization code for tokens (from your callback)
//	--code-verifier <verifier>        PKCE verifier from the --authorize-url step (for --exchange-code)
//
// Env vars:
//
//	A365_CLIENT_SECRET                Confidential client secret → HTTP Basic auth (optional)
//
// Examples:
//
//	go run ./tools/signintest my-client-id
//	go run ./tools/signintest --env gov my-gov-client-id                # verifies secure=1
//	go run ./tools/signintest --workspace-env gov --workspace <govAuthId> my-client-id  # Commercial→Gov
//	# Confidential redirect flow (browser sign-in happens between the two steps):
//	go run ./tools/signintest --authorize-url --redirect-uri https://app.example.com/cb my-client
//	A365_CLIENT_SECRET=… go run ./tools/signintest --exchange-code <code> --code-verifier <v> --redirect-uri https://app.example.com/cb my-client
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	altiumauth "github.com/AltiumDeveloper/altium-auth/libs/go"
)

const workspaceScopePrefix = "a365:workspace:"

var envs = []string{"prod", "gov", "aes"}

type cliArgs struct {
	clientID        string
	env             string
	workspaceEnv    string // endpoint for the workspace exchange (default: env)
	aesOrigin       string // required when env is "aes"
	secure          *bool  // nil = let the library auto-detect from the endpoint
	scopes          string
	workspace       string
	selectWorkspace altiumauth.WorkspaceSelection
	refresh         bool
	userinfo        bool
	revoke          bool
	authorizeURL    bool
	code            string
	codeVerifier    string
	redirectURI     string
}

func fail(message string) {
	fmt.Fprintf(os.Stderr, "\n❌ %s\n\n", message)
	fmt.Fprintln(os.Stderr, "Usage: go run ./tools/signintest [--env prod|gov|aes] [--secure|--no-secure]")
	fmt.Fprintln(os.Stderr, "                                 [--scopes \"...\"] [--workspace <authId>] [--refresh] <clientId>")
	fmt.Fprintln(os.Stderr)
	os.Exit(1)
}

func parseEnv(value, flag string) string {
	if !slices.Contains(envs, value) {
		fail(fmt.Sprintf("%s must be one of prod|gov|aes (got %q)", flag, value))
	}
	return value
}

func parseArgs(argv []string) cliArgs {
	a := cliArgs{env: "prod", scopes: "openid profile"}
	value := func(i *int) string {
		*i++
		if *i >= len(argv) {
			fail(fmt.Sprintf("Missing value for %s", argv[*i-1]))
		}
		return argv[*i]
	}
	selectWorkspaceSet := false

	for i := 0; i < len(argv); i++ {
		switch arg := argv[i]; arg {
		case "--env":
			a.env = parseEnv(value(&i), "--env")
		case "--workspace-env":
			a.workspaceEnv = parseEnv(value(&i), "--workspace-env")
		case "--aes-origin":
			a.aesOrigin = value(&i)
		case "--secure":
			v := true
			a.secure = &v
		case "--no-secure":
			v := false
			a.secure = &v
		case "--scopes":
			a.scopes = value(&i)
		case "--workspace":
			a.workspace = value(&i)
		case "--select-workspace":
			v := value(&i)
			if v != "none" && v != "strict" && v != "optional" {
				fail(fmt.Sprintf("--select-workspace must be one of none|strict|optional (got %q)", v))
			}
			a.selectWorkspace = altiumauth.WorkspaceSelection(v)
			selectWorkspaceSet = true
		case "--refresh":
			a.refresh = true
		case "--userinfo":
			a.userinfo = true
		case "--revoke":
			a.revoke = true
		case "--authorize-url":
			a.authorizeURL = true
		case "--exchange-code":
			a.code = value(&i)
		case "--code-verifier":
			a.codeVerifier = value(&i)
		case "--redirect-uri":
			a.redirectURI = value(&i)
		default:
			switch {
			case strings.HasPrefix(arg, "--"):
				fail("Unknown option: " + arg)
			case a.clientID != "":
				fail("Unexpected argument: " + arg)
			default:
				a.clientID = arg
			}
		}
	}

	if a.clientID == "" {
		fail("Missing <clientId>.")
	}
	if a.env == "aes" && a.aesOrigin == "" {
		fail(`--aes-origin is required when --env is "aes".`)
	}
	// AES hosts a single workspace, so there is nothing to select and no prompt
	// for it (SPEC §6) — request the workspace scope at sign-in instead.
	if selectWorkspaceSet && a.env == "aes" {
		fail("--select-workspace is not applicable to AES: no workspace-selection prompt (single workspace per installation).")
	}
	// Refresh and revoke both need a refresh token, which requires offline_access.
	if (a.refresh || a.revoke) && !slices.Contains(strings.Fields(a.scopes), "offline_access") {
		a.scopes = strings.TrimSpace(a.scopes + " offline_access")
	}
	return a
}

func endpointsFor(env, aesOrigin string) altiumauth.Endpoints {
	switch env {
	case "prod":
		return altiumauth.CommercialCloudEndpoints
	case "gov":
		return altiumauth.GovCloudEndpoints
	default: // "aes" (parseEnv rejects anything else)
		return altiumauth.AESEndpoints(aesOrigin) // validated present in parseArgs
	}
}

// workspaceScopeID returns the workspace ID requested by an a365:workspace:{id}
// scope, if the (space separated) scopes carry one.
func workspaceScopeID(scopes string) string {
	for _, s := range strings.Fields(scopes) {
		if id, ok := strings.CutPrefix(s, workspaceScopePrefix); ok {
			return id
		}
	}
	return ""
}

// decodeJWT decodes a JWT payload for human-readable output (no signature
// verification).
func decodeJWT(jwt string) map[string]any {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return nil
	}
	var claims map[string]any
	if json.Unmarshal(raw, &claims) != nil {
		return nil
	}
	return claims
}

func announceTest(label string) { fmt.Printf("\n⏺️  Testing: %s\n", label) }

func printTokens(label string, t *altiumauth.TokenSet) {
	fmt.Printf("\n✅ %s\n\n", label)
	fmt.Printf("  access_token : %s\n", t.AccessToken)
	if at := decodeJWT(t.AccessToken); at != nil {
		// The access token is a JWT — surface the claims that vary Commercial vs Gov.
		fmt.Printf("  ↳ iss        : %v\n", at["iss"])
		if secure, ok := at["secure"]; ok {
			fmt.Printf("  ↳ secure     : %v\n", secure)
		}
	}
	fmt.Printf("  token_type   : %s\n", t.TokenType)
	fmt.Printf("  expires_at   : %d\n", t.ExpiresAt)
	fmt.Printf("  scope        : %s\n", t.Scope)
	if t.RefreshToken != "" {
		fmt.Printf("  refresh_token: %s\n", t.RefreshToken)
	}
	if t.IDToken != "" {
		if claims := decodeJWT(t.IDToken); claims != nil {
			b, _ := json.MarshalIndent(claims, "", "  ")
			s := string(b)
			if len(s) > 300 {
				s = s[:300]
			}
			fmt.Printf("  id_token     : %s...\n", s)
		}
	}
}

// printUserinfo GETs the userinfo endpoint (derived from the authorize
// endpoint) and prints the response.
func printUserinfo(ctx context.Context, authEndpoint, accessToken string) error {
	u := strings.TrimSuffix(authEndpoint, "/connect/authorize") + "/connect/userinfo"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("User-Agent", altiumauth.UserAgent)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	fmt.Printf("\nℹ️  userinfo (%d) @ %s:\n%s\n", res.StatusCode, u, body)
	return nil
}

func main() {
	args := parseArgs(os.Args[1:])
	clientSecret := os.Getenv("A365_CLIENT_SECRET")
	ctx := context.Background()

	mkConfig := func(env string) altiumauth.Config {
		return altiumauth.Config{
			ClientID:     args.clientID,
			Scopes:       args.scopes,
			ClientSecret: clientSecret,
			Secure:       args.secure,
			Endpoints:    endpointsFor(env, args.aesOrigin),
		}
	}
	signInConfig := mkConfig(args.env)
	exchangeEnv := args.workspaceEnv
	if exchangeEnv == "" {
		exchangeEnv = args.env
	}
	exchangeConfig := mkConfig(exchangeEnv)

	redirectURI := args.redirectURI
	if redirectURI == "" {
		redirectURI = signInConfig.RedirectURI
	}

	// Authorize-URL mode: print the URL to sign in with a custom callback, then
	// exit. Use this for confidential/custom-redirect clients that can't use
	// ActionWait.
	if args.authorizeURL {
		authz, err := signInConfig.CreateAuthorizationURL(altiumauth.AuthorizationURLOptions{
			RedirectURI: args.redirectURI, SelectWorkspace: args.selectWorkspace,
		})
		if err != nil {
			fail(err.Error())
		}
		fmt.Print("=== altium-auth authorize URL ===\n\n")
		fmt.Printf("redirect_uri : %s\n", redirectURI)
		fmt.Printf("state         : %s\n", authz.State)
		fmt.Printf("code_verifier : %s\n", authz.CodeVerifier)
		fmt.Printf("\nOpen this URL in a browser to sign in:\n%s\n", authz.URL)
		fmt.Printf("\nYour callback receives ?code=…&state=%s. Then exchange it:\n", authz.State)
		redirectFlag := ""
		if args.redirectURI != "" {
			redirectFlag = " --redirect-uri " + args.redirectURI
		}
		fmt.Printf("  go run ./tools/signintest --exchange-code <code> --code-verifier %s%s %s\n", authz.CodeVerifier, redirectFlag, args.clientID)
		os.Exit(0)
	}

	fmt.Print("=== altium-auth sign-in E2E test ===\n\n")
	clientType := "public (PKCE)"
	if clientSecret != "" {
		clientType = "confidential (HTTP Basic)"
	}
	fmt.Printf("Client type   : %s\n", clientType)
	secureMode := "auto (from token endpoint)"
	if args.secure != nil {
		secureMode = map[bool]string{true: "forced on", false: "forced off"}[*args.secure]
	}
	fmt.Printf("secure=1      : %s\n", secureMode)
	fmt.Printf("Scopes        : %s\n", signInConfig.Scopes)
	if args.selectWorkspace != "" && args.selectWorkspace != altiumauth.SelectWorkspaceNone {
		fmt.Printf("selectWorkspace: %s (login-into-workspace)\n", args.selectWorkspace)
	}
	fmt.Printf("Token host    : %s\n", signInConfig.TokenEndpoint)
	if args.code != "" {
		fmt.Printf("Mode          : exchange authorization code (redirect_uri=%s)\n", redirectURI)
	} else {
		fmt.Printf("Sign-in       : %s\n", signInConfig.AuthEndpoint)
		fmt.Printf("ActionWait    : %s\n", signInConfig.ActionWaitEndpoint)
	}
	if args.workspace != "" {
		fmt.Printf("Exchange (%s): %s\n", exchangeEnv, exchangeConfig.TokenEndpoint)
	}

	if err := run(ctx, args, signInConfig, exchangeConfig, exchangeEnv); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ E2E test failed: %v\n\n", err)
		os.Exit(1)
	}
	fmt.Print("\n✅ E2E test passed.\n\n")
}

func run(ctx context.Context, args cliArgs, signInConfig, exchangeConfig altiumauth.Config, exchangeEnv string) error {
	// 1. Test the two-trip sign-in (global token → workspace token).
	current, tokenConfig, err := testTwoTripSignIn(ctx, args, signInConfig, exchangeConfig)
	if err != nil {
		return err
	}
	// 2. Test the one-trip sign-in (direct workspace token). It requests the
	//    workspace scope at sign-in on args.env's host, so it only applies when
	//    the workspace lives in that same environment — in bridge mode (e.g.
	//    --workspace-env gov) the workspace is on another partition, so a direct
	//    scope request is denied (use the two-trip exchange above). It also needs
	//    its own browser round trip and a code can only be redeemed once, so it
	//    is skipped in --exchange-code mode (the code was spent on test 1).
	switch {
	case args.code == "" && exchangeEnv != args.env:
		fmt.Printf("\n⏸️  Skipping one-trip sign-in: the workspace lives in '%s' but sign-in is on '%s'. Requesting that workspace scope at the '%s' /authorize endpoint is cross-partition (access_denied) — use the two-trip exchange (above).\n", exchangeEnv, args.env, args.env)
	case args.code == "":
		oneTripConfig := signInConfig
		if args.workspace != "" {
			fmt.Printf("Adding scope for workspace %s to test one-trip sign-in.\n", args.workspace)
			oneTripConfig.Scopes = oneTripConfig.Scopes + " " + workspaceScopePrefix + args.workspace
		} else {
			// Discover the workspace scope (AES: one workspace per installation)
			// and *add* it to the configured scopes. Substituting the introspected
			// list wholesale would drop offline_access — auto-added by
			// --refresh/--revoke — along with any custom --scopes.
			scopes, err := testScopeIntrospection(ctx, args, signInConfig)
			if err != nil {
				return err
			}
			for _, s := range scopes {
				if strings.HasPrefix(s, workspaceScopePrefix) {
					oneTripConfig.Scopes = signInConfig.Scopes + " " + s
					break
				}
			}
		}
		if err := testOneTripSignIn(ctx, args, oneTripConfig); err != nil {
			return err
		}
	}
	// 3. Test refresh if requested.
	if args.refresh {
		if current, err = testRefresh(ctx, current, tokenConfig); err != nil {
			return err
		}
	}
	// 4. Test revocation if requested.
	if args.revoke {
		if err := testRevoke(ctx, current, tokenConfig); err != nil {
			return err
		}
	}
	return nil
}

func signInOrExchange(ctx context.Context, args cliArgs, cfg altiumauth.Config) (*altiumauth.TokenSet, error) {
	// Obtain tokens via a manual authorization code (confidential/custom
	// redirect) or the interactive ActionWait sign-in.
	if args.code != "" {
		return cfg.ExchangeCode(ctx, altiumauth.ExchangeCodeParams{
			Code: args.code, CodeVerifier: args.codeVerifier, RedirectURI: args.redirectURI,
		})
	}
	return cfg.SignIn(ctx, altiumauth.SignInOptions{Timeout: 5 * time.Minute, SelectWorkspace: args.selectWorkspace})
}

func testScopeIntrospection(ctx context.Context, args cliArgs, signInConfig altiumauth.Config) ([]string, error) {
	if signInConfig.ScopeEndpoint == "" {
		fmt.Println("\n⏸️  Skipping scope introspection (no endpoint configured).")
		return nil, nil
	}
	announceTest("Client scope introspection")
	scopes, err := altiumauth.GetClientScopes(ctx, nil, signInConfig.ScopeEndpoint, args.clientID)
	if err != nil {
		return nil, err
	}
	joined := strings.Join(scopes, " ")
	if joined == "" {
		joined = "(none returned)"
	}
	fmt.Printf("\n✅ Client scopes for %s @ %s: %s\n", args.clientID, args.aesOrigin, joined)
	return scopes, nil
}

func testTwoTripSignIn(ctx context.Context, args cliArgs, signInConfig, exchangeConfig altiumauth.Config) (*altiumauth.TokenSet, altiumauth.Config, error) {
	announceTest("Two-trip sign-in (global token → workspace token)")
	global, err := signInOrExchange(ctx, args, signInConfig)
	if err != nil {
		return nil, signInConfig, err
	}
	printTokens("Global token:", global)
	if args.userinfo {
		if err := printUserinfo(ctx, signInConfig.AuthEndpoint, global.AccessToken); err != nil {
			return nil, signInConfig, err
		}
	}
	if args.workspace == "" {
		fmt.Println("\n⏸️  Skipping workspace token exchange (no --workspace provided).")
		return global, signInConfig, nil
	}
	ws, err := exchangeConfig.SignIntoWorkspace(ctx, global.AccessToken, args.workspace)
	if err != nil {
		return nil, exchangeConfig, err
	}
	printTokens(fmt.Sprintf("Workspace token (%s) [two-trip]:", args.workspace), ws)
	return ws, exchangeConfig, nil
}

func testOneTripSignIn(ctx context.Context, args cliArgs, signInConfig altiumauth.Config) error {
	requested := workspaceScopeID(signInConfig.Scopes)
	if requested == "" {
		// This would exercise the same path as the global token in
		// testTwoTripSignIn, so skip it to avoid duplicate output.
		fmt.Println("\n⏸️  Skipping one-trip workspace sign-in (no workspace scope requested).")
		return nil
	}
	announceTest("One-trip sign-in (direct workspace token)")
	tokens, err := signInOrExchange(ctx, args, signInConfig)
	if err != nil {
		return err
	}
	printTokens(fmt.Sprintf("Workspace Token (%s) [one-trip]:", requested), tokens)
	if args.userinfo {
		return printUserinfo(ctx, signInConfig.AuthEndpoint, tokens.AccessToken)
	}
	return nil
}

func testRefresh(ctx context.Context, current *altiumauth.TokenSet, tokenConfig altiumauth.Config) (*altiumauth.TokenSet, error) {
	// Refresh/revoke operate on the exchanged token (if any), else the global
	// token — always at the endpoint that issued it.
	if current.RefreshToken == "" {
		fmt.Fprintln(os.Stderr, "\n⚠️  --refresh requested but no refresh_token was returned (is offline_access granted?).")
		return current, nil
	}
	announceTest("Refresh token")
	fmt.Println("\nRefreshing token: " + current.RefreshToken)
	refreshed, err := tokenConfig.RefreshToken(ctx, current.RefreshToken)
	if err != nil {
		return nil, err
	}
	printTokens("Refreshed token:", refreshed)
	return refreshed, nil
}

func testRevoke(ctx context.Context, current *altiumauth.TokenSet, tokenConfig altiumauth.Config) error {
	if current.RefreshToken == "" {
		fmt.Fprintln(os.Stderr, "\n⚠️  --revoke requested but no refresh_token is available (is offline_access granted?).")
		return nil
	}
	// Uses the library's RevokeRefreshToken (client auth from config).
	announceTest("Revoke token")
	fmt.Println("\nRevoking token: " + current.RefreshToken)
	if err := tokenConfig.RevokeRefreshToken(ctx, current.RefreshToken); err != nil {
		return err
	}
	fmt.Println("\n🔒 revocation request sent (RFC 7009: 200 for known/unknown tokens).")
	// Prove it: a refresh with the revoked token should now fail. If it still
	// works, the test has failed — fail the run rather than printing a ❌ under a
	// green summary.
	if _, err := tokenConfig.RefreshToken(ctx, current.RefreshToken); err != nil {
		fmt.Println("\n✅ Refresh after revocation was rejected, as expected: " + err.Error())
		return nil
	}
	return errors.New("refresh still succeeded after revocation — the revocation did not take effect")
}

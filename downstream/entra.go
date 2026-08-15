package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// One cached access token. Entra issues these for about an hour, independent of the
// SVID underneath being refreshed every few minutes.
var (
	entraMu      sync.Mutex
	entraCached  string
	entraExpires time.Time
)

// Names the API being asked for. Injected by the platform, one per app this one
// already declared in consumes - the URI format is the platform's own, so building it
// here would mean guessing at a convention this app cannot see. /.default means "every
// role already granted to me there"; naming a single role would ask a user to consent,
// and there is no user.
func entraScope() string {
	return os.Getenv("ENTRA_SCOPE_UPSTREAM_API")
}

// Trades this pod's SVID for an Entra access token. No secret involved - the SVID is
// the proof, and the federated credential is why Entra accepts it.
func fetchEntraToken(ctx context.Context) (string, error) {
	entraMu.Lock()
	defer entraMu.Unlock()

	// Refresh a minute early - a token expiring mid-flight fails at the callee and
	// looks exactly like a refusal.
	if entraCached != "" && time.Now().Before(entraExpires.Add(-time.Minute)) {
		return entraCached, nil
	}

	tenantID := os.Getenv("AZURE_TENANT_ID")
	clientID := os.Getenv("AZURE_CLIENT_ID")
	tokenFile := os.Getenv("AZURE_FEDERATED_TOKEN_FILE")
	if tenantID == "" || clientID == "" || tokenFile == "" {
		return "", fmt.Errorf("entra not configured on this pod")
	}
	// Set by the platform from consumes. Missing means this Api never declared that it
	// calls upstream-api, so there is no API to ask for a token against.
	if entraScope() == "" {
		return "", fmt.Errorf("no Entra scope for upstream-api - is it in consumes?")
	}

	assertion, err := os.ReadFile(tokenFile)
	if err != nil {
		return "", fmt.Errorf("read svid: %w", err)
	}

	form := url.Values{
		"grant_type":            {"client_credentials"},
		"client_id":             {clientID},
		"client_assertion_type": {"urn:ietf:params:oauth:client-assertion-type:jwt-bearer"},
		"client_assertion":      {strings.TrimSpace(string(assertion))},
		"scope":                 {entraScope()},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://login.microsoftonline.com/"+tenantID+"/oauth2/v2.0/token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token endpoint: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		// Only the error code, never the body - it can echo the assertion back.
		var e struct {
			Error string `json:"error"`
		}
		json.Unmarshal(body, &e) //nolint:errcheck
		return "", fmt.Errorf("token endpoint refused: %s (%d)", e.Error, resp.StatusCode)
	}

	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("token endpoint returned no access_token")
	}

	entraCached = tok.AccessToken
	entraExpires = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	return entraCached, nil
}

// Both callers run this same code and both hold a real Entra identity. Only one was
// granted the role, and that difference shows up at the callee, not here.
func entraHandler(target string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := fetchEntraToken(r.Context())
		if err != nil {
			// Not "denied" - this pod could not prove who it is, which is a broken
			// platform rather than a working boundary.
			record("entra", "error")
			writeJSONError(w, "entra token exchange failed: "+err.Error(), http.StatusBadGateway)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			record("entra", "error")
			writeJSONError(w, "build request failed", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := httpClient.Do(req)
		if err != nil {
			record("entra", "unreachable")
			writeJSONError(w, "upstream call failed", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close() //nolint:errcheck
		record("entra", outcome(resp.StatusCode))

		body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if err != nil {
			writeJSONError(w, "read upstream response failed", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(resp.StatusCode)
		w.Write(body) //nolint:errcheck
	}
}

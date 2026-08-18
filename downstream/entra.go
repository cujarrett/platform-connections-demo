package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
)

// Built once. WorkloadIdentityCredential re-reads AZURE_FEDERATED_TOKEN_FILE on every
// GetToken call and caches the resulting access token itself, so there is nothing left
// for this app to cache or refresh by hand.
var (
	entraCredOnce sync.Once
	entraCred     *azidentity.WorkloadIdentityCredential
	entraCredErr  error
)

func entraCredential() (*azidentity.WorkloadIdentityCredential, error) {
	entraCredOnce.Do(func() {
		entraCred, entraCredErr = azidentity.NewWorkloadIdentityCredential(nil)
	})
	return entraCred, entraCredErr
}

// Names the API being asked for. Injected by the platform, one per app this one
// already declared in consumes - the URI format is the platform's own, so building it
// here would mean guessing at a convention this app cannot see. /.default means "every
// role already granted to me there"; naming a single role would ask a user to consent,
// and there is no user.
func entraScope() string {
	return os.Getenv("ENTRA_SCOPE_UPSTREAM_API")
}

// svidSubject reads the sub claim out of this pod's own SVID, for display only - the
// credential above reads the same file itself to build the actual assertion. No
// verification here: it is our own token, read from our own file, and used for display.
func svidSubject() string {
	raw, err := os.ReadFile(os.Getenv("AZURE_FEDERATED_TOKEN_FILE"))
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.TrimSpace(string(raw)), ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var c struct {
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(payload, &c); err != nil {
		return ""
	}
	return c.Sub
}

// What this side of the exchange looked like. A GUID on its own says nothing, so the
// client id is shown next to the app it belongs to.
type exchangedView struct {
	Proved   string `json:"proved"`
	AskedFor string `json:"asked_for"`
	As       string `json:"as"`
}

// scopeLabel pulls the app name out of "api://<tenant-guid>/<app-name>/.default" - the
// one part of the scope worth reading. This row is one line, scrolled rather than
// wrapped (styles.css .token-v), so without this the readable segment sits behind a
// 36-character tenant GUID that nobody scrolls past to find it.
func scopeLabel(scope string) string {
	parts := strings.Split(strings.TrimPrefix(scope, "api://"), "/")
	if len(parts) >= 2 && parts[1] != "" {
		return parts[1]
	}
	return scope
}

// The app name is the last segment of the SPIFFE ID this pod already proved.
func appNameFromSVID() string {
	sub := svidSubject()
	if i := strings.LastIndex(sub, "/"); i >= 0 {
		return sub[i+1:]
	}
	return sub
}

// Trades this pod's SVID for an Entra access token via the same Azure SDK a real
// platform user would reach for - WorkloadIdentityCredential is built for exactly this
// federated-credential shape. No secret involved - the SVID is the proof, and the
// federated credential is why Entra accepts it.
func fetchEntraToken(ctx context.Context) (string, error) {
	// Set by the platform from consumes. Missing means this Api never declared that it
	// calls upstream-api, so there is no API to ask for a token against.
	if entraScope() == "" {
		return "", fmt.Errorf("no Entra scope for upstream-api - is it in consumes?")
	}

	cred, err := entraCredential()
	if err != nil {
		return "", fmt.Errorf("entra not configured on this pod: %w", err)
	}

	tok, err := cred.GetToken(ctx, policy.TokenRequestOptions{Scopes: []string{entraScope()}})
	if err != nil {
		// azidentity.AuthenticationFailedError.Error() dumps the full token-endpoint
		// request URL and response body - correlation IDs, timestamps, diagnostic
		// text. This response is public, so only a fixed reason leaves the process;
		// the real error goes to the log instead.
		slog.Warn("entra token exchange failed", "err", err)
		return "", fmt.Errorf("token endpoint refused the request")
	}
	return tok.Token, nil
}

// One token, two routes. The same identity is granted the role one of them needs and
// not the other, so the difference shows up at the callee rather than here.
func entraHandler(name, target string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := fetchEntraToken(r.Context())
		if err != nil {
			// Not "denied" - this pod could not prove who it is, which is a broken
			// platform rather than a working boundary.
			record(name, "error")
			writeJSONError(w, "entra token exchange failed: "+err.Error(), http.StatusBadGateway)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			record(name, "error")
			writeJSONError(w, "build request failed", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := httpClient.Do(req)
		if err != nil {
			record(name, "unreachable")
			writeJSONError(w, "upstream call failed", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close() //nolint:errcheck
		record(name, outcome(resp.StatusCode))

		body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if err != nil {
			writeJSONError(w, "read upstream response failed", http.StatusBadGateway)
			return
		}

		// What this side of the exchange looked like. The SVID and the access token are
		// both credentials, so neither appears here - only the identity that was proven
		// and the API it was traded for, both of which are already public config.
		// The callee's verdict first - it is the thing worth reading. A struct, not a
		// map, because Go sorts map keys and would lead with a GUID.
		out, err := json.Marshal(struct {
			Upstream  json.RawMessage `json:"upstream_said"`
			Exchanged exchangedView   `json:"exchanged"`
		}{
			Upstream: json.RawMessage(body),
			Exchanged: exchangedView{
				Proved:   svidSubject(),
				AskedFor: scopeLabel(entraScope()) + " · " + entraScope(),
				As:       appNameFromSVID() + " · " + os.Getenv("AZURE_CLIENT_ID"),
			},
		})
		if err != nil {
			writeJSONError(w, "encode response failed", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(resp.StatusCode)
		w.Write(out) //nolint:errcheck
	}
}

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// Role names as declared under entra.roles in this Api's workspace file. Declared and
// granted there; only checked here. Data.Admin is offered to nobody, so holding an
// identity this API trusts is still not enough to pass it.
const (
	roleRead  = "Data.Read"
	roleAdmin = "Data.Admin"
)

// Nil until discovery completes. Fetched in the background so an Entra blip cannot
// stop this pod becoming ready and take the mesh half of the demo down with it.
var entraVerifier atomic.Pointer[oidc.IDTokenVerifier]

// Split rather than summed - the refused series is the one worth watching.
var (
	entraAllowed atomic.Int64
	entraRefused atomic.Int64
)

// This API's own client id, injected by the platform. A v2 access token carries the
// resource's client id in aud, whatever identifier the caller asked by - so a caller
// naming this API by App ID URI still produces a token audienced to this id.
func expectedAudience() string {
	return os.Getenv("AZURE_CLIENT_ID")
}

// Resolves the verifier in the background, retrying forever. Reads no secret,
// because this flow has none.
func startEntraVerifier(ctx context.Context) {
	tenantID := os.Getenv("AZURE_TENANT_ID")
	// No audience means nothing to check against, so refuse everything rather than
	// verify half a token.
	if tenantID == "" || expectedAudience() == "" {
		slog.Info("entra not configured, protected endpoint will refuse everything")
		return
	}

	go func() {
		for {
			// v2.0 issuer. The v1 endpoint mints tokens from sts.windows.net, which
			// fails issuer validation here even though the token is otherwise good.
			provider, err := oidc.NewProvider(ctx, "https://login.microsoftonline.com/"+tenantID+"/v2.0")
			if err == nil {
				// aud is the check that catches a token which is real, signed and
				// unexpired, and minted for a different API.
				entraVerifier.Store(provider.Verifier(&oidc.Config{ClientID: expectedAudience()}))
				slog.Info("entra verifier ready", "tenant", tenantID, "audience", expectedAudience())
				return
			}
			slog.Warn("entra discovery failed, retrying", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
			}
		}
	}()
}

// The Entra half. The mesh already allowed the connection; this asks the separate
// question of whether that identity was granted the role this route needs.
func entraRoleHandler(requiredRole string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { checkRole(w, r, requiredRole) }
}

func checkRole(w http.ResponseWriter, r *http.Request, requiredRole string) {
	verifier := entraVerifier.Load()
	if verifier == nil {
		// Not a refusal - nothing was checked. Saying "denied" would teach the wrong lesson.
		entraDeny(w, http.StatusServiceUnavailable, "verifier_unavailable",
			"Entra discovery has not completed yet")
		return
	}

	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || raw == "" {
		entraDeny(w, http.StatusUnauthorized, "no_token", "no bearer token presented")
		return
	}

	// Signature, issuer, audience and expiry. Entra is not called here - the keys
	// were fetched once at startup.
	tok, err := verifier.Verify(r.Context(), raw)
	if err != nil {
		// 401, not 403: the token itself did not hold up, so the caller has not been
		// refused - it has not been believed.
		//
		// The reason stays in the log. This response is public, and a library error
		// string is not something to pipe there on trust - what it says today is
		// audience and issuer detail, but that is the library's choice to change.
		slog.Warn("entra token rejected", "err", err)
		entraDeny(w, http.StatusUnauthorized, "invalid_token",
			"signature, issuer, audience or expiry did not check out")
		return
	}

	// Only the claims go-oidc does not already expose. aud, iss and exp are read off
	// the token below instead - aud in particular is a string in some tokens and an
	// array in others, and the library has already normalised that.
	var claims struct {
		Roles []string `json:"roles"`
		// azp, not appid - appid is a v1 claim, and these tokens are v2.
		AppID string `json:"azp"`
	}
	if err := tok.Claims(&claims); err != nil {
		slog.Warn("entra claims unreadable", "err", err)
		entraDeny(w, http.StatusUnauthorized, "unreadable_claims", "could not read the token claims")
		return
	}

	// What the demo shows instead of the token. These are identifiers, not secrets -
	// no signature, no raw JWT, and never the SVID that bought it. The token itself is
	// a bearer credential for about an hour and this walkthrough is public, so it does
	// not leave this process.
	// Field order is the reading order, and a bare GUID teaches nothing - each one is
	// labelled with what it identifies. Structs, not maps: Go sorts map keys, which
	// would put the GUIDs first and the decision last.
	presented := tokenView{
		Roles:     claims.Roles,
		Azp:       claims.AppID + " · the caller",
		Aud:       strings.Join(tok.Audience, ", ") + " · this API",
		Iss:       tok.Issuer,
		ExpiresIn: fmt.Sprintf("%ds", max(0, int64(time.Until(tok.Expiry).Seconds()))),
	}

	// The line the demo turns on. A refused caller still arrives with a real, valid
	// token - it just does not carry the role this route wants.
	if !slices.Contains(claims.Roles, requiredRole) {
		entraRefused.Add(1)
		slog.Info("entra refused", "azp", claims.AppID, "roles", claims.Roles, "required", requiredRole)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(decision{ //nolint:errcheck
			Why:       "the token is valid and this role is not in it",
			Needs:     requiredRole,
			Held:      claims.Roles,
			Error:     "missing_role",
			Gate:      "entra",
			Presented: presented,
		})
		return
	}

	entraAllowed.Add(1)
	slog.Info("entra allowed", "azp", claims.AppID, "roles", claims.Roles)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(decision{ //nolint:errcheck
		Why:       "the token carries the role this route requires",
		Needs:     requiredRole,
		Held:      claims.Roles,
		Presented: presented,
	})
}

// What the callee received, in reading order. Nothing here is a credential: the
// signature and the token itself never leave this process.
type tokenView struct {
	Roles     []string `json:"roles"`
	Azp       string   `json:"azp"`
	Aud       string   `json:"aud"`
	Iss       string   `json:"iss"`
	ExpiresIn string   `json:"expires_in"`
}

// The verdict first, then what it was reached from.
type decision struct {
	Why       string    `json:"why"`
	Needs     string    `json:"needs"`
	Held      []string  `json:"held"`
	Error     string    `json:"error,omitempty"`
	Gate      string    `json:"gate,omitempty"`
	Presented tokenView `json:"presented"`
}

// Always names which check failed - a mesh 403 and a role 403 look identical from
// outside, and a bare one teaches nothing.
func entraDeny(w http.ResponseWriter, code int, reason, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
		"error":  reason,
		"detail": detail,
		"gate":   "entra",
	})
}

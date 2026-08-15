package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// roundTrip is what the walkthrough renders. Steps are listed in the order they
// ran so a partial failure shows how far the call got.
type roundTrip struct {
	Binding string   `json:"binding"`
	Status  string   `json:"status"` // ok | not_configured | starting | error
	Detail  string   `json:"detail"`
	Steps   []string `json:"steps,omitempty"`
	Ms      int64    `json:"ms,omitempty"`
}

func bindingRoot() string {
	if r := os.Getenv("SERVICE_BINDING_ROOT"); r != "" {
		return r
	}
	return "/bindings"
}

// readBinding loads one servicebinding.io directory. Each file is one key.
func readBinding(name string) (map[string]string, bool) {
	dir := filepath.Join(bindingRoot(), name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, false
	}
	b := make(map[string]string, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		v, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		b[e.Name()] = strings.TrimSpace(string(v))
	}
	return b, true
}

// hasProfile reports whether the credential sidecar has written this binding's
// profile yet. The profile name always equals the binding directory name.
func hasProfile(name string) bool {
	f := os.Getenv("AWS_SHARED_CREDENTIALS_FILE")
	if f == "" {
		return false
	}
	data, err := os.ReadFile(f)
	if err != nil {
		return false
	}
	return strings.Contains(string(data), "["+name+"]")
}

func awsConfig(ctx context.Context, profile, region string) (aws.Config, error) {
	return config.LoadDefaultConfig(ctx,
		config.WithSharedConfigProfile(profile),
		config.WithRegion(region),
	)
}

func writeRoundTrip(w http.ResponseWriter, rt roundTrip) {
	w.Header().Set("Content-Type", "application/json")
	if rt.Status == "error" {
		w.WriteHeader(http.StatusBadGateway)
	}
	_ = json.NewEncoder(w).Encode(rt)
}

// tableHandler round-trips an item through the bound table: write, read back,
// delete. The partition key is the platform default, `id`.
func tableHandler(w http.ResponseWriter, r *http.Request) {
	rt := roundTrip{Binding: "nosql"}
	b, ok := readBinding("nosql")
	if !ok {
		rt.Status, rt.Detail = "not_configured", "no nosql binding mounted"
		writeRoundTrip(w, rt)
		return
	}
	if !hasProfile("nosql") {
		rt.Status, rt.Detail = "starting", "binding ready, waiting on credentials"
		writeRoundTrip(w, rt)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	cfg, err := awsConfig(ctx, "nosql", b["region"])
	if err != nil {
		slog.Warn("dynamodb round trip failed", "op", "config", "err", err)
		rt.Status, rt.Detail = "error", "credential load failed"
		writeRoundTrip(w, rt)
		return
	}

	client := dynamodb.NewFromConfig(cfg)
	table := aws.String(b["table-name"])
	key := map[string]ddbtypes.AttributeValue{
		"id": &ddbtypes.AttributeValueMemberS{Value: fmt.Sprintf("connections-demo-%d", time.Now().UnixNano())},
	}
	start := time.Now()

	if _, err := client.PutItem(ctx, &dynamodb.PutItemInput{TableName: table, Item: key}); err != nil {
		slog.Warn("dynamodb round trip failed", "op", "put", "err", err)
		rt.Status, rt.Detail = "error", "write failed"
		writeRoundTrip(w, rt)
		return
	}
	rt.Steps = append(rt.Steps, "PutItem")

	// ConsistentRead so the read cannot be served by a stale replica - a demo
	// that intermittently reports "not found" teaches the wrong lesson.
	got, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: table, Key: key, ConsistentRead: aws.Bool(true),
	})
	if err != nil || got.Item == nil {
		slog.Warn("dynamodb round trip failed", "op", "get", "err", err)
		rt.Status, rt.Detail = "error", "read failed"
		writeRoundTrip(w, rt)
		return
	}
	rt.Steps = append(rt.Steps, "GetItem")

	if _, err := client.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: table, Key: key}); err != nil {
		slog.Warn("dynamodb round trip failed", "op", "delete", "err", err)
		rt.Status, rt.Detail = "error", "delete failed"
		writeRoundTrip(w, rt)
		return
	}
	rt.Steps = append(rt.Steps, "DeleteItem")

	rt.Status = "ok"
	rt.Ms = time.Since(start).Milliseconds()
	rt.Detail = fmt.Sprintf("wrote, read and deleted an item in %s", b["table-name"])
	writeRoundTrip(w, rt)
}

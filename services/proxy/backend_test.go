package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBackendConnectSuccess(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/proxy/connect" {
			t.Errorf("Unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}

		if r.Header.Get("Authorization") != "Bearer secret-123" {
			t.Errorf("Unexpected authorization header: %s", r.Header.Get("Authorization"))
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var reqBody map[string]string
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			http.Error(w, "Bad request", http.StatusBadRequest)
			return
		}

		if reqBody["hostname"] != "play-meliora.hikat.org" {
			t.Errorf("Unexpected hostname: %s", reqBody["hostname"])
		}

		if reqBody["intent"] != "LOGIN" {
			t.Errorf("Unexpected intent: %s", reqBody["intent"])
		}

		resp := ConnectResponse{
			Status:     "ONLINE",
			TargetHost: "node.hikat.org",
			TargetPort: 25565,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	client := NewBackendClient(ts.URL, "secret-123")
	resp, err := client.Connect(context.Background(), "play-meliora.hikat.org", "LOGIN")
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	if resp.Status != "ONLINE" {
		t.Errorf("Expected status ONLINE, got %s", resp.Status)
	}
	if resp.TargetHost != "node.hikat.org" || resp.TargetPort != 25565 {
		t.Errorf("Unexpected target: %s:%d", resp.TargetHost, resp.TargetPort)
	}
}

func TestBackendConnectNotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer ts.Close()

	client := NewBackendClient(ts.URL, "secret-123")
	resp, err := client.Connect(context.Background(), "play-unknown.hikat.org", "LOGIN")
	if err != nil {
		t.Fatalf("Expected nil error for 404 handled response, got %v", err)
	}

	if resp.Status != "UNAVAILABLE" {
		t.Errorf("Expected status UNAVAILABLE for 404, got %s", resp.Status)
	}
	if resp.Error != "SERVER_NOT_FOUND" {
		t.Errorf("Expected error SERVER_NOT_FOUND, got %s", resp.Error)
	}
}

func TestBackendGetRoutes(t *testing.T) {
	expectedRoutes := []ProxyRoute{
		{
			ServerID:   "s-1",
			PublicPort: 24455,
			TargetHost: "node.hikat.org",
			TargetPort: 24455,
		},
		{
			ServerID:   "s-1",
			PublicPort: 24456,
			TargetHost: "node.hikat.org",
			TargetPort: 24456,
		},
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/proxy/routes" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer secret-123" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(expectedRoutes)
	}))
	defer ts.Close()

	client := NewBackendClient(ts.URL, "secret-123")
	routes, err := client.GetRoutes(context.Background())
	if err != nil {
		t.Fatalf("GetRoutes failed: %v", err)
	}

	if len(routes) != 2 {
		t.Fatalf("Expected 2 routes, got %d", len(routes))
	}
	if routes[0].PublicPort != 24455 || routes[1].PublicPort != 24456 {
		t.Errorf("Routes mismatch: %+v", routes)
	}
}

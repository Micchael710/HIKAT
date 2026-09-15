package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ConnectResponse struct {
	Status     string `json:"status"`
	TargetHost string `json:"targetHost,omitempty"`
	TargetPort int    `json:"targetPort,omitempty"`
	Error      string `json:"error,omitempty"`
}

type ProxyRoute struct {
	ServerID   string `json:"serverId"`
	PublicPort int    `json:"publicPort"`
	TargetHost string `json:"targetHost"`
	TargetPort int    `json:"targetPort"`
}

type BackendClient struct {
	baseURL    string
	secret     string
	httpClient *http.Client
}

func NewBackendClient(baseURL, secret string) *BackendClient {
	cleanURL := strings.TrimRight(baseURL, "/")
	return &BackendClient{
		baseURL: cleanURL,
		secret:  secret,
		httpClient: &http.Client{
			Timeout: 3 * time.Second,
		},
	}
}

// Connect calls POST /internal/proxy/connect on the HiKAT backend.
func (b *BackendClient) Connect(ctx context.Context, hostname, intent string) (*ConnectResponse, error) {
	url := fmt.Sprintf("%s/internal/proxy/connect", b.baseURL)

	reqPayload := map[string]string{
		"hostname": hostname,
		"intent":   intent,
	}

	bodyBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal connect request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create connect request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", b.secret))

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("backend connect request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read backend response body: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return &ConnectResponse{Status: "UNAVAILABLE", Error: "SERVER_NOT_FOUND"}, nil
	}

	if resp.StatusCode != http.StatusOK {
		return &ConnectResponse{Status: "UNAVAILABLE", Error: fmt.Sprintf("HTTP %d", resp.StatusCode)}, nil
	}

	var connResp ConnectResponse
	if err := json.Unmarshal(respBytes, &connResp); err != nil {
		return nil, fmt.Errorf("failed to decode backend response: %w", err)
	}

	return &connResp, nil
}

// GetRoutes calls GET /internal/proxy/routes on the HiKAT backend.
func (b *BackendClient) GetRoutes(ctx context.Context) ([]ProxyRoute, error) {
	url := fmt.Sprintf("%s/internal/proxy/routes", b.baseURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create routes request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", b.secret))

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("backend routes request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("backend returned status %d for routes", resp.StatusCode)
	}

	var routes []ProxyRoute
	if err := json.NewDecoder(resp.Body).Decode(&routes); err != nil {
		return nil, fmt.Errorf("failed to decode routes response: %w", err)
	}

	return routes, nil
}

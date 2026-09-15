package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func parsePort(addr string) int {
	_, portStr, _ := net.SplitHostPort(addr)
	p, _ := strconv.Atoi(portStr)
	return p
}

func TestFlowStatusPingOnline(t *testing.T) {
	// 1. Mock Target Minecraft Server
	targetListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start target listener: %v", err)
	}
	defer targetListener.Close()

	targetReceived := make(chan []byte, 1)
	go func() {
		conn, err := targetListener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 512)
		n, _ := conn.Read(buf)
		targetReceived <- buf[:n]
		_, _ = conn.Write([]byte("PONG_STATUS"))
	}()

	targetPort := parsePort(targetListener.Addr().String())

	// 2. Mock HiKAT Backend
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status:     "ONLINE",
			TargetHost: "127.0.0.1",
			TargetPort: targetPort,
		})
	}))
	defer backendServer.Close()

	backend := NewBackendClient(backendServer.URL, "test-secret")

	// 3. Start in-memory listener for proxy
	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start proxy listener: %v", err)
	}
	defer proxyListener.Close()

	sem := make(chan struct{}, 10)
	go func() {
		conn, err := proxyListener.Accept()
		if err != nil {
			return
		}
		sem <- struct{}{}
		handleConnection(conn, backend, sem)
	}()

	// 4. Client connects and sends Handshake with nextState=1 (Status)
	clientConn, err := net.Dial("tcp", proxyListener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial proxy: %v", err)
	}
	defer clientConn.Close()

	rawHandshake := buildRawHandshake(765, "play-meliora.hikat.org\x00FML\x00", 25565, 1)
	if _, err := clientConn.Write(rawHandshake); err != nil {
		t.Fatalf("Failed to write handshake: %v", err)
	}

	// Verify target received raw handshake with FML marker intact
	select {
	case received := <-targetReceived:
		if !bytes.Equal(received, rawHandshake) {
			t.Errorf("Target did not receive exact raw handshake")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for target to receive handshake")
	}

	// Read response from target through proxy
	replyBuf := make([]byte, 64)
	n, err := clientConn.Read(replyBuf)
	if err != nil {
		t.Fatalf("Failed to read from client connection: %v", err)
	}
	if string(replyBuf[:n]) != "PONG_STATUS" {
		t.Errorf("Expected PONG_STATUS, got %s", string(replyBuf[:n]))
	}
}

func TestFlowStatusPingOfflineClosesImmediately(t *testing.T) {
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status: "OFFLINE",
		})
	}))
	defer backendServer.Close()

	backend := NewBackendClient(backendServer.URL, "test-secret")

	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start proxy listener: %v", err)
	}
	defer proxyListener.Close()

	sem := make(chan struct{}, 10)
	go func() {
		conn, err := proxyListener.Accept()
		if err != nil {
			return
		}
		sem <- struct{}{}
		handleConnection(conn, backend, sem)
	}()

	clientConn, err := net.Dial("tcp", proxyListener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial proxy: %v", err)
	}
	defer clientConn.Close()

	rawHandshake := buildRawHandshake(765, "play-meliora.hikat.org", 25565, 1)
	_, _ = clientConn.Write(rawHandshake)

	// In status ping when offline, proxy closes connection without sending anything
	buf := make([]byte, 128)
	n, err := clientConn.Read(buf)
	if err != io.EOF && n != 0 {
		t.Fatalf("Expected connection closed with EOF, got n=%d, err=%v", n, err)
	}
}

func TestFlowLoginStarted(t *testing.T) {
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status: "STARTED",
		})
	}))
	defer backendServer.Close()

	backend := NewBackendClient(backendServer.URL, "test-secret")

	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start proxy listener: %v", err)
	}
	defer proxyListener.Close()

	sem := make(chan struct{}, 10)
	go func() {
		conn, err := proxyListener.Accept()
		if err != nil {
			return
		}
		sem <- struct{}{}
		handleConnection(conn, backend, sem)
	}()

	clientConn, err := net.Dial("tcp", proxyListener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial proxy: %v", err)
	}
	defer clientConn.Close()

	rawHandshake := buildRawHandshake(765, "play-meliora.hikat.org", 25565, 2)
	_, _ = clientConn.Write(rawHandshake)

	// Read disconnect packet
	buf := make([]byte, 512)
	n, err := clientConn.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("Failed to read login disconnect packet: %v", err)
	}

	if n == 0 {
		t.Fatal("Expected disconnect packet, got 0 bytes")
	}

	// Contains the started message
	if !strings.Contains(string(buf[:n]), "El servidor se acaba de iniciar") {
		t.Errorf("Disconnect packet does not contain started message: %q", string(buf[:n]))
	}
}

func TestFlowLoginStarting(t *testing.T) {
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status: "STARTING",
		})
	}))
	defer backendServer.Close()

	backend := NewBackendClient(backendServer.URL, "test-secret")

	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start proxy listener: %v", err)
	}
	defer proxyListener.Close()

	sem := make(chan struct{}, 10)
	go func() {
		conn, err := proxyListener.Accept()
		if err != nil {
			return
		}
		sem <- struct{}{}
		handleConnection(conn, backend, sem)
	}()

	clientConn, err := net.Dial("tcp", proxyListener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial proxy: %v", err)
	}
	defer clientConn.Close()

	rawHandshake := buildRawHandshake(765, "play-meliora.hikat.org", 25565, 2)
	_, _ = clientConn.Write(rawHandshake)

	buf := make([]byte, 512)
	n, err := clientConn.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("Failed to read login disconnect packet: %v", err)
	}

	if n == 0 {
		t.Fatal("Expected disconnect packet, got 0 bytes")
	}

	if !strings.Contains(string(buf[:n]), "El servidor se está iniciando") {
		t.Errorf("Disconnect packet does not contain starting message: %q", string(buf[:n]))
	}
}

func TestFlowLoginOnlineButUnreachablePortTreatedAsStarting(t *testing.T) {
	// Backend claims online, but target port is closed (server process still warming up)
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status:     "ONLINE",
			TargetHost: "127.0.0.1",
			TargetPort: 64999, // unopened port
		})
	}))
	defer backendServer.Close()

	backend := NewBackendClient(backendServer.URL, "test-secret")

	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start proxy listener: %v", err)
	}
	defer proxyListener.Close()

	sem := make(chan struct{}, 10)
	go func() {
		conn, err := proxyListener.Accept()
		if err != nil {
			return
		}
		sem <- struct{}{}
		handleConnection(conn, backend, sem)
	}()

	clientConn, err := net.Dial("tcp", proxyListener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial proxy: %v", err)
	}
	defer clientConn.Close()

	rawHandshake := buildRawHandshake(764, "play-meliora.hikat.org", 25565, 2)
	_, _ = clientConn.Write(rawHandshake)

	buf := make([]byte, 512)
	n, err := clientConn.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("Failed to read login disconnect packet: %v", err)
	}

	// Must gracefully treat unreachable online target as STARTING
	if !strings.Contains(string(buf[:n]), "El servidor se está iniciando") {
		t.Errorf("Expected fallback to starting message, got %q", string(buf[:n]))
	}
}

func TestFlowLoginUnavailable(t *testing.T) {
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status: "UNAVAILABLE",
		})
	}))
	defer backendServer.Close()

	backend := NewBackendClient(backendServer.URL, "test-secret")

	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start proxy listener: %v", err)
	}
	defer proxyListener.Close()

	sem := make(chan struct{}, 10)
	go func() {
		conn, err := proxyListener.Accept()
		if err != nil {
			return
		}
		sem <- struct{}{}
		handleConnection(conn, backend, sem)
	}()

	clientConn, err := net.Dial("tcp", proxyListener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial proxy: %v", err)
	}
	defer clientConn.Close()

	rawHandshake := buildRawHandshake(764, "play-meliora.hikat.org", 25565, 2)
	_, _ = clientConn.Write(rawHandshake)

	buf := make([]byte, 512)
	n, err := clientConn.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("Failed to read login disconnect packet: %v", err)
	}

	if !strings.Contains(string(buf[:n]), "El servidor no está disponible en este momento") {
		t.Errorf("Expected unavailable message, got %q", string(buf[:n]))
	}
}

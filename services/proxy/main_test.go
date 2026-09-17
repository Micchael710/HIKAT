package main

import (
	"bytes"
	"encoding/json"
	"errors"
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
	expectedMsg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
	if !strings.Contains(string(buf[:n]), expectedMsg) {
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

	expectedMsg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
	if !strings.Contains(string(buf[:n]), expectedMsg) {
		t.Errorf("Disconnect packet does not contain starting message: %q", string(buf[:n]))
	}
}

func TestFlowLoginStopping(t *testing.T) {
	// Mock target server to verify proxy does NOT attempt to connect to it
	targetListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start target listener: %v", err)
	}
	defer targetListener.Close()

	targetConnected := make(chan struct{}, 1)
	go func() {
		conn, err := targetListener.Accept()
		if err == nil {
			conn.Close()
			targetConnected <- struct{}{}
		}
	}()

	targetPort := parsePort(targetListener.Addr().String())

	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ConnectResponse{
			Status:     "STOPPING",
			TargetHost: "127.0.0.1",
			TargetPort: targetPort,
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

	expectedMsg := "El servidor se está apagando. Inténtalo nuevamente en unos segundos."
	if !strings.Contains(string(buf[:n]), expectedMsg) {
		t.Errorf("Disconnect packet does not contain expected message %q, got: %q", expectedMsg, string(buf[:n]))
	}

	// Verify target was not connected
	select {
	case <-targetConnected:
		t.Error("Proxy unexpectedly connected to target server when status was STOPPING")
	case <-time.After(100 * time.Millisecond):
		// Expected: no connection to target
	}
}

func TestFlowLoginOnlineTargetInaccessible(t *testing.T) {
	backendCalls := 0
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backendCalls++
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

	if n == 0 {
		t.Fatal("Expected disconnect packet, got 0 bytes")
	}

	expectedMsg := "El servidor está encendido, pero no está aceptando conexiones en este momento. Inténtalo nuevamente en unos segundos."
	if !strings.Contains(string(buf[:n]), expectedMsg) {
		t.Errorf("Expected disconnect packet to contain %q, got: %q", expectedMsg, string(buf[:n]))
	}

	// Must NOT state STARTING
	if strings.Contains(string(buf[:n]), "El servidor se está iniciando") {
		t.Errorf("Did not expect message to claim STARTING, got: %q", string(buf[:n]))
	}

	// Must NOT make additional calls to Backend (no wake, no polling)
	if backendCalls != 1 {
		t.Errorf("Expected exactly 1 backend call, got %d", backendCalls)
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

func TestGracefulShutdown(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to create listener: %v", err)
	}

	done := make(chan struct{})
	loopExited := make(chan struct{})

	go func() {
		defer close(loopExited)
		for {
			_, err := listener.Accept()
			if err != nil {
				select {
				case <-done:
					return
				default:
					if errors.Is(err, net.ErrClosed) {
						return
					}
					continue
				}
			}
		}
	}()

	// Trigger shutdown
	close(done)
	listener.Close()

	select {
	case <-loopExited:
		// Exited cleanly without hanging or infinite loop
	case <-time.After(1 * time.Second):
		t.Fatal("Accept loop did not exit promptly on shutdown")
	}
}

func TestSendLoginDisconnectCleanClose(t *testing.T) {
	// 1. Create real localhost TCP listener
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to create listener: %v", err)
	}
	defer listener.Close()

	msg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
	disconnectPkt := BuildLoginDisconnect(765, msg)

	serverDone := make(chan struct{})
	var serverDuration time.Duration

	go func() {
		defer close(serverDone)
		conn, aErr := listener.Accept()
		if aErr != nil {
			return
		}
		defer conn.Close()

		start := time.Now()
		sendLoginDisconnect(conn, disconnectPkt)
		serverDuration = time.Since(start)
	}()

	// 2. Connect client to listener
	clientConn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatalf("Failed to dial server: %v", err)
	}
	defer clientConn.Close()

	// 3. Client sends pipelined extra bytes (simulating Login Start sent after Handshake)
	handshake := buildRawHandshake(765, "play-meliora.hikat.org", 25565, 2)
	loginStart := []byte{0x0b, 0x00, 0x09, 'P', 'l', 'a', 'y', 'e', 'r', '1', '2', '3'}
	pipelinedData := append(handshake, loginStart...)

	if _, err := clientConn.Write(pipelinedData); err != nil {
		t.Fatalf("Failed to write pipelined data: %v", err)
	}

	// 4. Client reads full disconnect packet until EOF
	_ = clientConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var received bytes.Buffer
	buf := make([]byte, 256)
	var readErr error

	for {
		n, rErr := clientConn.Read(buf)
		if n > 0 {
			received.Write(buf[:n])
		}
		if rErr != nil {
			readErr = rErr
			break
		}
	}

	// 5. Verify connection terminated with clean EOF, not Connection Reset
	if readErr != io.EOF {
		t.Fatalf("Expected connection to terminate cleanly with EOF, got error: %v", readErr)
	}

	// 6. Verify client received complete Disconnect packet
	if !bytes.Equal(received.Bytes(), disconnectPkt) {
		t.Fatalf("Received bytes mismatch: got %d bytes, expected %d bytes", received.Len(), len(disconnectPkt))
	}

	// 7. Verify helper finished within expected short timeout (< 1.5s)
	select {
	case <-serverDone:
		if serverDuration > 1500*time.Millisecond {
			t.Errorf("sendLoginDisconnect took unexpectedly long: %v", serverDuration)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for server to complete sendLoginDisconnect")
	}
}

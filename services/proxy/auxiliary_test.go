package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestAuxiliaryTCPForwardingSuccess(t *testing.T) {
	// 1. Mock Target TCP Server
	targetListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start target listener: %v", err)
	}
	defer targetListener.Close()

	targetReceived := make(chan []byte, 1)
	go func() {
		conn, aErr := targetListener.Accept()
		if aErr != nil {
			return
		}
		defer conn.Close()

		buf := make([]byte, 64)
		n, _ := conn.Read(buf)
		targetReceived <- buf[:n]
		_, _ = conn.Write([]byte("VOICE_TCP_PONG"))
	}()

	targetPort := parsePort(targetListener.Addr().String())

	// 2. Start Auxiliary TCP Route on ephemeral port (0)
	tcpInst, err := startTCPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: targetPort,
	})
	if err != nil {
		t.Fatalf("Failed to start TCP route: %v", err)
	}
	defer tcpInst.stop()

	// 3. Connect client to public port
	clientConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", tcpInst.publicPort))
	if err != nil {
		t.Fatalf("Failed to dial auxiliary TCP route: %v", err)
	}
	defer clientConn.Close()

	// 4. Send ping
	if _, err := clientConn.Write([]byte("VOICE_TCP_PING")); err != nil {
		t.Fatalf("Failed to write to auxiliary TCP route: %v", err)
	}

	// Verify target received ping
	select {
	case rec := <-targetReceived:
		if string(rec) != "VOICE_TCP_PING" {
			t.Fatalf("Target received %s, expected VOICE_TCP_PING", string(rec))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for target to receive TCP ping")
	}

	// Read reply on client
	reply := make([]byte, 64)
	n, err := clientConn.Read(reply)
	if err != nil {
		t.Fatalf("Failed to read TCP reply from client: %v", err)
	}
	if string(reply[:n]) != "VOICE_TCP_PONG" {
		t.Fatalf("Expected VOICE_TCP_PONG, got %s", string(reply[:n]))
	}
}

func TestAuxiliaryTCPTargetUnreachable(t *testing.T) {
	// Point to closed/unbound port
	tcpInst, err := startTCPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: 64997,
	})
	if err != nil {
		t.Fatalf("Failed to start TCP route: %v", err)
	}
	defer tcpInst.stop()

	clientConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", tcpInst.publicPort))
	if err != nil {
		t.Fatalf("Failed to dial auxiliary TCP route: %v", err)
	}
	defer clientConn.Close()

	// Since target dial fails, proxy closes incoming connection immediately
	buf := make([]byte, 64)
	n, err := clientConn.Read(buf)
	if err != io.EOF && n != 0 {
		t.Fatalf("Expected EOF when target is unreachable, got n=%d, err=%v", n, err)
	}
}

func TestAuxiliaryUDPForwardingAndResponse(t *testing.T) {
	// 1. Mock Target UDP Server
	targetAddr, err := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to resolve target UDP addr: %v", err)
	}
	targetListener, err := net.ListenUDP("udp", targetAddr)
	if err != nil {
		t.Fatalf("Failed to start target UDP listener: %v", err)
	}
	defer targetListener.Close()

	targetPort := targetListener.LocalAddr().(*net.UDPAddr).Port

	go func() {
		buf := make([]byte, 1024)
		n, senderAddr, rErr := targetListener.ReadFromUDP(buf)
		if rErr != nil {
			return
		}
		if string(buf[:n]) == "VOICE_UDP_PING" {
			_, _ = targetListener.WriteToUDP([]byte("VOICE_UDP_PONG"), senderAddr)
		}
	}()

	// 2. Start Auxiliary UDP Route
	var globalCounter int32
	udpInst, err := startUDPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: targetPort,
	}, &globalCounter)
	if err != nil {
		t.Fatalf("Failed to start UDP route: %v", err)
	}
	defer udpInst.stop()

	// 3. Client sends datagram
	clientUDPAddr, err := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to resolve client UDP addr: %v", err)
	}
	clientConn, err := net.ListenUDP("udp", clientUDPAddr)
	if err != nil {
		t.Fatalf("Failed to start client UDP conn: %v", err)
	}
	defer clientConn.Close()

	proxyUDPAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("127.0.0.1:%d", udpInst.publicPort))
	if err != nil {
		t.Fatalf("Failed to resolve proxy UDP addr: %v", err)
	}

	_, err = clientConn.WriteToUDP([]byte("VOICE_UDP_PING"), proxyUDPAddr)
	if err != nil {
		t.Fatalf("Failed to write datagram to proxy: %v", err)
	}

	// 4. Client reads response
	respBuf := make([]byte, 1024)
	_ = clientConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, respSender, err := clientConn.ReadFromUDP(respBuf)
	if err != nil {
		t.Fatalf("Failed to read UDP response: %v", err)
	}

	if string(respBuf[:n]) != "VOICE_UDP_PONG" {
		t.Fatalf("Expected VOICE_UDP_PONG, got %s", string(respBuf[:n]))
	}

	// CRITICAL: Verify response arrived from proxy's public port, NOT internal target
	if respSender.Port != udpInst.publicPort {
		t.Fatalf("Response arrived from port %d, expected public listener port %d", respSender.Port, udpInst.publicPort)
	}
}

func TestAuxiliaryUDPIsolatedSessionMaps(t *testing.T) {
	var globalCounter int32

	udp1, err := startUDPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: 64991,
	}, &globalCounter)
	if err != nil {
		t.Fatalf("Failed to start UDP route 1: %v", err)
	}
	defer udp1.stop()

	udp2, err := startUDPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: 64992,
	}, &globalCounter)
	if err != nil {
		t.Fatalf("Failed to start UDP route 2: %v", err)
	}
	defer udp2.stop()

	// Send datagram to udp1
	clientConn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	if err != nil {
		t.Fatalf("Failed to start client: %v", err)
	}
	defer clientConn.Close()

	dest1, _ := net.ResolveUDPAddr("udp", fmt.Sprintf("127.0.0.1:%d", udp1.publicPort))
	_, _ = clientConn.WriteToUDP([]byte("HELLO_1"), dest1)

	// Allow readLoop to process
	time.Sleep(50 * time.Millisecond)

	udp1.mu.Lock()
	sessCount1 := len(udp1.sessions)
	udp1.mu.Unlock()

	udp2.mu.Lock()
	sessCount2 := len(udp2.sessions)
	udp2.mu.Unlock()

	if sessCount1 != 1 {
		t.Errorf("Expected 1 session in listener 1, got %d", sessCount1)
	}
	if sessCount2 != 0 {
		t.Errorf("Expected 0 sessions in listener 2, got %d", sessCount2)
	}
}

func TestAuxiliaryUDPInactivityCleanup(t *testing.T) {
	// Set fast cleanup for test
	origInact := udpInactivity
	origClean := udpCleanupInterval
	udpInactivity = 50 * time.Millisecond
	udpCleanupInterval = 20 * time.Millisecond
	defer func() {
		udpInactivity = origInact
		udpCleanupInterval = origClean
	}()

	var globalCounter int32
	udpInst, err := startUDPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: 64993,
	}, &globalCounter)
	if err != nil {
		t.Fatalf("Failed to start UDP route: %v", err)
	}
	defer udpInst.stop()

	clientConn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	if err != nil {
		t.Fatalf("Failed to start client: %v", err)
	}
	defer clientConn.Close()

	proxyAddr, _ := net.ResolveUDPAddr("udp", fmt.Sprintf("127.0.0.1:%d", udpInst.publicPort))
	_, _ = clientConn.WriteToUDP([]byte("TEST"), proxyAddr)

	time.Sleep(30 * time.Millisecond)

	udpInst.mu.Lock()
	if len(udpInst.sessions) != 1 {
		udpInst.mu.Unlock()
		t.Fatalf("Expected 1 session created, got %d", len(udpInst.sessions))
	}
	udpInst.mu.Unlock()

	if atomic.LoadInt32(&globalCounter) != 1 {
		t.Fatalf("Expected global counter 1, got %d", atomic.LoadInt32(&globalCounter))
	}

	// Wait for inactivity expiration and cleanup loop trigger (50ms inactivity + 20ms ticker)
	time.Sleep(100 * time.Millisecond)

	udpInst.mu.Lock()
	finalCount := len(udpInst.sessions)
	udpInst.mu.Unlock()

	if finalCount != 0 {
		t.Errorf("Expected session to be cleaned up after inactivity, got %d sessions remaining", finalCount)
	}
	if atomic.LoadInt32(&globalCounter) != 0 {
		t.Errorf("Expected global counter 0, got %d", atomic.LoadInt32(&globalCounter))
	}
}

func TestAuxiliaryUDPGlobalLimit(t *testing.T) {
	origMax := maxUDPSessions
	maxUDPSessions = 2
	defer func() {
		maxUDPSessions = origMax
	}()

	var globalCounter int32
	udpInst, err := startUDPRoute(ProxyRoute{
		PublicPort: 0,
		TargetHost: "127.0.0.1",
		TargetPort: 64994,
	}, &globalCounter)
	if err != nil {
		t.Fatalf("Failed to start UDP route: %v", err)
	}
	defer udpInst.stop()

	proxyAddr, _ := net.ResolveUDPAddr("udp", fmt.Sprintf("127.0.0.1:%d", udpInst.publicPort))

	// Client 1
	c1, _ := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	defer c1.Close()
	_, _ = c1.WriteToUDP([]byte("C1"), proxyAddr)

	// Client 2
	c2, _ := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	defer c2.Close()
	_, _ = c2.WriteToUDP([]byte("C2"), proxyAddr)

	time.Sleep(50 * time.Millisecond)

	if atomic.LoadInt32(&globalCounter) != 2 {
		t.Fatalf("Expected global counter 2, got %d", atomic.LoadInt32(&globalCounter))
	}

	// Client 3 (exceeds limit 2)
	c3, _ := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	defer c3.Close()
	_, _ = c3.WriteToUDP([]byte("C3"), proxyAddr)

	time.Sleep(50 * time.Millisecond)

	// Must still be 2, C3 dropped
	if atomic.LoadInt32(&globalCounter) != 2 {
		t.Errorf("Expected global counter to remain 2, got %d", atomic.LoadInt32(&globalCounter))
	}

	udpInst.mu.Lock()
	sessCount := len(udpInst.sessions)
	udpInst.mu.Unlock()

	if sessCount != 2 {
		t.Errorf("Expected exactly 2 sessions, got %d", sessCount)
	}
}

func TestRouteManagerLifecycleAndSync(t *testing.T) {
	// Step 1: Mock Backend providing routes dynamically
	var routesData []ProxyRoute
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/proxy/routes" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(routesData)
	}))
	defer backendServer.Close()

	// Initial route on dynamic free port
	testPortListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed getting free port: %v", err)
	}
	port1 := testPortListener.Addr().(*net.TCPAddr).Port
	testPortListener.Close()

	routesData = []ProxyRoute{
		{
			ServerID:   "srv-1",
			PublicPort: port1,
			TargetHost: "127.0.0.1",
			TargetPort: 30001,
		},
	}

	backend := NewBackendClient(backendServer.URL, "test-secret")
	routeMgr := NewRouteManager(backend)

	// Sync routes
	if err := routeMgr.SyncRoutes(context.Background()); err != nil {
		t.Fatalf("SyncRoutes failed: %v", err)
	}

	routeMgr.mu.Lock()
	if len(routeMgr.activeRoutes) != 1 {
		routeMgr.mu.Unlock()
		t.Fatalf("Expected 1 active route, got %d", len(routeMgr.activeRoutes))
	}
	entry1 := routeMgr.activeRoutes[port1]
	routeMgr.mu.Unlock()

	if entry1 == nil || entry1.tcpInstance == nil || entry1.udpInstance == nil {
		t.Fatal("Expected active TCP and UDP instances for route 1")
	}

	// Change backend to route 2
	testPortListener2, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed getting free port: %v", err)
	}
	port2 := testPortListener2.Addr().(*net.TCPAddr).Port
	testPortListener2.Close()

	routesData = []ProxyRoute{
		{
			ServerID:   "srv-2",
			PublicPort: port2,
			TargetHost: "127.0.0.1",
			TargetPort: 30002,
		},
	}

	// Sync routes again: port1 should be stopped and deleted, port2 created
	if err := routeMgr.SyncRoutes(context.Background()); err != nil {
		t.Fatalf("Second SyncRoutes failed: %v", err)
	}

	routeMgr.mu.Lock()
	if _, exists := routeMgr.activeRoutes[port1]; exists {
		routeMgr.mu.Unlock()
		t.Errorf("Port %d should have been removed", port1)
	}
	entry2 := routeMgr.activeRoutes[port2]
	activeCount := len(routeMgr.activeRoutes)
	routeMgr.mu.Unlock()

	if activeCount != 1 || entry2 == nil {
		t.Fatalf("Expected 1 active route on port %d, got %d", port2, activeCount)
	}

	// Stop manager
	routeMgr.Stop()

	routeMgr.mu.Lock()
	remaining := len(routeMgr.activeRoutes)
	routeMgr.mu.Unlock()

	if remaining != 0 {
		t.Errorf("Expected 0 active routes after Stop(), got %d", remaining)
	}

	// Second Stop() should be a safe no-op (sync.Once)
	routeMgr.Stop()
}

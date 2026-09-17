package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	DefaultListenAddr         = ":25565"
	DefaultBackendURL         = "http://127.0.0.1:8787"
	DefaultMaxConnections     = 300
	DefaultMaxUDPSessions     = 1000
	DefaultUDPInactivity      = 30 * time.Second
	DefaultUDPCleanupInterval = 15 * time.Second
	DefaultRoutesRefreshSec   = 60
	HandshakeTimeout          = 3 * time.Second
	TargetDialTimeout         = 1 * time.Second
)

var (
	maxUDPSessions     = DefaultMaxUDPSessions
	udpInactivity      = DefaultUDPInactivity
	udpCleanupInterval = DefaultUDPCleanupInterval
)

type Config struct {
	ListenAddr       string
	BackendURL       string
	ProxySecret      string
	MaxConnections   int
	RoutesRefreshSec int
}

func loadConfig() Config {
	listenAddr := os.Getenv("LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = DefaultListenAddr
	}

	backendURL := os.Getenv("BACKEND_URL")
	if backendURL == "" {
		backendURL = DefaultBackendURL
	}

	secret := os.Getenv("INTERNAL_PROXY_SECRET")

	maxConn := DefaultMaxConnections
	if maxConnStr := os.Getenv("MAX_CONNECTIONS"); maxConnStr != "" {
		if val, err := strconv.Atoi(maxConnStr); err == nil && val > 0 {
			maxConn = val
		}
	}

	refreshSec := DefaultRoutesRefreshSec
	if refreshStr := os.Getenv("ROUTES_REFRESH_SEC"); refreshStr != "" {
		if val, err := strconv.Atoi(refreshStr); err == nil && val > 0 {
			refreshSec = val
		}
	}

	return Config{
		ListenAddr:       listenAddr,
		BackendURL:       backendURL,
		ProxySecret:      secret,
		MaxConnections:   maxConn,
		RoutesRefreshSec: refreshSec,
	}
}

func main() {
	cfg := loadConfig()
	if cfg.ProxySecret == "" {
		log.Fatal("[Proxy] FATAL: INTERNAL_PROXY_SECRET environment variable is required")
	}

	backend := NewBackendClient(cfg.BackendURL, cfg.ProxySecret)

	// Global connection limit semaphore
	sem := make(chan struct{}, cfg.MaxConnections)

	// Auxiliary Route Manager (TCP + UDP)
	routeMgr := NewRouteManager(backend, sem)
	refreshInterval := time.Duration(cfg.RoutesRefreshSec) * time.Second
	if refreshInterval <= 0 {
		refreshInterval = DefaultRoutesRefreshSec * time.Second
	}
	routeMgr.Start(context.Background(), refreshInterval)

	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		log.Fatalf("[Proxy] Failed to bind TCP listener on %s: %v", cfg.ListenAddr, err)
	}
	defer listener.Close()

	log.Printf("[Proxy] HiKAT Minecraft Proxy listening on %s (backend: %s, max_conns: %d)",
		cfg.ListenAddr, cfg.BackendURL, cfg.MaxConnections)

	// Graceful shutdown channels
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)
	done := make(chan struct{})

	go func() {
		<-stopChan
		log.Println("[Proxy] Shutting down listener and auxiliary routes...")
		routeMgr.Stop()
		close(done)
		listener.Close()
	}()

	for {
		clientConn, err := listener.Accept()
		if err != nil {
			select {
			case <-done:
				log.Println("[Proxy] Listener stopped cleanly")
				return
			default:
				if errors.Is(err, net.ErrClosed) {
					log.Println("[Proxy] Listener closed, exiting accept loop cleanly")
					return
				}
				log.Printf("[Proxy] Accept error: %v", err)
				continue
			}
		}

		// Check capacity defensively
		select {
		case sem <- struct{}{}:
			go handleConnection(clientConn, backend, sem)
		default:
			log.Printf("[Proxy] Max connections (%d) reached, dropping incoming connection from %s",
				cfg.MaxConnections, clientConn.RemoteAddr())
			clientConn.Close()
		}
	}
}

func handleConnection(clientConn net.Conn, backend *BackendClient, sem chan struct{}) {
	defer func() {
		clientConn.Close()
		<-sem
	}()

	// 1. Read handshake with strict 3-second deadline
	if err := clientConn.SetReadDeadline(time.Now().Add(HandshakeTimeout)); err != nil {
		return
	}

	hs, err := ReadHandshake(clientConn)
	if err != nil {
		log.Printf("[Proxy] Handshake error from %s: %v", clientConn.RemoteAddr(), err)
		return
	}

	// 2. Clear deadline for subsequent streaming
	if err := clientConn.SetReadDeadline(time.Time{}); err != nil {
		return
	}

	intent := "LOGIN"
	if hs.NextState == 1 {
		intent = "STATUS"
	}

	// 3. Query backend
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := backend.Connect(ctx, hs.CleanHostname, intent)
	if err != nil {
		log.Printf("[Proxy] Backend connect error for host %s (%s): %v", hs.CleanHostname, intent, err)
		if intent == "LOGIN" {
			disconnectKey := "The server is not available right now."
			pkt := BuildLoginDisconnectTranslation(hs.ProtocolVersion, disconnectKey)
			sendLoginDisconnect(clientConn, pkt)
		}
		return
	}

	// 4. Handle based on intent
	if intent == "STATUS" {
		handleStatusPing(clientConn, hs, resp)
	} else {
		handleLogin(clientConn, hs, resp)
	}
}

func handleStatusPing(clientConn net.Conn, hs *Handshake, resp *ConnectResponse) {
	if resp.Status != "ONLINE" {
		// If OFFLINE, STARTING, or UNAVAILABLE: close connection immediately
		// Never send wake or forward packets
		return
	}

	targetAddr := fmt.Sprintf("%s:%d", resp.TargetHost, resp.TargetPort)
	targetConn, err := net.DialTimeout("tcp", targetAddr, TargetDialTimeout)
	if err != nil {
		log.Printf("[Proxy] Failed to connect to online target %s for status ping: %v", targetAddr, err)
		return
	}
	defer targetConn.Close()

	// Forward raw handshake intact
	if _, err := targetConn.Write(hs.RawPacket); err != nil {
		return
	}

	// Stream bidirectional status exchange
	pipe(clientConn, targetConn)
}

func handleLogin(clientConn net.Conn, hs *Handshake, resp *ConnectResponse) {
	switch resp.Status {
	case "STARTED":
		pkt := BuildLoginDisconnectTranslation(hs.ProtocolVersion, "The server is starting. Please try again in a few seconds.")
		sendLoginDisconnect(clientConn, pkt)

	case "STARTING":
		pkt := BuildLoginDisconnectTranslation(hs.ProtocolVersion, "The server is starting. Please try again in a few seconds.")
		sendLoginDisconnect(clientConn, pkt)

	case "STOPPING":
		pkt := BuildLoginDisconnectTranslation(hs.ProtocolVersion, "The server is shutting down. Please try again in a few seconds.")
		sendLoginDisconnect(clientConn, pkt)

	case "ONLINE":
		targetAddr := fmt.Sprintf("%s:%d", resp.TargetHost, resp.TargetPort)
		targetConn, err := net.DialTimeout("tcp", targetAddr, TargetDialTimeout)
		if err != nil {
			log.Printf("[Proxy] Online target %s is not accepting connections: %v", targetAddr, err)
			pkt := BuildLoginDisconnectTranslation(hs.ProtocolVersion, "The server is online, but is not accepting connections right now. Please try again in a few seconds.")
			sendLoginDisconnect(clientConn, pkt)
			return
		}
		defer targetConn.Close()

		// Forward raw handshake intact (including Forge/FML suffix if present)
		if _, err := targetConn.Write(hs.RawPacket); err != nil {
			return
		}

		// Passthrough streaming
		pipe(clientConn, targetConn)

	default: // "UNAVAILABLE" or any unexpected status
		pkt := BuildLoginDisconnectTranslation(hs.ProtocolVersion, "The server is not available right now.")
		sendLoginDisconnect(clientConn, pkt)
	}
}

// sendLoginDisconnect writes the disconnect packet with a write deadline,
// issues a half-close (CloseWrite) to send a FIN, drains any pending pipelined
// client bytes up to a short 500ms read deadline, and returns cleanly.
// This prevents RST packets caused by closing sockets with unread data in the receive buffer.
func sendLoginDisconnect(conn net.Conn, packet []byte) {
	_ = conn.SetWriteDeadline(time.Now().Add(1 * time.Second))

	for len(packet) > 0 {
		n, err := conn.Write(packet)
		if err != nil {
			return
		}
		packet = packet[n:]
	}

	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.CloseWrite()
	} else if cw, ok := conn.(interface{ CloseWrite() error }); ok {
		_ = cw.CloseWrite()
	}

	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, _ = io.Copy(io.Discard, conn)
}

// pipe provides bidirectional streaming between client and target connections.
func pipe(c1, c2 net.Conn) {
	done := make(chan struct{}, 2)

	go func() {
		_, _ = io.Copy(c1, c2)
		done <- struct{}{}
	}()

	go func() {
		_, _ = io.Copy(c2, c1)
		done <- struct{}{}
	}()

	<-done
}

// --- Auxiliary Forwarding (TCP + UDP) ---

func tryAcquireUDPSession(counter *int32, limit int) bool {
	for {
		curr := atomic.LoadInt32(counter)
		if curr >= int32(limit) {
			return false
		}
		if atomic.CompareAndSwapInt32(counter, curr, curr+1) {
			return true
		}
	}
}

type udpSession struct {
	targetConn *net.UDPConn
	lastSeen   time.Time
}

type udpListenerInstance struct {
	publicPort        int
	targetHost        string
	targetPort        int
	listener          *net.UDPConn
	sessions          map[string]*udpSession
	mu                sync.Mutex
	globalUDPSessions *int32
	stopChan          chan struct{}
	stopOnce          sync.Once
}

func startUDPRoute(route ProxyRoute, globalCounter *int32) (*udpListenerInstance, error) {
	listenAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf(":%d", route.PublicPort))
	if err != nil {
		return nil, fmt.Errorf("failed to resolve UDP listen addr for port %d: %w", route.PublicPort, err)
	}

	listener, err := net.ListenUDP("udp", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("failed to bind UDP listener on port %d: %w", route.PublicPort, err)
	}

	u := &udpListenerInstance{
		publicPort:        listener.LocalAddr().(*net.UDPAddr).Port,
		targetHost:        route.TargetHost,
		targetPort:        route.TargetPort,
		listener:          listener,
		sessions:          make(map[string]*udpSession),
		globalUDPSessions: globalCounter,
		stopChan:          make(chan struct{}),
	}

	go u.readLoop()
	go u.cleanupLoop()

	log.Printf("[Proxy] Auxiliary UDP listener started on :%d -> %s:%d", route.PublicPort, route.TargetHost, route.TargetPort)
	return u, nil
}

func (u *udpListenerInstance) readLoop() {
	buf := make([]byte, 2048)

	for {
		n, clientAddr, err := u.listener.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-u.stopChan:
				return
			default:
				if errors.Is(err, net.ErrClosed) {
					return
				}
				continue
			}
		}

		clientKey := clientAddr.String()

		u.mu.Lock()
		sess, exists := u.sessions[clientKey]
		if exists {
			sess.lastSeen = time.Now()
			u.mu.Unlock()
			_, _ = sess.targetConn.Write(buf[:n])
			continue
		}

		// New session: atomic reservation across all listeners
		if !tryAcquireUDPSession(u.globalUDPSessions, maxUDPSessions) {
			u.mu.Unlock()
			log.Printf("[Proxy] Global UDP sessions limit (%d) reached, dropping packet on port %d",
				maxUDPSessions, u.publicPort)
			continue
		}

		targetUDPAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", u.targetHost, u.targetPort))
		if err != nil {
			atomic.AddInt32(u.globalUDPSessions, -1)
			u.mu.Unlock()
			continue
		}

		targetConn, err := net.DialUDP("udp", nil, targetUDPAddr)
		if err != nil {
			atomic.AddInt32(u.globalUDPSessions, -1)
			u.mu.Unlock()
			continue
		}

		newSess := &udpSession{
			targetConn: targetConn,
			lastSeen:   time.Now(),
		}
		u.sessions[clientKey] = newSess
		u.mu.Unlock()

		// Send initial datagram
		_, _ = targetConn.Write(buf[:n])

		// Stream target responses back through the public listener to the client
		go func(cAddr *net.UDPAddr, tConn *net.UDPConn, pubListener *net.UDPConn) {
			respBuf := make([]byte, 2048)
			for {
				rn, rErr := tConn.Read(respBuf)
				if rErr != nil {
					return
				}
				_, _ = pubListener.WriteToUDP(respBuf[:rn], cAddr)
			}
		}(clientAddr, targetConn, u.listener)
	}
}

func (u *udpListenerInstance) cleanupLoop() {
	ticker := time.NewTicker(udpCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-u.stopChan:
			return
		case <-ticker.C:
			u.mu.Lock()
			now := time.Now()
			for key, sess := range u.sessions {
				if now.Sub(sess.lastSeen) > udpInactivity {
					_ = sess.targetConn.Close()
					delete(u.sessions, key)
					atomic.AddInt32(u.globalUDPSessions, -1)
				}
			}
			u.mu.Unlock()
		}
	}
}

func (u *udpListenerInstance) stop() {
	u.stopOnce.Do(func() {
		close(u.stopChan)
		_ = u.listener.Close()

		u.mu.Lock()
		defer u.mu.Unlock()
		for _, sess := range u.sessions {
			_ = sess.targetConn.Close()
			atomic.AddInt32(u.globalUDPSessions, -1)
		}
		u.sessions = make(map[string]*udpSession)
	})
}

type tcpListenerInstance struct {
	publicPort int
	targetHost string
	targetPort int
	listener   net.Listener
	conns      map[net.Conn]struct{}
	connsMu    sync.Mutex
	stopChan   chan struct{}
	stopOnce   sync.Once
	tcpSem     chan struct{}
}

func startTCPRoute(route ProxyRoute, tcpSem chan struct{}) (*tcpListenerInstance, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", route.PublicPort))
	if err != nil {
		return nil, fmt.Errorf("failed to bind TCP listener on port %d: %w", route.PublicPort, err)
	}

	t := &tcpListenerInstance{
		publicPort: listener.Addr().(*net.TCPAddr).Port,
		targetHost: route.TargetHost,
		targetPort: route.TargetPort,
		listener:   listener,
		conns:      make(map[net.Conn]struct{}),
		stopChan:   make(chan struct{}),
		tcpSem:     tcpSem,
	}

	go t.acceptLoop()

	log.Printf("[Proxy] Auxiliary TCP listener started on :%d -> %s:%d", route.PublicPort, route.TargetHost, route.TargetPort)
	return t, nil
}

func (t *tcpListenerInstance) acceptLoop() {
	for {
		clientConn, err := t.listener.Accept()
		if err != nil {
			select {
			case <-t.stopChan:
				return
			default:
				if errors.Is(err, net.ErrClosed) {
					return
				}
				continue
			}
		}

		if t.tcpSem != nil {
			select {
			case t.tcpSem <- struct{}{}:
			default:
				log.Printf("[Proxy] Max global TCP connections reached, dropping auxiliary connection on port %d", t.publicPort)
				clientConn.Close()
				continue
			}
		}

		t.connsMu.Lock()
		select {
		case <-t.stopChan:
			t.connsMu.Unlock()
			if t.tcpSem != nil {
				<-t.tcpSem
			}
			clientConn.Close()
			return
		default:
			t.conns[clientConn] = struct{}{}
			t.connsMu.Unlock()
		}

		go func(cConn net.Conn) {
			defer func() {
				cConn.Close()
				t.connsMu.Lock()
				delete(t.conns, cConn)
				t.connsMu.Unlock()
				if t.tcpSem != nil {
					<-t.tcpSem
				}
			}()

			targetAddr := fmt.Sprintf("%s:%d", t.targetHost, t.targetPort)
			targetConn, dialErr := net.DialTimeout("tcp", targetAddr, TargetDialTimeout)
			if dialErr != nil {
				// Target is down/unreachable: close incoming connection
				return
			}
			defer targetConn.Close()

			pipe(cConn, targetConn)
		}(clientConn)
	}
}

func (t *tcpListenerInstance) stop() {
	t.stopOnce.Do(func() {
		close(t.stopChan)
		_ = t.listener.Close()

		t.connsMu.Lock()
		for c := range t.conns {
			_ = c.Close()
		}
		t.conns = make(map[net.Conn]struct{})
		t.connsMu.Unlock()
	})
}

type routeEntry struct {
	route       ProxyRoute
	tcpInstance *tcpListenerInstance
	udpInstance *udpListenerInstance
}

type RouteManager struct {
	backend           *BackendClient
	mu                sync.Mutex
	activeRoutes      map[int]*routeEntry
	globalUDPSessions int32
	tcpSem            chan struct{}
	stopChan          chan struct{}
	stopOnce          sync.Once
}

func NewRouteManager(backend *BackendClient, tcpSem ...chan struct{}) *RouteManager {
	var sem chan struct{}
	if len(tcpSem) > 0 {
		sem = tcpSem[0]
	}
	return &RouteManager{
		backend:      backend,
		activeRoutes: make(map[int]*routeEntry),
		tcpSem:       sem,
		stopChan:     make(chan struct{}),
	}
}

func (m *RouteManager) SyncRoutes(ctx context.Context) error {
	select {
	case <-m.stopChan:
		return nil
	default:
	}

	routes, err := m.backend.GetRoutes(ctx)
	if err != nil {
		return fmt.Errorf("failed to get routes from backend: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	newRouteMap := make(map[int]ProxyRoute)
	for _, r := range routes {
		newRouteMap[r.PublicPort] = r
	}

	// 1. Remove obsolete or changed routes
	for port, entry := range m.activeRoutes {
		newR, stillExists := newRouteMap[port]
		if !stillExists || newR.TargetHost != entry.route.TargetHost || newR.TargetPort != entry.route.TargetPort {
			log.Printf("[Proxy] Removing obsolete auxiliary route on port %d", port)
			if entry.tcpInstance != nil {
				entry.tcpInstance.stop()
			}
			if entry.udpInstance != nil {
				entry.udpInstance.stop()
			}
			delete(m.activeRoutes, port)
		}
	}

	// 2. Add newly registered or recover partial routes
	for port, r := range newRouteMap {
		entry, alreadyActive := m.activeRoutes[port]
		if !alreadyActive {
			entry = &routeEntry{route: r}
		}

		// Try starting TCP if not already running
		if entry.tcpInstance == nil {
			tcpInst, tcpErr := startTCPRoute(r, m.tcpSem)
			if tcpErr != nil {
				log.Printf("[Proxy] Warning: Failed starting auxiliary TCP on port %d: %v", port, tcpErr)
			} else {
				entry.tcpInstance = tcpInst
			}
		}

		// Try starting UDP if not already running
		if entry.udpInstance == nil {
			udpInst, udpErr := startUDPRoute(r, &m.globalUDPSessions)
			if udpErr != nil {
				log.Printf("[Proxy] Warning: Failed starting auxiliary UDP on port %d: %v", port, udpErr)
			} else {
				entry.udpInstance = udpInst
			}
		}

		if entry.tcpInstance != nil || entry.udpInstance != nil {
			m.activeRoutes[port] = entry
		}
	}

	return nil
}

func (m *RouteManager) Start(ctx context.Context, interval time.Duration) {
	if err := m.SyncRoutes(ctx); err != nil {
		log.Printf("[Proxy] Initial routes sync warning: %v", err)
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-m.stopChan:
				return
			case <-ticker.C:
				syncCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				if err := m.SyncRoutes(syncCtx); err != nil {
					log.Printf("[Proxy] Periodic routes sync warning: %v", err)
				}
				cancel()
			}
		}
	}()
}

func (m *RouteManager) Stop() {
	m.stopOnce.Do(func() {
		close(m.stopChan)

		m.mu.Lock()
		defer m.mu.Unlock()

		for port, entry := range m.activeRoutes {
			if entry.tcpInstance != nil {
				entry.tcpInstance.stop()
			}
			if entry.udpInstance != nil {
				entry.udpInstance.stop()
			}
			delete(m.activeRoutes, port)
		}
	})
}

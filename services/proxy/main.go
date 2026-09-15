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
	"syscall"
	"time"
)

const (
	DefaultListenAddr     = ":25565"
	DefaultBackendURL     = "http://127.0.0.1:8787"
	DefaultMaxConnections = 300
	HandshakeTimeout      = 3 * time.Second
	TargetDialTimeout     = 1 * time.Second
)

type Config struct {
	ListenAddr     string
	BackendURL     string
	ProxySecret    string
	MaxConnections int
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

	return Config{
		ListenAddr:     listenAddr,
		BackendURL:     backendURL,
		ProxySecret:    secret,
		MaxConnections: maxConn,
	}
}

func main() {
	cfg := loadConfig()
	if cfg.ProxySecret == "" {
		log.Fatal("[Proxy] FATAL: INTERNAL_PROXY_SECRET environment variable is required")
	}

	backend := NewBackendClient(cfg.BackendURL, cfg.ProxySecret)

	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		log.Fatalf("[Proxy] Failed to bind TCP listener on %s: %v", cfg.ListenAddr, err)
	}
	defer listener.Close()

	log.Printf("[Proxy] HiKAT Minecraft Proxy listening on %s (backend: %s, max_conns: %d)",
		cfg.ListenAddr, cfg.BackendURL, cfg.MaxConnections)

	// Global connection limit semaphore
	sem := make(chan struct{}, cfg.MaxConnections)

	// Graceful shutdown channels
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)
	done := make(chan struct{})

	go func() {
		<-stopChan
		log.Println("[Proxy] Shutting down listener...")
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
			disconnectMsg := "El servidor no está disponible en este momento."
			pkt := BuildLoginDisconnect(hs.ProtocolVersion, disconnectMsg)
			_, _ = clientConn.Write(pkt)
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
		msg := "El servidor se acaba de iniciar. Inténtalo nuevamente en unos segundos."
		pkt := BuildLoginDisconnect(hs.ProtocolVersion, msg)
		_, _ = clientConn.Write(pkt)

	case "STARTING":
		msg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
		pkt := BuildLoginDisconnect(hs.ProtocolVersion, msg)
		_, _ = clientConn.Write(pkt)

	case "ONLINE":
		targetAddr := fmt.Sprintf("%s:%d", resp.TargetHost, resp.TargetPort)
		targetConn, err := net.DialTimeout("tcp", targetAddr, TargetDialTimeout)
		if err != nil {
			// Target process may still be opening socket: treat locally as STARTING
			log.Printf("[Proxy] Online target %s not reachable yet, treating as STARTING: %v", targetAddr, err)
			msg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
			pkt := BuildLoginDisconnect(hs.ProtocolVersion, msg)
			_, _ = clientConn.Write(pkt)
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
		msg := "El servidor no está disponible en este momento."
		pkt := BuildLoginDisconnect(hs.ProtocolVersion, msg)
		_, _ = clientConn.Write(pkt)
	}
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

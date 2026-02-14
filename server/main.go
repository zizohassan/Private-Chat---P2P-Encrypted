package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"
)

//go:embed all:web
var webFiles embed.FS

func main() {
	// Find available port (prefer 3000)
	port := findAvailablePort(3000)
	addr := fmt.Sprintf("localhost:%d", port)
	url := fmt.Sprintf("http://%s", addr)

	// Get sub-filesystem starting from "web/"
	webFS, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatal("Failed to access embedded files:", err)
	}

	// Security headers middleware
	securityHeaders := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-XSS-Protection", "1; mode=block")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Content-Security-Policy",
				"default-src 'self'; "+
					"script-src 'self'; "+
					"style-src 'self' 'unsafe-inline'; "+
					"img-src 'self' data: blob:; "+
					"connect-src 'self' https://speed.cloudflare.com; "+
					"media-src 'self' blob:; "+
					"object-src 'none'; "+
					"base-uri 'self'")
			next.ServeHTTP(w, r)
		})
	}

	// Create file server
	mux := http.NewServeMux()

	// API endpoint: returns local network IP for same-LAN P2P discovery
	mux.HandleFunc("/api/local-ip", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ip := getLocalIP()
		fmt.Fprintf(w, `{"ip":"%s"}`, ip)
	})

	// API endpoint: proxy Cloudflare TURN credentials (avoids CORS)
	mux.HandleFunc("/api/turn-creds", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get("https://speed.cloudflare.com/turn-creds")
		if err != nil {
			w.WriteHeader(502)
			fmt.Fprintf(w, `{"error":"%s"}`, err.Error())
			return
		}
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	mux.Handle("/", http.FileServer(http.FS(webFS)))

	server := &http.Server{
		Addr:    addr,
		Handler: securityHeaders(mux),
	}

	// Print startup info
	fmt.Println()
	fmt.Println("  ╔══════════════════════════════════════════╗")
	fmt.Println("  ║       PRIVATE CHAT - P2P Encrypted       ║")
	fmt.Println("  ╠══════════════════════════════════════════╣")
	fmt.Printf("  ║  Running at: %-27s ║\n", url)
	fmt.Println("  ║                                          ║")
	fmt.Println("  ║  Encryption: ECDH P-521 + AES-256-GCM    ║")
	fmt.Println("  ║  No server in the middle - true P2P      ║")
	fmt.Println("  ║                                          ║")
	fmt.Println("  ║  Note: localhost = secure context,        ║")
	fmt.Println("  ║  WebRTC works without HTTPS               ║")
	fmt.Println("  ║                                          ║")
	fmt.Println("  ║  Press Ctrl+C to stop                    ║")
	fmt.Println("  ╚══════════════════════════════════════════╝")
	fmt.Println()

	// Open browser after small delay
	go func() {
		time.Sleep(500 * time.Millisecond)
		openBrowser(url)
	}()

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		fmt.Println("\n  Shutting down...")
		server.Close()
		os.Exit(0)
	}()

	// Start HTTP server on localhost
	// localhost is treated as a secure context by all modern browsers,
	// so WebRTC, Web Crypto, and clipboard APIs all work without HTTPS
	err = server.ListenAndServe()
	if err != nil && err != http.ErrServerClosed {
		log.Fatal("Failed to start server:", err)
	}
}

// Find an available port starting from the preferred one
func findAvailablePort(preferred int) int {
	for port := preferred; port < preferred+100; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", port))
		if err == nil {
			ln.Close()
			return port
		}
	}
	// Let OS assign a random port
	ln, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		return preferred
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port
}

// Get the machine's local network IP (non-loopback IPv4)
func getLocalIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 != nil && !ip4.IsLoopback() {
				return ip4.String()
			}
		}
	}
	return ""
}

// Open URL in default browser
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		fmt.Printf("  Open %s in your browser\n", url)
		return
	}
	cmd.Start()
}

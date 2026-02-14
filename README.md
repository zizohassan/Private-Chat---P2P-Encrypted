# Private Chat - P2P Encrypted Messenger

<img width="484" height="912" alt="Screenshot 2026-02-14 at 5 27 15 PM" src="https://github.com/user-attachments/assets/bf78c018-b7e2-4b30-8bfd-53d380b3971b" />

Truly serverless peer-to-peer chat with end-to-end encryption. No central server, no accounts, no tracking. Peers connect directly using WebRTC with manual code exchange.

## How It Works

```
User A                                    User B
  |                                         |
  |-- 1. Generate "Invite Code" ----------->|  (copy-paste)
  |     (WebRTC SDP offer +                 |
  |      encryption public key)             |
  |                                         |
  |<-- 2. Return "Answer Code" -------------|  (copy-paste)
  |     (WebRTC SDP answer +                |
  |      encryption public key)             |
  |                                         |
  |<====== 3. Direct P2P Connection =======>|
  |     (WebRTC DataChannel + MediaStream)  |
  |     (All data E2E encrypted)            |
```

1. **User A** clicks "Create Invite" and gets an invite code
2. **User A** sends the code to **User B** (via any channel - SMS, email, etc.)
3. **User B** pastes the code and gets an answer code back
4. **User B** sends the answer code to **User A**
5. **User A** pastes the answer code - direct P2P connection established

All communication after step 5 flows directly between peers. No data passes through any server.

## Features

- **Text Messaging** - Real-time encrypted chat
- **File Sharing** - Send files of any type with progress indication; images preview inline
- **Voice Calls** - P2P voice calls via WebRTC MediaStream
- **Online Status** - Heartbeat-based online/offline detection
- **E2E Encryption** - ECDH P-521 key exchange + AES-256-GCM encryption
- **Zero Dependencies** - Pure HTML/CSS/JavaScript, no npm, no frameworks
- **Cross-Platform** - Desktop (macOS, Windows, Linux) and Android

## Security

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Key Exchange | ECDH P-521 | Derive shared secret between peers |
| Key Derivation | HKDF-SHA-512 | Derive encryption key from shared secret |
| Encryption | AES-256-GCM | Encrypt all messages and files |
| Transport | DTLS (WebRTC) | Additional transport-layer encryption |

- Private keys never leave the browser
- Invite/answer codes only contain **public** keys
- Key fingerprints displayed for manual verification (MITM protection)
- All crypto uses the native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

## Downloads

| Platform | File | Size |
|----------|------|------|
| macOS (Apple Silicon) | `PrivateChat-macOS` | ~5.8 MB |
| Windows (x64) | `PrivateChat-Windows.exe` | ~6.3 MB |
| Linux (x64) | `PrivateChat-Linux` | ~6.1 MB |
| Android (7.0+) | `PrivateChat-v1.1-debug.apk` | ~3.1 MB |

### Running on Desktop

```bash
# macOS
chmod +x PrivateChat-macOS
./PrivateChat-macOS

# Linux
chmod +x PrivateChat-Linux
./PrivateChat-Linux

# Windows
PrivateChat-Windows.exe
```

The app starts a local HTTP server on `localhost:3000` (or next available port) and opens your browser. `localhost` is treated as a secure context by all modern browsers, so WebRTC, Web Crypto, and clipboard APIs all work without HTTPS.

### Running on Android

Install `PrivateChat-v1.1-debug.apk` on your device. You may need to enable "Install from unknown sources" in settings.

## Building from Source

### Prerequisites

- **Go 1.21+** (for desktop builds)
- **Android SDK + JDK 17+** (for Android APK)

### Desktop

```bash
./build.sh
```

Builds for macOS (arm64), Windows (amd64), and Linux (amd64). The Go binary embeds all web files — the output is a single self-contained executable.

### Android

```bash
cd android
./gradlew assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk
```

### Development (web only)

Open `web/index.html` directly won't work (WebRTC requires secure context). Use the Go server or any local HTTP server:

```bash
cd web
python3 -m http.server 3000
# Open http://localhost:3000
```

## Project Structure

```
privateChat/
├── web/                        # Frontend (shared by all platforms)
│   ├── index.html              # App shell & UI
│   ├── css/style.css           # Dark theme, responsive
│   └── js/
│       ├── app.js              # Main controller, heartbeat
│       ├── connection.js       # WebRTC signaling & ICE
│       ├── crypto.js           # ECDH P-521 + AES-256-GCM
│       ├── chat.js             # Encrypted messaging
│       ├── file-transfer.js    # Chunked file transfer
│       ├── voice.js            # Voice calls
│       └── ui.js               # UI updates & notifications
├── server/
│   └── main.go                 # Go server (embeds web/, serves on localhost)
├── android/                    # Android WebView wrapper
│   └── app/src/main/
│       ├── java/.../MainActivity.java
│       └── assets/web/         # Copy of web/ for Android
├── build.sh                    # Build script (all desktop platforms)
└── README.md
```

## Network & NAT Traversal

The app uses the following strategy to establish peer connections:

1. **STUN** (Google + Cloudflare) - Discovers public IP for NAT traversal
2. **TURN** (Cloudflare) - Relay fallback when direct connection fails (symmetric NAT, strict firewalls)
3. **Local IP injection** - The Go server provides the machine's LAN IP for direct same-network connections

TURN relay credentials are fetched dynamically from Cloudflare's free service. All relayed traffic is still end-to-end encrypted — the TURN server cannot read any messages.

## Limitations

- **Manual signaling** - Users must exchange codes through an external channel
- **Session-only history** - Messages are not stored; refreshing the page clears the chat
- **Single peer** - Each session connects exactly two peers
- **TURN dependency** - Peers behind symmetric NAT require the Cloudflare TURN relay to be available

## License

MIT

// WebRTC P2P Connection Module
// Handles signaling (manual code exchange), ICE, DataChannel

const ConnectionModule = (() => {
    let peerConnection = null;
    let dataChannel = null;
    let isInitiator = false;

    // Callbacks
    let onConnected = null;
    let onDisconnected = null;
    let onMessage = null;
    let onDataChannelOpen = null;

    // UTF-8 safe base64 encoding (replaces deprecated escape/unescape)
    function utf8ToBase64(str) {
        return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    }
    function base64ToUtf8(b64) {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    // Detailed logging
    function log(...args) {
        const ts = new Date().toISOString().substr(11, 12);
        console.log(`[${ts}][Connection]`, ...args);
    }
    function logError(...args) {
        const ts = new Date().toISOString().substr(11, 12);
        console.error(`[${ts}][Connection]`, ...args);
    }

    // Build ICE servers list with TURN credentials from Cloudflare
    async function getICEServers() {
        const servers = [
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
        ];

        // Fetch TURN credentials - try Android bridge, then Go proxy, then direct
        try {
            let data = null;

            // Try 1: Android native bridge (no CORS, no network permission issues)
            if (window.AndroidTurn) {
                try {
                    log('Fetching TURN credentials via Android bridge...');
                    const json = window.AndroidTurn.getCredentials();
                    data = JSON.parse(json);
                    if (data.error) throw new Error(data.error);
                    log('TURN credentials obtained via Android bridge');
                } catch (bridgeErr) {
                    log('Android bridge failed:', bridgeErr.message);
                    data = null;
                }
            }

            // Try 2: Local Go server proxy (avoids CORS on desktop)
            if (!data) {
                try {
                    log('Fetching TURN credentials from server proxy...');
                    const resp = await fetch('/api/turn-creds');
                    data = await resp.json();
                    if (data.error) throw new Error(data.error);
                    log('TURN credentials obtained via proxy');
                } catch (proxyErr) {
                    log('Proxy unavailable:', proxyErr.message);
                }
            }

            // Try 3: Direct fetch (last resort)
            if (!data) {
                log('Trying direct Cloudflare fetch...');
                const resp = await fetch('https://speed.cloudflare.com/turn-creds');
                data = await resp.json();
                log('TURN credentials obtained directly');
            }

            if (data && data.username && data.credential) {
                const turnUrls = data.urls || [
                    'turn:turn.cloudflare.com:3478?transport=udp',
                    'turn:turn.cloudflare.com:3478?transport=tcp',
                    'turns:turn.cloudflare.com:5349?transport=tcp'
                ];

                const urlList = Array.isArray(turnUrls) ? turnUrls : [turnUrls];
                for (const url of urlList) {
                    if (url.startsWith('turn') || url.startsWith('turns')) {
                        servers.push({
                            urls: url,
                            username: data.username,
                            credential: data.credential
                        });
                    }
                }
                log('TURN servers added:', servers.length - 2);
            }
        } catch (e) {
            logError('Failed to get TURN credentials:', e.message);
            logError('No TURN relay available - connection may fail behind strict NAT');
        }

        return servers;
    }

    // Replace mDNS .local addresses in SDP with real local IP
    // This enables direct same-LAN connectivity between different machines
    async function addLocalIPCandidates(sdp) {
        try {
            const response = await fetch('/api/local-ip');
            const data = await response.json();
            if (!data.ip) return sdp;

            log('Local IP from server:', data.ip);

            // Find host candidates with mDNS addresses and add real-IP versions
            const lines = sdp.split('\r\n');
            const additions = [];
            for (const line of lines) {
                if (line.startsWith('a=candidate:') && line.includes(' host ') && line.includes('.local')) {
                    const realLine = line.replace(/[a-f0-9-]{36}\.local/g, data.ip);
                    if (realLine !== line) {
                        additions.push(realLine);
                    }
                }
            }

            if (additions.length > 0) {
                // Insert real-IP candidates before the first m= or a=end-of-candidates line
                const result = [];
                let added = false;
                for (const line of lines) {
                    if (!added && line.startsWith('a=end-of-candidates')) {
                        additions.forEach(a => result.push(a));
                        added = true;
                    }
                    result.push(line);
                }
                if (!added) {
                    // Add before the last empty line
                    const lastIdx = lines.length - 1;
                    result.splice(lastIdx, 0, ...additions);
                }
                log('Added', additions.length, 'real-IP candidates for same-LAN connectivity');
                return result.join('\r\n');
            }
        } catch (e) {
            // Server may not have /api/local-ip (e.g., running as static file)
            log('Local IP endpoint not available (expected if not using PrivateChat server)');
        }
        return sdp;
    }

    // Initialize a new RTCPeerConnection
    async function createPeerConnection() {
        if (peerConnection) {
            log('Closing existing peer connection');
            peerConnection.close();
        }

        const iceServers = await getICEServers();
        log('Creating RTCPeerConnection with', iceServers.length, 'ICE servers');
        log('ICE servers:', JSON.stringify(iceServers.map(s => s.urls)));

        peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceCandidatePoolSize: 10
        });

        log('RTCPeerConnection created successfully');
        log('Initial signalingState:', peerConnection.signalingState);
        log('Initial iceGatheringState:', peerConnection.iceGatheringState);
        log('Initial iceConnectionState:', peerConnection.iceConnectionState);
        log('Initial connectionState:', peerConnection.connectionState);

        peerConnection.onsignalingstatechange = () => {
            log('Signaling state changed:', peerConnection.signalingState);
        };

        peerConnection.onicegatheringstatechange = () => {
            log('ICE gathering state changed:', peerConnection.iceGatheringState);
        };

        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            log('ICE connection state changed:', state);

            if (state === 'connected' || state === 'completed') {
                log('=== CONNECTION ESTABLISHED ===');
                logConnectionDetails();
                if (onConnected) onConnected();
            } else if (state === 'failed') {
                logError('=== ICE CONNECTION FAILED ===');
                logError('Possible causes: firewall, symmetric NAT, TURN server unreachable');
                if (peerConnection && isInitiator) {
                    log('Attempting ICE restart (initiator)...');
                    peerConnection.restartIce();
                }
                if (onDisconnected) onDisconnected(state);
            } else if (state === 'disconnected') {
                log('ICE temporarily disconnected (may recover)');
            } else if (state === 'closed') {
                log('ICE connection closed');
                if (onDisconnected) onDisconnected(state);
            }
        };

        peerConnection.onconnectionstatechange = () => {
            log('Connection state changed:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'failed') {
                logError('Peer connection state FAILED');
                if (onDisconnected) onDisconnected('connection-failed');
            }
        };

        // Log every ICE candidate in detail
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const c = event.candidate;
                log(`ICE candidate found: type=${c.type} protocol=${c.protocol} address=${c.address}:${c.port} priority=${c.priority} component=${c.component}`);
                log(`  Full candidate: ${c.candidate}`);
            } else {
                log('ICE candidate gathering finished (null candidate received)');
            }
        };

        peerConnection.onicecandidateerror = (event) => {
            logError(`ICE candidate error: code=${event.errorCode} text="${event.errorText}" url=${event.url} hostCandidate=${event.hostCandidate}`);
        };

        return peerConnection;
    }

    // Log connection details when connected
    function logConnectionDetails() {
        if (!peerConnection) return;

        peerConnection.getStats().then(stats => {
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    log('Active candidate pair:');
                    log(`  Local candidate: ${report.localCandidateId}`);
                    log(`  Remote candidate: ${report.remoteCandidateId}`);
                    log(`  Bytes sent: ${report.bytesSent}, received: ${report.bytesReceived}`);
                }
                if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                    log(`  ${report.type}: type=${report.candidateType} address=${report.address}:${report.port} protocol=${report.protocol}`);
                }
            });
        }).catch(e => logError('Failed to get stats:', e));
    }

    // Setup DataChannel
    function setupDataChannel(channel) {
        log(`Setting up DataChannel: label="${channel.label}" id=${channel.id} readyState=${channel.readyState}`);
        dataChannel = channel;
        dataChannel.binaryType = 'arraybuffer';

        dataChannel.onopen = () => {
            log('=== DATACHANNEL OPEN === readyState:', dataChannel.readyState);
            if (onDataChannelOpen) onDataChannelOpen();
        };

        dataChannel.onclose = () => {
            log('DataChannel closed');
            if (onDisconnected) onDisconnected('datachannel-closed');
        };

        dataChannel.onmessage = (event) => {
            if (onMessage) onMessage(event.data);
        };

        dataChannel.onerror = (error) => {
            logError('DataChannel error:', error);
        };

        log('DataChannel handlers attached');
    }

    // Wait for ICE gathering to complete
    function waitForICEGathering() {
        return new Promise((resolve) => {
            log('Waiting for ICE gathering... current state:', peerConnection.iceGatheringState);

            if (peerConnection.iceGatheringState === 'complete') {
                log('ICE gathering already complete');
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                const candidateCount = countCandidates(peerConnection.localDescription.sdp);
                const info = analyzeCandidates(peerConnection.localDescription.sdp);
                log(`ICE gathering TIMED OUT after 15s. Collected ${candidateCount} candidates. Proceeding anyway.`);
                log(`Candidate breakdown: host=${info.host} srflx=${info.srflx} relay=${info.relay}`);
                if (candidateCount === 0) {
                    logError('WARNING: Zero ICE candidates! Connection will likely fail.');
                    logError('Check: internet connection, firewall, browser WebRTC settings');
                }
                if (info.relay === 0) {
                    logError('WARNING: No relay (TURN) candidates. Same-network peers may fail to connect.');
                }
                resolve();
            }, 15000);

            const originalHandler = peerConnection.onicecandidate;
            peerConnection.onicecandidate = (event) => {
                if (originalHandler) originalHandler(event);

                if (event.candidate === null) {
                    clearTimeout(timeout);
                    const candidateCount = countCandidates(peerConnection.localDescription.sdp);
                    log(`ICE gathering complete. Total candidates in SDP: ${candidateCount}`);
                    resolve();
                }
            };
        });
    }

    // Validate signaling payload structure and size
    const MAX_SDP_LENGTH = 100000;
    const MAX_PK_LENGTH = 1000;

    function validatePayload(payload, expectedType) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid payload: not an object');
        }
        if (payload.type !== expectedType) {
            throw new Error(`Invalid payload: expected type "${expectedType}", got "${payload.type}"`);
        }
        if (typeof payload.sdp !== 'string' || payload.sdp.length === 0) {
            throw new Error('Invalid payload: missing or empty SDP');
        }
        if (payload.sdp.length > MAX_SDP_LENGTH) {
            throw new Error(`Invalid payload: SDP too large (${payload.sdp.length} > ${MAX_SDP_LENGTH})`);
        }
        if (typeof payload.pk !== 'string' || payload.pk.length === 0) {
            throw new Error('Invalid payload: missing public key');
        }
        if (payload.pk.length > MAX_PK_LENGTH) {
            throw new Error(`Invalid payload: public key too large (${payload.pk.length} > ${MAX_PK_LENGTH})`);
        }
        // Validate SDP starts with expected header
        if (!payload.sdp.startsWith('v=0')) {
            throw new Error('Invalid payload: SDP does not start with v=0');
        }
        // Salt is optional (for backwards compat) but validated if present
        if (payload.salt !== undefined && typeof payload.salt !== 'string') {
            throw new Error('Invalid payload: salt must be a string');
        }
    }

    // Count and categorize ICE candidates in SDP
    function countCandidates(sdp) {
        if (!sdp) return 0;
        return (sdp.match(/a=candidate:/g) || []).length;
    }

    function analyzeCandidates(sdp) {
        if (!sdp) return { total: 0, host: 0, srflx: 0, relay: 0 };
        const lines = sdp.split('\n').filter(l => l.startsWith('a=candidate:'));
        const result = { total: lines.length, host: 0, srflx: 0, relay: 0, prflx: 0 };
        lines.forEach(line => {
            if (line.includes(' host ')) result.host++;
            else if (line.includes(' srflx ')) result.srflx++;
            else if (line.includes(' relay ')) result.relay++;
            else if (line.includes(' prflx ')) result.prflx++;
        });
        return result;
    }

    // Create invite code (initiator side)
    async function createOffer() {
        log('=== CREATE OFFER (Initiator) ===');
        isInitiator = true;
        await createPeerConnection();

        // Create DataChannel before offer
        log('Creating DataChannel "chat"');
        const channel = peerConnection.createDataChannel('chat', { ordered: true });
        setupDataChannel(channel);

        // Generate encryption keys and session salt
        log('Generating ECDH P-521 key pair...');
        await CryptoModule.generateKeyPair();
        const publicKey = await CryptoModule.exportPublicKey();
        const salt = CryptoModule.generateSalt();
        log('Key pair generated, public key length:', publicKey.length);
        log('Session salt generated (32 bytes random)');

        // Create SDP offer
        log('Creating SDP offer...');
        const offer = await peerConnection.createOffer();
        log('SDP offer created, type:', offer.type, 'length:', offer.sdp.length);

        log('Setting local description...');
        await peerConnection.setLocalDescription(offer);
        log('Local description set. signalingState:', peerConnection.signalingState);

        // Wait for ICE candidates
        log('Gathering ICE candidates...');
        await waitForICEGathering();

        // Full SDP with all candidates
        let fullSDP = peerConnection.localDescription.sdp;
        const candidateInfo = analyzeCandidates(fullSDP);
        log('Final SDP stats:', JSON.stringify(candidateInfo));
        log('SDP length:', fullSDP.length);

        if (candidateInfo.total === 0) {
            logError('ERROR: No ICE candidates in offer! Check network/firewall.');
        }
        if (candidateInfo.relay === 0) {
            logError('WARNING: No relay candidates in offer. TURN server may be unreachable.');
        } else {
            log('TURN relay candidates found:', candidateInfo.relay, '(good for NAT traversal)');
        }

        // Add real local IP candidates for same-LAN connectivity
        fullSDP = await addLocalIPCandidates(fullSDP);
        const finalInfo = analyzeCandidates(fullSDP);
        if (finalInfo.total > candidateInfo.total) {
            log('SDP after local IP injection:', JSON.stringify(finalInfo));
        }

        // Package (includes salt for HKDF key derivation)
        const payload = { type: 'offer', sdp: fullSDP, pk: publicKey, salt: salt };
        const json = JSON.stringify(payload);
        const encoded = utf8ToBase64(json);
        log('Invite code generated, length:', encoded.length, 'chars');
        log('=== OFFER READY - Share this code with peer ===');
        return encoded;
    }

    // Process invite code and create answer
    async function createAnswer(offerCode) {
        log('=== CREATE ANSWER (Responder) ===');
        isInitiator = false;
        await createPeerConnection();

        // Responder receives DataChannel
        peerConnection.ondatachannel = (event) => {
            log('Received DataChannel from initiator:', event.channel.label);
            setupDataChannel(event.channel);
        };

        // Decode the offer
        log('Decoding invite code, length:', offerCode.trim().length);
        let json, payload;
        try {
            json = base64ToUtf8(offerCode.trim());
            payload = JSON.parse(json);
            log('Invite code decoded successfully');
        } catch (e) {
            logError('Failed to decode invite code:', e.message);
            throw new Error('Invalid invite code format: ' + e.message);
        }

        validatePayload(payload, 'offer');

        const offerCandidates = analyzeCandidates(payload.sdp);
        log('Offer SDP received:', JSON.stringify(offerCandidates));
        log('Offer SDP length:', payload.sdp.length);
        log('Offer public key length:', payload.pk.length);

        // Import peer's public key and use their salt
        log('Importing peer public key and deriving encryption key...');
        await CryptoModule.generateKeyPair();
        if (payload.salt) {
            CryptoModule.setSalt(payload.salt);
            log('Using session salt from initiator');
        } else {
            logError('WARNING: No salt in offer - using fallback (old client?)');
            CryptoModule.generateSalt();
        }
        await CryptoModule.importPeerPublicKey(payload.pk);
        await CryptoModule.deriveEncryptionKey();
        log('Encryption key derived successfully');

        const publicKey = await CryptoModule.exportPublicKey();

        // Set remote description
        log('Setting remote description (offer)...');
        try {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription({ type: 'offer', sdp: payload.sdp })
            );
            log('Remote description set. signalingState:', peerConnection.signalingState);
        } catch (e) {
            logError('FAILED to set remote description:', e.message);
            logError('This usually means the SDP is malformed or incompatible');
            throw e;
        }

        // Create answer
        log('Creating SDP answer...');
        const answer = await peerConnection.createAnswer();
        log('SDP answer created, length:', answer.sdp.length);

        log('Setting local description (answer)...');
        await peerConnection.setLocalDescription(answer);
        log('Local description set. signalingState:', peerConnection.signalingState);

        // Wait for ICE candidates
        log('Gathering ICE candidates for answer...');
        await waitForICEGathering();

        let fullSDP = peerConnection.localDescription.sdp;
        const answerCandidates = analyzeCandidates(fullSDP);
        log('Answer SDP stats:', JSON.stringify(answerCandidates));

        if (answerCandidates.relay === 0) {
            logError('WARNING: No relay candidates in answer. TURN server may be unreachable.');
        } else {
            log('TURN relay candidates found:', answerCandidates.relay, '(good for NAT traversal)');
        }

        // Add real local IP candidates for same-LAN connectivity
        fullSDP = await addLocalIPCandidates(fullSDP);

        // Package
        const answerPayload = { type: 'answer', sdp: fullSDP, pk: publicKey };
        const answerJson = JSON.stringify(answerPayload);
        const encoded = utf8ToBase64(answerJson);
        log('Answer code generated, length:', encoded.length, 'chars');
        log('=== ANSWER READY - Share this code back to initiator ===');
        return encoded;
    }

    // Complete connection (initiator side)
    async function completeConnection(answerCode) {
        log('=== COMPLETE CONNECTION (Initiator processing answer) ===');

        let json, payload;
        try {
            json = base64ToUtf8(answerCode.trim());
            payload = JSON.parse(json);
            log('Answer code decoded successfully');
        } catch (e) {
            logError('Failed to decode answer code:', e.message);
            throw new Error('Invalid answer code format: ' + e.message);
        }

        validatePayload(payload, 'answer');

        const answerCandidates = analyzeCandidates(payload.sdp);
        log('Answer SDP received:', JSON.stringify(answerCandidates));
        log('Answer SDP length:', payload.sdp.length);

        // Import peer's public key
        log('Importing peer public key and deriving encryption key...');
        await CryptoModule.importPeerPublicKey(payload.pk);
        await CryptoModule.deriveEncryptionKey();
        log('Encryption key derived successfully');

        // Set remote description
        log('Setting remote description (answer)...');
        log('Current signalingState before:', peerConnection.signalingState);
        log('Current iceConnectionState before:', peerConnection.iceConnectionState);
        log('Current iceGatheringState before:', peerConnection.iceGatheringState);
        try {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
            );
            log('Remote description set successfully');
            log('signalingState after:', peerConnection.signalingState);
            log('iceConnectionState after:', peerConnection.iceConnectionState);
        } catch (e) {
            logError('FAILED to set remote description:', e.message);
            throw e;
        }

        log('=== WAITING FOR ICE CONNECTION... ===');
        log('ICE should now attempt to connect using the exchanged candidates.');
        log('Watch for "ICE connection state changed: connected" above.');
    }

    // Send data
    function send(data) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            throw new Error('DataChannel not open (state: ' + (dataChannel ? dataChannel.readyState : 'null') + ')');
        }
        dataChannel.send(data);
    }

    function sendString(str) { send(str); }
    function sendBinary(buffer) { send(buffer); }

    function isConnected() {
        return dataChannel && dataChannel.readyState === 'open';
    }

    function getConnectionInfo() {
        if (!peerConnection) return null;
        return {
            iceState: peerConnection.iceConnectionState,
            connectionState: peerConnection.connectionState,
            signalingState: peerConnection.signalingState,
            gatheringState: peerConnection.iceGatheringState,
            dataChannelState: dataChannel ? dataChannel.readyState : 'none',
            isInitiator: isInitiator
        };
    }

    function getPeerConnection() { return peerConnection; }

    function disconnect() {
        log('Disconnecting...');
        if (dataChannel) {
            dataChannel.close();
            dataChannel = null;
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        log('Disconnected');
    }

    function on(event, callback) {
        switch (event) {
            case 'connected': onConnected = callback; break;
            case 'disconnected': onDisconnected = callback; break;
            case 'message': onMessage = callback; break;
            case 'datachannel-open': onDataChannelOpen = callback; break;
        }
    }

    return {
        createOffer,
        createAnswer,
        completeConnection,
        sendString,
        sendBinary,
        isConnected,
        getConnectionInfo,
        getPeerConnection,
        disconnect,
        on
    };
})();

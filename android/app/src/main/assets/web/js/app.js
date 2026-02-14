// Main Application Controller
// Wires all modules together

window.App = (() => {
    let isReady = false;
    let heartbeatInterval = null;
    let lastPongTime = 0;
    let peerOnline = false;
    const HEARTBEAT_INTERVAL = 3000;  // Send ping every 3 seconds
    const OFFLINE_TIMEOUT = 10000;     // Mark offline after 10 seconds no response

    async function init() {
        // Setup UI
        UIModule.showScreen('welcome');
        UIModule.initWelcomeScreen(handleCreateInvite, handleJoinPeer);
        UIModule.initChatScreen();

        // Setup connection event handlers
        ConnectionModule.on('connected', handleConnected);
        ConnectionModule.on('disconnected', handleDisconnected);
        ConnectionModule.on('message', handleMessage);
        ConnectionModule.on('datachannel-open', handleDataChannelOpen);

        // Setup chat event handlers
        ChatModule.on('message', handleChatMessage);
        ChatModule.on('delivered', handleMessageDelivered);

        // Setup file input
        document.getElementById('btn-attach').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        document.getElementById('file-input').addEventListener('change', handleFileSelected);

        // Setup voice call button
        document.getElementById('btn-voice-call').addEventListener('click', () => {
            VoiceModule.startCall();
        });

        // Setup copy buttons
        document.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                const text = document.getElementById(targetId).value;
                UIModule.copyToClipboard(text);
            });
        });

        // Setup submit buttons for connection flow
        document.getElementById('btn-submit-offer').addEventListener('click', handleSubmitOffer);
        document.getElementById('btn-submit-answer').addEventListener('click', handleSubmitAnswer);

        // Setup disconnect button
        document.getElementById('btn-disconnect').addEventListener('click', handleDisconnectClick);

        // Setup start over button
        document.getElementById('btn-start-over').addEventListener('click', handleStartOver);

        // Setup name input
        const savedName = localStorage.getItem('privateChat_name') || '';
        if (savedName) {
            document.getElementById('display-name').value = savedName;
        }

        console.log('[App] Initialized');
    }

    // --- Connection Flow ---

    async function handleCreateInvite() {
        try {
            const name = document.getElementById('display-name').value.trim() || 'Anonymous';
            localStorage.setItem('privateChat_name', name);

            UIModule.showScreen('connect');
            UIModule.showConnecting();

            const offerCode = await ConnectionModule.createOffer();

            UIModule.hideConnecting();
            UIModule.showOfferCode(offerCode);

        } catch (error) {
            console.error('[App] Failed to create invite:', error);
            UIModule.hideConnecting();
            UIModule.showError('Failed to create invite: ' + error.message);
        }
    }

    async function handleJoinPeer() {
        const name = document.getElementById('display-name').value.trim() || 'Anonymous';
        localStorage.setItem('privateChat_name', name);

        UIModule.showScreen('connect');
        UIModule.showJoinSection();
    }

    async function handleSubmitOffer() {
        const offerCode = UIModule.getOfferInput();
        if (!offerCode) {
            UIModule.showError('Please paste the invite code');
            return;
        }

        try {
            UIModule.showConnecting();
            const answerCode = await ConnectionModule.createAnswer(offerCode);
            UIModule.hideConnecting();
            UIModule.showAnswerCode(answerCode);
        } catch (error) {
            console.error('[App] Failed to process invite:', error);
            UIModule.hideConnecting();
            UIModule.showError('Invalid invite code: ' + error.message);
        }
    }

    async function handleSubmitAnswer() {
        const answerCode = UIModule.getAnswerInput();
        if (!answerCode) {
            UIModule.showError('Please paste the answer code');
            return;
        }

        try {
            UIModule.showConnecting();
            await ConnectionModule.completeConnection(answerCode);
            // Connection will be established via ICE, handled by onConnected callback
        } catch (error) {
            console.error('[App] Failed to complete connection:', error);
            UIModule.hideConnecting();
            UIModule.showError('Invalid answer code: ' + error.message);
        }
    }

    // --- Connection Events ---

    async function handleConnected() {
        console.log('[App] Peer connected!');
        UIModule.setConnectionStatus('connected');
    }

    async function handleDataChannelOpen() {
        console.log('[App] DataChannel open, chat ready!');
        UIModule.hideConnecting();
        UIModule.showScreen('chat');
        UIModule.setConnectionStatus('connected');

        // Show encryption fingerprints and security info
        try {
            const myFp = await CryptoModule.getFingerprint();
            const peerFp = await CryptoModule.getPeerFingerprint();
            const secInfo = CryptoModule.getSecurityInfo();
            UIModule.setFingerprints(myFp, peerFp);
            UIModule.addSystemMessage(`E2E Encryption: ${secInfo.curve} + ${secInfo.cipher}`);
            UIModule.addSystemMessage(`Your key: ${myFp}`);
            UIModule.addSystemMessage(`Peer key: ${peerFp}`);
        } catch (e) {
            UIModule.addSystemMessage('Connected! End-to-end encryption active.');
        }

        // Send our name
        const name = localStorage.getItem('privateChat_name') || 'Anonymous';
        await ChatModule.sendName(name);

        isReady = true;

        // Start heartbeat for online status
        startHeartbeat();
    }

    function handleDisconnected(state) {
        console.log('[App] Disconnected:', state);
        stopHeartbeat();
        peerOnline = false;
        UIModule.setConnectionStatus('disconnected');
        UIModule.setPeerOnlineStatus(false);
        UIModule.addSystemMessage('Peer disconnected.');
        isReady = false;
    }

    // --- Heartbeat / Online Status ---

    function startHeartbeat() {
        lastPongTime = Date.now();
        peerOnline = true;
        UIModule.setPeerOnlineStatus(true);

        heartbeatInterval = setInterval(async () => {
            if (!isReady) return;

            // Send ping
            try {
                await ChatModule.sendControl(ChatModule.MSG_TYPES.PING, {});
            } catch (e) {
                // DataChannel might be closed
            }

            // Check if peer responded recently
            const elapsed = Date.now() - lastPongTime;
            const wasOnline = peerOnline;

            if (elapsed > OFFLINE_TIMEOUT) {
                peerOnline = false;
                if (wasOnline) {
                    UIModule.setPeerOnlineStatus(false);
                }
            } else {
                peerOnline = true;
                if (!wasOnline) {
                    UIModule.setPeerOnlineStatus(true);
                }
            }
        }, HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    // --- Message Handling ---

    function handleMessage(data) {
        // All messages (text, files, voice) come as encrypted JSON strings
        if (typeof data === 'string') {
            ChatModule.handleIncoming(data);
        }
    }

    function handleChatMessage(msg) {
        switch (msg.type) {
            case 'text':
                UIModule.addMessage(msg);
                // Play notification sound or vibrate
                notifyNewMessage();
                break;
            case 'name':
                UIModule.setPeerName(msg.name);
                UIModule.addSystemMessage(`Peer identified as: ${msg.name}`);
                break;
            case 'typing':
                UIModule.showTypingIndicator(msg.isTyping);
                break;
            case 'ping':
                // Peer pinged us - update their online status
                lastPongTime = Date.now();
                break;
            case 'pong':
                // Peer responded to our ping
                lastPongTime = Date.now();
                break;
            case ChatModule.MSG_TYPES.FILE_META:
                FileTransferModule.handleFileMeta(msg);
                break;
            case ChatModule.MSG_TYPES.FILE_CHUNK:
                FileTransferModule.handleFileChunk(msg);
                break;
            case ChatModule.MSG_TYPES.FILE_COMPLETE:
                FileTransferModule.handleFileComplete(msg);
                break;
            case ChatModule.MSG_TYPES.VOICE_REQUEST:
            case ChatModule.MSG_TYPES.VOICE_ACCEPT:
            case ChatModule.MSG_TYPES.VOICE_REJECT:
            case ChatModule.MSG_TYPES.VOICE_END:
                VoiceModule.handleVoiceMessage(msg);
                break;
        }
    }

    function handleMessageDelivered(msg) {
        UIModule.updateMessageStatus(msg.id, 'delivered');
    }

    // --- User Actions ---

    async function sendMessage(text) {
        if (!isReady) return;
        try {
            const msg = await ChatModule.sendText(text);
            UIModule.addMessage(msg);
        } catch (error) {
            console.error('[App] Failed to send message:', error);
            UIModule.showError('Failed to send message');
        }
    }

    async function sendTyping(isTyping) {
        if (!isReady) return;
        try {
            await ChatModule.sendTyping(isTyping);
        } catch (error) {
            // Ignore typing indicator errors
        }
    }

    async function handleFileSelected(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = ''; // Reset input

        if (!isReady) {
            UIModule.showError('Not connected');
            return;
        }

        try {
            await FileTransferModule.sendFile(file);
        } catch (error) {
            console.error('[App] Failed to send file:', error);
            UIModule.showError('Failed to send file: ' + error.message);
        }
    }

    function handleDisconnectClick() {
        stopHeartbeat();
        ConnectionModule.disconnect();
        ChatModule.clear();
        UIModule.showScreen('welcome');
        UIModule.setConnectionStatus('disconnected');
        isReady = false;
    }

    function handleStartOver() {
        stopHeartbeat();
        ConnectionModule.disconnect();
        ChatModule.clear();
        isReady = false;
        // Reset connect screen sections
        document.getElementById('offer-section').classList.add('hidden');
        document.getElementById('answer-input-section').classList.add('hidden');
        document.getElementById('join-section').classList.add('hidden');
        document.getElementById('answer-output-section').classList.add('hidden');
        document.getElementById('connecting-status').classList.add('hidden');
        document.getElementById('error-message').classList.add('hidden');
        // Clear all code textareas
        document.getElementById('offer-code').value = '';
        document.getElementById('offer-input').value = '';
        document.getElementById('answer-input').value = '';
        document.getElementById('answer-code').value = '';
        // Go back to welcome
        UIModule.showScreen('welcome');
    }

    function notifyNewMessage() {
        // Visual notification if tab is not focused
        if (document.hidden) {
            document.title = '(New Message) Private Chat';
            document.addEventListener('visibilitychange', function handler() {
                document.title = 'Private Chat';
                document.removeEventListener('visibilitychange', handler);
            });
        }
    }

    // Public API
    return {
        init,
        sendMessage,
        sendTyping
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

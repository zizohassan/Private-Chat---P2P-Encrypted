// Chat Module - Encrypted messaging over DataChannel

const ChatModule = (() => {
    let messages = [];
    let onMessageReceived = null;
    let onMessageDelivered = null;
    let myName = 'Me';
    let peerName = 'Peer';

    // Message types
    const MSG_TYPES = {
        TEXT: 'text',
        FILE_META: 'file_meta',
        FILE_CHUNK: 'file_chunk',
        FILE_COMPLETE: 'file_complete',
        VOICE_REQUEST: 'voice_request',
        VOICE_ACCEPT: 'voice_accept',
        VOICE_REJECT: 'voice_reject',
        VOICE_END: 'voice_end',
        DELIVERY_ACK: 'delivery_ack',
        NAME: 'name',
        TYPING: 'typing',
        PING: 'ping',
        PONG: 'pong'
    };

    // Generate unique message ID
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // Send a text message (encrypts and sends)
    async function sendText(text) {
        const msg = {
            type: MSG_TYPES.TEXT,
            id: generateId(),
            content: text,
            timestamp: Date.now()
        };

        const encrypted = await CryptoModule.encrypt(JSON.stringify(msg));
        ConnectionModule.sendString(JSON.stringify(encrypted));

        // Store locally
        const localMsg = { ...msg, sender: 'me', status: 'sent' };
        messages.push(localMsg);
        return localMsg;
    }

    // Send control message (name, typing, voice signals, etc.)
    async function sendControl(type, data = {}) {
        const msg = {
            type: type,
            id: generateId(),
            timestamp: Date.now(),
            ...data
        };

        const encrypted = await CryptoModule.encrypt(JSON.stringify(msg));
        ConnectionModule.sendString(JSON.stringify(encrypted));
        return msg;
    }

    // Send delivery acknowledgment
    async function sendDeliveryAck(messageId) {
        await sendControl(MSG_TYPES.DELIVERY_ACK, { ackId: messageId });
    }

    // Send your display name to peer
    async function sendName(name) {
        myName = name;
        await sendControl(MSG_TYPES.NAME, { name: name });
    }

    // Send typing indicator
    async function sendTyping(isTyping) {
        await sendControl(MSG_TYPES.TYPING, { isTyping: isTyping });
    }

    // Handle incoming message from DataChannel
    async function handleIncoming(data) {
        try {
            // Parse the encrypted envelope
            const encrypted = JSON.parse(data);

            // Decrypt
            const decrypted = await CryptoModule.decrypt(encrypted);
            const msg = JSON.parse(decrypted);

            switch (msg.type) {
                case MSG_TYPES.TEXT:
                    const textMsg = {
                        ...msg,
                        sender: 'peer',
                        status: 'received'
                    };
                    messages.push(textMsg);
                    if (onMessageReceived) onMessageReceived(textMsg);
                    // Send delivery ack
                    await sendDeliveryAck(msg.id);
                    break;

                case MSG_TYPES.DELIVERY_ACK:
                    // Mark our message as delivered
                    const original = messages.find(m => m.id === msg.ackId);
                    if (original) {
                        original.status = 'delivered';
                        if (onMessageDelivered) onMessageDelivered(original);
                    }
                    break;

                case MSG_TYPES.NAME:
                    peerName = msg.name;
                    if (onMessageReceived) onMessageReceived({ type: 'name', name: msg.name });
                    break;

                case MSG_TYPES.TYPING:
                    if (onMessageReceived) onMessageReceived({ type: 'typing', isTyping: msg.isTyping });
                    break;

                case MSG_TYPES.FILE_META:
                case MSG_TYPES.FILE_CHUNK:
                case MSG_TYPES.FILE_COMPLETE:
                    // Forward to file transfer module
                    if (onMessageReceived) onMessageReceived(msg);
                    break;

                case MSG_TYPES.PING:
                    // Respond to ping with pong (heartbeat)
                    await sendControl(MSG_TYPES.PONG, {});
                    if (onMessageReceived) onMessageReceived({ type: 'ping' });
                    break;

                case MSG_TYPES.PONG:
                    // Peer responded to our ping
                    if (onMessageReceived) onMessageReceived({ type: 'pong' });
                    break;

                case MSG_TYPES.VOICE_REQUEST:
                case MSG_TYPES.VOICE_ACCEPT:
                case MSG_TYPES.VOICE_REJECT:
                case MSG_TYPES.VOICE_END:
                    // Forward to voice module
                    if (onMessageReceived) onMessageReceived(msg);
                    break;
            }
        } catch (error) {
            console.error('[Chat] Failed to handle message:', error);
        }
    }

    // Get all messages
    function getMessages() {
        return [...messages];
    }

    // Get names
    function getMyName() { return myName; }
    function getPeerName() { return peerName; }

    // Set event callbacks
    function on(event, callback) {
        switch (event) {
            case 'message': onMessageReceived = callback; break;
            case 'delivered': onMessageDelivered = callback; break;
        }
    }

    // Clear messages (on disconnect)
    function clear() {
        messages = [];
        peerName = 'Peer';
    }

    return {
        MSG_TYPES,
        sendText,
        sendControl,
        sendName,
        sendTyping,
        handleIncoming,
        getMessages,
        getMyName,
        getPeerName,
        on,
        clear
    };
})();

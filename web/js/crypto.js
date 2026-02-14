// E2E Encryption Module - ECDH P-521 + AES-256-GCM
// P-521 = 521-bit ECC keys (equivalent to ~15,360-bit RSA)
// Uses Web Crypto API (no external dependencies)

const CryptoModule = (() => {
    let keyPair = null;
    let sharedEncryptionKey = null;
    let peerPublicKey = null;
    let sessionSalt = null; // Random salt generated per session

    // Generate ECDH key pair using P-521 curve (strongest available)
    // P-521 key = 521 bits = ~15,360-bit RSA equivalent security
    async function generateKeyPair() {
        keyPair = await window.crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-521' },
            true, // extractable (needed to export public key)
            ['deriveKey', 'deriveBits']
        );
        return keyPair;
    }

    // Generate random session salt (called by initiator)
    function generateSalt() {
        sessionSalt = window.crypto.getRandomValues(new Uint8Array(32));
        return arrayBufferToBase64(sessionSalt.buffer);
    }

    // Set session salt from peer (called by responder)
    function setSalt(base64Salt) {
        sessionSalt = new Uint8Array(base64ToArrayBuffer(base64Salt));
    }

    // Get current salt as base64
    function getSalt() {
        if (!sessionSalt) throw new Error('Salt not generated');
        return arrayBufferToBase64(sessionSalt.buffer);
    }

    // Export public key as base64 string (for embedding in signaling codes)
    async function exportPublicKey() {
        if (!keyPair) throw new Error('Key pair not generated');
        const exported = await window.crypto.subtle.exportKey('raw', keyPair.publicKey);
        return arrayBufferToBase64(exported);
    }

    // Import peer's public key from base64 string
    async function importPeerPublicKey(base64Key) {
        const keyData = base64ToArrayBuffer(base64Key);
        peerPublicKey = await window.crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'ECDH', namedCurve: 'P-521' },
            true, // extractable for fingerprint
            []
        );
        return peerPublicKey;
    }

    // Derive shared secret and encryption key using ECDH + HKDF
    async function deriveEncryptionKey(importedPeerKey) {
        if (!keyPair) throw new Error('Key pair not generated');
        const peer = importedPeerKey || peerPublicKey;
        if (!peer) throw new Error('Peer public key not imported');

        // Step 1: ECDH to get shared bits (528 bits from P-521 - max available)
        const sharedBits = await window.crypto.subtle.deriveBits(
            { name: 'ECDH', public: peer },
            keyPair.privateKey,
            528 // P-521 produces 66 bytes (528 bits) of shared secret
        );

        // Step 2: Import shared bits as HKDF key material
        const hkdfKey = await window.crypto.subtle.importKey(
            'raw',
            sharedBits,
            'HKDF',
            false,
            ['deriveKey']
        );

        // Step 3: Derive AES-256-GCM key using HKDF with SHA-512
        // Uses random per-session salt (exchanged in signaling codes)
        if (!sessionSalt) {
            throw new Error('Session salt not set - call generateSalt() or setSalt() first');
        }
        sharedEncryptionKey = await window.crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-512',
                salt: sessionSalt,
                info: new TextEncoder().encode('privateChat-e2e-aes256gcm-key')
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );

        return sharedEncryptionKey;
    }

    // Encrypt plaintext string -> { iv, ciphertext } as base64
    async function encrypt(plaintext) {
        if (!sharedEncryptionKey) throw new Error('Encryption key not derived');

        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
        const encoded = new TextEncoder().encode(plaintext);

        const ciphertext = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            sharedEncryptionKey,
            encoded
        );

        return {
            iv: arrayBufferToBase64(iv),
            ciphertext: arrayBufferToBase64(ciphertext)
        };
    }

    // Decrypt { iv, ciphertext } -> plaintext string
    async function decrypt(encryptedData) {
        if (!sharedEncryptionKey) throw new Error('Encryption key not derived');

        const iv = base64ToArrayBuffer(encryptedData.iv);
        const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            sharedEncryptionKey,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    }

    // Encrypt raw ArrayBuffer (for file chunks)
    async function encryptBuffer(buffer) {
        if (!sharedEncryptionKey) throw new Error('Encryption key not derived');

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            sharedEncryptionKey,
            buffer
        );

        // Prepend IV to ciphertext for simplicity
        const result = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(ciphertext), iv.byteLength);
        return result.buffer;
    }

    // Decrypt raw ArrayBuffer (for file chunks)
    async function decryptBuffer(buffer) {
        if (!sharedEncryptionKey) throw new Error('Encryption key not derived');

        const data = new Uint8Array(buffer);
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);

        return await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            sharedEncryptionKey,
            ciphertext
        );
    }

    // Get key fingerprint (SHA-256 hash of public key) for verification
    // Shows more bytes for P-521's larger key
    async function getFingerprint() {
        if (!keyPair) throw new Error('Key pair not generated');
        const exported = await window.crypto.subtle.exportKey('raw', keyPair.publicKey);
        const hash = await window.crypto.subtle.digest('SHA-256', exported);
        const bytes = new Uint8Array(hash);
        return Array.from(bytes.slice(0, 12))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':');
    }

    // Get peer's key fingerprint
    async function getPeerFingerprint() {
        if (!peerPublicKey) throw new Error('Peer public key not imported');
        const exported = await window.crypto.subtle.exportKey('raw', peerPublicKey);
        const hash = await window.crypto.subtle.digest('SHA-256', exported);
        const bytes = new Uint8Array(hash);
        return Array.from(bytes.slice(0, 12))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':');
    }

    // Get security info for display
    function getSecurityInfo() {
        return {
            curve: 'P-521 (521-bit)',
            rsaEquivalent: '~15,360-bit RSA',
            cipher: 'AES-256-GCM',
            kdf: 'HKDF-SHA-512',
            keyExchange: 'ECDH'
        };
    }

    // --- Utility functions ---

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    return {
        generateKeyPair,
        generateSalt,
        setSalt,
        getSalt,
        exportPublicKey,
        importPeerPublicKey,
        deriveEncryptionKey,
        encrypt,
        decrypt,
        encryptBuffer,
        decryptBuffer,
        getFingerprint,
        getPeerFingerprint,
        getSecurityInfo,
        arrayBufferToBase64,
        base64ToArrayBuffer
    };
})();

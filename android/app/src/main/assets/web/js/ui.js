// UI Controller Module
// Manages screens, message rendering, and user interactions

const UIModule = (() => {
    // Screen elements
    const screens = {
        welcome: 'welcome-screen',
        connect: 'connect-screen',
        chat: 'chat-screen'
    };

    let currentScreen = 'welcome';
    let typingTimeout = null;

    // Show a specific screen, hide others
    function showScreen(screenName) {
        Object.keys(screens).forEach(key => {
            const el = document.getElementById(screens[key]);
            if (el) {
                el.classList.toggle('active', key === screenName);
            }
        });
        currentScreen = screenName;
    }

    // --- Welcome Screen ---
    function initWelcomeScreen(onCreateInvite, onJoinPeer) {
        document.getElementById('btn-create-invite').addEventListener('click', onCreateInvite);
        document.getElementById('btn-join-peer').addEventListener('click', onJoinPeer);
    }

    // --- Connect Screen ---
    function showOfferCode(code) {
        const el = document.getElementById('offer-code');
        el.value = code;
        document.getElementById('offer-section').classList.remove('hidden');
        document.getElementById('answer-input-section').classList.remove('hidden');
    }

    function showJoinSection() {
        document.getElementById('join-section').classList.remove('hidden');
    }

    function showAnswerCode(code) {
        const el = document.getElementById('answer-code');
        el.value = code;
        document.getElementById('answer-output-section').classList.remove('hidden');
    }

    function getOfferInput() {
        return document.getElementById('offer-input').value.trim();
    }

    function getAnswerInput() {
        return document.getElementById('answer-input').value.trim();
    }

    function showConnecting() {
        document.getElementById('connecting-status').classList.remove('hidden');
    }

    function hideConnecting() {
        document.getElementById('connecting-status').classList.add('hidden');
    }

    function showError(message) {
        const el = document.getElementById('error-message');
        el.textContent = message;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    // --- Chat Screen ---
    function initChatScreen() {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send');

        sendBtn.addEventListener('click', () => {
            const text = input.value.trim();
            if (text) {
                input.value = '';
                if (window.App) window.App.sendMessage(text);
            }
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        });

        // Typing indicator
        let lastTypingSent = 0;
        input.addEventListener('input', () => {
            const now = Date.now();
            if (now - lastTypingSent > 2000) {
                lastTypingSent = now;
                if (window.App) window.App.sendTyping(true);
            }
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                if (window.App) window.App.sendTyping(false);
            }, 3000);
        });
    }

    function addMessage(msg) {
        const container = document.getElementById('messages-container');
        const div = document.createElement('div');
        div.className = `message ${msg.sender === 'me' ? 'sent' : 'received'}`;
        div.id = `msg-${msg.id}`;

        const time = new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        // Check if content contains an image (from file transfer)
        let contentHTML;
        if (msg.isImage && msg.imageUrl) {
            // Only allow data: and blob: URLs for images (no remote URLs)
            const safeImgUrl = (msg.imageUrl.startsWith('data:') || msg.imageUrl.startsWith('blob:'))
                ? msg.imageUrl : '';
            contentHTML = safeImgUrl
                ? `<img src="${safeImgUrl}" class="chat-image" onclick="UIModule.showImageFullscreen(this.src)">`
                : `<span class="message-text">[Image blocked: invalid source]</span>`;
        } else if (msg.isFile) {
            // Validate downloadUrl - only allow blob: URLs (created by URL.createObjectURL)
            let safeDownloadUrl = '';
            if (msg.downloadUrl && msg.downloadUrl.startsWith('blob:')) {
                safeDownloadUrl = msg.downloadUrl;
            }
            contentHTML = `<div class="file-message">
                <span class="file-icon">&#128196;</span>
                <div class="file-info">
                    <span class="file-name">${escapeHTML(msg.fileName)}</span>
                    <span class="file-size">${formatFileSize(msg.fileSize)}</span>
                </div>
                ${safeDownloadUrl ? `<a href="${escapeHTML(safeDownloadUrl)}" download="${escapeHTML(msg.fileName)}" class="file-download">&#11015;</a>` : ''}
            </div>`;
        } else {
            contentHTML = `<span class="message-text">${escapeHTML(msg.content)}</span>`;
        }

        div.innerHTML = `
            ${contentHTML}
            <div class="message-meta">
                <span class="message-time">${time}</span>
                ${msg.sender === 'me' ? `<span class="message-status" id="status-${msg.id}">${getStatusIcon(msg.status)}</span>` : ''}
            </div>
        `;

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function updateMessageStatus(msgId, status) {
        const el = document.getElementById(`status-${msgId}`);
        if (el) {
            el.innerHTML = getStatusIcon(status);
        }
    }

    function getStatusIcon(status) {
        switch (status) {
            case 'sent': return '&#10003;';      // single check
            case 'delivered': return '&#10003;&#10003;'; // double check
            default: return '';
        }
    }

    function showTypingIndicator(show) {
        const el = document.getElementById('typing-indicator');
        el.classList.toggle('hidden', !show);
    }

    function setPeerName(name) {
        document.getElementById('peer-name').textContent = name;
        // Set avatar initial
        const avatar = document.getElementById('peer-avatar');
        if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    }

    function setPeerOnlineStatus(online) {
        const dot = document.getElementById('online-dot');
        const statusText = document.getElementById('online-status-text');
        if (dot) {
            dot.className = 'online-dot ' + (online ? 'online' : 'offline');
        }
        if (statusText) {
            statusText.textContent = online ? 'Online' : 'Offline';
            statusText.className = 'online-status-text ' + (online ? 'online' : 'offline');
        }
    }

    function setConnectionStatus(status) {
        const el = document.getElementById('connection-status');
        el.className = 'connection-status ' + status;
        el.textContent = status === 'connected' ? 'E2E Encrypted (P-521)' :
                         status === 'connecting' ? 'Connecting...' : 'Disconnected';
    }

    function setFingerprints(myFp, peerFp) {
        const el = document.getElementById('fingerprints');
        if (el) {
            el.innerHTML = `Your key: <code>${myFp}</code><br>Peer key: <code>${peerFp}</code>`;
        }
    }

    function addSystemMessage(text) {
        const container = document.getElementById('messages-container');
        const div = document.createElement('div');
        div.className = 'system-message';
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    // File transfer progress
    function showFileProgress(fileId, fileName, progress) {
        let el = document.getElementById(`file-progress-${fileId}`);
        if (!el) {
            const container = document.getElementById('messages-container');
            el = document.createElement('div');
            el.className = 'file-progress';
            el.id = `file-progress-${fileId}`;
            el.innerHTML = `
                <span class="file-progress-name">${escapeHTML(fileName)}</span>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
                <span class="file-progress-percent">${progress}%</span>
            `;
            container.appendChild(el);
            container.scrollTop = container.scrollHeight;
        } else {
            el.querySelector('.progress-fill').style.width = `${progress}%`;
            el.querySelector('.file-progress-percent').textContent = `${progress}%`;
        }
    }

    function removeFileProgress(fileId) {
        const el = document.getElementById(`file-progress-${fileId}`);
        if (el) el.remove();
    }

    // Voice call UI
    function showIncomingCall(onAccept, onReject) {
        const el = document.getElementById('incoming-call');
        el.classList.remove('hidden');
        document.getElementById('btn-accept-call').onclick = () => {
            el.classList.add('hidden');
            onAccept();
        };
        document.getElementById('btn-reject-call').onclick = () => {
            el.classList.add('hidden');
            onReject();
        };
    }

    function showActiveCall(onEnd, onToggleMute) {
        document.getElementById('active-call').classList.remove('hidden');
        document.getElementById('btn-end-call').onclick = onEnd;
        document.getElementById('btn-mute').onclick = onToggleMute;
        startCallTimer();
    }

    function hideCallUI() {
        document.getElementById('incoming-call').classList.add('hidden');
        document.getElementById('active-call').classList.add('hidden');
        stopCallTimer();
    }

    let callTimerInterval = null;
    let callStartTime = null;
    function startCallTimer() {
        callStartTime = Date.now();
        callTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            document.getElementById('call-timer').textContent = `${mins}:${secs}`;
        }, 1000);
    }

    function stopCallTimer() {
        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }
    }

    function setMuteState(muted) {
        const btn = document.getElementById('btn-mute');
        btn.textContent = muted ? 'Unmute' : 'Mute';
        btn.classList.toggle('muted', muted);
    }

    // Copy to clipboard
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied to clipboard!');
        }).catch(() => {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('Copied to clipboard!');
        });
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // Image fullscreen
    function showImageFullscreen(src) {
        const overlay = document.getElementById('image-overlay');
        document.getElementById('fullscreen-image').src = src;
        overlay.classList.remove('hidden');
        overlay.onclick = () => overlay.classList.add('hidden');
    }

    // Utility
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(1) + ' GB';
    }

    return {
        showScreen,
        initWelcomeScreen,
        initChatScreen,
        showOfferCode,
        showJoinSection,
        showAnswerCode,
        getOfferInput,
        getAnswerInput,
        showConnecting,
        hideConnecting,
        showError,
        addMessage,
        updateMessageStatus,
        showTypingIndicator,
        setPeerName,
        setPeerOnlineStatus,
        setConnectionStatus,
        setFingerprints,
        addSystemMessage,
        showFileProgress,
        removeFileProgress,
        showIncomingCall,
        showActiveCall,
        hideCallUI,
        setMuteState,
        copyToClipboard,
        showImageFullscreen,
        escapeHTML,
        formatFileSize
    };
})();

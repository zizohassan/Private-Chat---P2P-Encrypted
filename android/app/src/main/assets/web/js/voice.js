// Voice Call Module - WebRTC Audio

const VoiceModule = (() => {
    let localStream = null;
    let isInCall = false;
    let isMuted = false;
    let onCallStateChange = null;

    // Request microphone and start a voice call
    async function startCall() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const pc = ConnectionModule.getPeerConnection();

            if (!pc) {
                throw new Error('No peer connection');
            }

            // Add audio tracks to the peer connection
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            // Listen for remote audio
            pc.ontrack = (event) => {
                const remoteAudio = document.getElementById('remote-audio');
                if (!remoteAudio) {
                    const audio = document.createElement('audio');
                    audio.id = 'remote-audio';
                    audio.autoplay = true;
                    document.body.appendChild(audio);
                }
                document.getElementById('remote-audio').srcObject = event.streams[0];
            };

            // Need to renegotiate since we added tracks
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Send renegotiation offer through chat channel
            await ChatModule.sendControl(ChatModule.MSG_TYPES.VOICE_REQUEST, {
                sdp: pc.localDescription.sdp
            });

            isInCall = true;
            if (onCallStateChange) onCallStateChange('calling');

        } catch (error) {
            console.error('[Voice] Failed to start call:', error);
            UIModule.showError('Failed to access microphone: ' + error.message);
            cleanup();
        }
    }

    // Accept an incoming call
    async function acceptCall(remoteSdp) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const pc = ConnectionModule.getPeerConnection();

            // Add our audio tracks
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            // Listen for remote audio
            pc.ontrack = (event) => {
                let remoteAudio = document.getElementById('remote-audio');
                if (!remoteAudio) {
                    remoteAudio = document.createElement('audio');
                    remoteAudio.id = 'remote-audio';
                    remoteAudio.autoplay = true;
                    document.body.appendChild(remoteAudio);
                }
                remoteAudio.srcObject = event.streams[0];
            };

            // Set the offer and create answer
            await pc.setRemoteDescription({ type: 'offer', sdp: remoteSdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            // Send answer back
            await ChatModule.sendControl(ChatModule.MSG_TYPES.VOICE_ACCEPT, {
                sdp: pc.localDescription.sdp
            });

            isInCall = true;
            if (onCallStateChange) onCallStateChange('active');
            UIModule.showActiveCall(endCall, toggleMute);
            UIModule.addSystemMessage('Voice call started');

        } catch (error) {
            console.error('[Voice] Failed to accept call:', error);
            UIModule.showError('Failed to access microphone: ' + error.message);
            rejectCall();
        }
    }

    // Handle call accepted by peer
    async function handleCallAccepted(remoteSdp) {
        try {
            const pc = ConnectionModule.getPeerConnection();
            await pc.setRemoteDescription({ type: 'answer', sdp: remoteSdp });

            isInCall = true;
            if (onCallStateChange) onCallStateChange('active');
            UIModule.showActiveCall(endCall, toggleMute);
            UIModule.addSystemMessage('Voice call started');
        } catch (error) {
            console.error('[Voice] Failed to complete call:', error);
        }
    }

    // Reject an incoming call
    async function rejectCall() {
        await ChatModule.sendControl(ChatModule.MSG_TYPES.VOICE_REJECT, {});
        cleanup();
    }

    // End the current call
    async function endCall() {
        await ChatModule.sendControl(ChatModule.MSG_TYPES.VOICE_END, {});
        cleanup();
        UIModule.hideCallUI();
        UIModule.addSystemMessage('Voice call ended');
    }

    // Handle remote call end
    function handleCallEnded() {
        cleanup();
        UIModule.hideCallUI();
        UIModule.addSystemMessage('Voice call ended');
    }

    // Toggle mute
    function toggleMute() {
        if (!localStream) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        UIModule.setMuteState(isMuted);
    }

    // Cleanup
    function cleanup() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        const remoteAudio = document.getElementById('remote-audio');
        if (remoteAudio) {
            remoteAudio.srcObject = null;
        }
        isInCall = false;
        isMuted = false;
    }

    // Handle incoming voice messages
    function handleVoiceMessage(msg) {
        switch (msg.type) {
            case ChatModule.MSG_TYPES.VOICE_REQUEST:
                if (onCallStateChange) onCallStateChange('incoming');
                UIModule.showIncomingCall(
                    () => acceptCall(msg.sdp),
                    () => rejectCall()
                );
                break;
            case ChatModule.MSG_TYPES.VOICE_ACCEPT:
                handleCallAccepted(msg.sdp);
                break;
            case ChatModule.MSG_TYPES.VOICE_REJECT:
                cleanup();
                UIModule.hideCallUI();
                UIModule.addSystemMessage('Call was rejected');
                break;
            case ChatModule.MSG_TYPES.VOICE_END:
                handleCallEnded();
                break;
        }
    }

    function on(event, callback) {
        if (event === 'state-change') onCallStateChange = callback;
    }

    function getCallState() {
        return { isInCall, isMuted };
    }

    return {
        startCall,
        endCall,
        toggleMute,
        handleVoiceMessage,
        getCallState,
        on
    };
})();

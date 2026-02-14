// File Transfer Module - Chunked P2P file sharing with E2E encryption
// All data sent as base64 through the encrypted chat channel (no raw binary)

const FileTransferModule = (() => {
    const CHUNK_SIZE = 12288; // 12KB raw = ~16KB base64 (safe for DataChannel)
    const MAX_CONCURRENT_TRANSFERS = 10;
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB limit
    let incomingFiles = {};   // Files being received
    let onFileReceived = null;

    // Convert ArrayBuffer to base64
    function bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // Convert base64 to ArrayBuffer
    function base64ToBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // Send a file to the peer
    async function sendFile(file) {
        if (file.size > MAX_FILE_SIZE) {
            UIModule.showError(`File too large (${UIModule.formatFileSize(file.size)}). Max: 500 MB`);
            return;
        }
        if (file.size === 0) {
            UIModule.showError('Cannot send empty file');
            return;
        }

        const fileId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const isImage = file.type.startsWith('image/');
        const buffer = await file.arrayBuffer();
        const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

        // Send file metadata first
        await ChatModule.sendControl(ChatModule.MSG_TYPES.FILE_META, {
            fileId: fileId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            totalChunks: totalChunks,
            isImage: isImage
        });

        // Send chunks as base64 through encrypted channel
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
            const chunk = buffer.slice(start, end);
            const chunkBase64 = bufferToBase64(chunk);

            // Send chunk through the encrypted chat channel
            await ChatModule.sendControl(ChatModule.MSG_TYPES.FILE_CHUNK, {
                fileId: fileId,
                index: i,
                data: chunkBase64
            });

            // Progress
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            UIModule.showFileProgress(fileId, file.name, progress);

            // Small delay every few chunks to avoid flooding
            if (i % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }

        // Send file complete signal
        await ChatModule.sendControl(ChatModule.MSG_TYPES.FILE_COMPLETE, {
            fileId: fileId
        });

        UIModule.removeFileProgress(fileId);

        // Show sent file in our own chat
        const localMsg = {
            type: 'text',
            id: fileId,
            timestamp: Date.now(),
            sender: 'me',
            isFile: true,
            fileName: file.name,
            fileSize: file.size,
            isImage: isImage,
            status: 'sent'
        };

        // For sender, create data URL from the original file
        if (isImage) {
            localMsg.imageUrl = await fileToDataURL(file);
        }

        UIModule.addMessage(localMsg);
    }

    // Convert File to data URL (for sender's own preview)
    function fileToDataURL(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
    }

    // Handle incoming file metadata
    function handleFileMeta(msg) {
        // Limit concurrent transfers
        if (Object.keys(incomingFiles).length >= MAX_CONCURRENT_TRANSFERS) {
            UIModule.showError('Too many concurrent transfers. Please wait.');
            return;
        }
        // Validate file size
        if (msg.fileSize > MAX_FILE_SIZE || msg.fileSize < 0) {
            UIModule.showError('Rejected file: invalid size');
            return;
        }
        // Validate total chunks is reasonable
        const expectedChunks = Math.ceil(msg.fileSize / CHUNK_SIZE);
        if (msg.totalChunks < 0 || msg.totalChunks > expectedChunks + 1) {
            UIModule.showError('Rejected file: invalid chunk count');
            return;
        }

        incomingFiles[msg.fileId] = {
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            fileType: msg.fileType,
            totalChunks: msg.totalChunks,
            isImage: msg.isImage,
            chunks: new Array(msg.totalChunks),
            receivedChunks: 0
        };
        UIModule.addSystemMessage(`Receiving file: ${msg.fileName} (${UIModule.formatFileSize(msg.fileSize)})`);
    }

    // Handle incoming file chunk (arrives as decrypted JSON through chat channel)
    function handleFileChunk(msg) {
        const fileInfo = incomingFiles[msg.fileId];
        if (!fileInfo) return;

        // Bounds check
        if (msg.index < 0 || msg.index >= fileInfo.totalChunks) return;

        // Only count new chunks (ignore duplicates)
        if (!fileInfo.chunks[msg.index]) {
            fileInfo.receivedChunks++;
        }
        fileInfo.chunks[msg.index] = msg.data; // base64 string

        const progress = Math.round((fileInfo.receivedChunks / fileInfo.totalChunks) * 100);
        UIModule.showFileProgress(msg.fileId, fileInfo.fileName, progress);
    }

    // Handle file complete - reassemble and display
    function handleFileComplete(msg) {
        const fileInfo = incomingFiles[msg.fileId];
        if (!fileInfo) return;

        // Verify all chunks received
        for (let i = 0; i < fileInfo.totalChunks; i++) {
            if (!fileInfo.chunks[i]) {
                UIModule.showError(`File transfer incomplete: missing chunk ${i + 1}/${fileInfo.totalChunks}`);
                UIModule.removeFileProgress(msg.fileId);
                delete incomingFiles[msg.fileId];
                return;
            }
        }

        // Reassemble all base64 chunks into one buffer
        const allChunks = [];
        for (const chunkBase64 of fileInfo.chunks) {
            allChunks.push(base64ToBuffer(chunkBase64));
        }

        // Merge into single Uint8Array
        const totalSize = allChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const assembled = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of allChunks) {
            assembled.set(chunk, offset);
            offset += chunk.byteLength;
        }

        // Create base64 data URL (works without any server!)
        const fullBase64 = bufferToBase64(assembled.buffer);
        const dataUrl = `data:${fileInfo.fileType};base64,${fullBase64}`;

        // Create download blob URL (for the download button)
        const blob = new Blob([assembled], { type: fileInfo.fileType });
        const downloadUrl = URL.createObjectURL(blob);

        UIModule.removeFileProgress(msg.fileId);

        // Create message for chat
        const receivedMsg = {
            type: 'text',
            id: msg.fileId,
            timestamp: Date.now(),
            sender: 'peer',
            isFile: true,
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize,
            downloadUrl: downloadUrl,
            isImage: fileInfo.isImage,
            status: 'received'
        };

        // Images use data URL so they display without any server
        if (fileInfo.isImage) {
            receivedMsg.imageUrl = dataUrl;
        }

        UIModule.addMessage(receivedMsg);

        if (onFileReceived) onFileReceived(receivedMsg);

        // Cleanup
        delete incomingFiles[msg.fileId];
    }

    function on(event, callback) {
        if (event === 'file-received') onFileReceived = callback;
    }

    return {
        sendFile,
        handleFileMeta,
        handleFileChunk,
        handleFileComplete,
        on
    };
})();

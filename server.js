const { WebcastPushConnection } = require('tiktok-live-connector');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Store active connections
const activeConnections = new Map();

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request) => {
    console.log('New WebSocket connection');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'connect') {
                const uniqueId = data.uniqueId.replace('@', '');
                
                // Check if already connected
                if (activeConnections.has(uniqueId)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Already connected to this live'
                    }));
                    return;
                }
                
                // Create TikTok connection
                const tiktokLiveConnection = new WebcastPushConnection(uniqueId, {
                    processInitialData: false,
                    enableExtendedGiftInfo: true,
                    enableWebsocketUpgrade: true,
                    requestPollingIntervalMs: 1000
                });
                
                // Store connection
                activeConnections.set(uniqueId, {
                    ws: ws,
                    tiktok: tiktokLiveConnection
                });
                
                // Connect to TikTok Live
                tiktokLiveConnection.connect()
                    .then(state => {
                        console.log(`Connected to @${uniqueId}`);
                        ws.send(JSON.stringify({
                            type: 'connected',
                            uniqueId: uniqueId,
                            roomId: state.roomId
                        }));
                    })
                    .catch(err => {
                        console.error('Connection failed:', err);
                        activeConnections.delete(uniqueId);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: err.message || 'Failed to connect to TikTok Live'
                        }));
                    });
                
                // Handle TikTok events
                tiktokLiveConnection.on('chat', data => {
                    ws.send(JSON.stringify({
                        type: 'chat',
                        username: data.uniqueId,
                        nickname: data.nickname,
                        message: data.comment,
                        timestamp: Date.now()
                    }));
                });
                
                tiktokLiveConnection.on('gift', data => {
                    ws.send(JSON.stringify({
                        type: 'gift',
                        username: data.uniqueId,
                        nickname: data.nickname,
                        giftName: data.giftName,
                        giftId: data.giftId,
                        repeatCount: data.repeatCount,
                        timestamp: Date.now()
                    }));
                });
                
                tiktokLiveConnection.on('like', data => {
                    ws.send(JSON.stringify({
                        type: 'like',
                        username: data.uniqueId,
                        likeCount: data.likeCount,
                        totalLikeCount: data.totalLikeCount,
                        timestamp: Date.now()
                    }));
                });
                
                tiktokLiveConnection.on('share', data => {
                    ws.send(JSON.stringify({
                        type: 'share',
                        username: data.uniqueId,
                        timestamp: Date.now()
                    }));
                });
                
                tiktokLiveConnection.on('follow', data => {
                    ws.send(JSON.stringify({
                        type: 'follow',
                        username: data.uniqueId,
                        timestamp: Date.now()
                    }));
                });
                
                tiktokLiveConnection.on('streamEnd', () => {
                    ws.send(JSON.stringify({
                        type: 'streamEnd',
                        message: 'Live stream has ended'
                    }));
                    activeConnections.delete(uniqueId);
                });
                
                tiktokLiveConnection.on('disconnect', () => {
                    ws.send(JSON.stringify({
                        type: 'disconnected',
                        message: 'Disconnected from TikTok Live'
                    }));
                    activeConnections.delete(uniqueId);
                });
            }
            
            if (data.type === 'disconnect') {
                const uniqueId = data.uniqueId;
                const connection = activeConnections.get(uniqueId);
                if (connection) {
                    connection.tiktok.disconnect();
                    activeConnections.delete(uniqueId);
                }
            }
            
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: error.message
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('WebSocket connection closed');
        // Clean up connections
        activeConnections.forEach((connection, uniqueId) => {
            if (connection.ws === ws) {
                connection.tiktok.disconnect();
                activeConnections.delete(uniqueId);
            }
        });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', connections: activeConnections.size });
});

// Create HTTP server
const server = app.listen(PORT, () => {
    console.log(`🚀 TikTok Wordle Backend running on port ${PORT}`);
});

// Upgrade HTTP server to WebSocket
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    activeConnections.forEach(connection => {
        connection.tiktok.disconnect();
    });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

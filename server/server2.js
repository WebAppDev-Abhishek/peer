const http = require("node:http");
const { Server } = require("socket.io");
const { io: ClientIO } = require("socket.io-client"); // Import Socket.IO client for server-to-server connection
const express = require("express"); // Import Express

const PORT = 3002;
const PEER_PORT = 3001; // The port of the other peer server
const PEER_SERVER_URL = `http://localhost:${PEER_PORT}`;
const MAX_RECONNECT_ATTEMPTS = 3; // Reduced attempts
const RECONNECT_INTERVAL = 10000; // Increased interval
const CONNECTION_TIMEOUT = 5000; // 5 seconds timeout
const MAX_MESSAGE_HISTORY = 100; // Limit message history to prevent memory bloat

// Map to store active users connected to THIS server
// Key: socket.id, Value: { room: string, userName: string }
const activeUsers = new Map();
// Array to store recent messages for each room
const roomMessages = new Map();

// Create Express app
const app = express();
// Create HTTP server from Express app
const httpServer = http.createServer(app);

// Add health check endpoint
app.get('/health', (req, res) => {
    const status = {
        status: 'ok',
        port: PORT,
        peerConnected: peerSocket?.connected || false,
        activeUsers: activeUsers.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    };
    res.json(status);
});

// Add graceful shutdown endpoint
app.post('/shutdown', (req, res) => {
    res.json({ status: 'shutting down' });
    gracefulShutdown();
});

// Create Socket.IO server for client connections
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow connections from any origin for development
        methods: ["GET", "POST"]
    },
    pingTimeout: 5000,
    pingInterval: 10000,
    maxHttpBufferSize: 1e6 // 1MB max message size
});

// Socket.IO client to connect to the other peer server
let peerSocket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let connectionTimeout = null;

// Function to store message with history limit
const storeMessage = (room, message) => {
    if (!roomMessages.has(room)) {
        roomMessages.set(room, []);
    }
    const messages = roomMessages.get(room);
    messages.push(message);
    if (messages.length > MAX_MESSAGE_HISTORY) {
        messages.shift(); // Remove oldest message
    }
};

// Function to connect to the peer server
const connectToPeer = () => {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log(`[Server ${PORT}] Max reconnection attempts reached. Please check if peer server is running.`);
        return;
    }

    // Clear any existing connection
    if (peerSocket) {
        peerSocket.close();
        peerSocket = null;
    }

    // Clear any existing timeout
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
    }

    console.log(`[Server ${PORT}] Attempting to connect to peer server (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
    
    try {
        peerSocket = ClientIO(PEER_SERVER_URL, {
            reconnection: false,
            timeout: CONNECTION_TIMEOUT,
            transports: ['websocket', 'polling'],
            forceNew: true,
            maxHttpBufferSize: 1e6 // 1MB max message size
        });

        // Set connection timeout
        connectionTimeout = setTimeout(() => {
            if (!peerSocket?.connected) {
                console.log(`[Server ${PORT}] Connection attempt timed out after ${CONNECTION_TIMEOUT}ms`);
                peerSocket?.close();
                scheduleReconnect();
            }
        }, CONNECTION_TIMEOUT);

        peerSocket.on("connect", () => {
            console.log(`[Server ${PORT}] Connected to peer server at ${PEER_SERVER_URL}`);
            reconnectAttempts = 0;
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
            }
            peerSocket.emit("peer:identify", { serverId: PORT });
        });

        peerSocket.on("disconnect", (reason) => {
            console.log(`[Server ${PORT}] Disconnected from peer server. Reason: ${reason}`);
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
            }
            scheduleReconnect();
        });

        peerSocket.on("connect_error", (err) => {
            console.error(`[Server ${PORT}] Connection error: ${err.message}`);
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
            }
            scheduleReconnect();
        });

        peerSocket.on("reconnect_attempt", (attemptNumber) => {
            console.log(`[Server ${PORT}] Attempting to reconnect to peer server (attempt ${attemptNumber})...`);
        });

        peerSocket.on("reconnect_failed", () => {
            console.error(`[Server ${PORT}] Failed to reconnect to peer server after all attempts`);
        });

        // Listen for peer:userJoined events from the other server
        peerSocket.on("peer:userJoined", ({ room, userName, sourceServerId }) => {
            if (sourceServerId !== PORT) { // Prevent infinite loops
                console.log(`[Server ${PORT}] Received peer:userJoined from Server ${sourceServerId}: ${userName} joined room ${room}`);
                // Broadcast to all clients connected to THIS server in that room
                io.to(room).emit("userJoined", { userName });
            }
        });

        // Listen for peer:userLeft events from the other server
        peerSocket.on("peer:userLeft", ({ room, userName, sourceServerId }) => {
            if (sourceServerId !== PORT) { // Prevent infinite loops
                console.log(`[Server ${PORT}] Received peer:userLeft from Server ${sourceServerId}: ${userName} left room ${room}`);
                // Broadcast to all clients connected to THIS server in that room
                io.to(room).emit("userLeft", { userName });
            }
        });
    } catch (error) {
        console.error(`[Server ${PORT}] Error creating peer connection:`, error);
        scheduleReconnect();
    }
};

// Function to schedule reconnection with exponential backoff
const scheduleReconnect = () => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(RECONNECT_INTERVAL * Math.pow(2, reconnectAttempts - 1), 60000); // Max 1 minute delay
        console.log(`[Server ${PORT}] Scheduling reconnection attempt ${reconnectAttempts} in ${delay}ms...`);
        reconnectTimer = setTimeout(() => {
            connectToPeer();
        }, delay);
    } else {
        console.log(`[Server ${PORT}] Max reconnection attempts reached. Please check if peer server is running.`);
        console.log(`[Server ${PORT}] You can check server status at http://localhost:${PORT}/health`);
    }
};

// Graceful shutdown function
const gracefulShutdown = () => {
    console.log(`[Server ${PORT}] Shutting down gracefully...`);
    
    // Close peer connection
    if (peerSocket) {
        peerSocket.close();
    }
    
    // Clear all timers
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (connectionTimeout) clearTimeout(connectionTimeout);
    
    // Close HTTP server
    httpServer.close(() => {
        console.log(`[Server ${PORT}] HTTP server closed.`);
        process.exit(0);
    });

    // Force close after 5 seconds
    setTimeout(() => {
        console.error(`[Server ${PORT}] Could not close connections in time, forcefully shutting down`);
        process.exit(1);
    }, 5000);
};

// Handle process termination
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error(`[Server ${PORT}] Uncaught Exception:`, error);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[Server ${PORT}] Unhandled Rejection at:`, promise, 'reason:', reason);
});

// Start listening for client connections
httpServer.listen(PORT, () => {
    console.log(`[Server ${PORT}] Client-facing Socket.IO server ready on http://localhost:${PORT}`);
    console.log(`[Server ${PORT}] Health check available at http://localhost:${PORT}/health`);
    connectToPeer();
});

// Handle client connections
io.on("connection", (socket) => {
    console.log(`[Server ${PORT}] Client connected: ${socket.id}`);

    socket.on("joinRoom", ({ room, userName }) => {
        try {
            // Check if the user is already in a room and leave it first
            const currentUser = activeUsers.get(socket.id);
            if (currentUser && currentUser.room !== room) {
                socket.leave(currentUser.room);
                console.log(`[Server ${PORT}] User ${currentUser.userName} (${socket.id}) left previous room: ${currentUser.room}`);
                // Notify peer server about user leaving previous room
                if (peerSocket?.connected) {
                    peerSocket.emit("peer:userLeft", { room: currentUser.room, userName: currentUser.userName, sourceServerId: PORT });
                }
                // Notify clients in the old room
                io.to(currentUser.room).emit("userLeft", { userName: currentUser.userName });
            }

            socket.join(room);
            activeUsers.set(socket.id, { room, userName });
            console.log(`[Server ${PORT}] User ${userName} (${socket.id}) joined room: ${room}`);

            // Send recent message history to the new user
            const messages = roomMessages.get(room) || [];
            socket.emit("messageHistory", messages);

            // Emit to all clients in the room (except the sender) that a user joined
            socket.to(room).emit("userJoined", { userName });

            // Also, notify the peer server about this new user
            if (peerSocket?.connected) {
                peerSocket.emit("peer:userJoined", { room, userName, sourceServerId: PORT });
            }
        } catch (error) {
            console.error(`[Server ${PORT}] Error in joinRoom:`, error);
            socket.emit("error", { message: "Failed to join room" });
        }
    });

    socket.on("sendMessage", (data) => {
        try {
            const { room, sender, message } = data;
            const messageData = { sender, message, timestamp: Date.now() };
            
            // Store message
            storeMessage(room, messageData);
            
            // Emit to everyone in the room, including the sender
            io.to(room).emit("message", messageData);
            console.log(`[Server ${PORT}] Message sent to room ${room} by ${sender}: "${message}"`);
        } catch (error) {
            console.error(`[Server ${PORT}] Error in sendMessage:`, error);
            socket.emit("error", { message: "Failed to send message" });
        }
    });

    socket.on("disconnect", () => {
        try {
            console.log(`[Server ${PORT}] Client disconnected: ${socket.id}`);
            const disconnectedUser = activeUsers.get(socket.id);

            if (disconnectedUser) {
                activeUsers.delete(socket.id);
                console.log(`[Server ${PORT}] User ${disconnectedUser.userName} (${socket.id}) left room: ${disconnectedUser.room}`);
                // Emit to everyone in the room that the user left
                io.to(disconnectedUser.room).emit("userLeft", { userName: disconnectedUser.userName });

                // Notify peer server about this user leaving
                if (peerSocket?.connected) {
                    peerSocket.emit("peer:userLeft", { room: disconnectedUser.room, userName: disconnectedUser.userName, sourceServerId: PORT });
                }
            }
        } catch (error) {
            console.error(`[Server ${PORT}] Error in disconnect handler:`, error);
        }
    });
});

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Room Data Structure:
// rooms[roomId] = { host: 'userId123', allowed: ['userId123', 'userId456'] }
let rooms = {};

// Socket ID se User ID map karne ke liye (Reverse Lookup)
let socketToUserMap = {}; 
// User ID se Socket ID dhundne ke liye (Messaging ke liye)
let userToSocketMap = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- JOIN ROOM (Updated Logic with UserID) ---
    // Ab hum sirf roomId aur username nahi, balki 'userId' bhi receive karenge
    socket.on('join-room', (roomId, username, userId) => {
        socket.join(roomId);
        socket.username = username;
        socket.userId = userId; // Socket object me ID save kar lo for easy access
        
        // Maps update karo taaki hum track kar sakein kaunsa socket kiska hai
        socketToUserMap[socket.id] = userId;
        userToSocketMap[userId] = socket.id;

        // 1. Agar Room nahi hai -> Create karo (Ye user HOST hai)
        if (!rooms[roomId]) {
            rooms[roomId] = { host: userId, allowed: [userId] };
            socket.emit('role-update', { role: 'Host' });
            console.log(`Room created: ${roomId} by Host: ${username}`);
        } 
        // 2. Agar Room hai aur ye banda HOST hai (Refresh karke wapas aaya hai)
        else if (rooms[roomId].host === userId) {
            socket.emit('role-update', { role: 'Host' });
            console.log(`Host returned: ${username}`);
        }
        // 3. Agar Room hai aur ye banda allowed list me hai (Co-Host)
        else if (rooms[roomId].allowed.includes(userId)) {
            socket.emit('role-update', { role: 'Co-Host' });
        }
        // 4. Normal User -> Viewer
        else {
            socket.emit('role-update', { role: 'Viewer' });
            
            // Host ko bolo naye bande ko time/video detail bheje
            const hostUserId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostUserId];
            
            // Agar Host online hai, tabhi usse signal maango
            if(hostSocketId) {
                io.to(hostSocketId).emit('get-current-state', { newSocketId: socket.id });
            }
        }

        socket.to(roomId).emit('receive-message', { user: 'System', msg: `${username} ne join kiya.` });
    });

    // --- HELPER FUNCTION: Permission Check ---
    function canControl(roomId, userId) {
        if (!rooms[roomId]) return false;
        return rooms[roomId].allowed.includes(userId);
    }

    // --- VIDEO CHANGE (Strictly Allowed Only) ---
    socket.on('change-video', (data) => {
        // Permission Check: User ID use karo, Socket ID nahi
        if (canControl(data.roomId, socket.userId)) {
            io.in(data.roomId).emit('change-video', data.videoId);
            
            io.in(data.roomId).emit('receive-message', { 
                user: 'System', 
                msg: 'Video change kiya gaya hai.' 
            });
        } else {
            console.log("Unauthorized change attempt by:", socket.username);
        }
    });

    // --- SYNC LOGIC (Play/Pause is Personal, Sync on request) ---
    
    // 1. Viewer Play dabata hai -> Host se Time maango
    socket.on('request-host-time', (roomId) => {
        if(rooms[roomId]) {
            const hostUserId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostUserId];
            
            if (hostSocketId) {
                io.to(hostSocketId).emit('provide-time-for-viewer', { requesterId: socket.id });
            }
        }
    });

    // 2. Host time bhejta hai -> Viewer ko forward karo
    socket.on('host-sends-time', (data) => {
        io.to(data.requesterId).emit('jump-to-live', data.time);
    });

    // 3. Initial Sync (Jab koi naya aata hai)
    socket.on('send-current-state', (data) => {
        io.to(data.targetSocketId).emit('sync-state-on-join', data);
    });

    // --- HAND RAISE & APPROVAL ---
    socket.on('request-control', (roomId) => {
        if (rooms[roomId]) {
            const hostUserId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostUserId];
            
            if(hostSocketId) {
                io.to(hostSocketId).emit('control-request', { id: socket.userId, name: socket.username });
            }
        }
    });

    socket.on('grant-control', (data) => {
        // Data: { roomId, targetUserId, targetName }
        if (rooms[data.roomId] && rooms[data.roomId].host === socket.userId) {
            // Allowed list mein User ID add karo
            rooms[data.roomId].allowed.push(data.targetUserId);
            
            // Us user ko batao ki wo Co-Host ban gaya
            const targetSocketId = userToSocketMap[data.targetUserId];
            if (targetSocketId) {
                io.to(targetSocketId).emit('role-update', { role: 'Co-Host' });
            }
            
            io.in(data.roomId).emit('receive-message', { 
                user: 'System', 
                msg: `${data.targetName} ko video control mil gaya hai.` 
            });
        }
    });

    // --- CHAT (Sabke liye open) ---
    socket.on('send-message', (data) => {
        io.in(data.roomId).emit('receive-message', data);
    });
    
    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        // Optional: Clean up maps if needed, but keeping them allows reconnects
        // console.log('User disconnected');
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

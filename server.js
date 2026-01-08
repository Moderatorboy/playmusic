const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- JOIN ROOM & ROLE ---
    socket.on('join-room', (roomId, username) => {
        socket.join(roomId);
        socket.username = username;

        if (!rooms[roomId]) {
            rooms[roomId] = { host: socket.id, allowed: [socket.id] };
            socket.emit('role-update', { role: 'Host' });
        } else {
            socket.emit('role-update', { role: 'Viewer' });
        }
        
        // Host ko bolo naye bande ko update kare
        if(rooms[roomId]) {
            io.to(rooms[roomId].host).emit('get-current-state', { newUserId: socket.id });
        }

        socket.to(roomId).emit('receive-message', { user: 'System', msg: `${username} ne join kiya.` });
    });

    // --- VIDEO CHANGE (Strictly Host/Allowed Only) ---
    socket.on('change-video', (data) => {
        // Check karo permission hai ya nahi
        if (rooms[data.roomId] && rooms[data.roomId].allowed.includes(socket.id)) {
            io.in(data.roomId).emit('change-video', data.videoId);
            
            // Chat mein batao
            io.in(data.roomId).emit('receive-message', { 
                user: 'System', 
                msg: `Video change kiya gaya hai.` 
            });
        }
    });

    // --- NEW LOGIC: SYNC ON PLAY ---
    // 1. Viewer Play dabata hai toh wo server se puchta hai: "Host kahan hai?"
    socket.on('request-host-time', (roomId) => {
        if(rooms[roomId]) {
            // Server Host ko signal bhejta hai
            io.to(rooms[roomId].host).emit('provide-time-for-viewer', { requesterId: socket.id });
        }
    });

    // 2. Host time bhejta hai
    socket.on('host-sends-time', (data) => {
        // Data: { requesterId, time, state }
        // Server wo time Viewer ko deta hai
        io.to(data.requesterId).emit('jump-to-live', data.time);
    });

    // --- PERMISSION / HAND RAISE SYSTEM ---
    socket.on('request-control', (roomId) => {
        if (rooms[roomId]) {
            io.to(rooms[roomId].host).emit('control-request', { id: socket.id, name: socket.username });
        }
    });

    socket.on('grant-control', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].host === socket.id) {
            rooms[data.roomId].allowed.push(data.targetId);
            io.to(data.targetId).emit('role-update', { role: 'Co-Host' });
            io.in(data.roomId).emit('receive-message', { user: 'System', msg: `${data.targetName} ab video change kar sakta hai.` });
        }
    });

    socket.on('send-message', (data) => {
        io.in(data.roomId).emit('receive-message', data);
    });
    
    // Initial Load Sync
    socket.on('send-current-state', (data) => {
        io.to(data.targetId).emit('sync-state-on-join', data);
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Room ka data store karne ke liye
// Format: { 'room1': { host: 'socketId', allowed: ['socketId1', 'socketId2'] } }
let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId, username) => {
        socket.join(roomId);
        socket.username = username; // User ka naam save kar lo
        
        // Check karo room exist karta hai ya nahi
        if (!rooms[roomId]) {
            // Agar room naya hai, toh ye user HOST hai
            rooms[roomId] = { host: socket.id, allowed: [socket.id] };
            socket.emit('role-update', { role: 'Host' });
        } else {
            // Agar room pehle se hai, toh ye user VIEWER hai
            socket.emit('role-update', { role: 'Viewer' });
        }

        // Sabko batao koi aaya hai
        socket.to(roomId).emit('receive-message', { 
            user: 'System', 
            msg: `${username} ne join kiya.` 
        });
    });

    // --- PERMISSION CHECK FUNCTION ---
    function isAllowed(roomId, socketId) {
        if (!rooms[roomId]) return false;
        return rooms[roomId].allowed.includes(socketId);
    }

    // Video Play/Pause Sync (Sirf Allowed log kar sakte hain)
    socket.on('sync-action', (data) => {
        if (isAllowed(data.roomId, socket.id)) {
            socket.to(data.roomId).emit('sync-action', data);
        }
    });

    // Video Change (Sirf Allowed log kar sakte hain)
    socket.on('change-video', (data) => {
        if (isAllowed(data.roomId, socket.id)) {
            io.in(data.roomId).emit('change-video', data.videoId);
        }
    });

    // --- HAND RAISE SYSTEM ---
    
    // 1. Viewer ne haath uthaya
    socket.on('request-control', (roomId) => {
        if (rooms[roomId]) {
            const hostId = rooms[roomId].host;
            // Sirf Host ko request bhejo
            io.to(hostId).emit('control-request', { 
                id: socket.id, 
                name: socket.username 
            });
        }
    });

    // 2. Host ne permission di
    socket.on('grant-control', (data) => {
        // Data mein: { roomId, targetId, targetName }
        if (rooms[data.roomId] && rooms[data.roomId].host === socket.id) {
            // Allowed list mein add karo
            rooms[data.roomId].allowed.push(data.targetId);
            
            // Us user ko batao ki power mil gayi
            io.to(data.targetId).emit('role-update', { role: 'Co-Host' });
            
            // Chat mein announce karo
            io.in(data.roomId).emit('receive-message', {
                user: 'System',
                msg: `${data.targetName} ko video control mil gaya hai.`
            });
        }
    });

    // Chat Message (Sab kar sakte hain)
    socket.on('send-message', (data) => {
        io.in(data.roomId).emit('receive-message', data);
    });

    // Disconnect Logic
    socket.on('disconnect', () => {
        // Agar host chala gaya toh room delete kar sakte hain ya naya host bana sakte hain
        // Abhi ke liye simple rakhte hain
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

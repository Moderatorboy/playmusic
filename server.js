const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Data Structures
// rooms[roomId] = { 
//   host: 'userId', 
//   allowed: [], 
//   playlist: [], 
//   users: [], 
//   currentVideoTitle: '', 
//   requests: [] 
// }
let rooms = {};

// Maps for Persistent Identity (Refresh Fix)
let socketToUserMap = {};
let userToSocketMap = {};

io.on('connection', (socket) => {
    // console.log('User connected:', socket.id);

    // --- JOIN ROOM ---
    socket.on('join-room', (roomId, username, userId) => {
        socket.join(roomId);
        socket.username = username;
        socket.userId = userId;
        socket.roomId = roomId;

        // Maps update karo (Refresh fix ke liye)
        socketToUserMap[socket.id] = userId;
        userToSocketMap[userId] = socket.id;

        // Room Initialization
        if (!rooms[roomId]) {
            rooms[roomId] = {
                host: userId,
                allowed: [userId],
                playlist: [],
                users: [],
                currentVideoTitle: "Waiting for video...",
                requests: [] // Pending Hand Raises
            };
            socket.emit('role-update', { role: 'Host' });
        }
        // Agar Room hai aur ye banda HOST hai (Refresh karke wapas aaya hai)
        else if (rooms[roomId].host === userId) {
            socket.emit('role-update', { role: 'Host' });
            // Host ko pending requests wapas bhejo
            socket.emit('update-requests', rooms[roomId].requests);
        }
        // Agar Co-Host hai
        else if (rooms[roomId].allowed.includes(userId)) {
            socket.emit('role-update', { role: 'Co-Host' });
        }
        // Normal Viewer
        else {
            socket.emit('role-update', { role: 'Viewer' });
            
            // Naye user ko sync karo (Host se state maango)
            const hostId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostId];
            if(hostSocketId) {
                io.to(hostSocketId).emit('get-current-state', { newSocketId: socket.id });
            }
        }

        // Add user to active list (Online Count ke liye)
        // Check karo ki duplicate na ho
        const existingUserIndex = rooms[roomId].users.findIndex(u => u.id === userId);
        if (existingUserIndex !== -1) {
            rooms[roomId].users[existingUserIndex].name = username; // Update name logic
        } else {
            rooms[roomId].users.push({ id: userId, name: username });
        }

        // UPDATE EVERYONE (Sabko naya data bhejo)
        io.in(roomId).emit('update-user-list', rooms[roomId].users.length);
        io.in(roomId).emit('update-playlist', rooms[roomId].playlist);
        io.in(roomId).emit('update-title', rooms[roomId].currentVideoTitle);
        
        socket.to(roomId).emit('receive-message', { user: 'System', msg: `${username} joined.` });
    });

    // --- PLAYLIST LOGIC ---
    socket.on('add-to-playlist', (data) => {
        if(rooms[data.roomId]) {
            const videoItem = {
                id: data.videoId,
                title: data.title || `Video ${data.videoId}`,
                thumbnail: `https://img.youtube.com/vi/${data.videoId}/mqdefault.jpg`
            };
            rooms[data.roomId].playlist.push(videoItem);
            
            // Sabko playlist update bhejo
            io.in(data.roomId).emit('update-playlist', rooms[data.roomId].playlist);

            // Agar playlist me ye pehla video hai, toh turant play karo
            if(rooms[data.roomId].playlist.length === 1) {
                rooms[data.roomId].currentVideoTitle = videoItem.title;
                io.in(data.roomId).emit('change-video', { videoId: data.videoId, title: videoItem.title });
                io.in(data.roomId).emit('update-title', videoItem.title);
            }
        }
    });

    // --- VIDEO CHANGE & PERMISSIONS ---
    socket.on('change-video', (data) => {
        // Permission Check using UserID
        if (rooms[data.roomId] && rooms[data.roomId].allowed.includes(socket.userId)) {
            rooms[data.roomId].currentVideoTitle = data.title || "Playing Video";
            
            io.in(data.roomId).emit('change-video', data);
            io.in(data.roomId).emit('update-title', rooms[data.roomId].currentVideoTitle);
            
            io.in(data.roomId).emit('receive-message', { 
                user: 'System', 
                msg: `Video changed: ${data.title}` 
            });
        }
    });

    // --- SYNC LOGIC ---
    socket.on('request-host-time', (roomId) => {
        if(rooms[roomId]) {
            const hostUserId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostUserId];
            if (hostSocketId) {
                io.to(hostSocketId).emit('provide-time-for-viewer', { requesterId: socket.id });
            }
        }
    });

    socket.on('host-sends-time', (data) => {
        io.to(data.requesterId).emit('jump-to-live', data.time);
    });

    socket.on('send-current-state', (data) => {
        io.to(data.targetSocketId).emit('sync-state-on-join', data);
    });

    // --- HAND RAISE SYSTEM (Accept/Deny Logic) ---
    socket.on('request-control', (roomId) => {
        if (rooms[roomId]) {
            const hostUserId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostUserId];
            
            if(hostSocketId) {
                // Request list me add karo
                const request = { id: socket.userId, name: socket.username };
                
                // Duplicate check
                if (!rooms[roomId].requests.some(r => r.id === request.id)) {
                    rooms[roomId].requests.push(request);
                    // Host ko nayi list bhejo
                    io.to(hostSocketId).emit('update-requests', rooms[roomId].requests);
                }
            }
        }
    });

    socket.on('grant-control', (data) => {
        // Data: { roomId, targetUserId, targetName, action: 'accept' | 'deny' }
        if (rooms[data.roomId] && rooms[data.roomId].host === socket.userId) {
            
            // Request list se hatao
            rooms[data.roomId].requests = rooms[data.roomId].requests.filter(r => r.id !== data.targetUserId);
            
            // Agar ACCEPT kiya hai
            if (data.action === 'accept') {
                rooms[data.roomId].allowed.push(data.targetUserId);
                
                const targetSocketId = userToSocketMap[data.targetUserId];
                if (targetSocketId) {
                    io.to(targetSocketId).emit('role-update', { role: 'Co-Host' });
                }
                
                io.in(data.roomId).emit('receive-message', { 
                    user: 'System', 
                    msg: `${data.targetName} is now a Co-Host.` 
                });
            }
            
            // Host ko updated list wapas bhejo (taaki naam list se hatt jaye)
            socket.emit('update-requests', rooms[data.roomId].requests);
        }
    });

    // --- CHAT ---
    socket.on('send-message', (data) => {
        io.in(data.roomId).emit('receive-message', data);
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        const userId = socket.userId;

        if(roomId && rooms[roomId]) {
            // User list se remove karo
            rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== userId);
            
            // Request list se remove karo (agar pending tha)
            rooms[roomId].requests = rooms[roomId].requests.filter(r => r.id !== userId);

            // Updates bhejo
            io.in(roomId).emit('update-user-list', rooms[roomId].users.length);

            // Agar Host online hai, usse request list update bhejo
            const hostId = rooms[roomId].host;
            const hostSocketId = userToSocketMap[hostId];
            if(hostSocketId) {
                io.to(hostSocketId).emit('update-requests', rooms[roomId].requests);
            }
        }
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// 'public' folder ki files ko dikhane ke liye
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Room Join Karna
    socket.on('join-room', (roomId, username) => {
        socket.join(roomId);
        // Doosro ko batao ki koi aaya hai
        socket.to(roomId).emit('receive-message', { 
            user: 'System', 
            msg: `${username} has joined the party!` 
        });
    });

    // Video Play/Pause Sync
    socket.on('sync-action', (data) => {
        // Jisne action kiya usko chhod kar baaki sabko bhejo
        socket.to(data.roomId).emit('sync-action', data);
    });

    // Video Change Karna
    socket.on('change-video', (data) => {
        io.in(data.roomId).emit('change-video', data.videoId);
    });

    // Chat Message
    socket.on('send-message', (data) => {
        io.in(data.roomId).emit('receive-message', data);
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server chal raha hai: http://localhost:${PORT}`);
});
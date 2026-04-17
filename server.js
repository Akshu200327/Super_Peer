// Step 1: Import required packages
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// Step 2: Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Step 3: Attach Socket.IO to the SAME HTTP server with simple CORS config
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// Step 4: Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Step 5: Keep simple room details in memory (no database)
// Example: rooms["ABC123"] = ["socketId1", "socketId2"]
const rooms = {};

// Utility: Generate a short room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Step 6: Listen for Socket.IO connections
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Create room
  socket.on("create-room", () => {
    let roomId = generateRoomId();

    // Make sure generated room ID is unique
    while (rooms[roomId]) {
      roomId = generateRoomId();
    }

    rooms[roomId] = [socket.id];
    socket.join(roomId);

    socket.emit("room-created", roomId);
    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  // Join room
  socket.on("join-room", (roomId) => {
    const roomUsers = rooms[roomId];

    // Basic validations
    if (!roomUsers) {
      socket.emit("error-message", "Room does not exist.");
      return;
    }

    if (roomUsers.length >= 2) {
      socket.emit("error-message", "Room is full (only 2 users allowed).");
      return;
    }

    roomUsers.push(socket.id);
    socket.join(roomId);

    // Tell the joiner that joining is successful
    socket.emit("joined-room", roomId);

    // Tell the creator that second user has joined
    socket.to(roomId).emit("peer-joined");
    console.log(`${socket.id} joined room ${roomId}`);
  });

  // Forward offer to the other peer in the room
  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", offer);
  });

  // Forward answer to the other peer in the room
  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", answer);
  });

  // Forward ICE candidate to the other peer in the room
  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", candidate);
  });

  // Handle disconnect and clean room state
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    for (const roomId of Object.keys(rooms)) {
      rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);

      // If room is empty, remove it
      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

// Step 7: Start server (Render provides PORT through environment variable)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

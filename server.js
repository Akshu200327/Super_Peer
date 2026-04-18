require("dotenv").config();

// Step 1: Import required packages
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const twilio = require("twilio");

// Step 2: Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Step 3: Attach Socket.IO to the SAME HTTP server with simple CORS config
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Step 4: Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Step 5: Generate temporary TURN/STUN credentials using Twilio
app.get("/turn-credentials", async (req, res) => {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const token = await client.tokens.create();
    return res.json({
      iceServers: token.iceServers.map((server) => ({
        urls: server.urls || server.url,
        username: server.username,
        credential: server.credential
      }))
    });
  } catch (err) {
    console.error("TURN error:", err);
    res.status(500).json({ error: "TURN fetch failed" });
  }
});

const uploadedFiles = new Map();
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

function sanitizeFileName(name) {
  return String(name || "file.bin").replace(/[\\/:*?"<>|]/g, "_");
}

app.post(
  "/upload",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  (req, res) => {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty upload body." });
      return;
    }
    if (req.body.length > MAX_UPLOAD_SIZE) {
      res.status(413).json({ error: "File too large for fast mode" });
      return;
    }

    const id = crypto.randomUUID();
    const fileName = sanitizeFileName(decodeURIComponent(String(req.query.name || "file.bin")));
    const contentType = decodeURIComponent(String(req.query.type || "application/octet-stream"));
    const expiresAt = Date.now() + UPLOAD_TTL_MS;

    const cleanupTimer = setTimeout(() => {
      uploadedFiles.delete(id);
    }, UPLOAD_TTL_MS);

    uploadedFiles.set(id, {
      buffer: Buffer.from(req.body),
      fileName,
      contentType,
      expiresAt,
      cleanupTimer
    });

    res.json({
      id,
      url: `/download/${id}`
    });
  }
);

app.get("/download/:id", (req, res) => {
  const fileId = req.params.id;
  const file = uploadedFiles.get(fileId);
  if (!file) {
    res.status(404).json({ error: "File expired or not found." });
    return;
  }

  if (Date.now() > file.expiresAt) {
    clearTimeout(file.cleanupTimer);
    uploadedFiles.delete(fileId);
    res.status(404).json({ error: "File expired or not found." });
    return;
  }

  res.setHeader("Content-Type", file.contentType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.on("finish", () => {
    clearTimeout(file.cleanupTimer);
    uploadedFiles.delete(fileId);
  });
  res.send(file.buffer);
});

app.use((err, req, res, next) => {
  if (req.path === "/upload" && err && err.type === "entity.too.large") {
    res.status(413).json({ error: "File too large for fast mode" });
    return;
  }
  next(err);
});

// Step 6: Keep simple room details in memory (no database)
// Example: rooms["ABC123"] = ["socketId1", "socketId2"]
const rooms = {};

// Utility: Generate a short room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Step 7: Listen for Socket.IO connections
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

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

// Step 8: Start server (Render provides PORT through environment variable)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

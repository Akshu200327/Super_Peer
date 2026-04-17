// Connect to Socket.IO server
const socket = io();

// -----------------------------
// UI ELEMENTS
// -----------------------------
const menuToggleBtn = document.getElementById("menuToggleBtn");
const headerMenu = document.getElementById("headerMenu");
const menuModeBtn = document.getElementById("menuModeBtn");
const menuThemeBtn = document.getElementById("menuThemeBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const toastContainer = document.getElementById("toastContainer");
const statusText = document.getElementById("statusText");
const loadingScreen = document.getElementById("loadingScreen");
const appCard = document.getElementById("appCard");
const successPopup = document.getElementById("successPopup");
const successLoader = document.getElementById("successLoader");
const successTitle = document.getElementById("successTitle");
const successSubtext = document.getElementById("successSubtext");

// Wizard screens
const entryScreen = document.getElementById("entryScreen");
const sendCreateScreen = document.getElementById("sendCreateScreen");
const sendWaitingScreen = document.getElementById("sendWaitingScreen");
const receiveJoinScreen = document.getElementById("receiveJoinScreen");
const receiveConnectingScreen = document.getElementById("receiveConnectingScreen");
const transferScreen = document.getElementById("transferScreen");
const allScreens = [
  entryScreen,
  sendCreateScreen,
  sendWaitingScreen,
  receiveJoinScreen,
  receiveConnectingScreen,
  transferScreen
];

// Entry buttons
const sendModeBtn = document.getElementById("sendModeBtn");
const receiveModeBtn = document.getElementById("receiveModeBtn");

// Send flow controls
const createRoomBtn = document.getElementById("createRoomBtn");
const roomDisplay = document.getElementById("roomDisplay");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const waitingRoomDisplay = document.getElementById("waitingRoomDisplay");
const waitingCopyRoomBtn = document.getElementById("waitingCopyRoomBtn");
const waitingDots = document.getElementById("waitingDots");

// Receive flow controls
const roomInput = document.getElementById("roomInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");

// Transfer controls (shared step 3)
const transferTitle = document.getElementById("transferTitle");
const sendControls = document.getElementById("sendControls");
const receiveInfo = document.getElementById("receiveInfo");
const fileInput = document.getElementById("fileInput");
const selectedFileName = document.getElementById("selectedFileName");
const sendFileBtn = document.getElementById("sendFileBtn");
const fileStatusText = document.getElementById("fileStatusText");
const fileProgressFill = document.getElementById("fileProgressFill");
const fileProgressValue = document.getElementById("fileProgressValue");
const fileProgressText = document.getElementById("fileProgressText");

// -----------------------------
// APP STATE
// -----------------------------
let currentFlow = null; // "send" | "receive"
let currentRoomId = null;
let isCreator = false;
let isPeerConnected = false;

let peerConnection = null;
let dataChannel = null;

// File transfer state (simple one-file flow)
const CHUNK_SIZE = 16 * 1024; // 16KB
let incomingFileInfo = null;
let receivedChunks = [];
let receivedBytes = 0;
let waitingDotsTimer = null;
let successPopupTimers = [];

// STUN config
const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// -----------------------------
// THEME
// -----------------------------
function applyTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark-mode");
    menuThemeBtn.textContent = "Light Mode";
  } else {
    document.body.classList.remove("dark-mode");
    menuThemeBtn.textContent = "Dark Mode";
  }
}

const savedTheme = localStorage.getItem("superpeer-theme") || "light";
applyTheme(savedTheme);

menuThemeBtn.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("superpeer-theme", nextTheme);
  headerMenu.classList.add("hidden-block");
});

// Header menu open/close
menuToggleBtn.addEventListener("click", () => {
  headerMenu.classList.toggle("hidden-block");
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-wrapper")) {
    headerMenu.classList.add("hidden-block");
  }
});

// -----------------------------
// WIZARD HELPERS
// -----------------------------
function showScreen(screenElement) {
  allScreens.forEach((screen) => screen.classList.remove("active"));
  screenElement.classList.add("active");

  // Animate dots only on sender waiting step
  if (screenElement === sendWaitingScreen) {
    startWaitingDots();
  } else {
    stopWaitingDots();
  }
}

// Step 3 is shared. In send mode, show file picker.
// In receive mode, show waiting info only.
function showConnectedStep() {
  showScreen(transferScreen);

  if (currentFlow === "send") {
    transferTitle.textContent = "Step 3: Connected - Send File";
    sendControls.classList.remove("hidden-block");
    receiveInfo.classList.add("hidden-block");
    selectedFileName.textContent = "📄 Select a file to start sharing";
  } else {
    transferTitle.textContent = "Step 3: Connected - Ready to Receive";
    sendControls.classList.add("hidden-block");
    receiveInfo.classList.remove("hidden-block");
    selectedFileName.textContent = "Receiving: waiting for file...";
  }

  statusText.textContent = "";
}

function resetTransferUi() {
  fileInput.value = "";
  setProgress(0);
  fileStatusText.textContent = "File Status: idle";

  if (currentFlow === "send") {
    selectedFileName.textContent = "📄 Select a file to start sharing";
  } else {
    selectedFileName.textContent = "Receiving: waiting for file...";
  }

  updateSendFileButtonState();
}

// Go back to mode selection screen and reset local UI state
function goToModeSelection() {
  stopWaitingDots();
  successPopup.classList.add("hidden-block");
  successPopup.classList.remove("celebrate");

  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  currentFlow = null;
  currentRoomId = null;
  isCreator = false;
  isPeerConnected = false;
  incomingFileInfo = null;
  receivedChunks = [];
  receivedBytes = 0;

  roomDisplay.innerHTML = "Room ID: <strong>Not created yet</strong>";
  waitingRoomDisplay.innerHTML = "Room ID: <strong>Not created yet</strong>";
  copyRoomBtn.disabled = true;
  waitingCopyRoomBtn.disabled = true;

  resetTransferUi();
  showScreen(entryScreen);
  statusText.textContent = "";
}

// -----------------------------
// TOAST + PROGRESS
// -----------------------------
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-6px)";
    toast.style.transition = "opacity 0.2s ease, transform 0.2s ease";
  }, 1800);

  setTimeout(() => {
    toast.remove();
  }, 2100);
}

// Center popup after successful connection
function showConnectionSuccessPopup() {
  // Clear old timers first
  successPopupTimers.forEach((timer) => clearTimeout(timer));
  successPopupTimers = [];

  successPopup.classList.remove("hidden-block");
  successPopup.classList.remove("celebrate");

  // Phase 1: short loading state
  successLoader.style.display = "inline-block";
  successTitle.textContent = "Connecting...";
  successSubtext.textContent = "Securing peer link...";

  const loadingToCelebrateTimer = setTimeout(() => {
    // Phase 2: connected celebration
    successLoader.style.display = "none";
    successTitle.textContent = "🎉 Connected!";
    successSubtext.textContent = "Secure connection established";
    successPopup.classList.add("celebrate");
  }, 650);

  const hideTimer = setTimeout(() => {
    successPopup.classList.add("hidden-block");
    successPopup.classList.remove("celebrate");
  }, 2000);

  successPopupTimers.push(loadingToCelebrateTimer, hideTimer);
}

// "Waiting for receiver..." dots animation
function startWaitingDots() {
  if (waitingDotsTimer) return;
  let dotsCount = 1;
  waitingDots.textContent = ".";
  waitingDotsTimer = setInterval(() => {
    dotsCount = (dotsCount % 3) + 1;
    waitingDots.textContent = ".".repeat(dotsCount);
  }, 450);
}

function stopWaitingDots() {
  if (!waitingDotsTimer) return;
  clearInterval(waitingDotsTimer);
  waitingDotsTimer = null;
  waitingDots.textContent = ".";
}

function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, percent));
  fileProgressFill.style.width = safePercent + "%";
  fileProgressValue.textContent = safePercent + "%";
  fileProgressText.textContent = "Transfer progress: " + safePercent + "%";
}

function updateSendFileButtonState() {
  const hasFile = fileInput.files && fileInput.files.length > 0;
  sendFileBtn.disabled = !(currentFlow === "send" && hasFile && isPeerConnected);
}

// -----------------------------
// WEBRTC + DATACHANNEL
// -----------------------------
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Receiver gets data channel from sender
  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannelEvents(dataChannel);
  };

  // Send ICE to other peer through Socket.IO
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentRoomId) {
      socket.emit("ice-candidate", {
        roomId: currentRoomId,
        candidate: event.candidate
      });
    }
  };

  // Wizard step movement based on connection state
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "connected") {
      isPeerConnected = true;
      showConnectedStep();
      showConnectionSuccessPopup();
      updateSendFileButtonState();
      return;
    }

    if (
      peerConnection.connectionState === "failed" ||
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "closed"
    ) {
      isPeerConnected = false;
      updateSendFileButtonState();
    }
  };
}

function setupDataChannelEvents(channel) {
  channel.onopen = () => {
    updateSendFileButtonState();
  };

  channel.onclose = () => {
    updateSendFileButtonState();
  };

  channel.onmessage = async (event) => {
    // Metadata packets are JSON text
    if (typeof event.data === "string") {
      let meta = null;
      try {
        meta = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (meta && meta.type === "file-meta") {
        incomingFileInfo = { name: meta.name, size: meta.size };
        receivedChunks = [];
        receivedBytes = 0;
        fileStatusText.textContent = "File Status: Receiving file...";
        selectedFileName.textContent = "Receiving: " + incomingFileInfo.name;
        setProgress(0);
      }
      return;
    }

    // Binary chunk packets
    if (!incomingFileInfo) return;

    let chunkBuffer = null;
    if (event.data instanceof ArrayBuffer) {
      chunkBuffer = event.data;
    } else if (event.data instanceof Blob) {
      chunkBuffer = await event.data.arrayBuffer();
    }
    if (!chunkBuffer) return;

    receivedChunks.push(chunkBuffer);
    receivedBytes += chunkBuffer.byteLength;

    const receivePercent = Math.min(
      100,
      Math.floor((receivedBytes / incomingFileInfo.size) * 100)
    );
    setProgress(receivePercent);

    // Done: combine + auto download
    if (receivedBytes >= incomingFileInfo.size) {
      const blob = new Blob(receivedChunks);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = incomingFileInfo.name;
      link.click();
      URL.revokeObjectURL(url);

      fileStatusText.textContent = "File Status: File received successfully";
      setProgress(100);
      showToast("File received");

      incomingFileInfo = null;
      receivedChunks = [];
      receivedBytes = 0;

      setTimeout(() => {
        resetTransferUi();
      }, 1200);
    }
  };
}

// -----------------------------
// ENTRY SCREEN
// -----------------------------
menuModeBtn.addEventListener("click", () => {
  goToModeSelection();
  headerMenu.classList.add("hidden-block");
});

disconnectBtn.addEventListener("click", () => {
  // Disconnect from signaling server, then reconnect for fresh state
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }

  goToModeSelection();
  showToast("Disconnected");
  headerMenu.classList.add("hidden-block");
});

sendModeBtn.addEventListener("click", () => {
  currentFlow = "send";
  isCreator = true;
  currentRoomId = null;
  copyRoomBtn.disabled = true;
  waitingCopyRoomBtn.disabled = true;
  roomDisplay.innerHTML = "Room ID: <strong>Not created yet</strong>";
  waitingRoomDisplay.innerHTML = "Room ID: <strong>Not created yet</strong>";
  resetTransferUi();
  showScreen(sendCreateScreen);
});

receiveModeBtn.addEventListener("click", () => {
  currentFlow = "receive";
  isCreator = false;
  currentRoomId = null;
  roomInput.value = "";
  resetTransferUi();
  showScreen(receiveJoinScreen);
});

// -----------------------------
// SEND FLOW
// -----------------------------
createRoomBtn.addEventListener("click", () => {
  socket.emit("create-room");
});

copyRoomBtn.addEventListener("click", async () => {
  copyRoomId();
});

waitingCopyRoomBtn.addEventListener("click", async () => {
  copyRoomId();
});

async function copyRoomId() {
  if (!currentRoomId) return;

  try {
    await navigator.clipboard.writeText(currentRoomId);
    showToast("Room code copied");
    copyRoomBtn.textContent = "Copied";
    waitingCopyRoomBtn.textContent = "Copied";
    setTimeout(() => {
      copyRoomBtn.textContent = "Copy";
      waitingCopyRoomBtn.textContent = "Copy";
    }, 900);
  } catch (error) {
    statusText.textContent = "Could not copy Room ID.";
  }
}

// -----------------------------
// RECEIVE FLOW
// -----------------------------
joinRoomBtn.addEventListener("click", () => {
  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    statusText.textContent = "Please enter a Room ID.";
    return;
  }

  socket.emit("join-room", roomId);
  showScreen(receiveConnectingScreen);
  statusText.textContent = "";
});

roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoomBtn.click();
  }
});

// -----------------------------
// FILE SEND ACTION (STEP 3 SEND)
// -----------------------------
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    selectedFileName.textContent = "Sending: " + fileInput.files[0].name;
    fileStatusText.textContent = "File Status: ready to send";
  } else {
    selectedFileName.textContent = "📄 Select a file to start sharing";
    fileStatusText.textContent = "File Status: idle";
  }
  setProgress(0);
  updateSendFileButtonState();
});

sendFileBtn.addEventListener("click", () => {
  const file = fileInput.files[0];
  if (!file) {
    fileStatusText.textContent = "File Status: Please choose a file first";
    return;
  }

  if (!dataChannel || dataChannel.readyState !== "open") {
    fileStatusText.textContent = "File Status: Secure link is still connecting";
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const fileBuffer = reader.result;

    // Send metadata first
    dataChannel.send(
      JSON.stringify({
        type: "file-meta",
        name: file.name,
        size: file.size
      })
    );

    fileStatusText.textContent = "File Status: Sending file...";
    selectedFileName.textContent = "Sending: " + file.name;
    setProgress(0);

    let sentBytes = 0;
    for (let offset = 0; offset < fileBuffer.byteLength; offset += CHUNK_SIZE) {
      const chunk = fileBuffer.slice(offset, offset + CHUNK_SIZE);
      dataChannel.send(chunk);
      sentBytes += chunk.byteLength;

      const sendPercent = Math.min(
        100,
        Math.floor((sentBytes / fileBuffer.byteLength) * 100)
      );
      setProgress(sendPercent);

      // Tiny pause gives smooth UI update
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    fileStatusText.textContent = "File Status: File sent successfully";
    setProgress(100);
    showToast("File sent");

    setTimeout(() => {
      resetTransferUi();
    }, 1200);
  };

  reader.readAsArrayBuffer(file);
});

// -----------------------------
// SOCKET EVENTS
// -----------------------------
socket.on("room-created", (roomId) => {
  currentRoomId = roomId;
  roomDisplay.innerHTML = `Room ID: <strong>${roomId}</strong>`;
  waitingRoomDisplay.innerHTML = `Room ID: <strong>${roomId}</strong>`;
  copyRoomBtn.disabled = false;
  waitingCopyRoomBtn.disabled = false;
  showToast("Room is ready. Share the code.");

  // Send flow step 2
  showScreen(sendWaitingScreen);
});

socket.on("joined-room", (roomId) => {
  currentRoomId = roomId;
  showScreen(receiveConnectingScreen);
});

socket.on("peer-joined", async () => {
  // Only creator sends offer
  if (!isCreator) return;

  createPeerConnection();

  // Sender creates DataChannel
  dataChannel = peerConnection.createDataChannel("file");
  setupDataChannelEvents(dataChannel);

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", {
    roomId: currentRoomId,
    offer: offer
  });
});

socket.on("offer", async (offer) => {
  if (!peerConnection) {
    createPeerConnection();
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", {
    roomId: currentRoomId,
    answer: answer
  });
});

socket.on("answer", async (answer) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async (candidate) => {
  if (!peerConnection) return;
  await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("error-message", (message) => {
  statusText.textContent = message;
  showToast(message);
});

// Show loading screen briefly before main wizard
setTimeout(() => {
  loadingScreen.classList.add("hidden-block");
  appCard.classList.remove("app-hidden");
}, 1200);

// Initial safe state
updateSendFileButtonState();

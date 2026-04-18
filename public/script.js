// Connect to Socket.IO server
const socket = io();

// -----------------------------
// UI ELEMENTS
// -----------------------------
function logMissingElement(id) {
  console.log("Element not found:", id);
}

function addSafeListener(element, id, eventName, handler) {
  if (!element) {
    logMissingElement(id);
    return;
  }
  element.addEventListener(eventName, handler);
}

const menuToggleBtn = document.getElementById("menuToggleBtn");
const headerMenu = document.getElementById("headerMenu");
const menuModeBtn = document.getElementById("menuModeBtn");
const menuThemeBtn = document.getElementById("menuThemeBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const toastContainer = document.getElementById("toastContainer");
const statusText = document.getElementById("statusText");
const loadingScreen = document.getElementById("loadingScreen");
const appCard = document.getElementById("appCard");
const connectionErrorBox = document.getElementById("connectionErrorBox");
const connectionErrorText = document.getElementById("connectionErrorText");
const retryConnectionBtn = document.getElementById("retryConnectionBtn");

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
const currentTransferFileText = document.getElementById("currentTransferFileText");
const fileTransferList = document.getElementById("fileTransferList");
const totalProgressText = document.getElementById("totalProgressText");

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
const CHUNK_SIZE = 64 * 1024; // 64KB
const BUFFER_PAUSE_THRESHOLD = 1024 * 1024; // 1MB
const BUFFER_LOW_THRESHOLD = 64 * 1024; // 64KB
const LARGE_FILE_WARNING_SIZE = 200 * 1024 * 1024; // 200MB
const EXTREME_FILE_BLOCK_SIZE = 500 * 1024 * 1024; // 500MB
let incomingFileInfo = null;
let receivedChunks = [];
let receivedBytes = 0;
let incomingFileMarkedComplete = false;
let waitingDotsTimer = null;
let connectionTimeoutTimer = null;
let retryRoomId = null;
let transferDirectionText = "Progress";
let isSendingFiles = false;
let hasBlockedLargeFile = false;
let transferItems = [];
let totalTransferredBytes = 0;
let totalTransferBytes = 0;

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
    if (menuThemeBtn) {
      menuThemeBtn.textContent = "Light Mode";
    } else {
      logMissingElement("menuThemeBtn");
    }
  } else {
    document.body.classList.remove("dark-mode");
    if (menuThemeBtn) {
      menuThemeBtn.textContent = "Dark Mode";
    } else {
      logMissingElement("menuThemeBtn");
    }
  }
}

const savedTheme = localStorage.getItem("superpeer-theme") || "light";
applyTheme(savedTheme);

addSafeListener(menuThemeBtn, "menuThemeBtn", "click", () => {
  const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("superpeer-theme", nextTheme);
  if (headerMenu) {
    headerMenu.classList.add("hidden-block");
  } else {
    logMissingElement("headerMenu");
  }
});

// Header menu open/close
addSafeListener(menuToggleBtn, "menuToggleBtn", "click", () => {
  if (headerMenu) {
    headerMenu.classList.toggle("hidden-block");
  } else {
    logMissingElement("headerMenu");
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-wrapper") && headerMenu) {
    headerMenu.classList.add("hidden-block");
  }
});

// -----------------------------
// WIZARD HELPERS
// -----------------------------
function showScreen(screenElement) {
  allScreens.forEach((screen, index) => {
    if (screen) {
      screen.classList.remove("active");
    } else {
      logMissingElement(`wizard-screen-${index}`);
    }
  });

  if (screenElement) {
    screenElement.classList.add("active");
  }

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
  hideConnectionFailure();

  if (currentFlow === "send") {
    transferTitle.textContent = "Step 3: Connected - Send File";
    sendControls.classList.remove("hidden-block");
    receiveInfo.classList.add("hidden-block");
    selectedFileName.textContent = "📄 Select a file to start sharing";
    setCurrentTransferFile("Current file: none");
  } else {
    transferTitle.textContent = "Step 3: Connected - Ready to Receive";
    sendControls.classList.add("hidden-block");
    receiveInfo.classList.remove("hidden-block");
    selectedFileName.textContent = "Receiving: waiting for file...";
    setCurrentTransferFile("Current file: waiting for sender");
  }

  statusText.textContent = "";
}

function resetTransferUi() {
  if (fileInput) {
    fileInput.value = "";
  } else {
    logMissingElement("fileInput");
  }
  isSendingFiles = false;
  hasBlockedLargeFile = false;
  transferDirectionText = "Progress";
  transferItems = [];
  totalTransferredBytes = 0;
  totalTransferBytes = 0;
  setProgress(0);
  renderTransferList();
  updateTotalProgressText();
  setCurrentTransferFile("Current file: none");
  if (fileStatusText) {
    fileStatusText.textContent = "File Status: idle";
  } else {
    logMissingElement("fileStatusText");
  }

  if (!selectedFileName) {
    logMissingElement("selectedFileName");
  } else if (currentFlow === "send") {
    selectedFileName.textContent = "📄 Select a file to start sharing";
  } else {
    selectedFileName.textContent = "Receiving: waiting for file...";
  }

  updateSendFileButtonState();
}

// Go back to mode selection screen and reset local UI state
function goToModeSelection() {
  stopWaitingDots();
  clearConnectionTimeout();
  hideConnectionFailure();

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
  setCreateRoomButtonDisabled(false);
  setJoinRoomButtonDisabled(false);

  resetTransferUi();
  showScreen(entryScreen);
  statusText.textContent = "";
}

function clearConnectionTimeout() {
  if (!connectionTimeoutTimer) return;
  clearTimeout(connectionTimeoutTimer);
  connectionTimeoutTimer = null;
}

function startConnectionTimeout() {
  clearConnectionTimeout();
  connectionTimeoutTimer = setTimeout(() => {
    showConnectionFailure("Connection failed. Try again.");
  }, 8000);
}

function hideConnectionFailure() {
  if (connectionErrorBox) {
    connectionErrorBox.classList.add("hidden-block");
  } else {
    logMissingElement("connectionErrorBox");
  }
}

function showConnectionFailure(message) {
  clearConnectionTimeout();
  isPeerConnected = false;
  setCreateRoomButtonDisabled(false);
  setJoinRoomButtonDisabled(false);
  updateSendFileButtonState();

  if (statusText) {
    statusText.textContent = message;
  } else {
    logMissingElement("statusText");
  }

  if (connectionErrorText) {
    connectionErrorText.textContent = message;
  } else {
    logMissingElement("connectionErrorText");
  }

  if (connectionErrorBox) {
    connectionErrorBox.classList.remove("hidden-block");
  } else {
    logMissingElement("connectionErrorBox");
  }

  showToast("Connection failed. Try again.", "error");
}

// -----------------------------
// TOAST + PROGRESS
// -----------------------------
function showToast(message, type = "info") {
  if (!toastContainer) {
    logMissingElement("toastContainer");
    return;
  }

  const toast = document.createElement("div");
  const toastType = ["success", "error", "info"].includes(type) ? type : "info";
  toast.className = `toast toast-${toastType}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-6px)";
    toast.style.transition = "opacity 0.2s ease, transform 0.2s ease";
  }, 2800);

  setTimeout(() => {
    toast.remove();
  }, 3000);
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
  if (fileProgressFill) {
    fileProgressFill.style.width = safePercent + "%";
  } else {
    logMissingElement("fileProgressFill");
  }
  if (fileProgressValue) {
    fileProgressValue.textContent = safePercent + "%";
  } else {
    logMissingElement("fileProgressValue");
  }
  if (fileProgressText) {
    fileProgressText.textContent = `${transferDirectionText}: ${safePercent}%`;
  } else {
    logMissingElement("fileProgressText");
  }
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setCurrentTransferFile(text) {
  if (!currentTransferFileText) {
    logMissingElement("currentTransferFileText");
    return;
  }
  currentTransferFileText.textContent = text;
}

function updateTotalProgressText() {
  if (!totalProgressText) {
    logMissingElement("totalProgressText");
    return;
  }
  if (!totalTransferBytes) {
    totalProgressText.textContent = "Total progress: 0%";
    return;
  }
  const percent = Math.min(100, Math.floor((totalTransferredBytes / totalTransferBytes) * 100));
  totalProgressText.textContent = `Total progress: ${percent}%`;
}

function renderTransferList() {
  if (!fileTransferList) {
    logMissingElement("fileTransferList");
    return;
  }

  if (transferItems.length === 0) {
    fileTransferList.classList.add("hidden-block");
    fileTransferList.innerHTML = "";
    return;
  }

  fileTransferList.classList.remove("hidden-block");
  fileTransferList.innerHTML = transferItems
    .map(
      (item) => `
        <div class="file-item">
          <div class="file-item-head">
            <span class="file-item-name">${escapeHtml(item.name)}</span>
            <span class="file-item-size">${formatFileSize(item.size)}</span>
          </div>
          <div class="file-item-progress">
            <div class="file-item-fill" style="width: ${item.progress}%"></div>
          </div>
          <div class="file-item-status">${escapeHtml(item.status)} (${item.progress}%)</div>
        </div>
      `
    )
    .join("");
}

function updateTransferItemProgress(itemIndex, progress, status) {
  const item = transferItems[itemIndex];
  if (!item) return;
  item.progress = progress;
  item.status = status;
  renderTransferList();
}

function validateSelectedFiles(files, showMessages) {
  const fileList = Array.from(files || []);
  let hasLargeWarning = false;
  let blockedFile = null;

  for (const file of fileList) {
    if (file.size > EXTREME_FILE_BLOCK_SIZE) {
      blockedFile = file;
      break;
    }
    if (file.size > LARGE_FILE_WARNING_SIZE) {
      hasLargeWarning = true;
    }
  }

  if (blockedFile && showMessages) {
    fileStatusText.textContent = `File Status: ${blockedFile.name} is too large. Max allowed is 500MB`;
    showToast("Extremely large file is blocked", "error");
  } else if (hasLargeWarning && showMessages) {
    fileStatusText.textContent = "Large file may fail on unstable networks";
    showToast("Large file may fail on unstable networks", "info");
  }

  return {
    hasLargeWarning,
    blockedFile
  };
}

function updateSendFileButtonState() {
  if (!fileInput) {
    logMissingElement("fileInput");
    return;
  }
  if (!sendFileBtn) {
    logMissingElement("sendFileBtn");
    return;
  }

  const hasFile = fileInput.files && fileInput.files.length > 0;
  sendFileBtn.disabled =
    !(currentFlow === "send" && hasFile && isPeerConnected) || isSendingFiles || hasBlockedLargeFile;
}

function setCreateRoomButtonDisabled(disabled) {
  if (createRoomBtn) {
    createRoomBtn.disabled = disabled;
  } else {
    logMissingElement("createRoomBtn");
  }
}

function setJoinRoomButtonDisabled(disabled) {
  if (joinRoomBtn) {
    joinRoomBtn.disabled = disabled;
  } else {
    logMissingElement("joinRoomBtn");
  }
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
      clearConnectionTimeout();
      showConnectedStep();
      showToast("Secure connection established", "success");
      updateSendFileButtonState();
      return;
    }

    if (
      peerConnection.connectionState === "failed" ||
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "closed"
    ) {
      showConnectionFailure("Connection failed. Try again.");
    }
  };
}

function setupDataChannelEvents(channel) {
  channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

  function completeIncomingFile() {
    if (!incomingFileInfo) return;

    const completedFileInfo = incomingFileInfo;
    const blob = new Blob(receivedChunks);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = completedFileInfo.name;
    link.click();
    URL.revokeObjectURL(url);

    fileStatusText.textContent =
      "File Status: File received successfully (" +
      completedFileInfo.fileIndex +
      "/" +
      completedFileInfo.totalFiles +
      ")";
    setProgress(100);
    updateTransferItemProgress(completedFileInfo.fileIndex - 1, 100, "Received");
    showToast("File received", "success");

    incomingFileInfo = null;
    receivedChunks = [];
    receivedBytes = 0;
    incomingFileMarkedComplete = false;

    if (completedFileInfo.fileIndex >= completedFileInfo.totalFiles) {
      setCurrentTransferFile("Current file: all files received");
      setTimeout(() => {
        resetTransferUi();
      }, 1200);
    } else {
      setCurrentTransferFile("Current file: waiting for next file");
    }
  }

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
        const isFirstIncomingFile = (meta.fileIndex || 1) === 1;
        if (isFirstIncomingFile) {
          transferItems = [];
          totalTransferredBytes = 0;
          totalTransferBytes = 0;
        }

        incomingFileInfo = {
          name: meta.name,
          size: meta.size,
          fileIndex: meta.fileIndex || 1,
          totalFiles: meta.totalFiles || 1
        };
        receivedChunks = [];
        receivedBytes = 0;
        incomingFileMarkedComplete = false;
        transferDirectionText = "Receiving...";
        fileStatusText.textContent =
          "File Status: Receiving file " +
          incomingFileInfo.fileIndex +
          " of " +
          incomingFileInfo.totalFiles;
        selectedFileName.textContent = "Receiving: " + incomingFileInfo.name;
        setCurrentTransferFile(
          `Current file: Receiving ${incomingFileInfo.name} (${incomingFileInfo.fileIndex}/${incomingFileInfo.totalFiles})`
        );
        transferItems.push({
          name: incomingFileInfo.name,
          size: incomingFileInfo.size,
          progress: 0,
          status: "Receiving"
        });
        totalTransferBytes += incomingFileInfo.size;
        renderTransferList();
        updateTotalProgressText();
        setProgress(0);
        return;
      }

      if (meta && meta.type === "file-complete" && incomingFileInfo) {
        incomingFileMarkedComplete = true;
        if (receivedBytes >= incomingFileInfo.size) {
          completeIncomingFile();
        }
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
    updateTransferItemProgress(incomingFileInfo.fileIndex - 1, receivePercent, "Receiving");
    totalTransferredBytes += chunkBuffer.byteLength;
    updateTotalProgressText();

    // Complete file when full data is received and sender marks last chunk done
    if (receivedBytes >= incomingFileInfo.size && incomingFileMarkedComplete) {
      completeIncomingFile();
    }
  };
}

function waitForBufferedAmountLow(channel) {
  return new Promise((resolve) => {
    if (channel.bufferedAmount <= BUFFER_LOW_THRESHOLD) {
      resolve();
      return;
    }

    const previousHandler = channel.onbufferedamountlow;
    channel.onbufferedamountlow = () => {
      channel.onbufferedamountlow = previousHandler;
      if (typeof previousHandler === "function") {
        previousHandler();
      }
      resolve();
    };
  });
}

// -----------------------------
// ENTRY SCREEN
// -----------------------------
addSafeListener(menuModeBtn, "menuModeBtn", "click", () => {
  goToModeSelection();
  if (headerMenu) {
    headerMenu.classList.add("hidden-block");
  } else {
    logMissingElement("headerMenu");
  }
});

addSafeListener(disconnectBtn, "disconnectBtn", "click", () => {
  // Disconnect from signaling server, then reconnect for fresh state
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }

  goToModeSelection();
  showToast("Disconnected", "info");
  if (headerMenu) {
    headerMenu.classList.add("hidden-block");
  } else {
    logMissingElement("headerMenu");
  }
});

addSafeListener(sendModeBtn, "sendModeBtn", "click", () => {
  currentFlow = "send";
  isCreator = true;
  currentRoomId = null;
  retryRoomId = null;
  hideConnectionFailure();
  clearConnectionTimeout();
  copyRoomBtn.disabled = true;
  waitingCopyRoomBtn.disabled = true;
  setCreateRoomButtonDisabled(false);
  roomDisplay.innerHTML = "Room ID: <strong>Not created yet</strong>";
  waitingRoomDisplay.innerHTML = "Room ID: <strong>Not created yet</strong>";
  resetTransferUi();
  showScreen(sendCreateScreen);
});

addSafeListener(receiveModeBtn, "receiveModeBtn", "click", () => {
  currentFlow = "receive";
  isCreator = false;
  currentRoomId = null;
  retryRoomId = null;
  hideConnectionFailure();
  clearConnectionTimeout();
  roomInput.value = "";
  setJoinRoomButtonDisabled(false);
  resetTransferUi();
  showScreen(receiveJoinScreen);
});

// -----------------------------
// SEND FLOW
// -----------------------------
addSafeListener(createRoomBtn, "createRoomBtn", "click", () => {
  setCreateRoomButtonDisabled(true);
  socket.emit("create-room");
});

addSafeListener(copyRoomBtn, "copyRoomBtn", "click", async () => {
  copyRoomId();
});

addSafeListener(waitingCopyRoomBtn, "waitingCopyRoomBtn", "click", async () => {
  copyRoomId();
});

async function copyRoomId() {
  if (!currentRoomId) return;

  try {
    await navigator.clipboard.writeText(currentRoomId);
    showToast("Room code copied", "info");
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
addSafeListener(joinRoomBtn, "joinRoomBtn", "click", () => {
  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    statusText.textContent = "Please enter a Room ID.";
    return;
  }

  retryRoomId = roomId;
  setJoinRoomButtonDisabled(true);
  hideConnectionFailure();
  startConnectionTimeout();
  socket.emit("join-room", roomId);
  showScreen(receiveConnectingScreen);
  statusText.textContent = "";
});

addSafeListener(roomInput, "roomInput", "keydown", (event) => {
  if (event.key === "Enter") {
    joinRoomBtn.click();
  }
});

async function sendSingleFile(file, fileIndex, totalFiles) {
  dataChannel.send(
    JSON.stringify({
      type: "file-meta",
      name: file.name,
      size: file.size,
      fileIndex,
      totalFiles
    })
  );

  fileStatusText.textContent = `File Status: Sending file ${fileIndex} of ${totalFiles}`;
  selectedFileName.textContent = "Sending: " + file.name;
  setCurrentTransferFile(`Current file: Sending ${file.name} (${fileIndex}/${totalFiles})`);
  transferDirectionText = "Sending...";
  updateTransferItemProgress(fileIndex - 1, 0, "Sending");
  setProgress(0);

  let sentBytes = 0;
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    while (dataChannel.bufferedAmount > BUFFER_PAUSE_THRESHOLD) {
      await waitForBufferedAmountLow(dataChannel);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const chunkBlob = file.slice(offset, offset + CHUNK_SIZE);
    const chunk = await chunkBlob.arrayBuffer();
    dataChannel.send(chunk);
    sentBytes += chunk.byteLength;

    const sendPercent = Math.min(100, Math.floor((sentBytes / file.size) * 100));
    setProgress(sendPercent);
    updateTransferItemProgress(fileIndex - 1, sendPercent, "Sending");
    totalTransferredBytes += chunk.byteLength;
    updateTotalProgressText();

    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  updateTransferItemProgress(fileIndex - 1, 100, "Sent");

  dataChannel.send(
    JSON.stringify({
      type: "file-complete",
      name: file.name,
      size: file.size,
      fileIndex,
      totalFiles
    })
  );
}

async function sendFiles(files) {
  const filesToSend = Array.from(files || []);
  if (filesToSend.length === 0) {
    fileStatusText.textContent = "File Status: Please choose file(s) first";
    return;
  }

  const { blockedFile } = validateSelectedFiles(filesToSend, true);
  hasBlockedLargeFile = !!blockedFile;
  if (hasBlockedLargeFile) {
    updateSendFileButtonState();
    return;
  }

  if (!dataChannel || dataChannel.readyState !== "open") {
    fileStatusText.textContent = "File Status: Secure link is still connecting";
    return;
  }

  if (transferItems.length === 0) {
    transferItems = filesToSend.map((file) => ({
      name: file.name,
      size: file.size,
      progress: 0,
      status: "Pending"
    }));
    renderTransferList();
  }
  totalTransferBytes = filesToSend.reduce((sum, file) => sum + file.size, 0);
  totalTransferredBytes = 0;
  updateTotalProgressText();

  isSendingFiles = true;
  updateSendFileButtonState();

  try {
    for (let index = 0; index < filesToSend.length; index += 1) {
      const file = filesToSend[index];
      await sendSingleFile(file, index + 1, filesToSend.length);
    }

    fileStatusText.textContent = `File Status: ${filesToSend.length} file(s) sent successfully`;
    setCurrentTransferFile("Current file: all files sent");
    setProgress(100);
    showToast("File sent successfully", "success");

    setTimeout(() => {
      resetTransferUi();
    }, 1200);
  } finally {
    isSendingFiles = false;
    updateSendFileButtonState();
  }
}

// -----------------------------
// FILE SEND ACTION (STEP 3 SEND)
// -----------------------------
addSafeListener(fileInput, "fileInput", "change", () => {
  if (fileInput.files.length > 0) {
    const { hasLargeWarning, blockedFile } = validateSelectedFiles(fileInput.files, false);
    hasBlockedLargeFile = !!blockedFile;

    const firstFileName = fileInput.files[0].name;
    const remainingCount = fileInput.files.length - 1;
    if (remainingCount > 0) {
      selectedFileName.textContent = `Sending: ${firstFileName} (+${remainingCount} more)`;
    } else {
      selectedFileName.textContent = "Sending: " + firstFileName;
    }
    if (hasBlockedLargeFile) {
      fileStatusText.textContent = `File Status: ${blockedFile.name} is too large. Max allowed is 500MB`;
      showToast("Extremely large file is blocked", "error");
    } else if (hasLargeWarning) {
      fileStatusText.textContent = "Large file may fail on unstable networks";
      showToast("Large file may fail on unstable networks", "info");
    } else {
      fileStatusText.textContent = `File Status: Ready to send ${fileInput.files.length} file(s)`;
    }

    transferItems = Array.from(fileInput.files).map((file) => ({
      name: file.name,
      size: file.size,
      progress: 0,
      status: file.size > EXTREME_FILE_BLOCK_SIZE ? "Blocked: too large" : "Pending"
    }));
    totalTransferBytes = transferItems.reduce((sum, item) => sum + item.size, 0);
    totalTransferredBytes = 0;
    renderTransferList();
    updateTotalProgressText();
    setCurrentTransferFile("Current file: none");
  } else {
    selectedFileName.textContent = "📄 Select a file to start sharing";
    fileStatusText.textContent = "File Status: idle";
    hasBlockedLargeFile = false;
    transferItems = [];
    totalTransferBytes = 0;
    totalTransferredBytes = 0;
    renderTransferList();
    updateTotalProgressText();
    setCurrentTransferFile("Current file: none");
  }
  setProgress(0);
  updateSendFileButtonState();
});

addSafeListener(sendFileBtn, "sendFileBtn", "click", async () => {
  await sendFiles(fileInput.files);
});

// -----------------------------
// SOCKET EVENTS
// -----------------------------
socket.on("connect", () => {
  console.log("Connected to server");
});

socket.on("connect_error", (err) => {
  console.log("Connection error:", err.message);
  showConnectionFailure("Connection failed. Try again.");
});

socket.on("room-created", (roomId) => {
  currentRoomId = roomId;
  retryRoomId = roomId;
  roomDisplay.innerHTML = `Room ID: <strong>${roomId}</strong>`;
  waitingRoomDisplay.innerHTML = `Room ID: <strong>${roomId}</strong>`;
  copyRoomBtn.disabled = false;
  waitingCopyRoomBtn.disabled = false;
  hideConnectionFailure();
  startConnectionTimeout();
  showToast("Room created successfully", "success");

  // Send flow step 2
  showScreen(sendWaitingScreen);
});

socket.on("joined-room", (roomId) => {
  currentRoomId = roomId;
  retryRoomId = roomId;
  setJoinRoomButtonDisabled(true);
  hideConnectionFailure();
  startConnectionTimeout();
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
  clearConnectionTimeout();
  setCreateRoomButtonDisabled(false);
  setJoinRoomButtonDisabled(false);
  statusText.textContent = message;
  showToast(message, "error");
});

addSafeListener(retryConnectionBtn, "retryConnectionBtn", "click", () => {
  clearConnectionTimeout();
  hideConnectionFailure();

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }

  if (currentFlow === "receive" && retryRoomId) {
    showScreen(receiveConnectingScreen);
    statusText.textContent = "";
    setJoinRoomButtonDisabled(true);
    socket.emit("join-room", retryRoomId);
    startConnectionTimeout();
    return;
  }

  if (currentFlow === "send") {
    showScreen(sendCreateScreen);
    statusText.textContent = "";
    setCreateRoomButtonDisabled(true);
    socket.emit("create-room");
    return;
  }

  showScreen(entryScreen);
});

// Show loading screen briefly before main wizard
setTimeout(() => {
  if (loadingScreen) {
    loadingScreen.classList.add("hidden-block");
  } else {
    logMissingElement("loadingScreen");
  }

  if (appCard) {
    appCard.classList.remove("app-hidden");
  } else {
    logMissingElement("appCard");
  }
}, 1200);

// Initial safe state
updateSendFileButtonState();

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
const roleStatusText = document.getElementById("roleStatusText");
const sendControls = document.getElementById("sendControls");
const connectedPanel = document.getElementById("connectedPanel");
const previewPanel = document.getElementById("previewPanel");
const progressPanel = document.getElementById("progressPanel");
const completedPanel = document.getElementById("completedPanel");
const sendingAnimationText = document.getElementById("sendingAnimationText");
const completionMessage = document.getElementById("completionMessage");
const resetTransferBtn = document.getElementById("resetTransferBtn");
const fileInputContainer = document.getElementById("fileInputContainer");
const fileInput = document.getElementById("fileInput");
const filePreviewList = document.getElementById("filePreviewList");
const sendFileBtn = document.getElementById("sendFileBtn");
const fileTransferList = document.getElementById("fileTransferList");
const totalProgressTrack = document.getElementById("totalProgressTrack");
const totalProgressFill = document.getElementById("totalProgressFill");
const totalProgressValue = document.getElementById("totalProgressValue");
const transferMetaText = document.getElementById("transferMetaText");
const cancelTransferBtn = document.getElementById("cancelTransferBtn");
const retryTransferBtn = document.getElementById("retryTransferBtn");

// -----------------------------
// APP STATE
// -----------------------------
let currentFlow = null; // "send" | "receive"
let userRole = "sender"; // "sender" | "receiver"
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
const EMPTY_FILE_PROMPT = "Drag & drop files or click to browse";
let incomingFileInfo = null;
let receivedChunks = [];
let receivedBytes = 0;
let incomingFileMarkedComplete = false;
let waitingDotsTimer = null;
let connectionTimeoutTimer = null;
let retryRoomId = null;
let isSendingFiles = false;
let hasBlockedLargeFile = false;
let transferItems = [];
let totalTransferredBytes = 0;
let totalTransferBytes = 0;
let transferStartedAt = 0;
let isTransferCancelled = false;
let manualRetryContext = null;
const TRANSFER_UI_STATES = {
  CONNECTED: "connected",
  FILES_SELECTED: "files-selected",
  SENDING: "sending",
  RECEIVING: "receiving",
  COMPLETED: "completed",
  ERROR: "error"
};
const MAX_FILE_RETRIES = 2;
let transferUiState = TRANSFER_UI_STATES.CONNECTED;

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

async function getIceServers() {
  try {
    const res = await fetch("/turn-credentials");
    const data = await res.json();
    return data.iceServers;
  } catch (err) {
    console.warn("TURN failed, using STUN fallback");
    return DEFAULT_ICE_SERVERS;
  }
}

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

function updateRoleUI() {
  if (fileInput) {
    fileInput.disabled = userRole !== "sender";
  } else {
    logMissingElement("fileInput");
  }
}

// Step 3 is shared. In send mode, show file picker.
// In receive mode, show waiting info only.
function showConnectedStep() {
  showScreen(transferScreen);
  hideConnectionFailure();
  updateRoleUI();

  if (userRole === "sender") {
    transferTitle.textContent = "Send files";
    setTransferStatus("");
    setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
    if (sendFileBtn) {
      sendFileBtn.disabled = true;
    } else {
      logMissingElement("sendFileBtn");
    }
  } else {
    transferTitle.textContent = "Receiving files...";
    setTransferStatus("");
    setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
    if (sendFileBtn) {
      sendFileBtn.disabled = true;
    } else {
      logMissingElement("sendFileBtn");
    }
  }

  statusText.textContent = "";
  updateSendFileButtonState();
}

function resetTransferUi() {
  if (fileInput) {
    fileInput.value = "";
  } else {
    logMissingElement("fileInput");
  }
  isSendingFiles = false;
  hasBlockedLargeFile = false;
  transferItems = [];
  totalTransferredBytes = 0;
  totalTransferBytes = 0;
  transferStartedAt = 0;
  manualRetryContext = null;
  isTransferCancelled = false;
  setProgress(0);
  setTransferMetaText("");
  setSendButtonLoading(false);
  renderTransferList();
  updateTotalProgressUi();
  setTransferStatus("");
  setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
  renderFilePreview([]);
  if (fileInputContainer) {
    fileInputContainer.classList.remove("drag-active");
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
  userRole = "sender";
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

function setTransferStatus(text) {
  if (!roleStatusText) {
    logMissingElement("roleStatusText");
    return;
  }
  roleStatusText.textContent = text || "";
  roleStatusText.classList.toggle("hidden-block", !text);
}

function setInlineStatus(text) {
  if (!statusText) {
    logMissingElement("statusText");
    return;
  }
  statusText.textContent = text || "";
}

function setTransferMetaText(text) {
  if (!transferMetaText) {
    logMissingElement("transferMetaText");
    return;
  }
  transferMetaText.textContent = text || "";
  transferMetaText.classList.toggle("hidden-block", !text);
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return "0 KB/s";
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatEta(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "--";
  return `${Math.max(0, Math.ceil(seconds))} sec`;
}

function recalculateTotalTransferredBytes() {
  totalTransferredBytes = transferItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.transferredBytes) ? item.transferredBytes : 0),
    0
  );
}

function updateTransferMeta() {
  if (!transferStartedAt || totalTransferBytes <= 0) {
    setTransferMetaText("");
    return;
  }

  const elapsedSeconds = Math.max(1, (Date.now() - transferStartedAt) / 1000);
  const speedBytesPerSecond = totalTransferredBytes / elapsedSeconds;
  const remainingBytes = Math.max(0, totalTransferBytes - totalTransferredBytes);
  const etaSeconds = speedBytesPerSecond > 0 ? remainingBytes / speedBytesPerSecond : 0;
  setTransferMetaText(`Speed: ${formatSpeed(speedBytesPerSecond)} • ETA: ${formatEta(etaSeconds)}`);
}

function setSendButtonLoading(loading) {
  if (!sendFileBtn) {
    logMissingElement("sendFileBtn");
    return;
  }
  sendFileBtn.textContent = loading ? "Sending" : "Send File";
  sendFileBtn.classList.toggle("btn-loading", loading);
}

function setTransferUiState(nextState) {
  transferUiState = nextState;

  if (transferScreen) {
    transferScreen.dataset.uiState = nextState;
  } else {
    logMissingElement("transferScreen");
  }

  const isSender = userRole === "sender";
  const showConnectedPanel = isSender && nextState === TRANSFER_UI_STATES.CONNECTED;
  const showPreviewPanel = isSender && nextState === TRANSFER_UI_STATES.FILES_SELECTED;
  const showProgressPanel =
    nextState === TRANSFER_UI_STATES.SENDING ||
    nextState === TRANSFER_UI_STATES.RECEIVING ||
    nextState === TRANSFER_UI_STATES.ERROR;
  const showCompletedPanel = nextState === TRANSFER_UI_STATES.COMPLETED;

  if (sendControls) {
    sendControls.classList.toggle("hidden-block", !isSender);
  } else {
    logMissingElement("sendControls");
  }
  if (connectedPanel) {
    connectedPanel.classList.toggle("hidden-block", !showConnectedPanel);
  } else {
    logMissingElement("connectedPanel");
  }
  if (previewPanel) {
    previewPanel.classList.toggle("hidden-block", !showPreviewPanel);
  } else {
    logMissingElement("previewPanel");
  }
  if (progressPanel) {
    progressPanel.classList.toggle("hidden-block", !showProgressPanel);
  } else {
    logMissingElement("progressPanel");
  }
  if (completedPanel) {
    completedPanel.classList.toggle("hidden-block", !showCompletedPanel);
  } else {
    logMissingElement("completedPanel");
  }

  if (sendFileBtn) {
    sendFileBtn.classList.toggle("hidden-block", !showPreviewPanel);
  } else {
    logMissingElement("sendFileBtn");
  }

  if (cancelTransferBtn) {
    const shouldShowCancel =
      nextState === TRANSFER_UI_STATES.SENDING || nextState === TRANSFER_UI_STATES.RECEIVING;
    cancelTransferBtn.classList.toggle("hidden-block", !shouldShowCancel);
    cancelTransferBtn.disabled = !shouldShowCancel;
  } else {
    logMissingElement("cancelTransferBtn");
  }

  if (retryTransferBtn) {
    const shouldShowRetry = nextState === TRANSFER_UI_STATES.ERROR && !!manualRetryContext;
    retryTransferBtn.classList.toggle("hidden-block", !shouldShowRetry);
    retryTransferBtn.disabled = !shouldShowRetry || isSendingFiles;
  } else {
    logMissingElement("retryTransferBtn");
  }

  if (completionMessage) {
    completionMessage.textContent = userRole === "sender" ? "Files sent successfully." : "Files received successfully.";
  } else {
    logMissingElement("completionMessage");
  }

  if (sendingAnimationText) {
    if (nextState === TRANSFER_UI_STATES.ERROR) {
      sendingAnimationText.textContent = "Transfer failed";
    } else if (nextState === TRANSFER_UI_STATES.RECEIVING) {
      sendingAnimationText.textContent = "Receiving files...";
    } else {
      sendingAnimationText.textContent = "Sending files...";
    }
  } else {
    logMissingElement("sendingAnimationText");
  }

  renderTransferList();
  updateTotalProgressUi();
  updateTransferMeta();
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
  if (totalProgressFill) {
    totalProgressFill.style.width = safePercent + "%";
  } else {
    logMissingElement("totalProgressFill");
  }
  if (totalProgressValue) {
    totalProgressValue.textContent = safePercent + "%";
  } else {
    logMissingElement("totalProgressValue");
  }
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileTypeIcon(file) {
  const fileType = String(file.type || "").toLowerCase();
  const fileName = String(file.name || "").toLowerCase();
  if (fileType.startsWith("image/")) return "🖼️";
  if (fileType.startsWith("video/")) return "🎬";
  if (fileType === "application/pdf" || fileName.endsWith(".pdf")) return "📄";
  return "📁";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateTotalProgressUi() {
  if (!totalProgressTrack) {
    logMissingElement("totalProgressTrack");
    return;
  }

  const hasTransfer = totalTransferBytes > 0;
  const allowVisible =
    transferUiState === TRANSFER_UI_STATES.SENDING ||
    transferUiState === TRANSFER_UI_STATES.RECEIVING ||
    transferUiState === TRANSFER_UI_STATES.ERROR;
  totalProgressTrack.classList.toggle("hidden-block", !allowVisible || !hasTransfer);

  if (!hasTransfer) {
    setProgress(0);
    return;
  }

  if (!totalTransferBytes) {
    setProgress(0);
    return;
  }

  const percent = Math.min(100, Math.floor((totalTransferredBytes / totalTransferBytes) * 100));
  setProgress(percent);
}

function renderTransferList() {
  if (!fileTransferList) {
    logMissingElement("fileTransferList");
    return;
  }

  const hasItems = transferItems.length > 0;
  const allowVisible =
    transferUiState === TRANSFER_UI_STATES.SENDING ||
    transferUiState === TRANSFER_UI_STATES.RECEIVING ||
    transferUiState === TRANSFER_UI_STATES.ERROR;
  fileTransferList.classList.toggle("hidden-block", !hasItems || !allowVisible);

  if (!hasItems) {
    fileTransferList.innerHTML = "";
    return;
  }

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

function renderFilePreview(files) {
  if (!filePreviewList) {
    logMissingElement("filePreviewList");
    return;
  }

  const fileList = Array.from(files || []);
  if (fileList.length === 0) {
    filePreviewList.innerHTML = `<p class="file-preview-empty">${escapeHtml(EMPTY_FILE_PROMPT)}</p>`;
    return;
  }

  filePreviewList.innerHTML = fileList
    .map(
      (file) => `
        <div class="file-item file-preview-item">
          <div class="file-item-head">
            <span class="file-item-name">${getFileTypeIcon(file)} ${escapeHtml(file.name)}</span>
            <span class="file-item-size">${formatFileSize(file.size)}</span>
          </div>
        </div>
      `
    )
    .join("");
}

function processSelectedFiles(files) {
  const fileList = Array.from(files || []);
  renderFilePreview(fileList);

  if (fileList.length > 0) {
    const { hasLargeWarning, blockedFile } = validateSelectedFiles(fileList, false);
    hasBlockedLargeFile = !!blockedFile;

    if (hasBlockedLargeFile) {
      setInlineStatus(`${blockedFile.name} is too large. Max allowed is 500MB`);
      showToast("Extremely large file is blocked", "error");
    } else if (hasLargeWarning) {
      setInlineStatus("Large file may fail on unstable networks");
      showToast("Large file may fail on unstable networks", "info");
    } else {
      setInlineStatus("");
    }

    transferItems = fileList.map((file) => ({
      name: file.name,
      size: file.size,
      progress: 0,
      status: file.size > EXTREME_FILE_BLOCK_SIZE ? "Blocked: too large" : "Pending",
      transferredBytes: 0
    }));
    totalTransferBytes = transferItems.reduce((sum, item) => sum + item.size, 0);
    totalTransferredBytes = 0;
    setTransferUiState(TRANSFER_UI_STATES.FILES_SELECTED);
  } else {
    setInlineStatus("");
    hasBlockedLargeFile = false;
    transferItems = [];
    totalTransferBytes = 0;
    totalTransferredBytes = 0;
    setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
  }

  updateSendFileButtonState();
}

function updateTransferItemProgress(itemIndex, progress, status) {
  const item = transferItems[itemIndex];
  if (!item) return;
  item.progress = progress;
  item.status = status;
  if (!Number.isFinite(item.transferredBytes)) {
    item.transferredBytes = 0;
  }
  recalculateTotalTransferredBytes();
  renderTransferList();
  updateTotalProgressUi();
  updateTransferMeta();
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
    setInlineStatus(`${blockedFile.name} is too large. Max allowed is 500MB`);
    showToast("Extremely large file is blocked", "error");
  } else if (hasLargeWarning && showMessages) {
    setInlineStatus("Large file may fail on unstable networks");
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
  const isChannelReady = !!dataChannel && dataChannel.readyState === "open";
  const isTransferBusy =
    transferUiState === TRANSFER_UI_STATES.SENDING || transferUiState === TRANSFER_UI_STATES.RECEIVING;
  sendFileBtn.disabled =
    !(
      userRole === "sender" &&
      currentFlow === "send" &&
      hasFile &&
      isPeerConnected &&
      isChannelReady
    ) ||
    isSendingFiles ||
    isTransferBusy ||
    hasBlockedLargeFile;
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
async function createPeerConnection() {
  const iceServers = await getIceServers();
  peerConnection = new RTCPeerConnection({
    iceServers: iceServers
  });

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

    setInlineStatus("");
    setTransferStatus("");
    updateTransferItemProgress(completedFileInfo.fileIndex - 1, 100, "Received");
    showToast("File received", "success");

    incomingFileInfo = null;
    receivedChunks = [];
    receivedBytes = 0;
    incomingFileMarkedComplete = false;

    if (completedFileInfo.fileIndex >= completedFileInfo.totalFiles) {
      setTransferStatus("");
      setTransferMetaText("");
      setTransferUiState(TRANSFER_UI_STATES.COMPLETED);
    }
  }

  channel.onopen = () => {
    isTransferCancelled = false;
    updateSendFileButtonState();
  };

  channel.onclose = () => {
    if (
      !isTransferCancelled &&
      (transferUiState === TRANSFER_UI_STATES.SENDING ||
        transferUiState === TRANSFER_UI_STATES.RECEIVING)
    ) {
      setInlineStatus("Connection lost");
      setTransferUiState(TRANSFER_UI_STATES.ERROR);
      showToast("Connection lost", "error");
    }
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

      if (meta && meta.type === "transfer-cancelled") {
        incomingFileInfo = null;
        receivedChunks = [];
        receivedBytes = 0;
        incomingFileMarkedComplete = false;
        setTransferStatus("");
        setTransferMetaText("");
        setInlineStatus("Transfer cancelled");
        setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
        updateSendFileButtonState();
        return;
      }

      if (meta && meta.type === "file-meta") {
        const isFirstIncomingFile = (meta.fileIndex || 1) === 1;
        if (isFirstIncomingFile) {
          transferItems = [];
          totalTransferredBytes = 0;
          totalTransferBytes = 0;
          transferStartedAt = Date.now();
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
        setTransferStatus(`Receiving: ${incomingFileInfo.name}`);
        setInlineStatus("");
        setTransferUiState(TRANSFER_UI_STATES.RECEIVING);
        transferItems.push({
          name: incomingFileInfo.name,
          size: incomingFileInfo.size,
          progress: 0,
          status: "Receiving",
          transferredBytes: 0
        });
        totalTransferBytes += incomingFileInfo.size;
        renderTransferList();
        updateTotalProgressUi();
        updateTransferMeta();
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
    const receivingItem = transferItems[incomingFileInfo.fileIndex - 1];
    if (receivingItem) {
      receivingItem.transferredBytes = receivedBytes;
    }
    updateTransferItemProgress(incomingFileInfo.fileIndex - 1, receivePercent, "Receiving");

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
    const watcher = setInterval(() => {
      if (!channel || channel.readyState !== "open") {
        clearInterval(watcher);
        channel.onbufferedamountlow = previousHandler;
        resolve();
      }
    }, 120);
    channel.onbufferedamountlow = () => {
      clearInterval(watcher);
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
  userRole = "sender";
  updateRoleUI();
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
  userRole = "receiver";
  updateRoleUI();
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

function closeDataChannelSafely() {
  if (!dataChannel) return;
  try {
    if (dataChannel.readyState !== "closed") {
      dataChannel.close();
    }
  } catch (error) {
    console.warn("Data channel close failed:", error.message);
  }
}

function rebuildSenderDataChannel() {
  if (userRole !== "sender" || !peerConnection || peerConnection.connectionState !== "connected") {
    return;
  }
  dataChannel = peerConnection.createDataChannel("file");
  setupDataChannelEvents(dataChannel);
}

function waitForDataChannelOpen(channel, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!channel) {
      reject(new Error("Connection lost"));
      return;
    }
    if (channel.readyState === "open") {
      resolve();
      return;
    }

    let timeoutId = null;
    const handleOpen = () => {
      if (timeoutId) clearTimeout(timeoutId);
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
      resolve();
    };
    const handleClose = () => {
      if (timeoutId) clearTimeout(timeoutId);
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
      reject(new Error("Connection lost"));
    };

    channel.addEventListener("open", handleOpen, { once: true });
    channel.addEventListener("close", handleClose, { once: true });
    timeoutId = setTimeout(() => {
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
      reject(new Error("Connection lost"));
    }, timeoutMs);
  });
}

async function ensureSenderDataChannelReady() {
  if (userRole !== "sender") return;
  if (!peerConnection || peerConnection.connectionState !== "connected") {
    throw new Error("Connection lost");
  }
  if (!dataChannel || dataChannel.readyState === "closed" || dataChannel.readyState === "closing") {
    rebuildSenderDataChannel();
  }
  await waitForDataChannelOpen(dataChannel);
}

async function cancelTransfer() {
  if (
    transferUiState !== TRANSFER_UI_STATES.SENDING &&
    transferUiState !== TRANSFER_UI_STATES.RECEIVING
  ) {
    return;
  }

  isTransferCancelled = true;
  isSendingFiles = false;
  manualRetryContext = null;
  transferStartedAt = 0;
  setSendButtonLoading(false);

  if (dataChannel && dataChannel.readyState === "open") {
    try {
      dataChannel.send(JSON.stringify({ type: "transfer-cancelled" }));
    } catch (error) {
      console.warn("Failed to send cancel event:", error.message);
    }
  }

  closeDataChannelSafely();
  rebuildSenderDataChannel();

  incomingFileInfo = null;
  receivedChunks = [];
  receivedBytes = 0;
  incomingFileMarkedComplete = false;
  setTransferStatus("");
  setTransferMetaText("");
  setInlineStatus("Transfer cancelled");
  setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
  updateSendFileButtonState();
  showToast("Transfer cancelled", "info");
}

async function sendSingleFile(file, fileIndex, totalFiles) {
  if (isTransferCancelled) {
    throw new Error("Transfer cancelled");
  }

  await ensureSenderDataChannelReady();
  const item = transferItems[fileIndex - 1];
  if (item) {
    item.transferredBytes = 0;
  }
  recalculateTotalTransferredBytes();
  setTransferStatus(`Sending: ${file.name}`);
  setTransferUiState(TRANSFER_UI_STATES.SENDING);
  updateTransferItemProgress(fileIndex - 1, 0, "Sending");

  if (!transferStartedAt) {
    transferStartedAt = Date.now();
  }

  dataChannel.send(
    JSON.stringify({
      type: "file-meta",
      name: file.name,
      size: file.size,
      fileIndex,
      totalFiles
    })
  );

  let sentBytes = 0;
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    if (isTransferCancelled) {
      throw new Error("Transfer cancelled");
    }
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new Error("Connection lost");
    }

    while (dataChannel.bufferedAmount > BUFFER_PAUSE_THRESHOLD) {
      await waitForBufferedAmountLow(dataChannel);
      if (isTransferCancelled) {
        throw new Error("Transfer cancelled");
      }
      if (!dataChannel || dataChannel.readyState !== "open") {
        throw new Error("Connection lost");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const chunkBlob = file.slice(offset, offset + CHUNK_SIZE);
    const chunk = await chunkBlob.arrayBuffer();
    dataChannel.send(chunk);
    sentBytes += chunk.byteLength;

    if (item) {
      item.transferredBytes = sentBytes;
    }
    const sendPercent = Math.min(100, Math.floor((sentBytes / file.size) * 100));
    updateTransferItemProgress(fileIndex - 1, sendPercent, "Sending");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  updateTransferItemProgress(fileIndex - 1, 100, "Sent");

  if (!dataChannel || dataChannel.readyState !== "open") {
    throw new Error("Connection lost");
  }
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

async function sendSingleFileWithRetry(file, fileIndex, totalFiles) {
  let retryCount = 0;
  while (retryCount <= MAX_FILE_RETRIES) {
    try {
      await sendSingleFile(file, fileIndex, totalFiles);
      return;
    } catch (error) {
      if (isTransferCancelled) {
        throw error;
      }

      if (retryCount < MAX_FILE_RETRIES) {
        retryCount += 1;
        updateTransferItemProgress(fileIndex - 1, 0, `Retrying... (${retryCount}/${MAX_FILE_RETRIES})`);
        setInlineStatus(`Retrying... (${retryCount}/${MAX_FILE_RETRIES})`);
        showToast(`Retrying... (${retryCount}/${MAX_FILE_RETRIES})`, "info");
        await ensureSenderDataChannelReady();
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      throw error;
    }
  }
}

async function runSendQueue(filesToSend, startIndex = 0) {
  isSendingFiles = true;
  isTransferCancelled = false;
  manualRetryContext = null;
  setSendButtonLoading(true);
  setInlineStatus("");
  setTransferUiState(TRANSFER_UI_STATES.SENDING);
  updateSendFileButtonState();
  recalculateTotalTransferredBytes();
  updateTransferMeta();

  if (!transferStartedAt) {
    transferStartedAt = Date.now();
  }

  let failedIndex = -1;
  try {
    await ensureSenderDataChannelReady();
    for (let index = startIndex; index < filesToSend.length; index += 1) {
      failedIndex = index;
      await sendSingleFileWithRetry(filesToSend[index], index + 1, filesToSend.length);
    }

    setTransferStatus("");
    setTransferMetaText("");
    setInlineStatus("");
    setTransferUiState(TRANSFER_UI_STATES.COMPLETED);
    showToast("File sent successfully", "success");
    return true;
  } catch (error) {
    if (isTransferCancelled) {
      return false;
    }

    const retryStartIndex = failedIndex >= 0 ? failedIndex : startIndex;
    manualRetryContext = { files: filesToSend, startIndex: retryStartIndex };
    setTransferStatus("");
    setInlineStatus("Transfer failed");
    setTransferUiState(TRANSFER_UI_STATES.ERROR);
    showToast(error.message === "Connection lost" ? "Connection lost" : "Transfer failed", "error");
    return false;
  } finally {
    isSendingFiles = false;
    setSendButtonLoading(false);
    updateSendFileButtonState();
  }
}

async function sendFiles(files) {
  if (userRole !== "sender") {
    if (sendFileBtn) {
      sendFileBtn.disabled = true;
    } else {
      logMissingElement("sendFileBtn");
    }
    return;
  }

  const filesToSend = Array.from(files || []);
  if (filesToSend.length === 0) {
    setInlineStatus("Please choose file(s) first");
    return;
  }

  const { blockedFile } = validateSelectedFiles(filesToSend, true);
  hasBlockedLargeFile = !!blockedFile;
  if (hasBlockedLargeFile) {
    updateSendFileButtonState();
    return;
  }

  transferItems = filesToSend.map((file) => ({
    name: file.name,
    size: file.size,
    progress: 0,
    status: "Pending",
    transferredBytes: 0
  }));

  totalTransferBytes = filesToSend.reduce((sum, file) => sum + file.size, 0);
  totalTransferredBytes = 0;
  transferStartedAt = Date.now();
  renderTransferList();
  updateTotalProgressUi();
  await runSendQueue(filesToSend, 0);
}

// -----------------------------
// FILE SEND ACTION (STEP 3 SEND)
// -----------------------------
addSafeListener(fileInput, "fileInput", "change", () => {
  if (userRole !== "sender") {
    if (sendFileBtn) {
      sendFileBtn.disabled = true;
    } else {
      logMissingElement("sendFileBtn");
    }
    return;
  }
  processSelectedFiles(fileInput.files);
});

addSafeListener(fileInputContainer, "fileInputContainer", "click", (event) => {
  if (userRole !== "sender") return;
  if (event.target === fileInput) return;
  fileInput.click();
});

addSafeListener(fileInputContainer, "fileInputContainer", "keydown", (event) => {
  if (userRole !== "sender") return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

addSafeListener(fileInputContainer, "fileInputContainer", "dragover", (event) => {
  if (userRole !== "sender") return;
  event.preventDefault();
  fileInputContainer.classList.add("drag-active");
});

addSafeListener(fileInputContainer, "fileInputContainer", "dragleave", (event) => {
  if (userRole !== "sender") return;
  if (fileInputContainer.contains(event.relatedTarget)) return;
  fileInputContainer.classList.remove("drag-active");
});

addSafeListener(fileInputContainer, "fileInputContainer", "drop", (event) => {
  if (userRole !== "sender") return;
  event.preventDefault();
  fileInputContainer.classList.remove("drag-active");
  const droppedFiles = event.dataTransfer ? event.dataTransfer.files : null;
  if (!droppedFiles || droppedFiles.length === 0) return;

  if (typeof DataTransfer === "function") {
    const dataTransfer = new DataTransfer();
    Array.from(droppedFiles).forEach((file) => {
      dataTransfer.items.add(file);
    });
    fileInput.files = dataTransfer.files;
  } else {
    return;
  }

  processSelectedFiles(fileInput.files);
});

addSafeListener(sendFileBtn, "sendFileBtn", "click", async () => {
  await sendFiles(fileInput.files);
});

addSafeListener(cancelTransferBtn, "cancelTransferBtn", "click", async () => {
  await cancelTransfer();
});

addSafeListener(retryTransferBtn, "retryTransferBtn", "click", async () => {
  if (!manualRetryContext) return;
  await runSendQueue(manualRetryContext.files, manualRetryContext.startIndex);
});

addSafeListener(resetTransferBtn, "resetTransferBtn", "click", () => {
  resetTransferUi();
  setInlineStatus("");
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

  await createPeerConnection();

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
    await createPeerConnection();
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
setTransferUiState(TRANSFER_UI_STATES.CONNECTED);
renderFilePreview([]);
updateSendFileButtonState();

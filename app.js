// ============================================================
// FLOW — app.js
// All client-side functionality: voice capture, text capture,
// Claude categorization (via /api/categorize), persistent storage
// (via /api/items, backed by Postgres), login digest modal, and
// UI rendering.
// ============================================================

// ---- EASY-TO-EDIT CONFIG -----------------------------------
// Change the user's display name here. Used in greeting + modal + sidebar.
const USER_NAME = "Kevin";
// --------------------------------------------------------------

// In-memory cache of items fetched from the database — refreshed
// on load and whenever a new item is confirmed.
let cachedItems = [];

// ---- DOM REFERENCES ----
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const inboxBadge = document.getElementById("inboxBadge");
const userNameLabel = document.getElementById("userNameLabel");
const userAvatar = document.getElementById("userAvatar");
const greetingHeading = document.getElementById("greetingHeading");

const voiceBtn = document.getElementById("voiceBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const voiceSpinner = document.getElementById("voiceSpinner");
const voiceHint = document.getElementById("voiceHint");

const textForm = document.getElementById("textForm");
const textInput = document.getElementById("textInput");

const resultCard = document.getElementById("resultCard");
const resultCategory = document.getElementById("resultCategory");
const resultPriority = document.getElementById("resultPriority");
const resultText = document.getElementById("resultText");
const resultTimestamp = document.getElementById("resultTimestamp");
const editBtn = document.getElementById("editBtn");
const dismissBtn = document.getElementById("dismissBtn");
const confirmBtn = document.getElementById("confirmBtn");

const statusBanner = document.getElementById("statusBanner");
const recentList = document.getElementById("recentList");

const modalBackdrop = document.getElementById("modalBackdrop");
const digestGreeting = document.getElementById("digestGreeting");
const digestDate = document.getElementById("digestDate");
const statCompleted = document.getElementById("statCompleted");
const statNew = document.getElementById("statNew");
const statWaiting = document.getElementById("statWaiting");
const statBlocked = document.getElementById("statBlocked");
const dismissModalBtn = document.getElementById("dismissModalBtn");
const startCapturingBtn = document.getElementById("startCapturingBtn");

// Holds the currently pending (unconfirmed) captured item
let pendingItem = null;

// ============================================================
// INITIALIZATION
// ============================================================
async function init() {
  userNameLabel.textContent = USER_NAME;
  userAvatar.textContent = USER_NAME.charAt(0).toUpperCase();
  greetingHeading.textContent = `What's on your mind, ${USER_NAME}?`;

  setupVoiceRecognition();
  bindEvents();

  await fetchItems();
  renderInboxBadge();
  renderRecentCaptures();
  showDigestModal();
}

// ============================================================
// DATABASE HELPERS (via /api/items, backed by Postgres)
// ============================================================
async function fetchItems() {
  try {
    const response = await fetch("/api/items");
    if (!response.ok) throw new Error("Failed to fetch items");
    cachedItems = await response.json();
  } catch (err) {
    console.error("fetchItems error:", err);
    cachedItems = [];
  }
}

async function postItem(item) {
  const response = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error("Failed to save item");
}

// ============================================================
// LOGIN DIGEST MODAL — reads real stats from the database
// ============================================================
function showDigestModal() {
  const items = cachedItems;

  const completed = items.filter((i) => i.status === "Completed").length;
  const newToday = items.filter((i) => isToday(i.timestamp)).length;
  const waiting = items.filter((i) => i.status === "Waiting").length;
  const blocked = items.filter((i) => i.status === "Blocked").length;

  digestGreeting.textContent = `Welcome back, ${USER_NAME}`;
  digestDate.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  statCompleted.textContent = completed;
  statNew.textContent = newToday;
  statWaiting.textContent = waiting;
  statBlocked.textContent = blocked;

  modalBackdrop.classList.add("visible");
}

function isToday(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function closeDigestModal() {
  modalBackdrop.classList.remove("visible");
}

// ============================================================
// INBOX BADGE — count of unread items
// ============================================================
function renderInboxBadge() {
  const unread = cachedItems.filter((i) => !i.read).length;
  inboxBadge.textContent = unread;
  inboxBadge.classList.toggle("hidden", unread === 0);
}

// ============================================================
// SIDEBAR TOGGLE (mobile)
// ============================================================
function bindEvents() {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });

  dismissModalBtn.addEventListener("click", closeDigestModal);
  startCapturingBtn.addEventListener("click", closeDigestModal);

  voiceBtn.addEventListener("click", handleVoiceButtonClick);

  textForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = textInput.value.trim();
    if (!value) return;
    textInput.value = "";
    processCapture(value);
  });

  editBtn.addEventListener("click", toggleEditResult);
  dismissBtn.addEventListener("click", dismissResultCard);
  confirmBtn.addEventListener("click", confirmResultCard);
}

// ============================================================
// WEB SPEECH API — VOICE CAPTURE
// ============================================================
let recognition = null;
let isRecording = false;

function setupVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceHint.textContent = "Voice not supported in this browser — please type instead";
    voiceBtn.disabled = true;
    voiceBtn.style.opacity = "0.5";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    processCapture(transcript);
  };

  recognition.onerror = () => {
    stopRecordingUI();
    showStatus("Could not capture audio — please try again", true);
  };

  recognition.onend = () => {
    if (isRecording) {
      // recognition ended without a result (silence) — reset UI
      stopRecordingUI();
    }
  };
}

function handleVoiceButtonClick() {
  if (!recognition) return;

  if (!isRecording) {
    startRecordingUI();
    try {
      recognition.start();
    } catch (e) {
      stopRecordingUI();
    }
  } else {
    recognition.stop();
    stopRecordingUI();
  }
}

function startRecordingUI() {
  isRecording = true;
  voiceBtn.classList.add("recording");
  micIcon.style.display = "none";
  stopIcon.style.display = "block";
  voiceSpinner.style.display = "none";
  voiceHint.textContent = "Tap to stop recording";
}

function stopRecordingUI() {
  isRecording = false;
  voiceBtn.classList.remove("recording");
  stopIcon.style.display = "none";
}

function showProcessingUI() {
  micIcon.style.display = "none";
  stopIcon.style.display = "none";
  voiceSpinner.style.display = "block";
  voiceHint.textContent = "Processing your thought...";
}

function resetVoiceUI() {
  micIcon.style.display = "block";
  stopIcon.style.display = "none";
  voiceSpinner.style.display = "none";
  voiceHint.textContent = "Tap to start speaking";
}

// ============================================================
// CAPTURE PROCESSING — sends text to Claude API for categorization
// ============================================================
async function processCapture(text) {
  showProcessingUI();
  showStatus("Processing your thought...", false);
  hideResultCard();

  try {
    const response = await fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error("API error");

    const data = await response.json();

    pendingItem = {
      id: Date.now(),
      text: text,
      summary: data.summary,
      category: data.category,
      priority: data.priority,
      status: "New",
      timestamp: new Date().toISOString(),
      read: false,
    };

    showResultCard(pendingItem);
    showStatus("", false);
  } catch (err) {
    showStatus("Could not process — please try again", true);
  } finally {
    resetVoiceUI();
  }
}

function showStatus(message, isError) {
  statusBanner.textContent = message;
  statusBanner.classList.toggle("error", isError);
}

// ============================================================
// RESULT CARD
// ============================================================
function categoryClass(category) {
  return "cat-" + category.toLowerCase().replace(/\s+/g, "-");
}

function showResultCard(item) {
  resultCategory.textContent = item.category;
  resultCategory.className = "badge-pill " + categoryClass(item.category);

  resultPriority.textContent = item.priority;
  resultPriority.className = "badge-pill priority " + item.priority.toLowerCase();

  resultText.textContent = item.text;
  resultText.contentEditable = "false";

  resultTimestamp.textContent = new Date(item.timestamp).toLocaleString();

  resultCard.classList.add("visible");
}

function hideResultCard() {
  resultCard.classList.remove("visible");
}

function toggleEditResult() {
  const isEditable = resultText.contentEditable === "true";
  resultText.contentEditable = isEditable ? "false" : "true";
  if (!isEditable) {
    resultText.focus();
    editBtn.textContent = "Done";
  } else {
    editBtn.textContent = "Edit";
    if (pendingItem) pendingItem.text = resultText.textContent;
  }
}

function dismissResultCard() {
  pendingItem = null;
  hideResultCard();
  resetVoiceUI();
}

async function confirmResultCard() {
  if (!pendingItem) return;

  // Capture any inline edit before saving
  pendingItem.text = resultText.textContent;

  try {
    await postItem(pendingItem);
    cachedItems.unshift(pendingItem);
    renderInboxBadge();
    renderRecentCaptures();
  } catch (err) {
    showStatus("Could not save — please try again", true);
  }

  pendingItem = null;
  hideResultCard();
  resetVoiceUI();
}

// ============================================================
// RECENT CAPTURES LIST
// ============================================================
function renderRecentCaptures() {
  const items = cachedItems.slice(0, 5);

  if (items.length === 0) {
    recentList.innerHTML = `<p class="empty-state">Nothing captured yet — tap the button above to get started</p>`;
    return;
  }

  recentList.innerHTML = items
    .map((item) => {
      const truncated =
        item.text.length > 60 ? item.text.slice(0, 60) + "…" : item.text;
      const time = new Date(item.timestamp).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      return `
        <div class="recent-item">
          <span class="priority-dot ${item.priority.toLowerCase()}"></span>
          <div class="recent-item-content">
            <p class="recent-item-text">${escapeHtml(truncated)}</p>
            <div class="recent-item-meta">
              <span class="badge-pill ${categoryClass(item.category)}" style="font-size:10px;padding:2px 8px;">${item.category}</span>
              <span>${time}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", init);

// ============================================================
// FLOW — app.js
// Voice/text capture, Claude categorization, auto-save to
// Postgres, login digest modal, and recent captures list.
// ============================================================

let cachedItems = [];

// ---- DOM REFERENCES ----
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const inboxBadge = document.getElementById("inboxBadge");
const greetingHeading = document.getElementById("greetingHeading");

const voiceBtn = document.getElementById("voiceBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const voiceSpinner = document.getElementById("voiceSpinner");
const voiceHint = document.getElementById("voiceHint");

const textForm = document.getElementById("textForm");
const textInput = document.getElementById("textInput");

const statusBanner = document.getElementById("statusBanner");
const recentList = document.getElementById("recentList");


// ============================================================
// INITIALIZATION
// ============================================================
async function init() {
  const session = getSession();
  greetingHeading.textContent = `What's on your mind, ${session ? session.name : ""}?`;

  await warmMicPermission();
  setupVoiceRecognition();
  bindEvents();
  bindRecentListEvents();

  await fetchItems();
  renderInboxBadge();
  renderRecentCaptures();
}

// ============================================================
// DATABASE HELPERS
// ============================================================
async function fetchItems() {
  try {
    const session = getSession();
    const url = session ? `/api/items?created_by=${session.id}` : "/api/items";
    const response = await fetch(url);
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
// INBOX BADGE — unread count from DB
// ============================================================
async function renderInboxBadge() {
  const session = getSession();
  if (!session) return;
  try {
    const res = await fetch(`/api/unread?user_id=${session.id}`);
    if (!res.ok) return;
    const { unread } = await res.json();
    inboxBadge.textContent = unread;
    inboxBadge.classList.toggle("hidden", unread === 0);
  } catch { /* silent */ }
}

// ============================================================
// SIDEBAR TOGGLE (mobile)
// ============================================================
function bindEvents() {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });

  voiceBtn.addEventListener("click", handleVoiceButtonClick);

  textForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = textInput.value.trim();
    if (!value) return;
    textInput.value = "";
    processCapture(value);
  });
}

// ============================================================
// MIC PERMISSION — warm up once so repeated taps don't re-prompt
// ============================================================
let _micStream = null;

async function warmMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Keep alive — SpeechRecognition reuses this grant without prompting
  } catch {
    // User denied or not available — SpeechRecognition will handle it
  }
}

// ============================================================
// WEB SPEECH API — VOICE CAPTURE
// ============================================================
let recognition   = null;
let isRecording   = false;
let finalTranscript   = "";
let interimTranscript = "";
let _recognitionActive = false; // guard against double-start

function setupVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceHint.textContent = "Voice not supported in this browser — please type instead";
    voiceBtn.disabled = true;
    voiceBtn.style.opacity = "0.5";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += text + " ";
      } else {
        interimTranscript += text;
      }
    }
    // Show live transcript in the hint area
    const display = (finalTranscript + interimTranscript).trim();
    if (display) {
      voiceHint.textContent = display;
      voiceHint.classList.add("transcript-live");
    }
    // Actively speaking — remove the pause indicator
    voiceBtn.classList.remove("recording-paused");
    voiceBtn.classList.add("recording");
  };

  recognition.onspeechend = () => {
    // Speech paused — soften the animation but keep recording
    if (isRecording) {
      voiceBtn.classList.add("recording-paused");
    }
  };

  recognition.onerror = (event) => {
    // "no-speech" is normal during pauses — don't treat as fatal
    if (event.error === "no-speech") return;
    // "aborted" fires when we manually stop — ignore
    if (event.error === "aborted") return;
    stopRecordingUI();
    showStatus("Could not capture audio — please try again", true);
  };

  recognition.onend = () => {
    _recognitionActive = false;
    if (isRecording) {
      // Browser auto-stopped (silence / mobile timeout) — restart immediately
      voiceBtn.classList.add("recording-paused");
      try {
        recognition.start();
        _recognitionActive = true;
      } catch { /* already restarting */ }
    }
  };
}

function handleVoiceButtonClick() {
  if (!recognition) return;

  if (!isRecording) {
    finalTranscript   = "";
    interimTranscript = "";
    startRecordingUI();
    if (!_recognitionActive) {
      try {
        recognition.start();
        _recognitionActive = true;
      } catch (e) {
        stopRecordingUI();
      }
    }
  } else {
    // User tapped stop — commit whatever we have
    isRecording = false;
    _recognitionActive = false;
    try { recognition.stop(); } catch { /* already stopped */ }

    const captured = (finalTranscript + interimTranscript).trim();
    stopRecordingUI();
    if (captured) {
      processCapture(captured);
    }
    finalTranscript   = "";
    interimTranscript = "";
  }
}

function startRecordingUI() {
  isRecording = true;
  voiceBtn.classList.add("recording");
  voiceBtn.classList.remove("recording-paused");
  micIcon.style.display     = "none";
  stopIcon.style.display    = "block";
  voiceSpinner.style.display = "none";
  voiceHint.textContent = "Listening… tap to stop";
  voiceHint.classList.remove("transcript-live");
}

function stopRecordingUI() {
  isRecording = false;
  voiceBtn.classList.remove("recording", "recording-paused");
  stopIcon.style.display = "none";
  voiceHint.classList.remove("transcript-live");
}

function showProcessingUI() {
  micIcon.style.display     = "none";
  stopIcon.style.display    = "none";
  voiceSpinner.style.display = "block";
  voiceHint.textContent = "Processing your thought...";
  voiceHint.classList.remove("transcript-live");
}

function resetVoiceUI() {
  micIcon.style.display     = "block";
  stopIcon.style.display    = "none";
  voiceSpinner.style.display = "none";
  voiceHint.textContent = "Tap to start speaking";
  voiceHint.classList.remove("transcript-live");
}

// ============================================================
// CAPTURE PROCESSING — categorize, auto-save, show toast
// ============================================================
async function processCapture(text) {
  showProcessingUI();
  showStatus("Processing your thought...", false);

  try {
    const response = await fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error("API error");

    const items = await response.json(); // always an array now

    const session = getSession();
    const baseTime = Date.now();
    const savedItems = [];

    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      const newItem = {
        id: baseTime + i,
        text: text,
        summary: d.summary,
        category: d.category,
        priority: d.priority,
        status: "Not Started",
        timestamp: new Date(baseTime + i).toISOString(),
        read: false,
        created_by: session ? session.id : null,
      };
      await postItem(newItem);
      savedItems.push(newItem);
    }

    // Prepend newest-first into the cache
    for (let i = savedItems.length - 1; i >= 0; i--) {
      cachedItems.unshift(savedItems[i]);
    }

    renderInboxBadge();
    renderRecentCaptures(savedItems.length);
    showStatus("", false);
    showToast(savedItems.length > 1 ? `Captured ${savedItems.length} items` : "Captured");
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
// TOAST NOTIFICATION
// ============================================================
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = "✓ " + message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2200);
}

// ============================================================
// RECENT CAPTURES LIST
// ============================================================
// newCount: how many of the top items just arrived (triggers stagger animation)
function renderRecentCaptures(newCount = 0) {
  const items = cachedItems.slice(0, 5);

  if (items.length === 0) {
    recentList.innerHTML = `<p class="empty-state">Nothing captured yet — tap the button above to get started</p>`;
    return;
  }

  recentList.innerHTML = items
    .map((item, idx) => {
      const displayText =
        item.summary && item.summary.length < item.text.length
          ? item.summary
          : item.text.length > 60 ? item.text.slice(0, 60) + "…" : item.text;
      const time = new Date(item.timestamp).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      const isNew = idx < newCount;
      const staggerStyle = isNew && newCount > 1 ? `style="animation-delay:${idx * 80}ms"` : "";

      return `
        <div class="recent-item${isNew && newCount > 1 ? " recent-item-stagger" : ""} recent-item-clickable"
             data-id="${item.id}" ${staggerStyle}>
          <span class="priority-dot ${item.priority.toLowerCase()}"></span>
          <div class="recent-item-content">
            <p class="recent-item-text">${escapeHtml(displayText)}</p>
            <div class="recent-item-meta">
              <span class="badge-pill ${categoryClass(item.category)} editable-badge"
                    data-id="${item.id}" data-field="category"
                    style="font-size:10px;padding:2px 8px;">${item.category}</span>
              <span class="badge-pill priority ${item.priority.toLowerCase()} editable-badge"
                    data-id="${item.id}" data-field="priority"
                    style="font-size:10px;padding:2px 8px;">${item.priority}</span>
              <span>${time}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// ============================================================
// RECENT CAPTURES — interaction (badge dropdown + detail modal)
// Single persistent delegated listener; safe across re-renders.
// ============================================================
function bindRecentListEvents() {
  recentList.addEventListener("click", (e) => {
    // Badge dropdown
    const badge = e.target.closest(".editable-badge[data-field]");
    if (badge) {
      e.stopPropagation();
      const id    = badge.dataset.id;
      const field = badge.dataset.field;
      const item  = cachedItems.find(i => String(i.id) === String(id));
      if (!item) return;
      const options = field === "category" ? ITEM_CATEGORIES : ITEM_PRIORITIES;
      openBadgeDropdown(badge, options, item[field], async (newVal) => {
        try {
          await fetch(`/api/items/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: newVal }),
          });
          item[field] = newVal;
          renderRecentCaptures();
        } catch (err) { console.error(err); }
      });
      return;
    }

    // Card click → detail modal
    const row = e.target.closest(".recent-item-clickable[data-id]");
    if (row) {
      const id   = row.dataset.id;
      const item = cachedItems.find(i => String(i.id) === String(id));
      if (item) openItemModal(item, () => renderRecentCaptures());
    }
  });
}

function categoryClass(category) {
  return "cat-" + category.toLowerCase().replace(/\s+/g, "-");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", () => initIdentity(init));

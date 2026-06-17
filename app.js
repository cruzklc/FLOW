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
  bindRecentSectionControls();

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
// MIC PERMISSION — iOS-aware permission flow
// ============================================================
const MIC_ASKED_KEY = "flow_mic_asked"; // set after first prompt
let _micStream = null;
let _micGranted = false;

// Check current permission state without prompting
async function getMicPermissionState() {
  if (!navigator.permissions) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state; // "granted" | "denied" | "prompt"
  } catch {
    return "unknown";
  }
}

// Show the pre-permission explainer (first time only), then request
async function warmMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const state = await getMicPermissionState();
  if (state === "granted") {
    // Already have permission — warm the stream silently
    await _requestMicStream();
    return;
  }
  if (state === "denied") {
    // Don't pre-request on load if already denied — let the button flow handle it
    return;
  }

  // "prompt" or "unknown" — show explainer if we haven't asked before
  const alreadyAsked = localStorage.getItem(MIC_ASKED_KEY) === "1";
  if (!alreadyAsked) {
    showMicExplainerModal();
  }
}

async function _requestMicStream() {
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _micGranted = true;
    localStorage.setItem(MIC_ASKED_KEY, "1");
  } catch {
    _micGranted = false;
    localStorage.setItem(MIC_ASKED_KEY, "1");
  }
}

// ---- EXPLAINER MODAL (shown once before first iOS prompt) ----
function showMicExplainerModal() {
  const existing = document.getElementById("micExplainerBackdrop");
  if (existing) return;

  const backdrop = document.createElement("div");
  backdrop.id = "micExplainerBackdrop";
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal mic-modal">
      <div class="mic-modal-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M12 1a4 4 0 00-4 4v6a4 4 0 008 0V5a4 4 0 00-4-4z" stroke="currentColor" stroke-width="1.8"/>
          <path d="M19 10v1a7 7 0 01-14 0v-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M12 18v4M8 22h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>Enable voice capture</h2>
      <p class="mic-modal-sub">FLOW needs microphone access to capture your voice notes. Tap <strong>Continue</strong> and then <strong>Allow</strong> on the next prompt.</p>
      <div class="modal-actions">
        <button class="btn-secondary" id="micExplainerSkip">Use text instead</button>
        <button class="btn-primary" id="micExplainerContinue">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("visible"));

  document.getElementById("micExplainerContinue").addEventListener("click", async () => {
    const el = document.getElementById("micExplainerBackdrop");
    if (el) el.remove();
    await _requestMicStream();
    if (!_micGranted) showMicDeniedModal();
  });

  document.getElementById("micExplainerSkip").addEventListener("click", () => {
    closeMicModal("micExplainerBackdrop");
    localStorage.setItem(MIC_ASKED_KEY, "1");
    focusTextInput();
  });
}

// ---- DENIED MODAL (shown when permission is blocked) ----
function showMicDeniedModal() {
  const existing = document.getElementById("micDeniedBackdrop");
  if (existing) return;

  const backdrop = document.createElement("div");
  backdrop.id = "micDeniedBackdrop";
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal mic-modal">
      <div class="mic-modal-icon mic-modal-icon--denied">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M12 1a4 4 0 00-4 4v6a4 4 0 008 0V5a4 4 0 00-4-4z" stroke="currentColor" stroke-width="1.8"/>
          <path d="M19 10v1a7 7 0 01-14 0v-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M12 18v4M8 22h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="3" y1="3" x2="21" y2="21" stroke="var(--badge-urgent)" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>Microphone access is turned off</h2>
      <p class="mic-modal-sub">Tap <strong>Try again</strong> — if the allow prompt doesn't appear, go to <strong>iPhone Settings → Privacy &amp; Security → Microphone</strong> and turn on <strong>Safari</strong>. Then come back and try again.</p>
      <div class="modal-actions">
        <button class="btn-secondary" id="micDeniedText">Use text instead</button>
        <button class="btn-primary" id="micDeniedRetry">Try again</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("visible"));

  document.getElementById("micDeniedRetry").addEventListener("click", async () => {
    const el = document.getElementById("micDeniedBackdrop");
    if (el) el.remove();
    // Always attempt getUserMedia — on iOS this re-triggers the native prompt
    await _requestMicStream();
    if (!_micGranted) {
      showMicDeniedModal();
      return;
    }
    // Permission granted — start recording since that was the user's original intent
    finalTranscript = "";
    interimTranscript = "";
    startRecordingUI();
    if (!_recognitionActive) {
      try {
        recognition.start();
        _recognitionActive = true;
      } catch (e) {
        stopRecordingUI();
        resetVoiceUI();
      }
    }
  });

  document.getElementById("micDeniedText").addEventListener("click", () => {
    closeMicModal("micDeniedBackdrop");
    focusTextInput();
  });
}

function closeMicModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("visible");
  setTimeout(() => { if (el.parentNode) el.remove(); }, 320);
}

function focusTextInput() {
  textInput?.focus();
  textInput?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (event.error === "no-speech") return;
    if (event.error === "aborted") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      stopRecordingUI();
      showMicDeniedModal();
      return;
    }
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

async function handleVoiceButtonClick() {
  if (!recognition) return;

  if (!isRecording) {
    // Check permission before starting
    const state = await getMicPermissionState();
    if (state === "denied") {
      showMicDeniedModal();
      return;
    }
    if (state === "prompt" && !localStorage.getItem(MIC_ASKED_KEY)) {
      showMicExplainerModal();
      return;
    }

    finalTranscript   = "";
    interimTranscript = "";
    startRecordingUI();
    if (!_recognitionActive) {
      try {
        recognition.start();
        _recognitionActive = true;
      } catch (e) {
        stopRecordingUI();
        // SpeechRecognition itself was denied
        showMicDeniedModal();
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
const RECENT_DEFAULT = 5;
const RECENT_MORE    = 10;
const RECENT_COLLAPSED_KEY = "flow_recent_collapsed";
const RECENT_EXPANDED_KEY  = "flow_recent_expanded";

let recentExpanded = false; // "View more" open state (resets on reload)

const recentBody          = document.getElementById("recentBody");
const recentOverflow      = document.getElementById("recentOverflow");
const recentOverflowInner = document.getElementById("recentOverflowInner");
const recentViewMoreBtn   = document.getElementById("recentViewMoreBtn");
const recentViewMoreLabel = document.getElementById("recentViewMoreLabel");
const recentTotalBadge    = document.getElementById("recentTotalBadge");
const recentCollapseBtn   = document.getElementById("recentCollapseBtn");

function isRecentCollapsed() {
  return localStorage.getItem(RECENT_COLLAPSED_KEY) === "1";
}

function buildRecentItem(item, isNew, idx, newCount) {
  const displayText =
    item.summary && item.summary.length < item.text.length
      ? item.summary
      : item.text.length > 60 ? item.text.slice(0, 60) + "…" : item.text;
  const time = new Date(item.timestamp).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
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
    </div>`;
}

function renderRecentCaptures(newCount = 0) {
  const total = cachedItems.length;
  const collapsed = isRecentCollapsed();

  // Total count badge (always visible)
  if (total > 0) {
    recentTotalBadge.textContent = total;
    recentTotalBadge.style.display = "";
  } else {
    recentTotalBadge.style.display = "none";
  }

  // Collapse toggle state
  recentBody.classList.toggle("collapsed", collapsed);
  recentCollapseBtn.classList.toggle("rotated", collapsed);

  if (total === 0) {
    recentList.innerHTML = `<p class="empty-state">Nothing captured yet — tap the button above to get started</p>`;
    recentOverflow.innerHTML = "";
    recentViewMoreBtn.style.display = "none";
    return;
  }

  // First 5 items
  const first = cachedItems.slice(0, RECENT_DEFAULT);
  recentList.innerHTML = first
    .map((item, idx) => buildRecentItem(item, idx < newCount, idx, newCount))
    .join("");

  // Overflow items (6–15)
  const extra = cachedItems.slice(RECENT_DEFAULT, RECENT_DEFAULT + RECENT_MORE);
  if (extra.length === 0) {
    recentOverflowInner.innerHTML = "";
    recentOverflow.classList.remove("open");
    recentViewMoreBtn.style.display = "none";
    recentExpanded = false;
    return;
  }

  recentOverflowInner.innerHTML = extra
    .map((item, idx) => buildRecentItem(item, false, idx, 0))
    .join("");
  recentOverflow.classList.toggle("open", recentExpanded);

  recentViewMoreBtn.style.display = "";
  const chevron = recentViewMoreBtn.querySelector(".view-more-chevron");
  if (recentExpanded) {
    recentViewMoreLabel.textContent = "Show less";
    chevron.style.transform = "rotate(180deg)";
  } else {
    recentViewMoreLabel.textContent = `View ${extra.length} more`;
    chevron.style.transform = "";
  }
}

function bindRecentSectionControls() {
  // Collapse/expand the whole section
  recentCollapseBtn.addEventListener("click", () => {
    const nowCollapsed = !isRecentCollapsed();
    localStorage.setItem(RECENT_COLLAPSED_KEY, nowCollapsed ? "1" : "0");
    renderRecentCaptures();
  });

  // View more / show less
  recentViewMoreBtn.addEventListener("click", () => {
    recentExpanded = !recentExpanded;
    renderRecentCaptures();
    if (!recentExpanded) {
      // Scroll back up so the first 5 are in view
      recentList.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

// ============================================================
// RECENT CAPTURES — interaction (badge dropdown + detail modal)
// Single persistent delegated listener; safe across re-renders.
// ============================================================
function bindRecentListEvents() {
  // Listen on the whole body so overflow items work too
  recentBody.addEventListener("click", (e) => {
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

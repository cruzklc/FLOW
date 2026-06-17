// ============================================================
// FLOW — inbox.js  (DB-backed)
// Threads and messages stored in Postgres.
// Any user can message any other user; recipient sees it on
// next load or on the 30s poll.
// ============================================================

// ---- STATE ----
let threads = [];
let activeThreadId = null;
let allItems = [];
let allUsers = [];
let pollTimer = null;

// ---- DOM ----
const inboxBadge     = document.getElementById("inboxBadge");
const sidebarToggle  = document.getElementById("sidebarToggle");
const sidebar        = document.getElementById("sidebar");
const threadList     = document.getElementById("threadList");
const threadSearch   = document.getElementById("threadSearch");
const newThreadBtn   = document.getElementById("newThreadBtn");

const threadPanel       = document.getElementById("threadPanel");
const conversationPanel = document.getElementById("conversationPanel");
const backBtn           = document.getElementById("backBtn");
const conversationHeader = document.getElementById("conversationHeader");
const messagesWrap      = document.getElementById("messagesWrap");
const messageInputWrap  = document.getElementById("messageInputWrap");
const messageInput      = document.getElementById("messageInput");
const sendMessageBtn    = document.getElementById("sendMessageBtn");
const inboxEmptyState   = document.getElementById("inboxEmptyState");

const newThreadBackdrop  = document.getElementById("newThreadBackdrop");
const itemLinkSelect     = document.getElementById("itemLinkSelect");
const firstMessageInput  = document.getElementById("firstMessageInput");
const cancelNewThreadBtn = document.getElementById("cancelNewThreadBtn");
const createThreadBtn    = document.getElementById("createThreadBtn");

// ============================================================
// INIT
// ============================================================
async function init() {
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("open"));

  await Promise.all([fetchThreads(), fetchItems(), fetchUsers()]);
  populateItemLinkSelect();
  populateRecipientSelect();
  renderThreadList();
  renderInboxBadge();
  bindEvents();

  // Poll for new messages every 30 seconds
  pollTimer = setInterval(pollForUpdates, 30000);
}

// ============================================================
// API HELPERS
// ============================================================
async function fetchThreads() {
  const session = getSession();
  if (!session) return;
  try {
    const res = await fetch(`/api/threads?user_id=${session.id}`);
    if (res.ok) threads = await res.json();
  } catch (err) {
    console.error("fetchThreads error:", err);
  }
}

async function fetchMessages(threadId) {
  const session = getSession();
  const url = `/api/threads/${threadId}/messages${session ? `?user_id=${session.id}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

async function fetchItems() {
  try {
    const res = await fetch("/api/items");
    if (res.ok) allItems = await res.json();
  } catch { allItems = []; }
}

async function fetchUsers() {
  try {
    const res = await fetch("/api/users");
    if (res.ok) allUsers = await res.json();
  } catch { allUsers = []; }
}

async function pollForUpdates() {
  const session = getSession();
  if (!session) return;
  try {
    const res = await fetch(`/api/threads?user_id=${session.id}`);
    if (!res.ok) return;
    threads = await res.json();
    renderInboxBadge();
    renderThreadList(threadSearch.value);

    // If a thread is open, refresh its messages silently
    if (activeThreadId) {
      const msgs = await fetchMessages(activeThreadId);
      const wasAtBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 60;
      const existingCount = messagesWrap.querySelectorAll(".message-bubble-wrap").length;
      if (msgs.length > existingCount) {
        const newMsgs = msgs.slice(existingCount);
        newMsgs.forEach((m) => appendMessageBubble(m, true));
        if (wasAtBottom) scrollToBottom();
      }
    }
  } catch { /* silent */ }
}

// ============================================================
// INBOX BADGE
// ============================================================
function renderInboxBadge() {
  const total = threads.reduce((n, t) => n + (t.unread_count || 0), 0);
  inboxBadge.textContent = total;
  inboxBadge.classList.toggle("hidden", total === 0);
}

// ============================================================
// POPULATE SELECTS
// ============================================================
function populateItemLinkSelect() {
  // clear existing options except the placeholder
  while (itemLinkSelect.options.length > 1) itemLinkSelect.remove(1);
  allItems.slice(0, 40).forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    const label = item.summary || item.text;
    opt.textContent = `[${item.category}] ${label.length > 60 ? label.slice(0, 60) + "…" : label}`;
    itemLinkSelect.appendChild(opt);
  });
}

function populateRecipientSelect() {
  const select = document.getElementById("recipientSelect");
  if (!select) return;
  const session = getSession();
  // clear except placeholder
  while (select.options.length > 1) select.remove(1);
  allUsers
    .filter((u) => !session || u.id !== session.id)
    .forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.name;
      select.appendChild(opt);
    });
}

// ============================================================
// RENDER THREAD LIST
// ============================================================
function renderThreadList(filterText = "") {
  const query = filterText.toLowerCase().trim();
  const session = getSession();

  const filtered = query
    ? threads.filter(
        (t) =>
          (t.item_summary || t.title || "").toLowerCase().includes(query) ||
          (t.last_message?.text || "").toLowerCase().includes(query)
      )
    : threads;

  if (filtered.length === 0) {
    threadList.innerHTML = `
      <div class="thread-list-empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M22 12h-6l-2 3h-4l-2-3H2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <p>${query ? "No conversations match your search" : "No conversations yet"}</p>
        ${!query ? `<button class="start-btn" id="emptyStartBtn">Start a conversation</button>` : ""}
      </div>
    `;
    if (!query) {
      document.getElementById("emptyStartBtn")?.addEventListener("click", openNewThreadModal);
    }
    return;
  }

  threadList.innerHTML = "";
  filtered.forEach((thread) => {
    const hasUnread = thread.unread_count > 0;
    const isActive = thread.id === activeThreadId;
    const displayTitle = thread.item_summary || thread.title || "Conversation";
    const category = thread.item_category || "FYI";
    const lastMsg = thread.last_message;

    // Participants other than self
    const others = (thread.participants || [])
      .filter((p) => !session || p.id !== session.id)
      .map((p) => p.name)
      .join(", ");

    const item = document.createElement("div");
    item.className = ["thread-item", isActive ? "active" : "", hasUnread ? "unread" : ""]
      .filter(Boolean).join(" ");
    item.dataset.id = thread.id;

    item.innerHTML = `
      <div class="thread-item-top">
        <span class="thread-item-title">${escapeHtml(displayTitle)}</span>
        <span class="thread-item-time">${lastMsg ? relativeTime(lastMsg.created_at) : ""}</span>
      </div>
      <div class="thread-item-meta">
        <span class="badge-pill ${categoryClass(category)}" style="font-size:9px;padding:2px 7px;">${category}</span>
        <span class="thread-preview">${lastMsg ? escapeHtml((lastMsg.sender_name || "?") + ": " + lastMsg.text) : "No messages yet"}</span>
        ${hasUnread ? `<span class="unread-dot"></span>` : ""}
      </div>
      ${others ? `<div class="thread-participants-line">with ${escapeHtml(others)}</div>` : ""}
    `;

    item.addEventListener("click", () => openThread(thread.id));
    threadList.appendChild(item);
  });
}

// ============================================================
// OPEN THREAD
// ============================================================
async function openThread(threadId) {
  activeThreadId = threadId;

  // Find thread in cache for header render (optimistic)
  const thread = threads.find((t) => t.id === threadId);

  renderConversationHeader(thread);
  messagesWrap.innerHTML = `<div class="inbox-loading">Loading messages…</div>`;
  inboxEmptyState.style.display = "none";
  messageInputWrap.style.display = "block";

  // Mobile: slide
  if (window.innerWidth <= 900) {
    threadPanel.classList.add("slide-out");
    conversationPanel.classList.add("slide-in");
  }

  try {
    const messages = await fetchMessages(threadId);
    messagesWrap.innerHTML = "";
    if (messages.length === 0) {
      messagesWrap.innerHTML = `
        <div class="inbox-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p>No messages yet — send the first one below</p>
        </div>
      `;
    } else {
      messages.forEach((m) => appendMessageBubble(m, false));
    }
    scrollToBottom();
    messageInput.focus();

    // Update unread in local cache + re-render badge/list
    if (thread) thread.unread_count = 0;
    renderInboxBadge();
    renderThreadList(threadSearch.value);
  } catch (err) {
    messagesWrap.innerHTML = `<div class="inbox-loading" style="color:var(--priority-high)">Failed to load messages</div>`;
  }
}

// ============================================================
// RENDER CONVERSATION HEADER
// ============================================================
function renderConversationHeader(thread) {
  if (!thread) { conversationHeader.innerHTML = ""; return; }
  const session = getSession();
  const others = (thread.participants || []).filter((p) => !session || p.id !== session.id);

  const avatars = others.map((p) =>
    `<div class="participant-avatar" style="background:var(--primary-dim)">${escapeHtml(p.name[0].toUpperCase())}</div>`
  ).join("");

  const participantNames = others.map((p) => p.name).join(" & ");
  const displayTitle = thread.item_summary || thread.title || "Conversation";
  const category = thread.item_category || "FYI";

  conversationHeader.innerHTML = `
    <div class="conversation-header-inner">
      <div class="conversation-header-left">
        <div class="conversation-participants">
          ${avatars}
          <span class="participants-label">${escapeHtml(participantNames || "No other participants")}</span>
        </div>
        <div class="linked-item-row">
          <span class="linked-item-label">Re:</span>
          <span class="linked-item-summary">${escapeHtml(displayTitle)}</span>
          <span class="badge-pill ${categoryClass(category)}" style="font-size:9px;padding:2px 7px;">${category}</span>
          ${thread.item_id ? `<a href="dashboard.html" class="view-in-dash-link">View in Dashboard →</a>` : ""}
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// MESSAGE BUBBLE
// ============================================================
function appendMessageBubble(msg, animate = true) {
  const session = getSession();
  const isMe = session && msg.sender_id === session.id;
  const wrap = document.createElement("div");
  wrap.className = `message-bubble-wrap ${isMe ? "from-me" : "from-them"}`;
  if (!animate) wrap.style.animation = "none";

  wrap.innerHTML = `
    <span class="bubble-sender">${escapeHtml(msg.sender_name || "Unknown")}</span>
    <div class="message-bubble">${escapeHtml(msg.text)}</div>
    <span class="bubble-time">${relativeTime(msg.created_at)}</span>
  `;

  const emptyEl = messagesWrap.querySelector(".inbox-empty-state, .inbox-loading");
  if (emptyEl) emptyEl.remove();

  messagesWrap.appendChild(wrap);
}

function scrollToBottom() {
  requestAnimationFrame(() => { messagesWrap.scrollTop = messagesWrap.scrollHeight; });
}

// ============================================================
// SEND MESSAGE
// ============================================================
async function sendMessage() {
  const text = messageInput.value.trim();
  const session = getSession();
  if (!text || !activeThreadId || !session) return;

  messageInput.value = "";
  messageInput.style.height = "auto";
  sendMessageBtn.disabled = true;

  try {
    const res = await fetch(`/api/threads/${activeThreadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender_id: session.id, text }),
    });
    if (!res.ok) throw new Error("Send failed");
    const msg = await res.json();
    appendMessageBubble(msg, true);
    scrollToBottom();
    renderThreadList(threadSearch.value);
  } catch (err) {
    console.error("sendMessage error:", err);
    messageInput.value = text; // restore on failure
  } finally {
    sendMessageBtn.disabled = false;
    messageInput.focus();
  }
}

// ============================================================
// NEW THREAD MODAL
// ============================================================
function openNewThreadModal() {
  if (firstMessageInput) firstMessageInput.value = "";
  newThreadBackdrop.classList.add("visible");
  setTimeout(() => firstMessageInput?.focus(), 200);
}

function closeNewThreadModal() {
  newThreadBackdrop.classList.remove("visible");
}

async function createThread() {
  const firstMsg = firstMessageInput.value.trim();
  const session = getSession();
  if (!firstMsg || !session) { firstMessageInput?.focus(); return; }

  const recipientSelect = document.getElementById("recipientSelect");
  const recipientId = recipientSelect?.value ? parseInt(recipientSelect.value, 10) : null;
  if (!recipientId) {
    recipientSelect?.focus();
    return;
  }

  const selectedItemId = itemLinkSelect.value ? parseInt(itemLinkSelect.value, 10) : null;

  createThreadBtn.disabled = true;
  try {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        created_by: session.id,
        participant_ids: [recipientId],
        item_id: selectedItemId || null,
        first_message: firstMsg,
      }),
    });
    if (!res.ok) throw new Error("Failed to create thread");
    const { id } = await res.json();

    closeNewThreadModal();
    await fetchThreads();
    renderThreadList();
    openThread(id);
  } catch (err) {
    console.error("createThread error:", err);
  } finally {
    createThreadBtn.disabled = false;
  }
}

// ============================================================
// BIND EVENTS
// ============================================================
function bindEvents() {
  newThreadBtn.addEventListener("click", openNewThreadModal);
  cancelNewThreadBtn.addEventListener("click", closeNewThreadModal);
  newThreadBackdrop.addEventListener("click", (e) => {
    if (e.target === newThreadBackdrop) closeNewThreadModal();
  });
  createThreadBtn.addEventListener("click", createThread);

  threadSearch.addEventListener("input", (e) => renderThreadList(e.target.value));

  sendMessageBtn.addEventListener("click", sendMessage);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
  });

  backBtn.addEventListener("click", () => {
    threadPanel.classList.remove("slide-out");
    conversationPanel.classList.remove("slide-in");
    activeThreadId = null;
  });
}

// ============================================================
// HELPERS
// ============================================================
function relativeTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return "Yesterday";
  return `${d}d ago`;
}
function categoryClass(c) { return "cat-" + (c || "fyi").toLowerCase().replace(/\s+/g, "-"); }
function escapeHtml(str) {
  const d = document.createElement("div"); d.textContent = str || ""; return d.innerHTML;
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", () => initIdentity(init));

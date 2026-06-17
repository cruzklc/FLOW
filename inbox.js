// ============================================================
// FLOW — inbox.js
// Two-panel inbox: thread list (left) + conversation (right).
// Threads stored in localStorage under "flow_inbox_threads".
// Messages are Kevin ↔ Amit, linked to captured item IDs.
// ============================================================

const STORAGE_KEY = "flow_inbox_threads";
function getCurrentUserName() {
  return getSession()?.name || "";
}

// ---- STATE ----
let threads = [];
let activeThreadId = null;
let allItems = []; // fetched from /api/items for the link dropdown

// ---- DOM ----
const inboxBadge = document.getElementById("inboxBadge");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebar = document.getElementById("sidebar");
const threadList = document.getElementById("threadList");
const threadSearch = document.getElementById("threadSearch");
const newThreadBtn = document.getElementById("newThreadBtn");

const threadPanel = document.getElementById("threadPanel");
const conversationPanel = document.getElementById("conversationPanel");
const backBtn = document.getElementById("backBtn");
const conversationHeader = document.getElementById("conversationHeader");
const messagesWrap = document.getElementById("messagesWrap");
const messageInputWrap = document.getElementById("messageInputWrap");
const messageInput = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const inboxEmptyState = document.getElementById("inboxEmptyState");

const newThreadBackdrop = document.getElementById("newThreadBackdrop");
const itemLinkSelect = document.getElementById("itemLinkSelect");
const firstMessageInput = document.getElementById("firstMessageInput");
const cancelNewThreadBtn = document.getElementById("cancelNewThreadBtn");
const createThreadBtn = document.getElementById("createThreadBtn");

// ============================================================
// INIT
// ============================================================
async function init() {
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("open"));

  loadThreads();
  await fetchItems();
  populateItemLinkSelect();

  if (threads.length === 0) seedSampleThreads();

  renderThreadList();
  renderInboxBadge();
  bindEvents();
}

// ============================================================
// STORAGE
// ============================================================
function loadThreads() {
  try {
    threads = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    threads = [];
  }
}

function saveThreads() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

// ============================================================
// SEED SAMPLE DATA (first visit only)
// ============================================================
function seedSampleThreads() {
  const now = Date.now();
  threads = [
    {
      id: "thread_1",
      itemId: null,
      itemCategory: "Decision Needed",
      itemSummary: "Restructure engineering team org chart",
      messages: [
        {
          id: "msg_1",
          sender: "Amit",
          text: "I reviewed the org chart proposal. I think we should hold off on the senior IC track until Q3 — need more utilization data first.",
          timestamp: new Date(now - 2 * 3600000).toISOString(),
          read: true,
        },
        {
          id: "msg_2",
          sender: "Kevin",
          text: "Makes sense. Can you put together a one-pager on utilization metrics before Monday's call?",
          timestamp: new Date(now - 1.5 * 3600000).toISOString(),
          read: true,
        },
        {
          id: "msg_3",
          sender: "Amit",
          text: "On it. Should I include contractor hours or just FTE?",
          timestamp: new Date(now - 28 * 60000).toISOString(),
          read: false,
        },
      ],
    },
    {
      id: "thread_2",
      itemId: null,
      itemCategory: "Action Item",
      itemSummary: "Prepare metrics report for Monday team call",
      messages: [
        {
          id: "msg_4",
          sender: "Kevin",
          text: "Amit — can you pull the engagement numbers from last quarter? Need them for the deck.",
          timestamp: new Date(now - 5 * 3600000).toISOString(),
          read: true,
        },
        {
          id: "msg_5",
          sender: "Amit",
          text: "Got it. Do you want the breakdown by product line or just the aggregate?",
          timestamp: new Date(now - 4 * 3600000).toISOString(),
          read: true,
        },
        {
          id: "msg_6",
          sender: "Kevin",
          text: "Both if possible. Aggregate on the first slide, breakdown in the appendix.",
          timestamp: new Date(now - 3.8 * 3600000).toISOString(),
          read: true,
        },
        {
          id: "msg_7",
          sender: "Amit",
          text: "Done — I'll have it ready by Sunday evening.",
          timestamp: new Date(now - 3.5 * 3600000).toISOString(),
          read: true,
        },
      ],
    },
    {
      id: "thread_3",
      itemId: null,
      itemCategory: "Urgent",
      itemSummary: "Production bug affecting checkout flow",
      messages: [
        {
          id: "msg_8",
          sender: "Amit",
          text: "Heads up — we're seeing a 12% drop-off on the checkout page since the deploy this morning. Looking into it now.",
          timestamp: new Date(now - 45 * 60000).toISOString(),
          read: false,
        },
        {
          id: "msg_9",
          sender: "Amit",
          text: "Traced it to a race condition in the payment handler. Fix is ready, just needs your sign-off to deploy.",
          timestamp: new Date(now - 20 * 60000).toISOString(),
          read: false,
        },
      ],
    },
  ];
  saveThreads();
}

// ============================================================
// FETCH ITEMS from DB (for link dropdown)
// ============================================================
async function fetchItems() {
  try {
    const res = await fetch("/api/items");
    if (res.ok) allItems = await res.json();
  } catch {
    allItems = [];
  }
}

function populateItemLinkSelect() {
  allItems.slice(0, 30).forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    const label = item.summary || item.text;
    opt.textContent = `[${item.category}] ${label.length > 60 ? label.slice(0, 60) + "…" : label}`;
    itemLinkSelect.appendChild(opt);
  });
}

// ============================================================
// INBOX BADGE
// ============================================================
function getUnreadCount() {
  const myName = getCurrentUserName().toLowerCase();
  return threads.reduce((count, thread) => {
    return count + thread.messages.filter((m) => !m.read && m.sender.toLowerCase() !== myName).length;
  }, 0);
}

function renderInboxBadge() {
  const unread = getUnreadCount();
  inboxBadge.textContent = unread;
  inboxBadge.classList.toggle("hidden", unread === 0);
}

// ============================================================
// RENDER THREAD LIST
// ============================================================
function renderThreadList(filterText = "") {
  const query = filterText.toLowerCase().trim();
  const filtered = query
    ? threads.filter(
        (t) =>
          t.itemSummary.toLowerCase().includes(query) ||
          t.messages.some((m) => m.text.toLowerCase().includes(query))
      )
    : threads;

  if (filtered.length === 0) {
    threadList.innerHTML = `
      <div class="thread-list-empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M22 12h-6l-2 3h-4l-2-3H2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <p>${query ? "No conversations match your search" : "No conversations yet — messages about your captured items will appear here"}</p>
        ${!query ? `<button class="start-btn" id="emptyStartBtn">Start a conversation</button>` : ""}
      </div>
    `;
    if (!query) {
      document.getElementById("emptyStartBtn")?.addEventListener("click", openNewThreadModal);
    }
    return;
  }

  // Sort by most recent message
  const sorted = [...filtered].sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.timestamp || "";
    const bLast = b.messages[b.messages.length - 1]?.timestamp || "";
    return bLast.localeCompare(aLast);
  });

  threadList.innerHTML = "";
  sorted.forEach((thread) => {
    const lastMsg = thread.messages[thread.messages.length - 1];
    const hasUnread = thread.messages.some((m) => !m.read && m.sender !== CURRENT_USER);
    const isActive = thread.id === activeThreadId;

    const item = document.createElement("div");
    item.className = [
      "thread-item",
      isActive ? "active" : "",
      hasUnread ? "unread" : "",
    ]
      .filter(Boolean)
      .join(" ");
    item.dataset.id = thread.id;

    item.innerHTML = `
      <div class="thread-item-top">
        <span class="thread-item-title">${escapeHtml(thread.itemSummary)}</span>
        <span class="thread-item-time">${lastMsg ? relativeTime(lastMsg.timestamp) : ""}</span>
      </div>
      <div class="thread-item-meta">
        <span class="badge-pill ${categoryClass(thread.itemCategory)}" style="font-size:9px;padding:2px 7px;">${thread.itemCategory}</span>
        <span class="thread-preview">${lastMsg ? escapeHtml(lastMsg.sender + ": " + lastMsg.text) : "No messages yet"}</span>
        ${hasUnread ? `<span class="unread-dot"></span>` : ""}
      </div>
    `;

    item.addEventListener("click", () => openThread(thread.id));
    threadList.appendChild(item);
  });
}

// ============================================================
// OPEN THREAD
// ============================================================
function openThread(threadId) {
  activeThreadId = threadId;

  // Mark all incoming messages as read
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return;
  const myName = getCurrentUserName().toLowerCase();
  thread.messages.forEach((m) => {
    if (m.sender.toLowerCase() !== myName) m.read = true;
  });
  saveThreads();
  renderInboxBadge();
  renderThreadList(threadSearch.value);
  renderConversation(thread);

  // Mobile: slide panels
  if (window.innerWidth <= 900) {
    threadPanel.classList.add("slide-out");
    conversationPanel.classList.add("slide-in");
  }
}

// ============================================================
// RENDER CONVERSATION
// ============================================================
function renderConversation(thread) {
  // Header
  conversationHeader.innerHTML = `
    <div class="conversation-header-inner">
      <div class="conversation-header-left">
        <div class="conversation-participants">
          <div class="participant-avatar kevin">K</div>
          <div class="participant-avatar amit">A</div>
          <span class="participants-label">Kevin &amp; Amit</span>
        </div>
        ${thread.itemSummary ? `
        <div class="linked-item-row">
          <span class="linked-item-label">Re:</span>
          <span class="linked-item-summary">${escapeHtml(thread.itemSummary)}</span>
          <span class="badge-pill ${categoryClass(thread.itemCategory)}" style="font-size:9px;padding:2px 7px;">${thread.itemCategory}</span>
          ${thread.itemId ? `<a href="dashboard.html" class="view-in-dash-link">View in Dashboard →</a>` : ""}
        </div>` : ""}
      </div>
    </div>
  `;

  // Messages
  messagesWrap.innerHTML = "";
  if (thread.messages.length === 0) {
    messagesWrap.innerHTML = `
      <div class="inbox-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>No messages yet — send the first one below</p>
      </div>
    `;
  } else {
    thread.messages.forEach((msg) => appendMessageBubble(msg, false));
  }

  inboxEmptyState.style.display = "none";
  messageInputWrap.style.display = "block";
  messageInput.focus();
  scrollToBottom();
}

function appendMessageBubble(msg, animate = true) {
  const isKevin = msg.sender.toLowerCase() === getCurrentUserName().toLowerCase();
  const wrap = document.createElement("div");
  wrap.className = `message-bubble-wrap ${isKevin ? "from-kevin" : "from-amit"}`;
  if (!animate) wrap.style.animation = "none";

  wrap.innerHTML = `
    <span class="bubble-sender">${escapeHtml(msg.sender)}</span>
    <div class="message-bubble">${escapeHtml(msg.text)}</div>
    <span class="bubble-time">${relativeTime(msg.timestamp)}</span>
  `;

  // Remove empty state if present
  const emptyEl = messagesWrap.querySelector(".inbox-empty-state");
  if (emptyEl) emptyEl.remove();

  messagesWrap.appendChild(wrap);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  });
}

// ============================================================
// SEND MESSAGE
// ============================================================
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !activeThreadId) return;

  const thread = threads.find((t) => t.id === activeThreadId);
  if (!thread) return;

  const msg = {
    id: "msg_" + Date.now(),
    sender: getCurrentUserName(),
    sender_id: getSession()?.id || null,
    text,
    timestamp: new Date().toISOString(),
    read: true,
  };

  thread.messages.push(msg);
  saveThreads();

  appendMessageBubble(msg, true);
  scrollToBottom();
  renderThreadList(threadSearch.value);

  messageInput.value = "";
  messageInput.style.height = "auto";
}

// ============================================================
// NEW THREAD MODAL
// ============================================================
function openNewThreadModal() {
  firstMessageInput.value = "";
  newThreadBackdrop.classList.add("visible");
  setTimeout(() => firstMessageInput.focus(), 200);
}

function closeNewThreadModal() {
  newThreadBackdrop.classList.remove("visible");
}

function createThread() {
  const firstMsg = firstMessageInput.value.trim();
  if (!firstMsg) {
    firstMessageInput.focus();
    return;
  }

  const selectedItemId = itemLinkSelect.value || null;
  const linkedItem = selectedItemId
    ? allItems.find((i) => String(i.id) === String(selectedItemId))
    : null;

  const thread = {
    id: "thread_" + Date.now(),
    itemId: selectedItemId,
    itemCategory: linkedItem ? linkedItem.category : "FYI",
    itemSummary: linkedItem
      ? (linkedItem.summary || linkedItem.text).slice(0, 80)
      : "General conversation",
    messages: [
      {
        id: "msg_" + Date.now(),
        sender: getCurrentUserName(),
        sender_id: getSession()?.id || null,
        text: firstMsg,
        timestamp: new Date().toISOString(),
        read: true,
      },
    ],
  };

  threads.unshift(thread);
  saveThreads();
  closeNewThreadModal();
  renderThreadList();
  openThread(thread.id);
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

  threadSearch.addEventListener("input", (e) => {
    renderThreadList(e.target.value);
  });

  sendMessageBtn.addEventListener("click", sendMessage);

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-grow textarea
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
function relativeTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  return `${diffDay}d ago`;
}

function categoryClass(category) {
  return "cat-" + (category || "fyi").toLowerCase().replace(/\s+/g, "-");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", () => initIdentity(init));

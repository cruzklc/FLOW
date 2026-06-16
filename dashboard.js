// ============================================================
// FLOW — dashboard.js
// Reads/writes the same Postgres-backed items used by Home
// (via /api/items, /api/items/[id], /api/categorize). Renders
// stats, the collapsible filter panel, Kanban board, List view,
// relative timestamps, and the floating Quick Add modal.
// ============================================================

const STATUS_COLUMNS = [
  { key: "Not Started", colClass: "col-not-started" },
  { key: "In Progress", colClass: "col-in-progress" },
  { key: "Waiting on Amit", colClass: "col-waiting" },
  { key: "Blocked", colClass: "col-blocked" },
  { key: "Done", colClass: "col-done" },
];

const CATEGORY_OPTIONS = ["All", "Action Item", "Decision Needed", "Idea", "FYI", "Urgent"];
const PRIORITY_OPTIONS = ["All", "High", "Medium", "Low"];
const STATUS_OPTIONS = ["All", ...STATUS_COLUMNS.map((c) => c.key)];

// In-memory cache of all items from the database
let cachedItems = [];

// Active filter + view state
const filters = { category: "All", priority: "All", status: "All", search: "" };
let currentView = "kanban";
let doneCollapsed = true;

// ---- DOM REFERENCES ----
const inboxBadge = document.getElementById("inboxBadge");
const statActive = document.getElementById("statActive");
const statUrgent = document.getElementById("statUrgent");
const statWaiting = document.getElementById("statWaiting");
const statCompletedWeek = document.getElementById("statCompletedWeek");

const filterToggleBtn = document.getElementById("filterToggleBtn");
const filterActiveDot = document.getElementById("filterActiveDot");
const filterDropdown = document.getElementById("filterDropdown");
const categoryFilterGroup = document.getElementById("categoryFilterGroup");
const priorityFilterGroup = document.getElementById("priorityFilterGroup");
const statusFilterGroup = document.getElementById("statusFilterGroup");
const searchInput = document.getElementById("searchInput");

const kanbanViewBtn = document.getElementById("kanbanViewBtn");
const listViewBtn = document.getElementById("listViewBtn");
const kanbanBoard = document.getElementById("kanbanBoard");
const listViewWrap = document.getElementById("listViewWrap");
const listTableBody = document.getElementById("listTableBody");
const dashEmptyState = document.getElementById("dashEmptyState");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

const quickAddBtn = document.getElementById("quickAddBtn");
const quickAddBackdrop = document.getElementById("quickAddBackdrop");
const quickAddInput = document.getElementById("quickAddInput");
const quickAddStatus = document.getElementById("quickAddStatus");
const quickAddMicBtn = document.getElementById("quickAddMicBtn");
const quickAddSubmitBtn = document.getElementById("quickAddSubmitBtn");

// ============================================================
// INIT
// ============================================================
async function init() {
  buildFilterPills();
  bindEvents();
  setupQuickAddVoice();

  await fetchItems();
  renderAll();

  // Keep relative timestamps fresh without a full re-render
  setInterval(refreshTimestamps, 30000);
}

function buildFilterPills() {
  buildPillGroup(categoryFilterGroup, CATEGORY_OPTIONS, "category");
  buildPillGroup(priorityFilterGroup, PRIORITY_OPTIONS, "priority");
  buildPillGroup(statusFilterGroup, STATUS_OPTIONS, "status");
}

function buildPillGroup(container, options, filterKey) {
  options.forEach((opt) => {
    const pill = document.createElement("button");
    pill.className = "filter-pill" + (opt === "All" ? " active" : "");
    pill.textContent = opt;
    pill.dataset.value = opt;
    pill.addEventListener("click", () => {
      filters[filterKey] = opt;
      container.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      updateFilterActiveDot();
      renderBoardAndList();
    });
    container.appendChild(pill);
  });
}

function updateFilterActiveDot() {
  const hasActiveFilter =
    filters.category !== "All" ||
    filters.priority !== "All" ||
    filters.status !== "All" ||
    filters.search !== "";
  filterActiveDot.classList.toggle("visible", hasActiveFilter);
}

function bindEvents() {
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("open"));

  filterToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = filterDropdown.classList.toggle("open");
    filterToggleBtn.classList.toggle("open", isOpen);
  });

  document.addEventListener("click", (e) => {
    if (!filterDropdown.contains(e.target) && !filterToggleBtn.contains(e.target)) {
      filterDropdown.classList.remove("open");
      filterToggleBtn.classList.remove("open");
    }
  });

  searchInput.addEventListener("input", (e) => {
    filters.search = e.target.value.trim().toLowerCase();
    updateFilterActiveDot();
    renderBoardAndList();
  });

  kanbanViewBtn.addEventListener("click", () => switchView("kanban"));
  listViewBtn.addEventListener("click", () => switchView("list"));

  quickAddBtn.addEventListener("click", openQuickAdd);
  quickAddBackdrop.addEventListener("click", (e) => {
    if (e.target === quickAddBackdrop) closeQuickAdd();
  });
  quickAddSubmitBtn.addEventListener("click", submitQuickAdd);
}

function switchView(view) {
  currentView = view;
  kanbanViewBtn.classList.toggle("active", view === "kanban");
  listViewBtn.classList.toggle("active", view === "list");
  kanbanBoard.style.display = view === "kanban" ? "grid" : "none";
  listViewWrap.style.display = view === "list" ? "block" : "none";
}

// ============================================================
// DATA LAYER
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

async function patchItem(id, fields) {
  const response = await fetch(`/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new Error("Failed to update item");
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
// RENDER ORCHESTRATION
// ============================================================
function renderAll() {
  renderInboxBadge();
  renderStats(true);
  renderBoardAndList();
}

function renderBoardAndList() {
  const items = getFilteredItems();
  const activeItems = cachedItems.filter((i) => !i.archived);

  dashEmptyState.style.display = activeItems.length === 0 ? "block" : "none";

  if (currentView === "kanban") {
    renderKanban(items);
  } else {
    renderList(items);
  }
}

function getFilteredItems() {
  return cachedItems.filter((item) => {
    if (item.archived) return false;
    if (filters.category !== "All" && item.category !== filters.category) return false;
    if (filters.priority !== "All" && item.priority !== filters.priority) return false;
    if (filters.status !== "All" && item.status !== filters.status) return false;
    if (filters.search && !item.text.toLowerCase().includes(filters.search)) return false;
    return true;
  });
}

// ============================================================
// STATS ROW — animated count-up
// ============================================================
function renderStats(animateFromZero) {
  const active = cachedItems.filter((i) => !i.archived);

  const totalActive = active.filter((i) => i.status !== "Done").length;
  const urgent = active.filter(
    (i) => i.category === "Urgent" || i.priority === "High"
  ).length;
  const waiting = active.filter((i) => i.status === "Waiting on Amit").length;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const completedThisWeek = active.filter(
    (i) => i.status === "Done" && i.completed_at && new Date(i.completed_at).getTime() >= sevenDaysAgo
  ).length;

  animateCount(statActive, totalActive, animateFromZero);
  animateCount(statUrgent, urgent, animateFromZero);
  animateCount(statWaiting, waiting, animateFromZero);
  animateCount(statCompletedWeek, completedThisWeek, animateFromZero);
}

function animateCount(el, target, fromZero) {
  const start = fromZero ? 0 : Number(el.textContent) || 0;
  if (start === target) {
    el.textContent = target;
    return;
  }

  const duration = 600;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = Math.round(start + (target - start) * eased);
    el.textContent = value;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = target;
    }
  }

  requestAnimationFrame(tick);
}

// ============================================================
// INBOX BADGE
// ============================================================
function renderInboxBadge() {
  const unread = cachedItems.filter((i) => !i.read && !i.archived).length;
  inboxBadge.textContent = unread;
  inboxBadge.classList.toggle("hidden", unread === 0);
}

// ============================================================
// KANBAN BOARD
// ============================================================
function renderKanban(items) {
  kanbanBoard.innerHTML = "";

  STATUS_COLUMNS.forEach((col) => {
    const columnItems = items.filter((i) => i.status === col.key);
    const isDone = col.key === "Done";

    const columnEl = document.createElement("div");
    columnEl.className = `kanban-column ${col.colClass}` + (isDone ? " collapsible" : "");

    const chevronSvg = `
      <span class="collapse-chevron ${isDone && !doneCollapsed ? "rotated" : ""}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    `;

    columnEl.innerHTML = `
      <div class="kanban-column-header">
        <span class="kanban-column-title">${col.key}</span>
        <div class="kanban-column-header-right">
          <span class="kanban-count ${isDone ? "done-count" : ""}">${columnItems.length}</span>
          ${isDone ? chevronSvg : ""}
        </div>
      </div>
      <div class="kanban-cards fade-in-group"></div>
    `;

    const cardsWrap = columnEl.querySelector(".kanban-cards");

    if (isDone && doneCollapsed) {
      cardsWrap.innerHTML = `<div class="done-collapsed-placeholder">${columnItems.length} completed — click to view</div>`;
    } else if (columnItems.length === 0) {
      cardsWrap.innerHTML = `<div class="kanban-empty">No items</div>`;
    } else {
      columnItems.forEach((item) => cardsWrap.appendChild(buildItemCard(item)));
    }

    if (isDone) {
      columnEl.querySelector(".kanban-column-header").addEventListener("click", () => {
        doneCollapsed = !doneCollapsed;
        renderBoardAndList();
      });
    }

    kanbanBoard.appendChild(columnEl);
  });
}

// ============================================================
// ITEM CARD (used in Kanban columns)
// ============================================================
function buildItemCard(item) {
  const card = document.createElement("div");

  const glowClass =
    item.status === "Waiting on Amit"
      ? "glow-amber"
      : item.priority === "High" || item.category === "Urgent"
      ? "glow-red"
      : "";

  const priorityClass = "priority-" + item.priority.toLowerCase();

  card.className = `item-card ${priorityClass} ${glowClass}`;
  card.dataset.id = item.id;

  card.innerHTML = `
    <div class="item-card-badges">
      <span class="badge-pill ${categoryClass(item.category)}">${item.category}</span>
      <span class="badge-pill priority ${item.priority.toLowerCase()}">${item.priority}</span>
    </div>
    <p class="item-card-text">${escapeHtml(item.text)}</p>
    <p class="item-card-time" data-timestamp="${item.timestamp}" title="${new Date(item.timestamp).toLocaleString()}">${relativeTime(item.timestamp)}</p>
    <div class="item-card-controls">
      <select class="status-select"></select>
      <div class="item-card-actions">
        <button class="icon-action-btn notes-btn" title="Notes" aria-label="Notes">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-action-btn archive-btn" title="Archive" aria-label="Archive">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.8"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
    <div class="item-notes">
      <textarea placeholder="Add a note...">${escapeHtml(item.notes || "")}</textarea>
      <button class="item-notes-save">Save Note</button>
    </div>
  `;

  // Populate status dropdown
  const select = card.querySelector(".status-select");
  STATUS_COLUMNS.forEach((col) => {
    const opt = document.createElement("option");
    opt.value = col.key;
    opt.textContent = col.key;
    if (col.key === item.status) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", async () => {
    const newStatus = select.value;
    try {
      await patchItem(item.id, { status: newStatus });
      item.status = newStatus;
      item.completed_at = newStatus === "Done" ? new Date().toISOString() : null;
      renderStats(false);
      renderBoardAndList();
      bumpColumnCounts();
    } catch (err) {
      console.error("status update error:", err);
    }
  });

  // Notes toggle
  const notesBtn = card.querySelector(".notes-btn");
  const notesWrap = card.querySelector(".item-notes");
  notesBtn.addEventListener("click", () => notesWrap.classList.toggle("open"));

  const notesSaveBtn = card.querySelector(".item-notes-save");
  const notesTextarea = card.querySelector("textarea");
  notesSaveBtn.addEventListener("click", async () => {
    const newNotes = notesTextarea.value;
    try {
      await patchItem(item.id, { notes: newNotes });
      item.notes = newNotes;
      notesSaveBtn.textContent = "Saved ✓";
      setTimeout(() => (notesSaveBtn.textContent = "Save Note"), 1200);
    } catch (err) {
      console.error("notes save error:", err);
    }
  });

  // Archive
  const archiveBtn = card.querySelector(".archive-btn");
  archiveBtn.addEventListener("click", async () => {
    try {
      await patchItem(item.id, { archived: true });
      item.archived = true;
      renderAll();
    } catch (err) {
      console.error("archive error:", err);
    }
  });

  return card;
}

function bumpColumnCounts() {
  document.querySelectorAll(".kanban-count").forEach((el) => {
    el.classList.add("bump");
    setTimeout(() => el.classList.remove("bump"), 220);
  });
}

// ============================================================
// LIST VIEW
// ============================================================
function renderList(items) {
  if (items.length === 0) {
    listTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 30px;">No items match your filters</td></tr>`;
    return;
  }

  listTableBody.innerHTML = items
    .map(
      (item) => `
      <tr data-id="${item.id}">
        <td><span class="badge-pill ${categoryClass(item.category)}" style="font-size:10px;padding:3px 9px;">${item.category}</span></td>
        <td><span class="badge-pill priority ${item.priority.toLowerCase()}" style="font-size:10px;padding:3px 9px;">${item.priority}</span></td>
        <td>
          <select class="status-select list-status-select" data-id="${item.id}">
            ${STATUS_COLUMNS.map(
              (col) =>
                `<option value="${col.key}" ${col.key === item.status ? "selected" : ""}>${col.key}</option>`
            ).join("")}
          </select>
        </td>
        <td class="list-text-cell" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</td>
        <td data-timestamp="${item.timestamp}" title="${new Date(item.timestamp).toLocaleString()}">${relativeTime(item.timestamp)}</td>
        <td class="list-actions-cell">
          <button class="icon-action-btn list-archive-btn" data-id="${item.id}" title="Archive" aria-label="Archive">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.8"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </td>
      </tr>
    `
    )
    .join("");

  listTableBody.querySelectorAll(".list-status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const id = select.dataset.id;
      const item = cachedItems.find((i) => String(i.id) === String(id));
      const newStatus = select.value;
      try {
        await patchItem(id, { status: newStatus });
        if (item) {
          item.status = newStatus;
          item.completed_at = newStatus === "Done" ? new Date().toISOString() : null;
        }
        renderStats(false);
        renderBoardAndList();
      } catch (err) {
        console.error("status update error:", err);
      }
    });
  });

  listTableBody.querySelectorAll(".list-archive-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const item = cachedItems.find((i) => String(i.id) === String(id));
      try {
        await patchItem(id, { archived: true });
        if (item) item.archived = true;
        renderAll();
      } catch (err) {
        console.error("archive error:", err);
      }
    });
  });
}

// ============================================================
// QUICK ADD MODAL
// ============================================================
function openQuickAdd() {
  quickAddBackdrop.classList.add("visible");
  quickAddInput.value = "";
  quickAddStatus.textContent = "";
  quickAddStatus.classList.remove("error");
  setTimeout(() => quickAddInput.focus(), 150);
}

function closeQuickAdd() {
  quickAddBackdrop.classList.remove("visible");
}

async function submitQuickAdd() {
  const text = quickAddInput.value.trim();
  if (!text) return;

  quickAddStatus.textContent = "Processing your thought...";
  quickAddStatus.classList.remove("error");

  try {
    const response = await fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error("Categorize failed");
    const data = await response.json();

    const newItem = {
      id: Date.now(),
      text,
      summary: data.summary,
      category: data.category,
      priority: data.priority,
      status: "Not Started",
      timestamp: new Date().toISOString(),
      read: false,
    };

    await postItem(newItem);
    cachedItems.unshift(newItem);
    renderAll();
    closeQuickAdd();
  } catch (err) {
    console.error("quick add error:", err);
    quickAddStatus.textContent = "Could not add — please try again";
    quickAddStatus.classList.add("error");
  }
}

// ---- Voice support inside Quick Add modal ----
let quickAddRecognition = null;
let quickAddRecording = false;

function setupQuickAddVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    quickAddMicBtn.style.display = "none";
    return;
  }

  quickAddRecognition = new SpeechRecognition();
  quickAddRecognition.continuous = false;
  quickAddRecognition.interimResults = false;
  quickAddRecognition.lang = "en-US";

  quickAddRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    quickAddInput.value = (quickAddInput.value + " " + transcript).trim();
  };

  quickAddRecognition.onerror = () => {
    quickAddRecording = false;
    quickAddMicBtn.classList.remove("recording");
    quickAddStatus.textContent = "Could not capture audio — please try again";
    quickAddStatus.classList.add("error");
  };

  quickAddRecognition.onend = () => {
    quickAddRecording = false;
    quickAddMicBtn.classList.remove("recording");
  };

  quickAddMicBtn.addEventListener("click", () => {
    if (!quickAddRecording) {
      quickAddRecording = true;
      quickAddMicBtn.classList.add("recording");
      try {
        quickAddRecognition.start();
      } catch (e) {
        quickAddRecording = false;
        quickAddMicBtn.classList.remove("recording");
      }
    } else {
      quickAddRecognition.stop();
    }
  });
}

// ============================================================
// RELATIVE TIMESTAMPS
// ============================================================
function relativeTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  if (diffDay === 1) return "Yesterday";
  return `${diffDay} days ago`;
}

function refreshTimestamps() {
  document.querySelectorAll("[data-timestamp]").forEach((el) => {
    el.textContent = relativeTime(el.dataset.timestamp);
  });
}

// ============================================================
// HELPERS
// ============================================================
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
document.addEventListener("DOMContentLoaded", init);

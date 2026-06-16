// ============================================================
// FLOW — dashboard.js
// Reads/writes the same Postgres-backed items used by Home
// (via /api/items, /api/items/[id]). Renders stats, filters,
// Kanban board, and List view; handles status changes, notes,
// and archiving.
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

// In-memory cache of all (non-archived + archived) items from the database
let cachedItems = [];

// Active filter + view state
const filters = { category: "All", priority: "All", status: "All", search: "" };
let currentView = "kanban";

// ---- DOM REFERENCES ----
const inboxBadge = document.getElementById("inboxBadge");
const statActive = document.getElementById("statActive");
const statUrgent = document.getElementById("statUrgent");
const statWaiting = document.getElementById("statWaiting");
const statCompletedWeek = document.getElementById("statCompletedWeek");

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

// ============================================================
// INIT
// ============================================================
async function init() {
  buildFilterPills();
  bindEvents();
  await fetchItems();
  renderAll();
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
      renderBoardAndList();
    });
    container.appendChild(pill);
  });
}

function bindEvents() {
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("open"));

  searchInput.addEventListener("input", (e) => {
    filters.search = e.target.value.trim().toLowerCase();
    renderBoardAndList();
  });

  kanbanViewBtn.addEventListener("click", () => switchView("kanban"));
  listViewBtn.addEventListener("click", () => switchView("list"));
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

// ============================================================
// RENDER ORCHESTRATION
// ============================================================
function renderAll() {
  renderInboxBadge();
  renderStats();
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
// STATS ROW
// ============================================================
function renderStats() {
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

  statActive.textContent = totalActive;
  statUrgent.textContent = urgent;
  statWaiting.textContent = waiting;
  statCompletedWeek.textContent = completedThisWeek;
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

    const columnEl = document.createElement("div");
    columnEl.className = `kanban-column ${col.colClass}`;

    columnEl.innerHTML = `
      <div class="kanban-column-header">
        <span class="kanban-column-title">${col.key}</span>
        <span class="kanban-count">${columnItems.length}</span>
      </div>
      <div class="kanban-cards"></div>
    `;

    const cardsWrap = columnEl.querySelector(".kanban-cards");

    if (columnItems.length === 0) {
      cardsWrap.innerHTML = `<div class="kanban-empty">No items</div>`;
    } else {
      columnItems.forEach((item) => cardsWrap.appendChild(buildItemCard(item)));
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

  card.className = `item-card ${glowClass}`;
  card.dataset.id = item.id;

  card.innerHTML = `
    <div class="item-card-badges">
      <span class="badge-pill ${categoryClass(item.category)}">${item.category}</span>
      <span class="badge-pill priority ${item.priority.toLowerCase()}">${item.priority}</span>
    </div>
    <p class="item-card-text">${escapeHtml(item.text)}</p>
    <p class="item-card-time">${formatTimestamp(item.timestamp)}</p>
    <div class="item-card-controls">
      <select class="status-select"></select>
      <button class="icon-action-btn notes-btn" title="Notes" aria-label="Notes">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-action-btn archive-btn" title="Archive" aria-label="Archive">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.8"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
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
      renderStats();
      renderBoardAndList();
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
        <td>${formatTimestamp(item.timestamp)}</td>
        <td class="list-actions-cell">
          <button class="icon-action-btn list-archive-btn" data-id="${item.id}" title="Archive" aria-label="Archive">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.8"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
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
        renderStats();
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
// HELPERS
// ============================================================
function categoryClass(category) {
  return "cat-" + category.toLowerCase().replace(/\s+/g, "-");
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

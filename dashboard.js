// ============================================================
// FLOW — dashboard.js
// Reads/writes the same Postgres-backed items used by Home
// (via /api/items, /api/items/[id], /api/categorize). Renders
// stats, the collapsible filter panel, Kanban board, List view,
// relative timestamps, and the floating Quick Add modal.
// ============================================================

const STATUS_COLUMNS = [
  { key: "Not Started",   label: "Not Started",     colClass: "col-not-started" },
  { key: "In Progress",   label: "In Progress",     colClass: "col-in-progress" },
  { key: "Waiting on Amit", label: "Waiting on Input", colClass: "col-waiting" },
  { key: "Blocked",       label: "Blocked",         colClass: "col-blocked" },
  { key: "Done",          label: "Done",            colClass: "col-done" },
];

const CATEGORY_OPTIONS = ["All", "Action Item", "Decision Needed", "Idea", "FYI", "Urgent"];
const PRIORITY_OPTIONS = ["All", "High", "Medium", "Low"];
const STATUS_OPTIONS = [
  { value: "All", label: "All" },
  ...STATUS_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
];

// In-memory cache of all items from the database
let cachedItems = [];

// Active filter + view state
const filters = { category: "All", priority: "All", status: "All", search: "", creator: "All" };
let currentView = "kanban";
let doneCollapsed = true;
let activeMobileCol = 0; // index into STATUS_COLUMNS

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
const creatorFilterGroup = document.getElementById("creatorFilterGroup");
const searchInput = document.getElementById("searchInput");

const kanbanViewBtn = document.getElementById("kanbanViewBtn");
const listViewBtn = document.getElementById("listViewBtn");
const kanbanBoard = document.getElementById("kanbanBoard");
const listViewWrap = document.getElementById("listViewWrap");
const listTableBody = document.getElementById("listTableBody");
const dashEmptyState = document.getElementById("dashEmptyState");
const mobileKanbanTabs = document.getElementById("mobileKanbanTabs");
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
  bindKanbanSwipe();
  setupQuickAddVoice();

  await fetchItems();
  buildCreatorFilterPills();
  renderAll();

  setInterval(refreshTimestamps, 30000);

  // Only re-render on orientation change (not every scroll-driven resize event)
  window.addEventListener("orientationchange", () => {
    setTimeout(() => renderBoardAndList(), 300);
  });
  // On desktop, re-render when crossing the 700px mobile breakpoint
  let _lastMobile = isMobile();
  window.addEventListener("resize", () => {
    const nowMobile = isMobile();
    if (nowMobile !== _lastMobile) {
      _lastMobile = nowMobile;
      renderBoardAndList();
    }
  });
}

function buildFilterPills() {
  buildPillGroup(categoryFilterGroup, CATEGORY_OPTIONS, "category");
  buildPillGroup(priorityFilterGroup, PRIORITY_OPTIONS, "priority");
  buildPillGroup(statusFilterGroup, STATUS_OPTIONS, "status");
}

function buildCreatorFilterPills() {
  creatorFilterGroup.innerHTML = "";
  const session = getSession();
  // Collect unique creators from loaded items
  const seen = new Map();
  cachedItems.forEach((item) => {
    if (item.created_by && item.created_by_name && !seen.has(item.created_by)) {
      seen.set(item.created_by, item.created_by_name);
    }
  });
  const options = [{ value: "All", label: "All" }];
  if (session) options.push({ value: String(session.id), label: "Mine" });
  seen.forEach((name, id) => {
    if (!session || String(id) !== String(session.id)) {
      options.push({ value: String(id), label: name });
    }
  });
  buildPillGroup(creatorFilterGroup, options, "creator");
}

function buildPillGroup(container, options, filterKey) {
  options.forEach((opt) => {
    const value = typeof opt === "object" ? opt.value : opt;
    const label = typeof opt === "object" ? opt.label : opt;
    const pill = document.createElement("button");
    pill.className = "filter-pill" + (value === "All" ? " active" : "");
    pill.textContent = label;
    pill.dataset.value = value;
    pill.addEventListener("click", () => {
      filters[filterKey] = value;
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
    filters.creator !== "All" ||
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
  renderBoardAndList();
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
  renderHealthBar();
  renderBoardAndList();
}

function renderBoardAndList() {
  const items = getFilteredItems();
  const activeItems = cachedItems.filter((i) => !i.archived);

  dashEmptyState.style.display = activeItems.length === 0 ? "block" : "none";

  if (currentView === "kanban") {
    kanbanBoard.style.display = "block";
    listViewWrap.style.display = "none";
    renderKanban(items);
  } else {
    kanbanBoard.style.display = "none";
    listViewWrap.style.display = "block";
    renderList(items);
  }
}

function getFilteredItems() {
  return cachedItems.filter((item) => {
    if (item.archived) return false;
    if (filters.category !== "All" && item.category !== filters.category) return false;
    if (filters.priority !== "All" && item.priority !== filters.priority) return false;
    if (filters.status !== "All" && item.status !== filters.status) return false;
    if (filters.creator !== "All" && String(item.created_by) !== filters.creator) return false;
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
// HEALTH BAR
// ============================================================
function renderHealthBar() {
  const track = document.getElementById("healthBarTrack");
  const legend = document.getElementById("healthBarLegend");
  const summary = document.getElementById("healthBarSummary");
  if (!track) return;

  const active = cachedItems.filter((i) => !i.archived);
  const total = active.length;

  const segments = [
    { key: "Not Started",     label: "New",        color: "var(--text-muted)",    filter: (i) => i.status === "Not Started" },
    { key: "In Progress",     label: "In Progress", color: "var(--secondary)",    filter: (i) => i.status === "In Progress" },
    { key: "Waiting",         label: "Waiting",    color: "#D97706",              filter: (i) => i.status === "Waiting on Amit" },
    { key: "Blocked",         label: "Blocked",    color: "var(--badge-urgent)",  filter: (i) => i.status === "Blocked" },
    { key: "Done",            label: "Done",       color: "#10B981",              filter: (i) => i.status === "Done" },
  ];

  const counts = segments.map((s) => ({ ...s, count: active.filter(s.filter).length }));
  const done = counts.find((s) => s.key === "Done").count;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  summary.textContent = total > 0 ? `${pct}% complete · ${total} total` : "No items yet";

  track.innerHTML = counts
    .filter((s) => s.count > 0)
    .map((s) => {
      const w = ((s.count / total) * 100).toFixed(1);
      return `<div class="health-bar-seg" style="width:${w}%;background:${s.color}" title="${s.label}: ${s.count}"></div>`;
    })
    .join("");

  if (total === 0) track.innerHTML = `<div class="health-bar-seg" style="width:100%;background:rgba(255,255,255,0.08)"></div>`;

  legend.innerHTML = counts
    .map((s) => `
      <span class="health-legend-item">
        <span class="health-legend-dot" style="background:${s.color}"></span>
        <span>${s.label}</span>
        <span class="health-legend-count">${s.count}</span>
      </span>`)
    .join("");
}

// ============================================================
// INBOX BADGE — unread message count from localStorage threads
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
// MOBILE KANBAN TABS
// ============================================================
function isMobile() { return window.innerWidth <= 700; }

function renderMobileKanbanTabs(items) {
  if (!isMobile()) { mobileKanbanTabs.style.display = "none"; return; }
  mobileKanbanTabs.style.display = "flex";
  mobileKanbanTabs.innerHTML = "";

  STATUS_COLUMNS.forEach((col, idx) => {
    const count = items.filter((i) => i.status === col.key).length;
    const btn = document.createElement("button");
    btn.className = "mobile-tab-pill" + (idx === activeMobileCol ? " active" : "");
    btn.dataset.colClass = col.colClass;
    btn.innerHTML = `${col.label}<span class="mobile-tab-count">${count}</span>`;
    btn.addEventListener("click", () => switchMobileCol(idx, items));
    mobileKanbanTabs.appendChild(btn);
  });

  // Scroll active pill into view
  const active = mobileKanbanTabs.querySelector(".mobile-tab-pill.active");
  if (active) active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function switchMobileCol(idx, items, direction) {
  if (idx < 0 || idx >= STATUS_COLUMNS.length) return;
  activeMobileCol = idx;
  renderMobileKanbanTabs(items);

  const columns = kanbanBoard.querySelectorAll(".kanban-column");
  columns.forEach((col, i) => {
    col.classList.remove("mobile-active", "slide-in-left", "slide-in-right");
    col.style.display = i === idx ? "" : "none";
  });
  if (columns[idx]) {
    const animClass = direction === "left" ? "slide-in-left" : direction === "right" ? "slide-in-right" : "slide-in-left";
    columns[idx].classList.add("mobile-active", animClass);
  }
}

function bindKanbanSwipe() {
  let startX = 0, startY = 0, lockedAxis = null;

  kanbanBoard.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lockedAxis = null;
  }, { passive: true });

  kanbanBoard.addEventListener("touchmove", (e) => {
    if (!isMobile() || lockedAxis) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    // Lock axis after 8px of movement so we don't misread diagonals
    if (dx > 8 || dy > 8) lockedAxis = dx > dy ? "x" : "y";
  }, { passive: true });

  kanbanBoard.addEventListener("touchend", (e) => {
    if (!isMobile() || lockedAxis !== "x") return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < 44) return; // require at least 44px horizontal travel
    const items = getFilteredItems();
    if (dx < 0) switchMobileCol(activeMobileCol + 1, items, "left");
    else        switchMobileCol(activeMobileCol - 1, items, "right");
  }, { passive: true });
}

// ============================================================
// OVERVIEW BOARDS (two focused boards: New Inputs + High Priority)
// ============================================================
const overviewCollapsed = { newInputs: false, highPriority: false };

function renderKanban(items) {
  kanbanBoard.innerHTML = "";
  mobileKanbanTabs.style.display = "none";
  kanbanBoard.style.display = "block";

  const boards = [
    {
      key: "newInputs",
      title: "New Inputs",
      subtitle: "Not Started",
      dotColor: "var(--text-muted)",
      items: items.filter((i) => i.status === "Not Started"),
    },
    {
      key: "highPriority",
      title: "High Priority",
      subtitle: "High priority · active",
      dotColor: "var(--badge-urgent)",
      items: items.filter((i) => i.priority === "High" && i.status !== "Done"),
    },
  ];

  boards.forEach((board) => {
    const collapsed = overviewCollapsed[board.key];
    const section = document.createElement("div");
    section.className = "overview-board";

    section.innerHTML = `
      <div class="overview-board-header" data-key="${board.key}">
        <div class="overview-board-title-wrap">
          <span class="overview-board-dot" style="background:${board.dotColor}"></span>
          <span class="overview-board-title">${board.title}</span>
          <span class="overview-board-count">${board.items.length}</span>
        </div>
        <span class="collapse-chevron ${!collapsed ? "rotated" : ""}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
      <div class="overview-board-body ${collapsed ? "" : "open"}">
        <div class="overview-cards fade-in-group"></div>
      </div>
    `;

    const cardsWrap = section.querySelector(".overview-cards");
    if (board.items.length === 0) {
      cardsWrap.innerHTML = `<div class="kanban-empty">All clear here</div>`;
    } else {
      board.items.forEach((item) => cardsWrap.appendChild(buildItemCard(item)));
    }

    section.querySelector(".overview-board-header").addEventListener("click", () => {
      overviewCollapsed[board.key] = !overviewCollapsed[board.key];
      renderBoardAndList();
    });

    kanbanBoard.appendChild(section);
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

  const session = getSession();
  const isOtherUser = item.created_by_name && (!session || String(item.created_by) !== String(session.id));
  const creatorChip = isOtherUser
    ? `<span class="card-creator-chip" title="Created by ${escapeHtml(item.created_by_name)}">${escapeHtml(item.created_by_name[0].toUpperCase())}</span>`
    : "";

  card.innerHTML = `
    <div class="item-card-badges">
      <span class="badge-pill ${categoryClass(item.category)} editable-badge" title="Click to change category">${item.category}</span>
      <span class="badge-pill priority ${item.priority.toLowerCase()} editable-badge" title="Click to change priority">${item.priority}</span>
      ${creatorChip}
    </div>
    <p class="item-card-text" title="${escapeHtml(item.text)}">${escapeHtml(item.summary || item.text)}</p>
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
    opt.textContent = col.label;
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

  // Editable category badge dropdown
  const badges = card.querySelectorAll(".item-card-badges .badge-pill");
  const catBadge = badges[0];
  const prioBadge = badges[1];

  catBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    openBadgeDropdown(catBadge, ITEM_CATEGORIES, item.category, async (newCat) => {
      try {
        await patchItem(item.id, { category: newCat });
        item.category = newCat;
        renderStats(false);
        renderBoardAndList();
      } catch (err) { console.error("category update error:", err); }
    });
  });

  prioBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    openBadgeDropdown(prioBadge, ITEM_PRIORITIES, item.priority, async (newPrio) => {
      try {
        await patchItem(item.id, { priority: newPrio });
        item.priority = newPrio;
        renderStats(false);
        renderBoardAndList();
      } catch (err) { console.error("priority update error:", err); }
    });
  });

  // Card body click → detail modal (exclude controls)
  card.addEventListener("click", (e) => {
    if (
      e.target.closest(".item-card-badges") ||
      e.target.closest(".item-card-controls") ||
      e.target.closest(".item-notes")
    ) return;
    openItemModal(item, (updated) => {
      Object.assign(item, updated);
      renderStats(false);
      renderBoardAndList();
    });
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
// LIST VIEW — grouped by category
// ============================================================
const listCollapsed = {};

function renderList(items) {
  const wrap = listViewWrap;
  wrap.innerHTML = "";

  if (items.length === 0) {
    wrap.innerHTML = `<div class="dash-empty-msg">No items match your filters</div>`;
    return;
  }

  const categoryOrder = ["Urgent", "Action Item", "Decision Needed", "Idea", "FYI"];
  const grouped = {};
  categoryOrder.forEach((c) => { grouped[c] = []; });
  items.forEach((item) => {
    const cat = item.category || "FYI";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  categoryOrder.forEach((cat) => {
    const catItems = grouped[cat];
    if (catItems.length === 0) return;

    if (listCollapsed[cat] === undefined) listCollapsed[cat] = false;
    const collapsed = listCollapsed[cat];

    const section = document.createElement("div");
    section.className = "cat-list-section";

    section.innerHTML = `
      <div class="cat-list-header" data-cat="${cat}">
        <div class="cat-list-title-wrap">
          <span class="badge-pill ${categoryClass(cat)}" style="font-size:10px;padding:2px 8px;">${cat}</span>
          <span class="cat-list-count">${catItems.length}</span>
        </div>
        <span class="collapse-chevron ${!collapsed ? "rotated" : ""}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
      <div class="cat-list-body ${collapsed ? "" : "open"}">
        <table class="list-table">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Status</th>
              <th>Summary</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="cat-list-tbody"></tbody>
        </table>
      </div>
    `;

    const tbody = section.querySelector(".cat-list-tbody");
    catItems.forEach((item) => {
      const tr = document.createElement("tr");
      tr.dataset.id = item.id;
      tr.innerHTML = `
        <td><span class="badge-pill priority ${item.priority.toLowerCase()}" style="font-size:10px;padding:2px 8px;">${item.priority}</span></td>
        <td>
          <select class="status-select list-status-select" data-id="${item.id}">
            ${STATUS_COLUMNS.map((col) => `<option value="${col.key}" ${col.key === item.status ? "selected" : ""}>${col.label}</option>`).join("")}
          </select>
        </td>
        <td class="list-text-cell" title="${escapeHtml(item.text)}">${escapeHtml(item.summary || item.text)}</td>
        <td data-timestamp="${item.timestamp}">${relativeTime(item.timestamp)}</td>
        <td class="list-actions-cell">
          <button class="icon-action-btn list-archive-btn" data-id="${item.id}" title="Archive" aria-label="Archive">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.8"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    section.querySelector(".cat-list-header").addEventListener("click", () => {
      listCollapsed[cat] = !listCollapsed[cat];
      renderBoardAndList();
    });

    tbody.querySelectorAll(".list-status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const id = select.dataset.id;
        const item = cachedItems.find((i) => String(i.id) === String(id));
        const newStatus = select.value;
        try {
          await patchItem(id, { status: newStatus });
          if (item) { item.status = newStatus; item.completed_at = newStatus === "Done" ? new Date().toISOString() : null; }
          renderStats(false);
          renderHealthBar();
          renderBoardAndList();
        } catch (err) { console.error("status update error:", err); }
      });
    });

    tbody.querySelectorAll(".list-archive-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const item = cachedItems.find((i) => String(i.id) === String(id));
        try {
          await patchItem(id, { archived: true });
          if (item) item.archived = true;
          renderAll();
        } catch (err) { console.error("archive error:", err); }
      });
    });

    wrap.appendChild(section);
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
    const items = await response.json(); // always an array

    const session = getSession();
    const baseTime = Date.now();

    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      const newItem = {
        id: baseTime + i,
        text,
        summary: d.summary,
        category: d.category,
        priority: d.priority,
        status: "Not Started",
        timestamp: new Date(baseTime + i).toISOString(),
        read: false,
        created_by: session ? session.id : null,
      };
      await postItem(newItem);
      cachedItems.unshift(newItem);
    }

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
document.addEventListener("DOMContentLoaded", () => initIdentity(init));

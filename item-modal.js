// ============================================================
// FLOW — item-modal.js
// Shared between index.html and dashboard.html.
// Provides: openItemModal(item, onUpdate)
//           openBadgeDropdown(anchorEl, options, current, onSelect)
// ============================================================

const ITEM_CATEGORIES = ["Action Item", "Decision Needed", "Idea", "FYI", "Urgent"];
const ITEM_PRIORITIES = ["High", "Medium", "Low"];
const ITEM_STATUS_OPTIONS = [
  { key: "Not Started",    label: "Not Started" },
  { key: "In Progress",    label: "In Progress" },
  { key: "Waiting on Amit", label: "Waiting on Input" },
  { key: "Blocked",        label: "Blocked" },
  { key: "Done",           label: "Done" },
];

function _catClass(cat) {
  return "cat-" + (cat || "fyi").toLowerCase().replace(/\s+/g, "-");
}
function _esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}
function _rel(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const dy = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy === 1) return "Yesterday";
  return `${dy} days ago`;
}

async function _patch(id, fields) {
  const res = await fetch(`/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error("Patch failed");
}

// ============================================================
// BADGE DROPDOWN
// ============================================================
let _activeDropdown = null;

function openBadgeDropdown(anchorEl, options, currentValue, onSelect) {
  if (_activeDropdown) { _activeDropdown(); _activeDropdown = null; }

  const rect = anchorEl.getBoundingClientRect();
  const dd = document.createElement("div");
  dd.className = "badge-dropdown";

  // Position below anchor, flip up if too close to bottom
  const spaceBelow = window.innerHeight - rect.bottom;
  const approxHeight = options.length * 36 + 12;
  if (spaceBelow < approxHeight) {
    dd.style.bottom = (window.innerHeight - rect.top + 6) + "px";
    dd.style.top = "auto";
  } else {
    dd.style.top = (rect.bottom + 6) + "px";
  }
  dd.style.left = rect.left + "px";

  options.forEach((opt) => {
    const val   = typeof opt === "object" ? opt.value : opt;
    const label = typeof opt === "object" ? opt.label : opt;
    const btn = document.createElement("button");
    btn.className = "badge-dropdown-option" + (val === currentValue ? " selected" : "");
    btn.textContent = label;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect(val);
      close();
    });
    dd.appendChild(btn);
  });

  document.body.appendChild(dd);
  requestAnimationFrame(() => dd.classList.add("open"));

  function close() {
    dd.classList.remove("open");
    setTimeout(() => { if (dd.parentNode) dd.remove(); }, 160);
    document.removeEventListener("mousedown", outside);
    if (_activeDropdown === close) _activeDropdown = null;
  }

  function outside(e) {
    if (!dd.contains(e.target) && e.target !== anchorEl) close();
  }
  setTimeout(() => document.addEventListener("mousedown", outside), 60);

  _activeDropdown = close;
  return close;
}

// ============================================================
// ITEM DETAIL MODAL
// ============================================================
function openItemModal(item, onUpdate) {
  const prev = document.getElementById("itemDetailBackdrop");
  if (prev) prev.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "itemDetailBackdrop";
  backdrop.className = "item-detail-backdrop";

  const hasSummary  = item.summary && item.summary !== item.text;
  const primaryText = hasSummary ? item.summary : (item.text || "");
  const createdLabel = item.created_by_name
    ? `<div class="detail-meta-row"><span class="detail-meta-label">Created by</span><span class="detail-meta-val">${_esc(item.created_by_name)}</span></div>`
    : "";

  backdrop.innerHTML = `
    <div class="item-detail-modal" id="itemDetailModal">

      <div class="item-detail-top">
        <div class="item-detail-badges" id="detailBadges">
          <span class="badge-pill ${_catClass(item.category)} editable-badge" id="detailCatBadge" role="button" tabindex="0" title="Click to change category">${_esc(item.category)}</span>
          <span class="badge-pill priority ${(item.priority||"").toLowerCase()} editable-badge" id="detailPrioBadge" role="button" tabindex="0" title="Click to change priority">${_esc(item.priority)}</span>
        </div>
        <button class="item-detail-close" id="itemDetailClose" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div class="item-detail-body">
        <p class="detail-primary-text">${_esc(primaryText)}</p>
        ${hasSummary ? `
          <button class="detail-original-toggle" id="detailOriginalToggle" aria-expanded="false">
            <svg class="detail-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            View original input
          </button>
          <div class="detail-original-wrap" id="detailOriginalWrap" aria-hidden="true">
            <blockquote class="detail-original-text ${_catClass(item.category)}">${_esc(item.text)}</blockquote>
          </div>
        ` : ""}

        <div class="detail-row">
          <span class="detail-meta-label">Status</span>
          <select class="status-select detail-status-select" id="detailStatusSelect">
            ${ITEM_STATUS_OPTIONS.map(s =>
              `<option value="${s.key}" ${s.key === item.status ? "selected" : ""}>${s.label}</option>`
            ).join("")}
          </select>
        </div>

        <div class="detail-row detail-notes-row">
          <span class="detail-meta-label">Notes</span>
          <div class="detail-notes-wrap">
            <textarea class="detail-notes-input" id="detailNotesInput" placeholder="Add a note...">${_esc(item.notes || "")}</textarea>
            <button class="item-notes-save" id="detailNotesSave">Save Note</button>
          </div>
        </div>

        <div class="detail-meta-section">
          ${createdLabel}
          <div class="detail-meta-row">
            <span class="detail-meta-label">Captured</span>
            <span class="detail-meta-val" title="${new Date(item.timestamp).toLocaleString()}">
              ${new Date(item.timestamp).toLocaleString([], { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })}
              <span class="detail-reltime"> · ${_rel(item.timestamp)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add("visible")));

  // ---- original input toggle ----
  const origToggle = document.getElementById("detailOriginalToggle");
  const origWrap   = document.getElementById("detailOriginalWrap");
  if (origToggle && origWrap) {
    origToggle.addEventListener("click", () => {
      const open = origWrap.classList.toggle("open");
      origToggle.setAttribute("aria-expanded", String(open));
      origToggle.classList.toggle("expanded", open);
    });
  }

  // ---- close ----
  function close() {
    backdrop.classList.remove("visible");
    setTimeout(() => { if (backdrop.parentNode) backdrop.remove(); }, 340);
  }
  document.getElementById("itemDetailClose").addEventListener("click", close);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });

  // ---- category badge ----
  const catBadge = document.getElementById("detailCatBadge");
  catBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    openBadgeDropdown(catBadge, ITEM_CATEGORIES, item.category, async (newCat) => {
      try {
        await _patch(item.id, { category: newCat });
        item.category = newCat;
        catBadge.textContent = newCat;
        catBadge.className = `badge-pill ${_catClass(newCat)} editable-badge`;
        onUpdate({ category: newCat });
      } catch (err) { console.error(err); }
    });
  });

  // ---- priority badge ----
  const prioBadge = document.getElementById("detailPrioBadge");
  prioBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    openBadgeDropdown(prioBadge, ITEM_PRIORITIES, item.priority, async (newPrio) => {
      try {
        await _patch(item.id, { priority: newPrio });
        item.priority = newPrio;
        prioBadge.textContent = newPrio;
        prioBadge.className = `badge-pill priority ${newPrio.toLowerCase()} editable-badge`;
        onUpdate({ priority: newPrio });
      } catch (err) { console.error(err); }
    });
  });

  // ---- status ----
  const statusSel = document.getElementById("detailStatusSelect");
  statusSel.addEventListener("change", async () => {
    const newStatus = statusSel.value;
    try {
      await _patch(item.id, { status: newStatus });
      item.status = newStatus;
      item.completed_at = newStatus === "Done" ? new Date().toISOString() : null;
      onUpdate({ status: newStatus, completed_at: item.completed_at });
    } catch (err) { console.error(err); }
  });

  // ---- notes ----
  const notesInput = document.getElementById("detailNotesInput");
  const notesSave  = document.getElementById("detailNotesSave");
  notesSave.addEventListener("click", async () => {
    const newNotes = notesInput.value;
    try {
      await _patch(item.id, { notes: newNotes });
      item.notes = newNotes;
      notesSave.textContent = "Saved ✓";
      setTimeout(() => { notesSave.textContent = "Save Note"; }, 1500);
      onUpdate({ notes: newNotes });
    } catch (err) { console.error(err); }
  });
}

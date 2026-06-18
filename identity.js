// ============================================================
// FLOW — identity.js
// Shared across all pages. Manages the "who am I" session
// (stored in localStorage) and shows the identity modal on
// first visit. No passwords — just a name matched or created
// in the Postgres users table.
//
// Usage in each page's JS:
//   document.addEventListener("DOMContentLoaded", () => initIdentity(init));
// ============================================================

const IDENTITY_SESSION_KEY = "flow_session";

function getSession() {
  try {
    const raw = localStorage.getItem(IDENTITY_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSession(id, name) {
  localStorage.setItem(IDENTITY_SESSION_KEY, JSON.stringify({ id, name }));
}

function clearSession() {
  localStorage.removeItem(IDENTITY_SESSION_KEY);
}

// initIdentity(onReady) — call on DOMContentLoaded.
// Calls onReady() immediately if a valid session exists,
// otherwise shows the identity modal first.
function initIdentity(onReady) {
  const session = getSession();
  if (session && session.id && session.name) {
    applySidebarUser(session);
    // Load and apply this user's saved theme, then run the page
    if (typeof loadUserTheme === "function") {
      loadUserTheme(session.id).then(onReady);
    } else {
      onReady();
    }
    return;
  }
  showIdentityModal(onReady);
}

// Update sidebar avatar + name label, inject "Switch" button.
function applySidebarUser(session) {
  const avatarEl = document.getElementById("userAvatar");
  const nameEl = document.getElementById("userNameLabel");

  if (avatarEl) avatarEl.textContent = session.name.charAt(0).toUpperCase();
  if (nameEl) {
    nameEl.textContent = session.name;
    const sidebarUser = nameEl.closest(".sidebar-user");
    if (sidebarUser && !sidebarUser.querySelector(".switch-user-btn")) {
      const btn = document.createElement("button");
      btn.className = "switch-user-btn";
      btn.textContent = "Switch";
      btn.title = "Switch user";
      btn.addEventListener("click", handleSwitchUser);
      sidebarUser.appendChild(btn);
    }
  }
}

function handleSwitchUser() {
  if (confirm("Switch user? This will show the login screen again.")) {
    clearSession();
    location.reload();
  }
}

// ============================================================
// IDENTITY MODAL
// ============================================================
function showIdentityModal(onReady) {
  const backdrop = document.createElement("div");
  backdrop.id = "identityBackdrop";
  backdrop.className = "identity-backdrop";

  backdrop.innerHTML = `
    <div class="identity-modal">
      <div class="identity-modal-logo">
        <span class="logo-mark">[F]</span>
        <span class="logo-text-id">FLOW</span>
      </div>
      <h2 class="identity-title">Who's this?</h2>
      <p class="identity-sub">Let FLOW know who's using it</p>
      <input
        type="text"
        id="identityNameInput"
        class="identity-input"
        placeholder="Enter your name"
        autocomplete="off"
        maxlength="50"
      />
      <p class="identity-error" id="identityError"></p>
      <button id="identityContinueBtn" class="btn-primary identity-continue-btn" disabled>
        Continue
      </button>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Animate in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add("visible"));
  });

  const input = document.getElementById("identityNameInput");
  const continueBtn = document.getElementById("identityContinueBtn");
  const errorEl = document.getElementById("identityError");

  setTimeout(() => input.focus(), 350);

  input.addEventListener("input", () => {
    continueBtn.disabled = !input.value.trim();
    errorEl.textContent = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !continueBtn.disabled) submitIdentity();
  });

  continueBtn.addEventListener("click", submitIdentity);

  async function submitIdentity() {
    const name = input.value.trim();
    if (!name) return;

    continueBtn.disabled = true;
    continueBtn.textContent = "One sec...";
    errorEl.textContent = "";

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) throw new Error("API error");
      const user = await res.json();

      setSession(user.id, user.name);
      applySidebarUser(user);

      // Load this user's theme before continuing
      if (typeof loadUserTheme === "function") {
        await loadUserTheme(user.id);
      }

      // Dismiss modal with animation
      backdrop.classList.remove("visible");
      setTimeout(() => {
        backdrop.remove();
        onReady();
      }, 380);
    } catch (err) {
      console.error("Identity submit error:", err);
      errorEl.textContent = "Could not connect — please try again";
      continueBtn.textContent = "Continue";
      continueBtn.disabled = false;
    }
  }
}

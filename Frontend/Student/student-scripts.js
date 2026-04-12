// --- Modal System for Students ---
function openModal(type) {
  const modalRoot = document.getElementById("modalRoot");
  if (!modalRoot) return;

  let title = "",
    body = "",
    action = "";

  if (type === "ticket") {
    title = "Raise Ticket";
    body = `
            <div class="form-grid">
                <input class="input" placeholder="Subject" />
                <select class="select">
                    <option>Technical Issue</option>
                    <option>Attendance Issue</option>
                    <option>Result Issue</option>
                    <option>Timetable Issue</option>
                </select>
                <textarea class="textarea" placeholder="Describe the issue..."></textarea>
            </div>
        `;
    action = "Submit Ticket";
  }

  modalRoot.innerHTML = `
        <div class="modal-backdrop" id="modalBackdrop">
            <div class="modal">
                <div class="modal-head">
                    <h3>${title}</h3>
                    <button class="icon-btn" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">${body}</div>
                <div class="modal-foot">
                    <button class="secondary-btn" onclick="closeModal()">Cancel</button>
                    <button class="primary-btn" onclick="submitModal('${action}')">${action}</button>
                </div>
            </div>
        </div>
    `;

  document.getElementById("modalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "modalBackdrop") closeModal();
  });
}

function closeModal() {
  const modalRoot = document.getElementById("modalRoot");
  if (modalRoot) modalRoot.innerHTML = "";
}

function submitModal(actionName) {
  closeModal();
  showToast(actionName, `${actionName} triggered successfully.`);
}

// --- Toast Notifications ---
function showToast(title, message) {
  const toastRoot = document.getElementById("toastRoot");
  if (!toastRoot) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
  toastRoot.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(16px)";
  }, 2600);
  setTimeout(() => toast.remove(), 3100);
}

// --- Profile Inline Edit Toggle ---
function spToggle(field, event) {
  const valEl = document.getElementById("sp_val_" + field);
  const inpEl = document.getElementById("sp_inp_" + field);
  const btn = event.target;

  if (btn.textContent === "Edit") {
    inpEl.value = valEl.textContent;
    inpEl.style.display = "block";
    valEl.style.display = "none";
    btn.textContent = "Save";
  } else {
    valEl.textContent = inpEl.value;
    inpEl.style.display = "none";
    valEl.style.display = "";
    btn.textContent = "Edit";
    showToast("Saved", field + " updated successfully.");
  }
}

// --- Theme Toggle ---
document.getElementById("themeBtn")?.addEventListener("click", () => {
  let theme = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = theme;
  document.getElementById("themeBtn").textContent =
    theme === "dark" ? "☾" : "☀";
});

// --- Mobile Hamburger Menu ---
document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

// --- Animated Counters ---
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".stat-value[data-target]").forEach((el) => {
    const target = parseFloat(el.dataset.target.replace(/,/g, ""));
    if (isNaN(target)) return;
    const duration = 1000;
    const start = performance.now();
    (function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent =
        Math.round(target * ease).toLocaleString() +
        (el.textContent.includes("%") ? "%" : "");
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  });
});

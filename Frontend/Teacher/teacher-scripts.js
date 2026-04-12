// --- Modal System for Teachers ---
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
                    <option>Attendance Problem</option>
                    <option>Result Change</option>
                    <option>Timetable Update</option>
                </select>
                <textarea class="textarea" placeholder="Describe the issue..."></textarea>
            </div>
        `;
    action = "Submit Ticket";
  } else if (type === "notification") {
    title = "Compose Notification";
    body = `
            <div class="form-grid">
                <input class="input" placeholder="Announcement title" />
                <textarea class="textarea" placeholder="Message for students..."></textarea>
                <select class="select">
                    <option>Send to all classes</option>
                    <option>Send to Class A</option>
                    <option>Send to Class B</option>
                </select>
            </div>
        `;
    action = "Send Notice";
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

// --- Auto-Highlight Active Navigation Link ---
document.addEventListener("DOMContentLoaded", () => {
  let currentPage = window.location.pathname.split("/").pop();
  if (currentPage === "") currentPage = "teacher-dashboard.html";

  document.querySelectorAll(".nav .nav-item").forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === currentPage) {
      link.classList.add("active");
    }
  });
});

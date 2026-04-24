// --- Theme Toggle ---
document.getElementById("themeBtn").addEventListener("click", () => {
  let theme = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = theme;
  document.getElementById("themeBtn").textContent =
    theme === "dark" ? "☾" : "☀";
});

// --- Mobile Hamburger Menu ---
document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

// --- Toast Notifications ---
function showToast(title, message) {
  const toastRoot = document.getElementById("toastRoot");
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
      el.textContent = Math.round(target * ease).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  });
});

// --- Auto-Highlight Active Navigation Link ---
document.addEventListener("DOMContentLoaded", () => {
    // Get the current file name from the URL (e.g., "users.html")
    let currentPage = window.location.pathname.split('/').pop();
    
    // Fallback in case the URL is just a directory root
    if (currentPage === "") currentPage = "dashboard.html"; 

    // Loop through all sidebar links
    document.querySelectorAll(".nav .nav-item").forEach(link => {
        // Remove the active class from all links first
        link.classList.remove("active");
        
        // If the link's href matches the current page, make it active
        if (link.getAttribute("href") === currentPage) {
            link.classList.add("active");
        }
    });
});
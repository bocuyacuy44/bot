/**
 * Setup scroll-to-top button
 */
export function setupScrollToTop() {
    const scrollTopBtn = document.getElementById("scrollTopBtn");
    if (!scrollTopBtn) {
        console.error("Scroll top button not found");
        return;
    }

    window.addEventListener("scroll", () => {
        scrollTopBtn.style.display = window.scrollY > 100 ? "block" : "none";
    });

    scrollTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type (success, danger, warning, info)
 */
export function showToast(message, type = "success") {
    let toastContainer = document.getElementById("toast-container");
    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "toast-container";
        toastContainer.className = "position-fixed bottom-0 end-0 p-3";
        toastContainer.style.zIndex = "9999";
        document.body.appendChild(toastContainer);
    }

    const bgColor =
        {
            success: "bg-success",
            danger: "bg-danger",
            warning: "bg-warning",
            info: "bg-info",
        }[type] || "bg-success";

    const icon =
        {
            success: "bi-check-circle-fill",
            danger: "bi-x-circle-fill",
            warning: "bi-megaphone-fill",
            info: "bi-info-circle-fill",
        }[type] || "bi-check-circle-fill";

    const toastId = `toast-${Date.now()}`;
    const toastHtml = `
    <div id="${toastId}" class="toast align-items-center text-white ${bgColor} border-0" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body">
          <i class="bi ${icon} me-2"></i> ${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

    toastContainer.insertAdjacentHTML("beforeend", toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, {
        autohide: true,
        delay: 3000,
    });
    toast.show();
    toastElement.addEventListener("hidden.bs.toast", () => toastElement.remove());
}

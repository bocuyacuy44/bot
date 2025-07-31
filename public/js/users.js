import { showToast } from "./utils.js";

let transactionModal = null;
let transactionPages = {};
let currentWhatsAppNumber = null;

/**
 * Load users from API and display in table
 */
export function loadUsers() {
    const tbody = document.getElementById("users-table");
    if (!tbody) {
        console.error("Users table element not found");
        return;
    }

    fetch("/api/users")
        .then((res) => {
            if (!res.ok) throw new Error(`Gagal mengambil users: ${res.status}`);
            return res.json();
        })
        .then((users) => {
            tbody.innerHTML = "";
            if (!Array.isArray(users)) {
                throw new Error("Data users bukan array");
            }
            users.forEach((user, index) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
          <td>
            <span class="masked-number" id="masked-${index}">${user.whatsapp_number}</span>
            <span class="full-number" id="full-${index}" style="display: none;">${user.whatsapp_number_full}</span>
            <button class="btn btn-outline-secondary btn-sm ms-2 reveal-btn" data-index="${index}" data-shown="false">
              <i class="bi bi-eye"></i>
            </button>
          </td>
          <td>${user.name}</td>
          <td>${user.total_chat}</td>
          <td>${user.total_transactions}</td>
          <td>
            <button class="btn btn-primary btn-sm btn-custom-user text-white view-details-btn" data-whatsapp="${user.whatsapp_number_full}">
              <i class="bi bi-eye-fill"></i> Lihat Detail
            </button>
          </td>
        `;
                tbody.appendChild(tr);
            });

            document.querySelectorAll(".reveal-btn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const index = btn.getAttribute("data-index");
                    const isShown = btn.getAttribute("data-shown") === "true";
                    if (isShown) {
                        document.getElementById(`masked-${index}`).style.display = "inline";
                        document.getElementById(`full-${index}`).style.display = "none";
                        btn.setAttribute("data-shown", "false");
                        btn.innerHTML = '<i class="bi bi-eye"></i>';
                    } else {
                        showPasswordModal(index, btn);
                    }
                });
            });

            document.querySelectorAll(".view-details-btn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const whatsappNumber = btn.dataset.whatsapp;
                    showTransactionDetails(whatsappNumber);
                });
            });
        })
        .catch((error) => {
            console.error("Error loading users:", error.message);
            tbody.innerHTML = `<tr><td colspan="5" class="text-danger">Gagal memuat daftar pelanggan</td></tr>`;
            showToast("Gagal memuat daftar pelanggan", "danger");
        });
}

/**
 * Update transaction table for a user
 * @param {string} whatsappNumber - User's WhatsApp number
 * @param {number} page - Current page number
 */
function updateTransactionTable(whatsappNumber, page = 1) {
    const limit = 5;
    transactionPages[whatsappNumber] = page;
    currentWhatsAppNumber = whatsappNumber;

    fetch(`/api/user-transactions/${whatsappNumber}?page=${page}&limit=${limit}`)
        .then((res) => res.json())
        .then((response) => {
            const tbody = document.getElementById("transaction-details");
            tbody.innerHTML = "";

            const transactions = response.data;
            for (let i = 0; i < 5; i++) {
                const tr = document.createElement("tr");
                if (i < transactions.length) {
                    const tx = transactions[i];
                    tr.innerHTML = `
            <td>${tx.order_id}</td>
            <td>${tx.nama}</td>
            <td>${tx.quantity} pcs</td>
            <td>Rp${parseInt(tx.total_price).toLocaleString("id-ID")}</td>
            <td>${new Date(tx.created_at).toLocaleString("id-ID")}</td>
          `;
                } else {
                    tr.classList.add("empty-row");
                    tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td>`;
                }
                tbody.appendChild(tr);
            }

            const { page: current, totalPages } = response.pagination;
            const prevBtn = document.getElementById("prev-transaction");
            const nextBtn = document.getElementById("next-transaction");
            const pageInfo = document.getElementById("transaction-page-info");

            prevBtn.classList.toggle("disabled", current === 1);
            nextBtn.classList.toggle("disabled", current >= totalPages);
            pageInfo.innerHTML = `<span class="page-link">Halaman ${current} dari ${totalPages}</span>`;

            prevBtn.onclick = () =>
                current > 1 && updateTransactionTable(whatsappNumber, current - 1);
            nextBtn.onclick = () =>
                current < totalPages &&
                updateTransactionTable(whatsappNumber, current + 1);
        })
        .catch((error) => {
            console.error("Error updating transaction table:", error.message);
            showToast("Gagal memuat transaksi pelanggan", "danger");
        });
}

/**
 * Show transaction details modal
 * @param {string} whatsappNumber - User's WhatsApp number
 * @param {number} page - Current page number
 */
export function showTransactionDetails(whatsappNumber, page = 1) {
    if (!transactionModal) {
        transactionModal = new bootstrap.Modal(
            document.getElementById("transactionModal")
        );
    }
    updateTransactionTable(whatsappNumber, page);
    transactionModal.show();
}

/**
 * Show password modal for revealing full WhatsApp number
 * @param {number} index - User index in table
 * @param {HTMLElement} btn - Reveal button element
 */
function showPasswordModal(index, btn) {
    const modal = new bootstrap.Modal(document.getElementById("passwordModal"));
    const form = document.getElementById("password-form");
    const error = document.getElementById("password-error");
    error.style.display = "none";

    form.onsubmit = (e) => {
        e.preventDefault();
        const password = document.getElementById("reveal-password").value;
        fetch("/api/verify-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    document.getElementById(`masked-${index}`).style.display = "none";
                    document.getElementById(`full-${index}`).style.display = "inline";
                    btn.setAttribute("data-shown", "true");
                    btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
                    modal.hide();
                } else {
                    error.textContent = data.error || "Password salah";
                    error.style.display = "block";
                }
            })
            .catch((error) => {
                error.textContent = `Error: ${error.message}`;
                error.style.display = "block";
            });
    };
    modal.show();
}

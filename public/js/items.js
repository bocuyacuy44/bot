import { showToast } from "./utils.js";

let lastUpdatedProductId = null;
let lastOperationType = null;
let itemForm = null;
let submitBtn = null;
let gambarInput = null;

/**
 * Initialize item management
 */
export function initItems() {
    itemForm = document.getElementById("item-form");
    submitBtn = document.getElementById("submit-btn");
    gambarInput = document.getElementById("gambar-input");

    if (itemForm) {
        itemForm.addEventListener("submit", handleFormSubmit);
        itemForm.addEventListener("reset", resetItemForm);
    }

    const cancelButton = document.getElementById("cancel-btn");
    if (cancelButton) {
        cancelButton.addEventListener("click", resetItemForm);
    }

    const addItemButton = document.querySelector(".add-item-btn");
    if (addItemButton) {
        addItemButton.addEventListener("click", () => {
            if (
                !document
                    .getElementById("item-form-container")
                    .classList.contains("show")
            ) {
                resetItemForm();
            }
        });
    }

    loadItems();
}

/**
 * Load items from API and display in table
 */
export function loadItems() {
    const tbody = document.getElementById("items-table");
    if (!tbody) {
        console.error("Items table element not found");
        return;
    }

    fetch("/api/items")
        .then((res) => {
            if (!res.ok) throw new Error("Gagal memuat data produk");
            return res.json();
        })
        .then((items) => {
            tbody.innerHTML = "";
            if (items.length === 0) {
                tbody.innerHTML =
                    '<tr><td colspan="7" class="text-center">Tidak ada produk</td></tr>';
                return;
            }

            items.forEach((item, index) => {
                const timestamp = new Date().getTime();
                const imageUrl = `/api/items/${item.id}/image?t=${timestamp}`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
          <td>${index + 1}</td>
          <td><img src="${imageUrl}" alt="Gambar ${item.nama
                    }" width="40" height="40" class="rounded" id="product-img-${item.id}" 
              data-bs-toggle="tooltip" data-bs-placement="top" title="Klik untuk memperbesar" 
              onerror="this.src='placeholder.jpg';"></td>
          <td>${item.nama}</td>
          <td>Rp${parseInt(item.harga).toLocaleString("id-ID")}</td>
          <td>${item.stok}</td>
          <td class="text-truncate" style="max-width: 150px;">${item.deskripsi || "Tidak ada deskripsi"
                    }</td>
          <td class="text-center">
            <div class="d-flex justify-content-center gap-1">
              <button class="btn btn-sm btn-primary action-btn edit-btn" data-id="${item.id
                    }" title="Edit Produk">
                <i class="bi bi-pencil-fill"></i>
              </button>
              <button class="btn btn-sm btn-danger action-btn delete-btn" data-id="${item.id
                    }" title="Hapus Produk">
                <i class="bi bi-trash-fill"></i>
              </button>
              <button class="btn btn-sm btn-success action-btn promote-btn" 
                      data-id="${item.id}" 
                      data-nama="${item.nama}" 
                      data-harga="${item.harga}" 
                      data-deskripsi="${item.deskripsi || "Tidak ada deskripsi"
                    }" 
                      data-image="${imageUrl}" 
                      title="Promosikan Produk">
                <i class="bi bi-megaphone-fill"></i>
              </button>
            </div>
          </td>
        `;
                tbody.appendChild(tr);
            });

            // Add event listeners for action buttons
            document.querySelectorAll(".edit-btn").forEach((btn) => {
                btn.addEventListener("click", () => editItem(Number(btn.dataset.id)));
            });
            document.querySelectorAll(".delete-btn").forEach((btn) => {
                btn.addEventListener("click", () => deleteItem(Number(btn.dataset.id)));
            });
            document.querySelectorAll(".promote-btn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const { id, nama, harga, deskripsi, image } = btn.dataset;
                    promoteItem(Number(id), nama, Number(harga), deskripsi, image);
                });
            });

            const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltips.forEach((tooltip) => new bootstrap.Tooltip(tooltip));

            document.querySelectorAll("#items-table img").forEach((img) => {
                img.addEventListener("click", () => {
                    if (!img.classList.contains("enlarged")) {
                        img.classList.add("enlarged");
                        setTimeout(() => {
                            document.addEventListener("click", function closeEnlarged(e) {
                                if (e.target !== img) {
                                    img.classList.remove("enlarged");
                                    document.removeEventListener("click", closeEnlarged);
                                }
                            });
                        }, 10);
                    } else {
                        img.classList.remove("enlarged");
                    }
                });
            });

            if (lastUpdatedProductId) {
                setTimeout(() => {
                    refreshProductImage(lastUpdatedProductId);
                    lastUpdatedProductId = null;
                }, 100);
            }
        })
        .catch((error) => {
            tbody.innerHTML =
                '<tr><td colspan="7" class="text-center text-danger">Error: Gagal memuat data</td></tr>';
            showToast("Gagal memuat data produk", "danger");
        });
}

/**
 * Handle item form submission
 * @param {Event} e - Form submission event
 */
function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const id = document.getElementById("item-id").value;

    const url = id ? `/api/items/${id}` : "/api/items";
    const method = id ? "PUT" : "POST";
    lastOperationType = id ? "edit" : "add";

    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Loading...';

    fetch(url, { method, body: formData })
        .then((res) => {
            if (!res.ok) {
                return res.text().then((text) => {
                    throw new Error(`Gagal ${id ? "update" : "tambah"} barang: ${text}`);
                });
            }
            return res.json();
        })
        .then((data) => {
            if (data.success) {
                lastUpdatedProductId = id || data.product?.id || data.id;
                const productName = formData.get("nama");
                const actionType = id ? "diperbarui" : "ditambahkan";

                loadItems();

                const itemFormContainer = document.getElementById(
                    "item-form-container"
                );
                if (itemFormContainer && bootstrap) {
                    new bootstrap.Collapse(itemFormContainer, { hide: true });
                }

                setTimeout(() => {
                    resetItemForm();
                    showToast(
                        `Produk "${productName}" berhasil ${actionType}!`,
                        "success"
                    );
                }, 300);
            } else {
                throw new Error("Respon server tidak valid");
            }
        })
        .catch((error) => {
            showToast(`Error: ${error.message}`, "danger");
        })
        .finally(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        });
}

/**
 * Reset item form to initial state
 */
function resetItemForm() {
    const itemIdField = document.getElementById("item-id");
    if (itemIdField) itemIdField.value = "";

    if (submitBtn) {
        submitBtn.textContent = "Tambah";
        submitBtn.classList.remove("btn-success");
        submitBtn.classList.add("btn-primary");
    }

    if (gambarInput) gambarInput.setAttribute("required", "true");

    const formTitle = document.getElementById("form-title");
    if (formTitle) formTitle.textContent = "Tambah Produk Baru";

    const formActionText = document.getElementById("form-action-text");
    if (formActionText) formActionText.textContent = "Tambah Produk";

    const btnIcon = document.querySelector(".add-item-btn i");
    if (btnIcon) {
        btnIcon.classList.remove("bi-pencil-fill");
        btnIcon.classList.add("bi-plus-circle");
    }

    if (itemForm) {
        itemForm.reset();
        ["nama", "harga", "stok", "deskripsi"].forEach((field) => {
            if (itemForm[field]) itemForm[field].value = "";
        });
    }

    lastOperationType = null;
}

/**
 * Edit an item
 * @param {number} id - Item ID
 */
export function editItem(id) {
    fetch("/api/items")
        .then((res) => {
            if (!res.ok) throw new Error("Gagal memuat data produk");
            return res.json();
        })
        .then((items) => {
            const item = items.find((i) => i.id === id);
            if (!item) {
                showToast("Barang tidak ditemukan", "danger");
                return;
            }

            document.getElementById("item-id").value = item.id;
            if (itemForm.nama) itemForm.nama.value = item.nama || "";
            if (itemForm.harga) itemForm.harga.value = item.harga || 0;
            if (itemForm.stok) itemForm.stok.value = item.stok || 0;
            if (itemForm.deskripsi) itemForm.deskripsi.value = item.deskripsi || "";

            if (gambarInput) gambarInput.removeAttribute("required");

            if (submitBtn) {
                submitBtn.textContent = "Simpan Perubahan";
                submitBtn.classList.remove("btn-primary");
                submitBtn.classList.add("btn-success");
            }

            const formTitle = document.getElementById("form-title");
            if (formTitle) formTitle.textContent = `Edit Produk: ${item.nama}`;

            const formActionText = document.getElementById("form-action-text");
            if (formActionText) formActionText.textContent = "Edit Produk";

            const btnIcon = document.querySelector(".add-item-btn i");
            if (btnIcon) {
                btnIcon.classList.remove("bi-plus-circle");
                btnIcon.classList.add("bi-pencil-fill");
            }

            const itemFormContainer = document.getElementById("item-form-container");
            if (
                itemFormContainer &&
                itemFormContainer.classList.contains("collapse")
            ) {
                new bootstrap.Collapse(itemFormContainer, { show: true });
            }

            const addItemBtn = document.querySelector(".add-item-btn");
            if (addItemBtn) addItemBtn.scrollIntoView({ behavior: "smooth" });
        })
        .catch((error) => {
            showToast(`Error: ${error.message}`, "danger");
        });
}

/**
 * Delete an item
 * @param {number} id - Item ID
 */
export function deleteItem(id) {
    fetch("/api/items")
        .then((res) => {
            if (!res.ok) throw new Error("Gagal memuat data produk");
            return res.json();
        })
        .then((items) => {
            const item = items.find((i) => i.id === id);
            if (!item) {
                showToast("Produk tidak ditemukan", "danger");
                return;
            }

            const modal = new bootstrap.Modal(document.getElementById("deleteModal"));
            const productName = document.getElementById("delete-product-name");
            const confirmBtn = document.getElementById("confirm-delete-btn");
            const btnText = document.getElementById("delete-btn-text");
            const loadingSpinner = document.getElementById("delete-loading");

            productName.textContent = item.nama;
            modal.show();

            confirmBtn.onclick = () => {
                btnText.textContent = "Menghapus...";
                loadingSpinner.classList.remove("d-none");
                confirmBtn.disabled = true;

                fetch(`/api/items/${id}`, { method: "DELETE" })
                    .then((res) => {
                        if (!res.ok) throw new Error("Gagal menghapus produk");
                        return res;
                    })
                    .then(() => {
                        loadItems();
                        showToast(`Produk "${item.nama}" berhasil dihapus!`, "danger");
                        modal.hide();
                    })
                    .catch((error) => {
                        showToast(`Error: ${error.message}`, "danger");
                    })
                    .finally(() => {
                        btnText.textContent = "Hapus";
                        loadingSpinner.classList.add("d-none");
                        confirmBtn.disabled = false;
                    });
            };
        })
        .catch((error) => {
            showToast(`Error: ${error.message}`, "danger");
        });
}

/**
 * Promote an item to customers
 * @param {number} id - Item ID
 * @param {string} nama - Item name
 * @param {number} harga - Item price
 * @param {string} deskripsi - Item description
 * @param {string} imageUrl - Item image URL
 */
export function promoteItem(
    id,
    nama,
    harga,
    deskripsi = "Tidak ada deskripsi",
    imageUrl = `/api/items/${id}/image?t=${new Date().getTime()}`
) {
    const modal = new bootstrap.Modal(document.getElementById("promotionModal"));
    const productImg = document.getElementById("promo-product-img");
    const productName = document.getElementById("promo-product-name");
    const productPrice = document.getElementById("promo-product-price");
    const productDesc = document.getElementById("promo-product-desc");
    const messagePreview = document.getElementById("promo-message-preview");
    const confirmBtn = document.getElementById("confirm-promo-btn");
    const btnText = document.getElementById("promo-btn-text");
    const loadingSpinner = document.getElementById("promo-loading");

    productImg.src = imageUrl;
    productImg.onerror = () => {
        productImg.src = "placeholder.jpg";
    };
    productName.textContent = nama;
    productPrice.textContent = `Rp${parseInt(harga).toLocaleString("id-ID")}`;
    productDesc.textContent = deskripsi;
    messagePreview.textContent = `✨ *Promo Spesial!* ✨\nProduk: *${nama}*\nHarga: Rp${parseInt(
        harga
    ).toLocaleString(
        "id-ID"
    )}\nDeskripsi: ${deskripsi}\nCek sekarang di Toko Lena Kerudung!`;

    modal.show();

    confirmBtn.onclick = () => {
        btnText.textContent = "Mengirim...";
        loadingSpinner.classList.remove("d-none");
        confirmBtn.disabled = true;

        fetch("/api/promote-product", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, nama, harga, deskripsi }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    showToast(
                        `Produk "${nama}" berhasil dipromosikan ke semua pelanggan!`,
                        "success"
                    );
                    modal.hide();
                } else {
                    throw new Error(data.error || "Gagal mempromosikan produk");
                }
            })
            .catch((error) => {
                showToast(`Error: ${error.message}`, "danger");
            })
            .finally(() => {
                btnText.textContent = "Kirim Promosi";
                loadingSpinner.classList.add("d-none");
                confirmBtn.disabled = false;
            });
    };
}

/**
 * Refresh product image after update
 * @param {number} productId - Product ID
 */
function refreshProductImage(productId) {
    const imgElement = document.getElementById(`product-img-${productId}`);
    if (!imgElement) return;

    imgElement.classList.add("refreshing-image");
    const timestamp = new Date().getTime();
    const newSrc = `/api/items/${productId}/image?t=${timestamp}`;

    const tempImg = new Image();
    tempImg.onload = function () {
        imgElement.src = newSrc;
        imgElement.classList.remove("refreshing-image");

        if (lastOperationType === "add") {
            imgElement.classList.add("new-image");
            const tr = imgElement.closest("tr");
            if (tr) {
                tr.classList.add("new-product-row");
                setTimeout(() => tr.classList.remove("new-product-row"), 3000);
            }
        } else {
            imgElement.classList.add("updated-image");
        }

        imgElement.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
            imgElement.classList.remove("updated-image");
            imgElement.classList.remove("new-image");
        }, 3000);
    };
    tempImg.src = newSrc;
}

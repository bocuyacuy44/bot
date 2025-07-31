import { showToast } from "./utils.js";

/**
 * Initialize print Excel button
 */
export function initPrintExcelButton() {
    const printExcelBtn = document.getElementById("print-excel-btn");
    if (printExcelBtn) {
        printExcelBtn.addEventListener("click", exportInvoicesToExcel);
    } else {
        console.error("Print Excel button not found");
    }
}

/**
 * Fetch invoices from API and display in table
 * @param {number} page - Current page number
 * @param {number} limit - Number of items per page
 * @param {string|null} orderId - Specific order ID to fetch
 */
export async function fetchInvoices(page = 1, limit = 10, orderId = null) {
    const invoiceTable = document.getElementById("invoice-table");
    if (!invoiceTable) {
        console.error("Invoice table element not found");
        return;
    }

    try {
        let url = `/api/invoices?page=${page}&limit=${limit}`;
        if (orderId) url = `/api/invoices?order_id=${orderId}`;

        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Gagal mengambil invoices: ${response.status}`);

        const { data, pagination } = await response.json();

        invoiceTable.innerHTML = "";

        if (data.length === 0) {
            invoiceTable.innerHTML = `<tr><td colspan="9" class="text-center">Tidak ada data invoice.</td></tr>`;
            return;
        }

        data.forEach((invoice) => {
            const row = document.createElement("tr");
            row.innerHTML = `
        <td>${invoice.order_id}</td>
        <td>${new Date(invoice.created_at).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            })}</td>
        <td>${invoice.whatsapp_number}</td>
        <td>${invoice.product_name}</td>
        <td>${invoice.quantity} pcs</td>
        <td>Rp${parseInt(invoice.unit_price).toLocaleString("id-ID")}</td>
        <td>Rp${parseInt(invoice.total_price).toLocaleString("id-ID")}</td>
        <td>
          <span class="badge bg-${invoice.status === "paid"
                    ? "success"
                    : invoice.status === "shipped"
                        ? "primary"
                        : "info"
                }">
            ${invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
          </span>
        </td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary print-invoice-btn" data-id="${invoice.order_id
                }">
            <i class="bi bi-printer"></i>
          </button>
        </td>
      `;
            invoiceTable.appendChild(row);
        });

        if (!orderId) {
            setupInvoicePagination(pagination, limit);
        }

        document.querySelectorAll(".print-invoice-btn").forEach((btn) => {
            btn.addEventListener("click", () => printInvoice(btn.dataset.id));
        });
    } catch (error) {
        console.error("Error fetching invoices:", error.message);
        invoiceTable.innerHTML = `<tr><td colspan="9" class="text-danger">Gagal memuat daftar invoice</td></tr>`;
        showToast("Gagal memuat daftar invoice", "danger");
    }
}

/**
 * Setup pagination for invoices
 * @param {Object} pagination - Pagination data
 * @param {number} limit - Number of items per page
 */
function setupInvoicePagination(pagination, limit) {
    const pageInfo = document.getElementById("invoice-page-info");
    const prevBtn = document.getElementById("prev-invoice");
    const nextBtn = document.getElementById("next-invoice");

    if (!pageInfo || !prevBtn || !nextBtn) {
        console.error("Invoice pagination elements not found");
        return;
    }

    pageInfo.querySelector(
        "span"
    ).textContent = `Halaman ${pagination.page} dari ${pagination.totalPages}`;
    prevBtn.classList.toggle("disabled", pagination.page === 1);
    nextBtn.classList.toggle(
        "disabled",
        pagination.page >= pagination.totalPages
    );

    prevBtn.onclick = () =>
        pagination.page > 1 && fetchInvoices(pagination.page - 1, limit);
    nextBtn.onclick = () =>
        pagination.page < pagination.totalPages &&
        fetchInvoices(pagination.page + 1, limit);
}

/**
 * Export invoices to Excel
 */
export function exportInvoicesToExcel() {
    fetch("/api/invoices?limit=1000")
        .then((res) => res.json())
        .then(({ data }) => {
            const ws = XLSX.utils.json_to_sheet(
                data.map((invoice) => ({
                    "ID Invoice": invoice.order_id,
                    Tanggal: new Date(invoice.created_at).toLocaleDateString("id-ID"),
                    Pelanggan: invoice.whatsapp_number,
                    Produk: invoice.product_name,
                    Jumlah: invoice.quantity,
                    Harga: `Rp${parseInt(invoice.unit_price).toLocaleString("id-ID")}`,
                    Total: `Rp${parseInt(invoice.total_price).toLocaleString("id-ID")}`,
                    Status: invoice.status,
                }))
            );
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Invoices");
            XLSX.writeFile(
                wb,
                `invoices_${new Date().toLocaleDateString("id-ID")}.xlsx`
            );
        })
        .catch((error) => {
            console.error("Error exporting invoices:", error.message);
            showToast("Gagal mengekspor invoices ke Excel", "danger");
        });
}

/**
 * Print invoice as PDF
 * @param {string} orderId - Invoice order ID
 */
export async function printInvoice(orderId) {
    try {
        const response = await fetch(`/api/invoices?order_id=${orderId}`);
        const { data } = await response.json();
        const invoice = data[0];

        if (!invoice) {
            showToast("Data invoice tidak ditemukan!", "danger");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: [100, 200],
        });

        let y = 8;
        doc.setFontSize(14);
        doc.text("Lena Kerudung", 50, y, { align: "center" });
        y += 6;
        doc.setFontSize(9);
        doc.text(
            "Jl. Pajagalan, Kec. Cicalengka, Kab. Bandung, Jawa Barat",
            50,
            y,
            { align: "center" }
        );
        y += 5;
        doc.text("Whatsapp: +6281912812802", 50, y, { align: "center" });
        y += 6;
        doc.line(5, y, 95, y);
        y += 6;

        doc.setFontSize(9);
        doc.text(`Pelanggan: ${invoice.whatsapp_number}`, 5, y);
        y += 6;
        doc.text(
            `Tanggal: ${new Date(invoice.created_at).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "long",
                year: "numeric",
            })}`,
            5,
            y
        );
        y += 6;
        doc.text(`ID Invoice: ${invoice.order_id}`, 5, y);
        y += 5;
        doc.line(5, y, 95, y);
        y += 6;

        doc.setFont("helvetica", "bold");
        doc.text("Produk", 5, y);
        doc.text("Jml", 40, y, { align: "right" });
        doc.text("Harga", 65, y, { align: "right" });
        doc.text("Total", 95, y, { align: "right" });
        doc.setFont("helvetica", "normal");
        y += 4;
        doc.line(5, y, 95, y);
        y += 6;

        doc.text(invoice.product_name, 5, y);
        doc.text(`${invoice.quantity}`, 40, y, { align: "right" });
        doc.text(
            `Rp${parseInt(invoice.unit_price).toLocaleString("id-ID")}`,
            65,
            y,
            { align: "right" }
        );
        doc.text(
            `Rp${(parseInt(invoice.unit_price) * invoice.quantity).toLocaleString(
                "id-ID"
            )}`,
            95,
            y,
            { align: "right" }
        );
        y += 5;
        doc.line(5, y, 95, y);
        y += 6;

        doc.setFont("helvetica", "bold");
        doc.text("Total", 5, y);
        doc.text(
            `Rp${parseInt(invoice.total_price).toLocaleString("id-ID")}`,
            95,
            y,
            { align: "right" }
        );
        doc.setFont("helvetica", "normal");
        y += 4;
        doc.line(5, y, 95, y);
        y += 6;

        doc.setFontSize(9);
        doc.text("Terima kasih atas pembelian Anda!", 50, y, { align: "center" });
        y += 5;
        doc.text("Hubungi kami untuk pertanyaan", 50, y, { align: "center" });
        y += 5;
        doc.text("atau pengembalian.", 50, y, { align: "center" });

        const filename = `Invoice-Lena Kerudung.pdf`;
        doc.save(filename);
    } catch (error) {
        showToast("Gagal mencetak resi. Silakan coba lagi.", "danger");
    }
}

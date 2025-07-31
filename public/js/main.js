import { setupWebSocket, pollStatus } from "./websocket.js";
import {
    fetchInvoices,
    exportInvoicesToExcel,
    printInvoice,
    initPrintExcelButton,
} from "./invoices.js";
import {
    initItems,
    loadItems,
    editItem,
    deleteItem,
    promoteItem,
} from "./items.js";
import { loadUsers, showTransactionDetails } from "./users.js";
import {
    updateStats,
    updateMessageChart,
    updateTransactionChart,
} from "./stats.js";
import { setupScrollToTop, showToast } from "./utils.js";
import { initLocationForm } from "./location.js";

/**
 * Initialize the application
 */
function initApp() {
    try {
        // Initialize WebSocket and polling
        setupWebSocket();
        pollStatus();

        // Initialize items management
        initItems();

        // Initialize location form
        initLocationForm();

        // Fetch initial data
        fetchInvoices();
        loadUsers();
        updateStats();
        updateMessageChart();
        updateTransactionChart();

        // Initialize print Excel button
        initPrintExcelButton();

        // Setup scroll-to-top button
        setupScrollToTop();

        // Set interval for periodic updates
        setInterval(() => {
            updateStats();
            updateMessageChart();
            updateTransactionChart();
        }, 5000);
    } catch (error) {
        console.error("Error initializing app:", error.message);
        showToast("Gagal menginisialisasi aplikasi", "danger");
    }
}

// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", initApp);

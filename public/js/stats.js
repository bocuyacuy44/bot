import { showToast } from "./utils.js";

/**
 * Update statistics for messages, users, products, and transactions
 */
export function updateStats() {
    const endpoints = [
        {
            url: "/api/message-stats",
            elementId: "incoming-messages",
            key: "incoming",
        },
        { url: "/api/user-stats", elementId: "total-users", key: "total" },
        { url: "/api/product-stats", elementId: "total-products", key: "total" },
        {
            url: "/api/transaction-stats",
            elementId: "total-transactions",
            key: "total",
        },
    ];

    endpoints.forEach(({ url, elementId, key }) => {
        fetch(url)
            .then((res) => res.json())
            .then((stats) => {
                const element = document.getElementById(elementId);
                if (element) {
                    element.textContent = stats[key];
                }
            })
            .catch((error) =>
                console.error(`Error updating ${elementId}:`, error.message)
            );
    });
}

/**
 * Update weekly message chart
 */
export function updateMessageChart() {
    const canvas = document.getElementById("weeklyMessageChart");
    if (!canvas) {
        console.error("Weekly message chart element not found");
        return;
    }

    fetch("/api/weekly-message-stats")
        .then((res) => {
            if (!res.ok)
                throw new Error(`Gagal mengambil weekly-message-stats: ${res.status}`);
            return res.json();
        })
        .then((data) => {
            if (!Array.isArray(data) || data.length !== 7) {
                throw new Error(
                    `Data weekly-message-stats tidak valid: ${JSON.stringify(data)}`
                );
            }
            const validData = data.map((val) => (isNaN(val) ? 0 : Number(val)));
            const labels = [
                "Senin",
                "Selasa",
                "Rabu",
                "Kamis",
                "Jumat",
                "Sabtu",
                "Minggu",
            ];
            const ctx = canvas.getContext("2d");

            if (window.messageChart) {
                window.messageChart.data.datasets[0].data = validData;
                window.messageChart.update();
            } else {
                window.messageChart = new Chart(ctx, {
                    type: "line",
                    data: {
                        labels,
                        datasets: [
                            {
                                label: "Pesan Masuk",
                                data: validData,
                                borderColor: "#007bff",
                                backgroundColor: "rgba(0, 123, 255, 0.1)",
                                fill: true,
                                tension: 0.4,
                            },
                        ],
                    },
                    options: {
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: { display: true, text: "Jumlah Pesan" },
                                ticks: { stepSize: 1 },
                                suggestedMax: Math.max(...validData, 5) + 1,
                            },
                            x: { title: { display: true, text: "Hari" } },
                        },
                        plugins: { legend: { display: false } },
                    },
                });
            }
        })
        .catch((error) => {
            console.error("Error updating message chart:", error.message);
            canvas.parentElement.innerHTML =
                '<p class="text-danger">Gagal memuat grafik pesan mingguan</p>';
            showToast("Gagal memuat grafik pesan mingguan", "danger");
        });
}

/**
 * Update weekly transaction chart
 */
export function updateTransactionChart() {
    const canvas = document.getElementById("weeklyTransactionChart");
    if (!canvas) {
        console.error("Weekly transaction chart element not found");
        return;
    }

    fetch("/api/weekly-transaction-stats")
        .then((res) => {
            if (!res.ok)
                throw new Error(
                    `Gagal mengambil weekly-transaction-stats: ${res.status}`
                );
            return res.json();
        })
        .then((data) => {
            if (!Array.isArray(data) || data.length !== 7) {
                throw new Error(
                    `Data weekly-transaction-stats tidak valid: ${JSON.stringify(data)}`
                );
            }
            const validData = data.map((val) => (isNaN(val) ? 0 : Number(val)));
            const labels = [
                "Senin",
                "Selasa",
                "Rabu",
                "Kamis",
                "Jumat",
                "Sabtu",
                "Minggu",
            ];
            const ctx = canvas.getContext("2d");

            if (window.transactionChart) {
                window.transactionChart.data.datasets[0].data = validData;
                window.transactionChart.update();
            } else {
                window.transactionChart = new Chart(ctx, {
                    type: "bar",
                    data: {
                        labels,
                        datasets: [
                            {
                                label: "Total Transaksi",
                                data: validData,
                                backgroundColor: [
                                    "#ff6384",
                                    "#36a2eb",
                                    "#ffce56",
                                    "#4bc0c0",
                                    "#9966ff",
                                    "#ff9f40",
                                    "#c9cbcf",
                                ],
                                borderColor: "#fff",
                                borderWidth: 1,
                            },
                        ],
                    },
                    options: {
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: { display: true, text: "Jumlah Transaksi" },
                                ticks: { stepSize: 1 },
                                suggestedMax: Math.max(...validData, 5) + 1,
                            },
                            x: { title: { display: true, text: "Hari" } },
                        },
                        plugins: { legend: { display: false } },
                        animation: { duration: 1500, easing: "easeOutBounce" },
                    },
                });
            }
        })
        .catch((error) => {
            console.error("Error updating transaction chart:", error.message);
            canvas.parentElement.innerHTML =
                '<p class="text-danger">Gagal memuat grafik transaksi mingguan</p>';
            showToast("Gagal memuat grafik transaksi mingguan", "danger");
        });
}

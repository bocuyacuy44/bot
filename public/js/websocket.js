/**
 * Setup WebSocket connection for real-time bot status updates
 */
export function setupWebSocket() {
  const ws = new WebSocket("ws://localhost:3000");

  ws.onopen = () => {
    console.log("WebSocket connection established");
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    const statusElement = document.getElementById("status");
    if (statusElement) {
      statusElement.textContent = "Gagal terhubung ke server WebSocket.";
    }
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed. Attempting to reconnect...");
    const statusElement = document.getElementById("status");
    if (statusElement) {
      statusElement.textContent = "Koneksi WebSocket terputus. Mencoba ulang...";
    }
    setTimeout(() => setupWebSocket(), 5000); // Reconnect after 5 seconds
  };

  ws.onmessage = (event) => {
    console.log("WebSocket message received:", event.data); // Debug pesan
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      return;
    }

    const statusElement = document.getElementById("status");
    const qrCodeElement = document.getElementById("qr-code");

    if (!statusElement || !qrCodeElement) {
      console.error("Status or QR code element not found");
      return;
    }

    if (data.qr) {
      qrCodeElement.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
        data.qr
      )}&size=200x200" alt="QR Code">`;
      statusElement.textContent = "Scan QR ini!";
    }
    if (data.status === "connected") {
      qrCodeElement.innerHTML = "";
      statusElement.textContent = "Bot Terhubung!";
    }
    if (data.status === "loggedOut") {
      qrCodeElement.innerHTML = "";
      statusElement.textContent = "Bot Logout. Menunggu QR baru...";
    }
  };
}

/**
 * Poll bot status periodically
 */
export function pollStatus() {
  setInterval(() => {
    fetch("/api/status")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! Status: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        console.log("Poll status response:", data); // Debug respons
        const statusElement = document.getElementById("status");
        const qrCodeElement = document.getElementById("qr-code");
        if (statusElement && qrCodeElement) {
          if (data.status === "OK" && data.connected) {
            statusElement.textContent = "Bot Terhubung!";
            qrCodeElement.innerHTML = "";
          } else if (data.status === "OK" && !data.connected) {
            statusElement.textContent = "Menunggu QR atau koneksi bot...";
          } else {
            statusElement.textContent = "Status server tidak diketahui.";
          }
        }
      })
      .catch((error) => {
        console.error("Error polling status:", error.message);
        const statusElement = document.getElementById("status");
        if (statusElement) {
          statusElement.textContent = "Gagal memeriksa status bot.";
        }
      });
  }, 5000);
}

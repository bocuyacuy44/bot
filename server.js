const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState } = require("@whiskeysockets/baileys");
const express = require("express");
const WebSocket = require("ws");
const mysql = require("mysql2");
const formidable = require("formidable");
const md5 = require("md5");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });
let qrCode = null;
const axios = require("axios");

// Koneksi MySQL
let db;

// Fungsi untuk koneksi database dengan promise
function connectDatabase() {
  return new Promise((resolve, reject) => {
    // Tutup koneksi lama jika ada
    if (db) {
      db.end(() => {
        createNewConnection();
      });
    } else {
      createNewConnection();
    }

    function createNewConnection() {
      db = mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        reconnect: true,
        idleTimeout: 300000,
        acquireTimeout: 60000,
        timeout: 60000,
      });

      db.connect((err) => {
        if (err) {
          console.error("❌ Koneksi database gagal:", err);
          // Coba reconnect setelah 3 detik
          setTimeout(() => {
            connectDatabase().then(resolve).catch(reject);
          }, 3000);
        } else {
          console.log("✅ Koneksi ke database berhasil!");

          // Test koneksi dengan query sederhana
          db.query("SELECT 1", (testErr) => {
            if (testErr) {
              console.error("❌ Test query gagal:", testErr);
              reject(testErr);
            } else {
              console.log("✅ Database siap digunakan!");
              resolve(db);
            }
          });
        }
      });

      // Handle error pada koneksi
      db.on("error", (err) => {
        console.error("Database error:", err);
        if (err.code === "PROTOCOL_CONNECTION_LOST") {
          connectDatabase();
        }
      });
    }
  });
}

// Initial connection
connectDatabase().catch(console.error);

// Middleware Express (urutan penting!)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// Middleware cek login
function isAuthenticated(req, res, next) {
  if (req.session.loggedin) return next();
  res.redirect("/login");
}

// Routes (sebelum static files)
app.get("/", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
  if (req.session.loggedin) return res.redirect("/"); // Kalau udah login, ke dashboard
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = md5(password);

  db.query(
    "SELECT * FROM admins WHERE username = ? AND password = ?",
    [username, hashedPassword],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(401).json({ error: "Username atau password salah" });
      }
      req.session.loggedin = true;
      req.session.username = username;
      res.json({ success: true });
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Static files (setelah routes)
app.use(express.static(path.join(__dirname, "public")));

// WebSocket untuk QR
wss.on("connection", (ws) => {
  if (qrCode) ws.send(JSON.stringify({ qr: qrCode }));
  if (botConnected) ws.send(JSON.stringify({ status: "connected" }));
});

// Bot WhatsApp
const userState = {};
let sockInstance; // Simpen instance sock global
let botConnected = false; // Tambah flag buat cek koneksi
let botReadyPromise; // Promise buat tunggu koneksi

async function resetWeeklyStats(currentDate) {
  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1); // Senin minggu ini
  weekStart.setHours(0, 0, 0, 0);

  // Hitung total pesan minggu lalu
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const lastWeekEnd = new Date(weekStart);
  lastWeekEnd.setDate(weekStart.getDate() - 1);
  lastWeekEnd.setHours(23, 59, 59, 999);

  db.query(
    "SELECT SUM(jumlah_pesan) as total FROM pesan_mingguan WHERE tanggal BETWEEN ? AND ?",
    [lastWeekStart, lastWeekEnd],
    (err, results) => {
      if (err) {
        console.error("Gagal hitung total minggu lalu:", err);
        return;
      }
      const totalMessages = results[0].total || 0;

      // Reset tabel mingguan
      db.query("DELETE FROM pesan_mingguan WHERE tanggal < ?", [weekStart]);
    }
  );
}

// Set buat lacak pesan yang udah di-log (hindari duplikat)
const loggedMessages = new Set();

async function logIncomingMessage(whatsappNumber, currentDate, messageId) {
  loggedMessages.add(messageId);
  // Bersihkan set kalau terlalu banyak (hindari memory leak)
  if (loggedMessages.size > 10000) {
    loggedMessages.clear();
  }

  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  if (currentDate.getDay() === 1) {
    await resetWeeklyStats(currentDate);
  }

  const normalizedNumber = normalizePhoneNumber(whatsappNumber);

  db.query(
    "INSERT INTO pesan_mingguan (tanggal, jumlah_pesan, week_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE jumlah_pesan = jumlah_pesan + 1",
    [
      currentDate.toISOString().split("T")[0],
      weekStart.toISOString().split("T")[0],
    ],
    (err, result) => {
      if (err) console.error("Gagal log pesan_mingguan:", err);
    }
  );

  db.query(
    "INSERT INTO pesan_masuk (whatsapp_number) VALUES (?)",
    [normalizedNumber],
    (err, result) => {
      if (err) console.error("Gagal log pesan masuk:", err);
    }
  );
}

async function logTransaction(currentDate, orderId) {
  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  // Ambil detail order dari database
  db.query(
    "SELECT * FROM orders WHERE order_id = ?",
    [orderId],
    (err, results) => {
      if (err) {
        console.error("Gagal mengambil detail order:", err);
      } else if (results.length > 0) {
        const order = results[0];

        // Format pesan notifikasi
        const notificationMessage =
          `📦 *PEMBELIAN BARU* 📦\n\n` +
          `ID Pesanan: ${order.order_id}\n` +
          `Jumlah: ${order.quantity} pcs\n` +
          `Total Harga: Rp${parseInt(order.total_price).toLocaleString(
            "id-ID"
          )}\n` +
          `Alamat: ${order.address}\n` +
          `No. WA Pembeli: ${order.whatsapp_number}\n` +
          `Waktu: ${new Date(order.created_at).toLocaleString("id-ID")}`;

        // Kirim notifikasi ke semua admin
        if (sockInstance) {
          // Ambil semua nomor admin dari database
          db.query(
            "SELECT whatsapp_number FROM admin_settings",
            async (err, results) => {
              if (err) {
                console.error("Gagal mengambil nomor admin:", err);
                return;
              }

              if (results.length > 0) {
                for (const admin of results) {
                  const adminNumber = `${admin.whatsapp_number}@s.whatsapp.net`;
                  try {
                    await sockInstance.sendMessage(adminNumber, {
                      text: notificationMessage,
                    });
                  } catch (sendErr) {}
                }
              } else {
                console.error("Tidak ada nomor admin yang terdaftar");
              }
            }
          );
        }
      }
    }
  );

  db.query(
    "INSERT INTO transaction_stats_weekly (date, transaction_count, week_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE transaction_count = transaction_count + 1",
    [
      currentDate.toISOString().split("T")[0],
      weekStart.toISOString().split("T")[0],
    ]
  );
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sockInstance = sock;

  botReadyPromise = new Promise((resolve) => {
    sock.ev.on("connection.update", (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log("QR code generated:", qr);
        qrCode = qr;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ qr: qrCode }));
            console.log("Sent QR code to client");
          }
        });
      }

      if (connection === "open") {
        botConnected = true;
        qrCode = null;
        console.log("✅ Bot connected to WhatsApp!");
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ status: "connected" }));
            console.log("Sent connected status to client");
          }
        });
        resolve();
      }

      if (connection === "close") {
        botConnected = false;
        console.log("Bot disconnected. Last disconnect:", lastDisconnect);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== 401 && statusCode !== 405;

        if (shouldReconnect) {
          console.log("Attempting to reconnect bot...");
          startBot();
        } else {
          console.log(
            `Bot logged out (status code: ${statusCode}). Clearing auth_info and restarting...`
          );
          const authPath = path.join(__dirname, "auth_info");
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log("Auth info cleared");
          } catch (err) {
            console.error("Failed to clear auth info:", err);
          }

          qrCode = null;
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ status: "loggedOut" }));
              console.log("Sent loggedOut status to client");
            }
          });

          connectDatabase()
            .then(() => {
              console.log("Database reconnected, restarting bot...");
              startBot();
            })
            .catch((err) => {
              console.error("Database reconnect failed:", err);
              startBot(); // Tetap coba start bot
            });
        }
      }
    });
  });

  sock.ev.on("creds.update", saveCreds);

  // Tangani error Baileys
  sock.ev.on("connection.update", (update) => {
    if (update.lastDisconnect?.error) {
      console.error("Baileys connection error:", update.lastDisconnect.error);
    }
  });

  async function sendReaction(sock, from, messageKey, emoji) {
    await sock.sendMessage(from, {
      react: { text: emoji, key: messageKey },
    });
  }

  // 🔹 Cek Status Pembayaran (Revisi)
  async function checkPaymentStatus(
    orderId,
    from,
    productId,
    quantity,
    totalPrice,
    qrMessageKey
  ) {
    const midtransServerKey = process.env.MIDTRANS_SERVER_KEY; // Ganti dengan Server Key sandboxmu
    const midtransStatusUrl = `https://api.sandbox.midtrans.com/v2/${orderId}/status`;

    const interval = setInterval(async () => {
      try {
        const response = await axios.get(midtransStatusUrl, {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization:
              "Basic " +
              Buffer.from(midtransServerKey + ":").toString("base64"),
          },
        });

        if (response.data.transaction_status === "settlement") {
          clearInterval(interval);
          await sock.sendMessage(from, { delete: qrMessageKey });

          const phoneNumber = from.split("@")[0];
          const address = userState[from].address; // Ambil alamat dari userState

          // Update pesanan yang udah ada
          db.query(
            "UPDATE orders SET status = 'paid' WHERE whatsapp_number = ? AND order_id = ?",
            [phoneNumber, orderId],
            async (err, result) => {
              if (err) {
                console.error("Gagal update pesanan:", err);
                await sock.sendMessage(from, {
                  text: "Gagal simpan pesanan, coba lagi.",
                });
              } else if (result.affectedRows === 0) {
                console.error("Tidak ada pesanan ditemukan untuk:", {
                  orderId,
                  phoneNumber,
                });
                await sock.sendMessage(from, {
                  text: "Pesanan tidak ditemukan, coba ulangi dari awal.",
                });
              } else {
                await logTransaction(new Date(), orderId);
                // Update stok
                db.query(
                  "UPDATE kerudung SET stok = stok - ? WHERE id = ?",
                  [quantity, productId],
                  async (err) => {
                    if (err) console.error("Gagal update stok:", err);
                  }
                );
                // Update last_address di users
                db.query(
                  "UPDATE users SET last_address = ? WHERE whatsapp_number = ?",
                  [address, phoneNumber],
                  async (err) => {
                    if (err)
                      console.error("Gagal simpan alamat terakhir:", err);
                  }
                );

                await sock.sendMessage(from, {
                  text: `Terima kasih! Pesananmu (ID: ${orderId}) akan dikirim ke ${address}. Tunggu kedatangan barangnya.`,
                });
              }
              delete userState[from];
            }
          );
        } else if (response.data.transaction_status === "expire") {
          clearInterval(interval);
          delete userState[from];
          await sock.sendMessage(from, {
            text: "Pesanan kadaluarsa, silakan coba lagi.",
          });
        }
      } catch (error) {
        console.error("Gagal cek status:", error.response?.data || error);
        clearInterval(interval);
        delete userState[from];
      }
    }, 10000);
  }

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const messageId = msg.key.id; // Ambil ID pesan unik
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    const replyContext = {
      contextInfo: {
        quotedMessage: msg.message,
        stanzaId: msg.key.id,
        participant: msg.key.remoteJid,
      },
    };

    // Log pesan masuk
    await logIncomingMessage(from.split("@")[0], new Date(), messageId);

    // Log pesan masuk aja
    // db.query("INSERT INTO incoming_messages (whatsapp_number) VALUES (?)", [
    //   from.split("@")[0],
    // ]);

    // 🔹 Cek apakah pengguna sedang dalam proses pendaftaran
    if (userState[from] === "waiting_for_name") {
      const userName = text.trim();
      const phoneNumber = from.split("@")[0];

      db.query(
        "INSERT INTO users (whatsapp_number, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = ?",
        [phoneNumber, userName, userName],
        async (err) => {
          if (err) {
            console.error("❌ Gagal menyimpan nama:", err);
            await sock.sendMessage(from, {
              text: "Terjadi kesalahan, coba lagi.",
              ...replyContext, // Tambah quote
            });
          } else {
            await sock.sendMessage(from, {
              text: `Terima kasih, ${userName}! Pendaftaran selesai.`,
              ...replyContext, // Tambah quote
            });
            delete userState[from];
          }
        }
      );
      return;
    }

    // 🔹 Perintah untuk memulai pendaftaran
    if (text.toLowerCase() === "daftar") {
      await sendReaction(sock, from, msg.key, "✅");
      const phoneNumber = from.split("@")[0];

      db.query(
        "SELECT name FROM users WHERE whatsapp_number = ?",
        [phoneNumber],
        async (err, results) => {
          if (err) {
            console.error("❌ Gagal mengambil data pengguna:", err);
            await sock.sendMessage(from, {
              text: "Terjadi kesalahan, coba lagi nanti.",
              ...replyContext, // Tambah quote
            });
            return;
          }

          if (results.length > 0) {
            const existingName = results[0].name;
            await sock.sendMessage(from, {
              text: `✅ Anda sudah terdaftar atas nama *${existingName}*.`,
              ...replyContext, // Tambah quote
            });
          } else {
            userState[from] = "waiting_for_name";
            await sock.sendMessage(from, {
              text: "Silakan masukkan nama Anda:",
              ...replyContext, // Tambah quote
            });
          }
        }
      );
      return;
    }

    // 🔹 Perintah untuk melihat daftar produk
    if (text.toLowerCase() === "produk") {
      await sendReaction(sock, from, msg.key, "🛍️");
      db.query("SELECT * FROM kerudung", async (err, results) => {
        if (err) {
          console.error("❌ Gagal mengambil data:", err);
          await sock.sendMessage(from, {
            text: "Maaf, terjadi kesalahan saat mengambil daftar produk.",
            ...replyContext,
          });
          return;
        }

        let response = "🛍️ *Daftar Produk Kerudung:*\n";
        results.forEach((item, index) => {
          const formattedPrice = parseInt(item.harga).toLocaleString("id-ID");
          response += `*${index + 1}*. ${item.nama} - Rp${formattedPrice}\n`;
        });

        response += "\nKetik angkanya untuk melihat detail produk! 🛒";
        await sock.sendMessage(from, {
          text: response,
          ...replyContext,
        });
      });
      return;
    }

    // 🔹 Jika pengguna memilih angka, kirim gambar dari database
    const produkIndex = parseInt(text);
    if (!isNaN(produkIndex)) {
      await sendReaction(sock, from, msg.key, "📌");
      db.query(
        "SELECT * FROM kerudung LIMIT 1 OFFSET ?",
        [produkIndex - 1],
        async (err, results) => {
          if (err || results.length === 0) {
            console.error("❌ Gagal mengambil data:", err);
            await sock.sendMessage(from, {
              text: "Maaf Kak, produk tidak ditemukan!",
              ...replyContext,
            });
            return;
          }

          const produkItem = results[0];
          const imageBuffer = produkItem.gambar;

          if (!imageBuffer) {
            await sock.sendMessage(from, {
              text: "Maaf, gambar tidak tersedia untuk produk ini.",
              ...replyContext,
            });
            return;
          }

          await sock.sendMessage(from, {
            image: imageBuffer,
            caption: `🧕 *${produkItem.nama}*\n💰 Harga: Rp${parseInt(
              produkItem.harga
            ).toLocaleString("id-ID")}\n📦 Stok: ${
              produkItem.stok
            } pcs\n📜 Deskripsi: ${
              produkItem.deskripsi || "Tidak ada deskripsi"
            }`,
            ...replyContext,
          });
        }
      );
      return;
    }

    // 🔹 Perintah "lokasi"
    if (text.toLowerCase() === "lokasi") {
      db.query(
        "SELECT * FROM lokasi_toko WHERE id = 1",
        async (err, results) => {
          if (err || results.length === 0) {
            console.error("Gagal ambil lokasi:", err);
            await sock.sendMessage(from, {
              text: "Maaf, lokasi toko tidak tersedia saat ini.",
              ...replyContext,
            });
            return;
          }
          const location = results[0];
          await sock.sendMessage(from, {
            location: {
              degreesLatitude: parseFloat(location.latitude),
              degreesLongitude: parseFloat(location.longitude),
              name: location.nama,
              address: location.alamat,
            },
            ...replyContext,
          });
          await sendReaction(sock, from, msg.key, "📍");
        }
      );
      return;
    }

    // 🔹 Perintah stok
    if (text.toLowerCase() === "stok") {
      await sendReaction(sock, from, msg.key, "📦");
      db.query("SELECT nama, stok FROM kerudung", async (err, results) => {
        if (err) {
          console.error("❌ Gagal cek stok:", err);
          await sock.sendMessage(from, {
            text: "Maaf, gagal cek stok.",
            ...replyContext, // Tambah quote
          });
          return;
        }

        if (results.length === 0) {
          await sock.sendMessage(from, {
            text: "Belum ada produk di stok saat ini.",
            ...replyContext, // Tambah quote
          });
          return;
        }

        let response = "📦 *Stok Kerudung Saat Ini:*\n";
        let totalStok = 0;

        results.forEach((item, index) => {
          response += `${index + 1}. ${item.nama} - ${item.stok} pcs\n`;
          totalStok += item.stok;
        });

        response += `\n*Total:* ${totalStok} pcs`;
        await sock.sendMessage(from, {
          text: response,
          ...replyContext, // Tambah quote
        });
      });
      return;
    }

    if (text.toLowerCase() === "order") {
      await sendReaction(sock, from, msg.key, "📲");
      let productList =
        "Silakan pilih produk dengan ketik angka, lalu ketik 'beli produk [nomor produk] [banyaknya]pcs' untuk order!\n\n*Contoh*:\nbeli produk 5 1pcs";

      await sock.sendMessage(from, {
        text: productList,
        ...replyContext,
      });
      return;
    }

    // 🔹 Perintah "rate"
    if (text.toLowerCase().startsWith("rate")) {
      const parts = text.toLowerCase().split(" ");

      // Kalau cuma ketik "rate" atau format kurang lengkap
      if (parts.length < 4 || parts[2] !== "bintang") {
        await sock.sendMessage(from, {
          text: "Untuk rate produk ketik *'rate [no produk] bintang [1-5]'* \n\n*contoh* 'rate 2 bintang 4'.",
          ...replyContext,
        });
        return;
      }

      const productIndex = parseInt(parts[1]) - 1; // Nomor urut mulai dari 1
      const rating = parseInt(parts[3]);

      if (isNaN(productIndex) || productIndex < 0) {
        await sock.sendMessage(from, {
          text: "Nomor produk tidak valid! Lihat daftar di 'produk'.",
          ...replyContext,
        });
        return;
      }

      if (isNaN(rating) || rating < 1 || rating > 5) {
        await sock.sendMessage(from, {
          text: "Rating harus angka 1-5!",
          ...replyContext,
        });
        return;
      }

      db.query("SELECT * FROM kerudung ORDER BY id", async (err, results) => {
        if (err || results.length === 0) {
          await sock.sendMessage(from, {
            text: "Gagal ambil daftar produk!",
            ...replyContext,
          });
          return;
        }

        if (productIndex >= results.length) {
          await sock.sendMessage(from, {
            text: "Nomor produk tidak ditemukan! Lihat daftar di 'produk'.",
            ...replyContext,
          });
          return;
        }

        const productId = results[productIndex].id;
        const phoneNumber = from.split("@")[0];

        db.query(
          "INSERT INTO rating_produk (product_id, whatsapp_number, rating) VALUES (?, ?, ?)",
          [productId, phoneNumber, rating],
          async (err) => {
            if (err) {
              console.error("Gagal simpan rating:", err);
              await sock.sendMessage(from, {
                text: "Gagal menyimpan rating, coba lagi.",
                ...replyContext,
              });
            } else {
              await sock.sendMessage(from, {
                text: `Terima kasih! Rating ${rating} bintang untuk produk nomor ${
                  productIndex + 1
                } sudah disimpan.`,
                ...replyContext,
              });
            }
          }
        );
      });
      return;
    }

    // 🔹 Perintah "beli produk [nomor] [jumlah]pcs"
    if (text.toLowerCase().startsWith("beli produk")) {
      const parts = text.toLowerCase().split(" ");
      if (parts.length < 4 || !parts[3].endsWith("pcs")) {
        await sock.sendMessage(from, {
          text: "Format salah! Gunakan: beli produk [nomor] [jumlah]pcs\nContoh: beli produk 3 5pcs",
          ...replyContext,
        });
        return;
      }

      const phoneNumber = from.split("@")[0];
      db.query(
        "SELECT * FROM users WHERE whatsapp_number = ?",
        [phoneNumber],
        async (err, results) => {
          if (err || results.length === 0) {
            await sock.sendMessage(from, {
              text: "Daftar untuk order! Ketik 'daftar' lalu masukkan nama Anda.",
              ...replyContext,
            });
            return;
          }

          const productIndex = parseInt(parts[2]) - 1;
          const quantity = parseInt(parts[3].replace("pcs", ""));

          if (
            isNaN(productIndex) ||
            productIndex < 0 ||
            isNaN(quantity) ||
            quantity <= 0
          ) {
            await sock.sendMessage(from, {
              text: "Nomor produk atau jumlah tidak valid! Lihat daftar di 'produk'.",
              ...replyContext,
            });
            return;
          }

          db.query(
            "SELECT * FROM kerudung ORDER BY id",
            async (err, results) => {
              if (
                err ||
                results.length === 0 ||
                productIndex >= results.length
              ) {
                await sock.sendMessage(from, {
                  text: "Produk tidak ditemukan! Lihat daftar di 'produk'.",
                  ...replyContext,
                });
                return;
              }

              const product = results[productIndex];
              if (product.stok < quantity) {
                await sock.sendMessage(from, {
                  text: `Stok ${product.nama} cuma ${product.stok} pcs, kurang dari ${quantity} pcs!`,
                  ...replyContext,
                });
                return;
              }

              userState[from] = {
                step: "choose_delivery",
                productId: product.id,
                quantity,
                price: product.harga * quantity,
              };

              await sock.sendMessage(from, {
                text: `Kamu mau beli *${
                  product.nama
                }* (${quantity} pcs) seharga Rp${(
                  product.harga * quantity
                ).toLocaleString(
                  "id-ID"
                )}. Pilih metode pengiriman:\n- Ketik "kirim 1" untuk Kirim Barang\n- Ketik "kirim 2" untuk Kirim ke Pasar`,
                ...replyContext,
              });
            }
          );
        }
      );
      return;
    }

    // 🔹 Pilih Metode Pengiriman (Tambah cek last_address)
    if (userState[from]?.step === "choose_delivery") {
      const textLower = text.toLowerCase();
      if (textLower === "kirim 1") {
        const phoneNumber = from.split("@")[0];
        db.query(
          "SELECT last_address FROM users WHERE whatsapp_number = ?",
          [phoneNumber],
          async (err, results) => {
            if (err) {
              console.error("Gagal cek alamat terakhir:", err);
              await sock.sendMessage(from, {
                text: "Terjadi kesalahan, coba lagi nanti.",
                ...replyContext,
              });
              delete userState[from];
              return;
            }

            if (results[0]?.last_address) {
              userState[from].step = "confirm_last_address";
              userState[from].lastAddress = results[0].last_address;
              await sock.sendMessage(from, {
                text: `Apakah akan dikirim ke alamat terakhir: ${results[0].last_address}? Balas 'ya' atau 'tidak'.`,
                ...replyContext,
              });
            } else {
              userState[from].step = "waiting_for_address_to_check_shipping";
              await sock.sendMessage(from, {
                text: "Kirim alamat pengirimanmu dengan format: Nama, Jalan, Kota, Kode Pos\nContoh: Budi, Jl. Merdeka 123, Bandung, 40123",
                ...replyContext,
              });
            }
          }
        );
      } else if (textLower === "kirim 2") {
        db.query(
          "SELECT id, nama, alamat FROM lokasi_pasar",
          async (err, results) => {
            if (err || results.length === 0) {
              await sock.sendMessage(from, {
                text: "Gagal ambil daftar pasar, coba lagi nanti.",
                ...replyContext,
              });
              delete userState[from];
              return;
            }

            let marketList = "Pilih pasar:\n";
            results.forEach((market, index) => {
              marketList += `${index + 1}. ${market.nama} - ${market.alamat}\n`;
            });
            marketList +=
              "Balas dengan 'pasar [nomor]' sesuai pasar, misalnya 'pasar 1'.";

            userState[from].step = "choose_market";
            userState[from].markets = results;
            await sock.sendMessage(from, {
              text: marketList,
              ...replyContext,
            });
          }
        );
      } else {
        await sock.sendMessage(from, {
          text: "Balas 'kirim 1' untuk Kirim Barang atau 'kirim 2' untuk Kirim ke Pasar!",
          ...replyContext,
        });
      }
      return;
    }

    // 🔹 Konfirmasi Alamat Terakhir (Baru)
    if (userState[from]?.step === "confirm_last_address") {
      const textLower = text.toLowerCase();
      if (textLower === "ya") {
        const { productId, quantity, price, lastAddress } = userState[from];
        const city = lastAddress.split(",")[2]?.trim() || "Unknown";
        const phoneNumber = from.split("@")[0];

        db.query(
          "SELECT harga FROM biaya_pengiriman WHERE kota = ?",
          [city],
          async (err, results) => {
            if (err) {
              console.error("Gagal cek ongkir:", err);
              await sock.sendMessage(from, {
                text: "Gagal cek ongkir, coba lagi nanti.",
                ...replyContext,
              });
              delete userState[from];
              return;
            }
            const shippingCost = results[0] ? Number(results[0].harga) : 20000;
            const totalPrice = price + shippingCost;

            userState[from] = {
              step: "confirm_order_with_shipping",
              productId,
              quantity,
              price,
              totalPrice,
              address: lastAddress,
            };

            await sock.sendMessage(from, {
              text: `Harga produk: Rp${price.toLocaleString(
                "id-ID"
              )}, Ongkir ke ${city}: Rp${shippingCost.toLocaleString(
                "id-ID"
              )}, Total: Rp${totalPrice.toLocaleString(
                "id-ID"
              )}. Konfirmasi 'ya' atau 'batal'.`,
              ...replyContext,
            });
          }
        );
      } else if (textLower === "tidak") {
        userState[from].step = "waiting_for_address_to_check_shipping";
        await sock.sendMessage(from, {
          text: "Kirim alamat pengirimanmu dengan format: Nama, Jalan, Kota, Kode Pos\nContoh: Budi, Jl. Merdeka 123, Bandung, 40123",
          ...replyContext,
        });
      } else {
        await sock.sendMessage(from, {
          text: "Balas 'ya' atau 'tidak'!",
          ...replyContext,
        });
      }
      return;
    }

    // 🔹 Cek Ongkir untuk Kirim Barang (Ubah sedikit)
    if (userState[from]?.step === "waiting_for_address_to_check_shipping") {
      const address = text;
      const city = address.split(",")[2]?.trim() || "Unknown";
      const phoneNumber = from.split("@")[0];

      if (
        !userState[from].price ||
        !userState[from].productId ||
        !userState[from].quantity
      ) {
        console.error("Data userState hilang:", userState[from]);
        await sock.sendMessage(from, {
          text: "Terjadi kesalahan, ulangi dari awal.",
          ...replyContext,
        });
        delete userState[from];
        return;
      }

      db.query(
        "SELECT harga FROM biaya_pengiriman WHERE kota = ?",
        [city],
        async (err, results) => {
          if (err) {
            console.error("Gagal cek ongkir:", err);
            await sock.sendMessage(from, {
              text: "Gagal cek ongkir, coba lagi nanti.",
              ...replyContext,
            });
            delete userState[from];
            return;
          }
          const shippingCost = results[0] ? Number(results[0].harga) : 20000;
          const productPrice = Number(userState[from].price);
          const totalPrice = productPrice + shippingCost;

          userState[from] = {
            step: "confirm_order_with_shipping",
            productId: userState[from].productId,
            quantity: userState[from].quantity,
            price: productPrice,
            totalPrice,
            address,
          };

          await sock.sendMessage(from, {
            text: `Harga produk: Rp${productPrice.toLocaleString(
              "id-ID"
            )}, Ongkir ke ${city}: Rp${shippingCost.toLocaleString(
              "id-ID"
            )}, Total: Rp${totalPrice.toLocaleString(
              "id-ID"
            )}. Konfirmasi 'ya' atau 'batal'.`,
            ...replyContext,
          });
        }
      );
      return;
    }

    // 🔹 Pilih Pasar untuk Kirim ke Pasar (Revisi)
    if (userState[from]?.step === "choose_market") {
      const textLower = text.toLowerCase();
      const marketMatch = textLower.match(/^pasar (\d+)$/); // Cek format "pasar [nomor]"

      if (!marketMatch) {
        await sock.sendMessage(from, {
          text: "Balas dengan 'pasar [nomor]' sesuai pasar, misalnya 'pasar 1'!",
          ...replyContext,
        });
        return;
      }

      const marketIndex = parseInt(marketMatch[1]) - 1; // Ambil nomor dari "pasar [nomor]"
      const markets = userState[from].markets;

      if (
        isNaN(marketIndex) ||
        marketIndex < 0 ||
        marketIndex >= markets.length
      ) {
        await sock.sendMessage(from, {
          text: "Pilih nomor pasar yang valid!",
          ...replyContext,
        });
        return;
      }

      const selectedMarket = markets[marketIndex];
      const totalPrice = userState[from].price; // Tanpa ongkir
      const orderId = `ORDER-${Date.now()}`;
      const phoneNumber = from.split("@")[0];

      db.query(
        "INSERT INTO orders (order_id, whatsapp_number, product_id, quantity, total_price, address, status) VALUES (?, ?, ?, ?, ?, ?, 'paid')",
        [
          orderId,
          phoneNumber,
          userState[from].productId,
          userState[from].quantity,
          totalPrice,
          selectedMarket.alamat,
        ],
        async (err) => {
          if (err) {
            console.error("Gagal simpan pesanan:", err);
            await sock.sendMessage(from, {
              text: "Gagal simpan pesanan, coba lagi.",
              ...replyContext,
            });
          } else {
            await logTransaction(new Date(), orderId); // Tambah ini
            db.query(
              "UPDATE kerudung SET stok = stok - ? WHERE id = ?",
              [userState[from].quantity, userState[from].productId],
              async (err) => {
                if (err) console.error("Gagal update stok:", err);
              }
            );
            await sock.sendMessage(from, {
              text: `Terima kasih! Pesananmu (ID: ${orderId}) akan dikirim ke ${selectedMarket.nama} (${selectedMarket.alamat}). Bayar langsung di pasar.`,
              ...replyContext,
            });
          }
          delete userState[from];
        }
      );
      return;
    }

    // 🔹 Konfirmasi Order dengan Ekspedisi
    if (userState[from]?.step === "confirm_order_with_shipping") {
      if (text.toLowerCase() === "ya") {
        const { productId, quantity, totalPrice, address } = userState[from];
        const orderId = `ORDER-${Date.now()}`;
        const phoneNumber = from.split("@")[0];

        // Simpan pesanan sementara dulu dengan status pending
        db.query(
          "INSERT INTO orders (order_id, whatsapp_number, product_id, quantity, total_price, address, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
          [orderId, phoneNumber, productId, quantity, totalPrice, address],
          async (err) => {
            if (err) {
              console.error("Gagal simpan pesanan sementara:", err);
              await sock.sendMessage(from, {
                text: "Gagal buat pesanan, coba lagi.",
                ...replyContext,
              });
              delete userState[from];
              return;
            }

            const midtransServerKey = process.env.MIDTRANS_SERVER_KEY; // Ganti dengan Server Key sandboxmu
            const midtransUrl = "https://api.sandbox.midtrans.com/v2/charge";

            const payload = {
              payment_type: "qris",
              transaction_details: {
                order_id: orderId,
                gross_amount: totalPrice,
              },
              qris: { acquirer: "gopay" },
            };

            try {
              const response = await axios.post(midtransUrl, payload, {
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  Authorization:
                    "Basic " +
                    Buffer.from(midtransServerKey + ":").toString("base64"),
                },
              });

              const qrCodeUrl = response.data.actions[0].url;
              console.log("QR Code URL:", qrCodeUrl);

              const qrMessage = await sock.sendMessage(from, {
                image: { url: qrCodeUrl },
                caption: `Scan QR ini untuk bayar Rp${totalPrice.toLocaleString(
                  "id-ID"
                )} Tunggu konfirmasi pembayaran!\n\nQR Code URL: ${qrCodeUrl}`,
                ...replyContext,
              });

              const qrMessageKey = qrMessage.key;
              checkPaymentStatus(
                orderId,
                from,
                productId,
                quantity,
                totalPrice,
                qrMessageKey
              );
            } catch (error) {
              console.error(
                "Gagal generate QR:",
                error.response?.data || error
              );
              await sock.sendMessage(from, {
                text: "Gagal buat QR pembayaran, coba lagi nanti.",
                ...replyContext,
              });
              delete userState[from];
            }
          }
        );
      } else if (text.toLowerCase() === "batal") {
        await sock.sendMessage(from, {
          text: "Pesanan dibatalkan.",
          ...replyContext,
        });
        delete userState[from];
      }
      return;
    }

    // 🔹 Pesan default
    db.query(
      "SELECT name FROM users WHERE whatsapp_number = ?",
      [from.split("@")[0]],
      async (err, results) => {
        await sendReaction(sock, from, msg.key, "👋");
        let greeting = "✨ *Halo kak!*";
        const userName = !err && results.length > 0 ? results[0].name : null;
        if (userName) greeting = `✨ *Halo kak ${userName}!*`;

        db.query(
          "SELECT message FROM templates WHERE name = 'pesan_default'",
          async (err, templateResults) => {
            if (err || templateResults.length === 0) {
              console.error("Gagal ambil template:", err);
              return await sock.sendMessage(from, {
                text: "Maaf, ada error.",
                ...replyContext,
              });
            }
            let message = templateResults[0].message;
            const greetingPlaceholder = "{{greeting}}";
            message = message.replace(greetingPlaceholder, greeting);
            if (userName) message = message.replace("{{name}}", userName);
            else message = message.replace("{{name}}", "");

            await sock.sendMessage(from, { text: message, ...replyContext });
          }
        );
      }
    );
  });
}

// API Produk Promo (Harga Termurah)
app.get("/api/promo-product", (req, res) => {
  db.query(
    "SELECT * FROM kerudung WHERE stok > 0 ORDER BY harga ASC LIMIT 1",
    (err, results) => {
      if (err || results.length === 0) {
        console.error("Gagal ambil produk promo:", err);
        return res.status(500).json({ error: "Gagal ambil promo" });
      }
      res.json(results[0]);
    }
  );
});

// API Grafik Pesan Mingguan
app.get("/api/weekly-message-stats", (req, res) => {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(
    today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)
  );
  startOfWeek.setHours(0, 0, 0, 0);

  const sql = `
    SELECT 
      DAYOFWEEK(tanggal) AS day,
      jumlah_pesan AS count
    FROM pesan_mingguan
    WHERE tanggal >= ? AND tanggal < DATE_ADD(?, INTERVAL 7 DAY)
    GROUP BY DAYOFWEEK(tanggal)
    ORDER BY day
  `;
  const params = [startOfWeek, startOfWeek];

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("Gagal ambil weekly-message-stats:", err);
      return res.status(500).json({ error: "Gagal ambil data" });
    }

    const data = [0, 0, 0, 0, 0, 0, 0];
    results.forEach((row) => {
      const index = row.day === 1 ? 6 : row.day - 2; // Minggu ke akhir
      data[index] = row.count || 0;
    });

    res.json(data);
  });
});

app.post("/api/messages", (req, res) => {
  const { whatsapp_number, message } = req.body;
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(
    today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)
  );
  startOfWeek.setHours(0, 0, 0, 0);

  // Simpan ke incoming_messages
  const insertMessage = `
  INSERT INTO pesan_masuk (whatsapp_number, timestamp)
  VALUES (?, NOW())
`;
  db.query(insertMessage, [whatsapp_number, message], (err) => {
    if (err) {
      console.error("Gagal simpan incoming_messages:", err);
      return res.status(500).json({ error: "Gagal simpan pesan" });
    }

    // Perbarui message_stats_weekly
    const updateStats = `
      INSERT INTO pesan_mingguan (tanggal, jumlah_pesan, week_start)
      VALUES (CURDATE(), 1, ?)
      ON DUPLICATE KEY UPDATE jumlah_pesan = jumlah_pesan + 1
    `;
    db.query(updateStats, [startOfWeek], (err) => {
      if (err) {
        console.error("Gagal perbarui message_stats_weekly:", err);
        return res.status(500).json({ error: "Gagal perbarui statistik" });
      }
      res.json({ success: true });
    });
  });
});

// API Total Pesan Masuk
app.get("/api/message-stats", isAuthenticated, (req, res) => {
  db.query("SELECT COUNT(*) as total FROM pesan_masuk", (err, results) => {
    if (err) {
      console.error("Gagal ambil stats:", err);
      return res.status(500).json({ error: "Gagal ambil statistik" });
    }
    res.json({ incoming: results[0].total });
  });
});

// API Total Pelanggan
app.get("/api/user-stats", isAuthenticated, (req, res) => {
  db.query("SELECT COUNT(*) as total FROM users", (err, results) => {
    if (err) {
      console.error("Gagal ambil stats pelanggan:", err);
      return res.status(500).json({ error: "Gagal ambil statistik" });
    }
    res.json({ total: results[0].total });
  });
});

// API Total Produk
app.get("/api/product-stats", isAuthenticated, (req, res) => {
  db.query("SELECT COUNT(*) as total FROM kerudung", (err, results) => {
    if (err) {
      console.error("Gagal ambil stats produk:", err);
      return res.status(500).json({ error: "Gagal ambil statistik" });
    }
    res.json({ total: results[0].total });
  });
});

// API Promosikan Produk
app.post("/api/promote-product", isAuthenticated, async (req, res) => {
  const { id, nama, harga } = req.body;

  if (!sockInstance || !botConnected) {
    return res
      .status(503)
      .json({ error: "Bot belum terhubung, coba lagi nanti" });
  }

  try {
    // Ambil deskripsi produk
    db.query(
      "SELECT deskripsi FROM kerudung WHERE id = ?",
      [id],
      async (err, result) => {
        if (err || result.length === 0) {
          return res.status(500).json({ error: "Gagal ambil data produk" });
        }

        const deskripsi = result[0].deskripsi || "Tidak ada deskripsi";

        // Ambil semua nomor terdaftar
        db.query("SELECT whatsapp_number FROM users", async (err, results) => {
          if (err || results.length === 0) {
            return res
              .status(500)
              .json({ error: "Gagal ambil daftar pelanggan" });
          }

          const message = `✨ *Promo Spesial!* ✨\nProduk: *${nama}*\nHarga: Rp${parseInt(
            harga
          ).toLocaleString(
            "id-ID"
          )}\nDeskripsi: ${deskripsi}\nCek sekarang di Toko Lena Kerudung!`;
          const numbers = results.map(
            (user) => `${user.whatsapp_number}@s.whatsapp.net`
          );

          for (const number of numbers) {
            try {
              await sockInstance.sendMessage(number, { text: message });
            } catch (sendErr) {
              console.error(`Gagal kirim ke ${number}:`, sendErr);
            }
          }

          res.json({ success: true });
        });
      }
    );
  } catch (error) {
    console.error("Gagal kirim promo:", error);
    res.status(500).json({ error: "Gagal kirim pesan promo" });
  }
});

startBot();

// API Endpoints
app.post("/api/verify-password", isAuthenticated, (req, res) => {
  const { password } = req.body;
  const hashedPassword = md5(password);

  db.query(
    "SELECT * FROM admins WHERE username = ? AND password = ?",
    [req.session.username, hashedPassword],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(401).json({ error: "Password salah" });
      }
      res.json({ success: true });
    }
  );
});

// Fungsi mask nomor
function maskPhoneNumber(number) {
  if (!number) return "N/A";
  return number.slice(0, 4) + "*******";
}

// Normalisasi nomor
function normalizePhoneNumber(number) {
  if (!number) return "";
  return number.replace(/[^0-9]/g, "").replace(/^(\+62|62)/, "62");
}

// API Users (update dengan jumlah transaksi)
app.get("/api/users", isAuthenticated, (req, res) => {
  db.query(
    `
    SELECT u.whatsapp_number, u.name,
           (SELECT COUNT(*) FROM pesan_masuk im WHERE im.whatsapp_number = u.whatsapp_number) as chat_count,
           (SELECT COUNT(*) FROM orders o WHERE o.whatsapp_number = u.whatsapp_number AND o.status IN ('paid', 'shipped', 'delivered')) as transaction_count
    FROM users u
    GROUP BY u.whatsapp_number, u.name
    `,
    (err, results) => {
      if (err) {
        console.error("Gagal ambil data pelanggan:", err);
        return res.status(500).json({ error: "Gagal ambil data" });
      }
      const maskedResults = results.map((user) => {
        const normalizedNumber = normalizePhoneNumber(user.whatsapp_number);
        const totalChat = Number(user.chat_count) || 0;
        const totalTransactions = Number(user.transaction_count) || 0; // Debug log
        return {
          whatsapp_number: maskPhoneNumber(normalizedNumber),
          whatsapp_number_full: normalizedNumber,
          name: user.name,
          total_chat: totalChat,
          total_transactions: totalTransactions,
        };
      });
      res.json(maskedResults);
    }
  );
});

// API Detail Transaksi per Pelanggan
app.get(
  "/api/user-transactions/:whatsapp_number",
  isAuthenticated,
  (req, res) => {
    const whatsappNumber = req.params.whatsapp_number;
    const page = parseInt(req.query.page) || 1; // Default halaman 1
    const limit = parseInt(req.query.limit) || 6; // Default 6 per halaman
    const offset = (page - 1) * limit;

    db.query(
      `
    SELECT o.order_id, o.product_id, o.quantity, o.total_price, o.created_at, k.nama
    FROM orders o
    JOIN kerudung k ON o.product_id = k.id
    WHERE o.whatsapp_number = ? AND o.status IN ('paid', 'shipped', 'delivered')
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
    `,
      [whatsappNumber, limit, offset],
      (err, results) => {
        if (err) {
          console.error("Gagal ambil detail transaksi:", err);
          return res
            .status(500)
            .json({ error: "Gagal ambil detail transaksi" });
        }
        // Hitung total data untuk pagination
        db.query(
          "SELECT COUNT(*) as total FROM orders WHERE whatsapp_number = ? AND status IN ('paid', 'shipped', 'delivered')",
          [whatsappNumber],
          (err, countResult) => {
            if (err) {
              console.error("Gagal hitung total transaksi:", err);
              return res.status(500).json({ error: "Gagal hitung total" });
            }
            const total = countResult[0].total;
            const totalPages = Math.ceil(total / limit);
            res.json({
              data: results,
              pagination: { page, limit, total, totalPages },
            });
          }
        );
      }
    );
  }
);

// Dummy endpoint untuk /api/status
app.get("/api/status", (req, res) => {
  res.json({ status: "OK", connected: botConnected });
});

// GET items (ambil semua produk)
app.get("/api/items", (req, res) => {
  db.query("SELECT * FROM kerudung", (err, results) =>
    err ? res.status(500).json({ error: err }) : res.json(results)
  );
});

// POST item (tambah produk)
app.post("/api/items", (req, res) => {
  const form = new formidable.IncomingForm({
    allowEmptyFiles: true,
    minFileSize: 0,
    keepExtensions: true,
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error("Error parsing form:", err);
      return res
        .status(500)
        .json({ success: false, error: "Gagal memproses form" });
    }

    const nama = fields.nama?.[0];
    const harga = fields.harga?.[0];
    const stok = fields.stok?.[0];
    const deskripsi = fields.deskripsi?.[0] || ""; // Deskripsi opsional

    let gambar = null;
    try {
      if (files.gambar?.[0]?.filepath) {
        gambar = fs.readFileSync(files.gambar[0].filepath);
      }
    } catch (fileErr) {
      return res
        .status(500)
        .json({ success: false, error: "Gagal membaca file gambar" });
    }

    if (!nama || !harga || !stok || !gambar) {
      return res.status(400).json({
        success: false,
        error: "Nama, harga, stok, dan gambar wajib diisi",
        missing: {
          nama: !nama,
          harga: !harga,
          stok: !stok,
          gambar: !gambar,
        },
      });
    }

    db.query(
      "INSERT INTO kerudung (nama, harga, stok, gambar, deskripsi) VALUES (?, ?, ?, ?, ?)",
      [nama, harga, stok, gambar, deskripsi],
      (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ success: false, error: "Gagal simpan ke database" });
        }
        res.json({
          success: true,
          id: result.insertId,
          product: { id: result.insertId, nama, harga, stok, deskripsi },
        });
      }
    );
  });
});

// PUT item (update produk)
app.put("/api/items/:id", (req, res) => {
  const form = new formidable.IncomingForm({
    allowEmptyFiles: true,
    minFileSize: 0,
    keepExtensions: true,
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error("Error parsing form:", err);
      return res
        .status(500)
        .json({ success: false, error: "Gagal memproses form" });
    }

    const nama = fields.nama?.[0];
    const harga = fields.harga?.[0];
    const stok = fields.stok?.[0];
    const deskripsi = fields.deskripsi?.[0] || ""; // Deskripsi opsional

    let hasNewImage = false;
    let gambar = null;

    try {
      if (files.gambar?.[0]?.filepath && files.gambar[0].size > 0) {
        hasNewImage = true;
        gambar = fs.readFileSync(files.gambar[0].filepath);
      }
    } catch (fileErr) {
      console.error("Error membaca file:", fileErr);
      return res
        .status(500)
        .json({ success: false, error: "Gagal membaca file gambar" });
    }

    if (!nama || !harga || !stok) {
      return res.status(400).json({
        success: false,
        error: "Nama, harga, dan stok wajib diisi",
        missing: {
          nama: !nama,
          harga: !harga,
          stok: !stok,
        },
      });
    }

    let query, params;
    if (hasNewImage) {
      query =
        "UPDATE kerudung SET nama=?, harga=?, stok=?, gambar=?, deskripsi=? WHERE id=?";
      params = [nama, harga, stok, gambar, deskripsi, req.params.id];
    } else {
      query =
        "UPDATE kerudung SET nama=?, harga=?, stok=?, deskripsi=? WHERE id=?";
      params = [nama, harga, stok, deskripsi, req.params.id];
    }

    db.query(query, params, (err, result) => {
      if (err) {
        console.error("Error update DB:", err);
        return res
          .status(500)
          .json({ success: false, error: "Gagal update database" });
      }

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Produk tidak ditemukan" });
      }
      res.json({ success: true, id: req.params.id });
    });
  });
});

app.delete("/api/items/:id", (req, res) => {
  db.query("DELETE FROM kerudung WHERE id=?", [req.params.id], (err) =>
    err ? res.status(500).json({ error: err }) : res.sendStatus(200)
  );
});

// Endpoint buat ambil gambar berdasarkan ID
app.get("/api/items/:id/image", (req, res) => {
  db.query(
    "SELECT gambar FROM kerudung WHERE id = ?",
    [req.params.id],
    (err, results) => {
      if (err || results.length === 0 || !results[0].gambar) {
        console.error("Gagal ambil gambar:", err || "Gambar tidak ditemukan");
        return res.status(404).json({ error: "Gambar tidak ditemukan" });
      }
      res.set("Content-Type", "image/jpeg"); // Sesuain tipe gambar kalau perlu
      res.send(results[0].gambar); // Kirim BLOB sebagai binary
    }
  );
});

app.get("/api/location", isAuthenticated, (req, res) => {
  db.query("SELECT * FROM lokasi_toko WHERE id = 1", (err, results) => {
    if (err || results.length === 0) {
      console.error("Gagal ambil lokasi:", err);
      return res.status(500).json({ error: "Gagal ambil lokasi" });
    }
    const location = results[0];
    res.json({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.nama,
      address: location.alamat,
    });
  });
});

app.put("/api/location", isAuthenticated, (req, res) => {
  const { latitude, longitude, nama, alamat } = req.body;

  // Validasi input
  if (!latitude || !longitude || !nama || !alamat) {
    return res.status(400).json({ error: "Semua field wajib diisi" });
  }
  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: "Koordinat harus berupa angka" });
  }

  db.query(
    "INSERT INTO lokasi_toko (id, latitude, longitude, nama, alamat) VALUES (1, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE latitude = ?, longitude = ?, nama = ?, alamat = ?, updated_at = CURRENT_TIMESTAMP",
    [latitude, longitude, nama, alamat, latitude, longitude, nama, alamat],
    (err) => {
      if (err) {
        console.error("Gagal simpan lokasi:", err);
        return res.status(500).json({ error: "Gagal simpan lokasi" });
      }
      res.json({ success: true });
    }
  );
});

// API (hanya kalau login)
app.get("/api/items", isAuthenticated, (req, res) => {
  db.query("SELECT * FROM kerudung", (err, results) =>
    err ? res.status(500).json({ error: err }) : res.json(results)
  );
});

app.get("/api/public-items", (req, res) => {
  db.query("SELECT * FROM kerudung", (err, results) =>
    err ? res.status(500).json({ error: err }) : res.json(results)
  );
});

// Routes
app.get("/templates", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "templates.html"));
});

// API Templates
app.get("/api/templates", isAuthenticated, (req, res) => {
  db.query("SELECT * FROM templates", (err, results) =>
    err
      ? res.status(500).json({ error: "Gagal ambil templates" })
      : res.json(results)
  );
});

app.put("/api/templates/:name", isAuthenticated, (req, res) => {
  const { message } = req.body;
  db.query(
    "UPDATE templates SET message = ? WHERE name = ?",
    [message, req.params.name],
    (err) => {
      if (err) {
        console.error("Gagal update template:", err);
        return res.status(500).json({ error: "Gagal simpan template" });
      }
      res.json({ success: true });
    }
  );
});

// API Rating Rata-rata per Produk
app.get("/api/product-ratings", (req, res) => {
  db.query(
    "SELECT product_id, AVG(rating) as average, COUNT(*) as count FROM rating_produk GROUP BY product_id",
    (err, results) => {
      if (err) {
        console.error("Gagal ambil rating produk:", err);
        return res.status(500).json({ error: "Gagal ambil rating" });
      }
      const ratings = {};
      results.forEach((row) => {
        ratings[row.product_id] = {
          average: parseFloat(row.average).toFixed(1),
          count: row.count,
        };
      });
      res.json(ratings);
    }
  );
});

// API Jumlah Terjual per Produk
app.get("/api/product-sales", (req, res) => {
  db.query(
    "SELECT product_id, SUM(quantity) as sold FROM orders WHERE status IN ('paid', 'shipped', 'delivered') GROUP BY product_id",
    (err, results) => {
      if (err) {
        console.error("Gagal ambil data penjualan:", err);
        return res.status(500).json({ error: "Gagal ambil data penjualan" });
      }
      const sales = {};
      results.forEach((row) => {
        sales[row.product_id] = row.sold;
      });
      res.json(sales);
    }
  );
});

// API Total Transaksi
app.get("/api/transaction-stats", isAuthenticated, (req, res) => {
  db.query(
    "SELECT COUNT(*) as total FROM orders WHERE status IN ('paid', 'shipped', 'delivered')",
    (err, results) => {
      if (err) {
        console.error("Gagal ambil stats transaksi:", err);
        return res.status(500).json({ error: "Gagal ambil statistik" });
      }
      res.json({ total: results[0].total });
    }
  );
});

app.get("/api/weekly-transaction-stats", (req, res) => {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(
    today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)
  );
  startOfWeek.setHours(0, 0, 0, 0);

  const sql = `
    SELECT 
      DAYOFWEEK(created_at) AS day,
      COUNT(*) AS count
    FROM orders
    WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 7 DAY)
      AND status IN ('paid', 'shipped', 'delivered')
    GROUP BY DAYOFWEEK(created_at)
    ORDER BY day
  `;
  const params = [startOfWeek, startOfWeek];

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("Gagal ambil weekly-transaction-stats:", err);
      return res.status(500).json({ error: "Gagal ambil data" });
    }

    const data = [0, 0, 0, 0, 0, 0, 0];
    results.forEach((row) => {
      const index = row.day === 1 ? 6 : row.day - 2;
      data[index] = row.count;
    });

    res.json(data);
  });
});

// GET /api/admin-number (tidak berubah)
app.get("/api/admin-number", isAuthenticated, (req, res) => {
  db.query(
    "SELECT id, name, whatsapp_number FROM admin_settings",
    (err, results) => {
      if (err) {
        console.error("Gagal ambil nomor admin:", err);
        return res.status(500).json({ error: "Gagal ambil nomor admin" });
      }
      res.json({ admins: results || [] });
    }
  );
});

// PUT /api/admin-number
app.put("/api/admin-number", isAuthenticated, (req, res) => {
  const { admins } = req.body;

  // Validasi input
  if (!Array.isArray(admins) || admins.length < 1 || admins.length > 3) {
    return res
      .status(400)
      .json({ error: "Minimal 1 dan maksimal 3 nomor admin diperlukan" });
  }

  // Validasi setiap nomor
  const validAdmins = admins.filter((admin) => {
    const number = admin.whatsapp_number;
    return number && /^62\d{8,13}$/.test(number); // Harus diawali 62, total 10-15 digit
  });
  if (validAdmins.length < 1) {
    return res
      .status(400)
      .json({
        error:
          "Setidaknya 1 nomor WhatsApp valid diperlukan (diawali 62, 10-15 digit)",
      });
  }

  // Hapus semua nomor admin lama
  db.query("DELETE FROM admin_settings", (err) => {
    if (err) {
      console.error("Gagal menghapus nomor admin lama:", err);
      return res.status(500).json({ error: "Gagal update nomor admin" });
    }

    // Insert nomor admin baru
    const values = validAdmins.map((admin) => [
      admin.name || "Admin",
      admin.whatsapp_number,
    ]);
    db.query(
      "INSERT INTO admin_settings (name, whatsapp_number) VALUES ?",
      [values],
      (err) => {
        if (err) {
          console.error("Gagal insert nomor admin:", err);
          return res.status(500).json({ error: "Gagal update nomor admin" });
        }
        res.json({ success: true });
      }
    );
  });
});

// API Invoice/Laporan Penjualan
app.get("/api/invoices", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const orderId = req.query.order_id;
  const offset = (page - 1) * limit;

  let sql = `
    SELECT 
      o.order_id, 
      o.created_at, 
      k.nama AS product_name, 
      o.quantity, 
      k.harga AS unit_price, 
      o.total_price, 
      o.whatsapp_number, 
      o.address, 
      o.status
    FROM orders o
    JOIN kerudung k ON o.product_id = k.id
    WHERE o.status IN ('paid', 'shipped', 'delivered')
  `;
  let params = [];

  if (orderId) {
    sql += ` AND o.order_id = ?`;
    params.push(orderId);
  } else {
    sql += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("Gagal ambil data invoice:", err);
      return res.status(500).json({ error: "Gagal ambil data invoice" });
    }

    if (orderId) {
      res.json({ data: results });
    } else {
      db.query(
        "SELECT COUNT(*) as total FROM orders WHERE status IN ('paid', 'shipped', 'delivered')",
        (err, countResult) => {
          if (err) {
            console.error("Gagal hitung total invoice:", err);
            return res.status(500).json({ error: "Gagal hitung total" });
          }
          const total = countResult[0].total;
          const totalPages = Math.ceil(total / limit);
          res.json({
            data: results,
            pagination: { page, limit, total, totalPages },
          });
        }
      );
    }
  });
});

// startBot();
server.listen(3000, () =>
  console.log("Server berjalan di http://localhost:3000")
);

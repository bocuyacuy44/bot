let allProducts = []; // Simpan semua produk buat filtering
let currentSearchTerm = ""; // Simpan search term buat kombinasi filter
let productRatings = {}; // Simpan rating dan count per produk
let productSales = {}; // Simpan jumlah terjual per produk
let promoProduct = null; // Simpan produk promo

document.addEventListener("DOMContentLoaded", () => {
  loadRatings(); // Load rating dulu
  loadProductSales(); // Load jumlah terjual
  loadPromoBanner(); // Load promo banner
  loadProducts();

  // Kontak WhatsApp
  document.getElementById("whatsapp-contact").addEventListener("click", (e) => {
    e.preventDefault();
    window.open("https://wa.me/62882001079926", "_blank");
  });

  // Search input listener
  document.getElementById("search-input").addEventListener("input", (e) => {
    currentSearchTerm = e.target.value.toLowerCase();
    showLoading();
    setTimeout(() => filterAndSortProducts(), 300);
  });

  // Price filter listener
  document.getElementById("price-filter").addEventListener("change", () => {
    showLoading();
    setTimeout(() => filterAndSortProducts(), 300);
  });
});

function showLoading() {
  document.getElementById("loading-spinner").style.display = "block";
  document.getElementById("product-list").style.display = "none";
}

function hideLoading() {
  document.getElementById("loading-spinner").style.display = "none";
  document.getElementById("product-list").style.display = "flex";
}

function loadRatings() {
  fetch("/api/product-ratings")
    .then((res) => res.json())
    .then((ratings) => {
      productRatings = ratings;
    })
    .catch((err) => console.error("Gagal load rating:", err));
}

function loadProductSales() {
  fetch("/api/product-sales")
    .then((res) => res.json())
    .then((sales) => {
      productSales = sales;
    })
    .catch((err) => console.error("Gagal load penjualan:", err));
}

function loadPromoBanner() {
  fetch("/api/promo-product")
    .then((res) => res.json())
    .then((product) => {
      promoProduct = product;
      document.getElementById(
        "promo-title"
      ).textContent = `Promo Spesial: ${product.nama}`;
      document.getElementById("promo-price").textContent = `Hanya Rp${parseInt(
        product.harga
      ).toLocaleString("id-ID")}!`;
      document.getElementById("promo-button").onclick = () => {
        document
          .querySelector(`[onclick="showProductDetail(${product.id})"]`)
          .click(); // Trigger modal
      };
    })
    .catch((err) => {
      console.error("Gagal load promo:", err);
      document.getElementById("promo-banner").style.display = "none";
    });
}

function loadProducts() {
  showLoading();
  fetch("/api/items")
    .then((res) => {
      if (!res.ok) throw new Error("Gagal mengambil data produk");
      return res.json();
    })
    .then((products) => {
      allProducts = products; // Simpan semua produk
      displayProducts(products);
      hideLoading();
    })
    .catch((err) => {
      console.error("Error:", err);
      document.getElementById("product-list").innerHTML =
        '<p class="text-center text-danger">Gagal memuat katalog, silakan coba lagi nanti.</p>';
      hideLoading();
    });
}

function displayProducts(products) {
  const productList = document.getElementById("product-list");
  productList.innerHTML = "";
  if (products.length === 0) {
    productList.innerHTML =
      '<p class="text-center text-muted">Tidak ada produk yang ditemukan.</p>';
    return;
  }

  products.forEach((product, index) => {
    const isOutOfStock = product.stok <= 0;
    const ratingData = productRatings[product.id] || {
      average: "N/A",
      count: 0,
    };
    const sold = productSales[product.id] || 0;
    const card = document.createElement("div");
    card.className = "col-md-6 col-lg-4 mb-4";
    card.innerHTML = `
      <div class="card product-card h-100" data-bs-toggle="modal" data-bs-target="#productModal" onclick="showProductDetail(${
        product.id
      })">
        <div class="product-img-wrapper position-relative">
          <img src="/api/items/${product.id}/image" class="card-img-top" alt="${
      product.nama
    }" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image';">
          ${
            isOutOfStock
              ? '<span class="badge bg-danger position-absolute top-0 end-0 m-2">Stok Habis</span>'
              : ""
          }
        </div>
        <div class="card-body">
          <h5 class="card-title fw-bold">${product.nama}</h5>
          <p class="card-text text-muted">Rp${parseInt(
            product.harga
          ).toLocaleString("id-ID")}</p>
          <p class="card-text rating-stars">${
            ratingData.average !== "N/A"
              ? `${getStarRating(ratingData.average)} ${ratingData.average} (${
                  ratingData.count
                })`
              : "Belum ada rating"
          }</p>
          <p class="card-text small">Stok: ${product.stok} pcs</p>
          <p class="card-text small">Terjual: ${sold} pcs</p>
          <p class="card-text text-truncate">${
            product.deskripsi || "Tidak ada deskripsi"
          }</p>
        </div>
        <div class="card-footer text-center">
          <button class="btn btn-success w-100" onclick="event.stopPropagation(); window.open('https://wa.me/62882001079926?text=Saya%20mau%20pesan%20${
            product.nama
          }', '_blank')" ${isOutOfStock ? "disabled" : ""}>
            <i class="bi bi-whatsapp"></i> Pesan Sekarang
          </button>
        </div>
      </div>
    `;
    productList.appendChild(card);
  });
}

function filterAndSortProducts() {
  let filteredProducts = allProducts.filter((product) => {
    const nameMatch = product.nama.toLowerCase().includes(currentSearchTerm);
    const descMatch = product.deskripsi
      ? product.deskripsi.toLowerCase().includes(currentSearchTerm)
      : false;
    return nameMatch || descMatch;
  });

  const filterValue = document.getElementById("price-filter").value;
  if (filterValue === "low-to-high") {
    filteredProducts.sort((a, b) => parseInt(a.harga) - parseInt(b.harga));
  } else if (filterValue === "high-to-low") {
    filteredProducts.sort((a, b) => parseInt(b.harga) - parseInt(a.harga));
  }

  displayProducts(filteredProducts);
  hideLoading();
}

function showProductDetail(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;

  const isOutOfStock = product.stok <= 0;
  const ratingData = productRatings[product.id] || { average: "N/A", count: 0 };
  const sold = productSales[product.id] || 0;
  const productIndex = allProducts.findIndex((p) => p.id === productId) + 1; // Nomor urut

  document.getElementById(
    "modal-product-image"
  ).src = `/api/items/${product.id}/image`;
  document.getElementById("modal-product-image").onerror = () =>
    (document.getElementById("modal-product-image").src =
      "https://via.placeholder.com/300x200?text=No+Image");
  document.getElementById("modal-product-name").textContent = product.nama;
  document.getElementById("modal-product-price").textContent = `Rp${parseInt(
    product.harga
  ).toLocaleString("id-ID")}`;
  document.getElementById("modal-product-rating").innerHTML =
    ratingData.average !== "N/A"
      ? `${getStarRating(ratingData.average)} ${ratingData.average} (${
          ratingData.count
        })`
      : "Belum ada rating";
  document.getElementById(
    "modal-product-stock"
  ).textContent = `Stok: ${product.stok} pcs`;
  document.getElementById(
    "modal-product-sold"
  ).textContent = `Terjual: ${sold} pcs`;
  document.getElementById("modal-product-stock").className = `small ${
    isOutOfStock ? "text-danger" : ""
  }`;
  document.getElementById("modal-product-description").textContent =
    product.deskripsi || "Tidak ada deskripsi";
  const orderButton = document.getElementById("modal-product-order");
  orderButton.href = `https://wa.me/62882001079926?text=Saya%20mau%20pesan%20${product.nama}`;
  orderButton.className = `btn btn-success w-100 mt-3 ${
    isOutOfStock ? "disabled" : ""
  }`;
  orderButton.disabled = isOutOfStock;

  const feedbackButton = document.getElementById("modal-product-feedback");
  feedbackButton.onclick = () =>
    window.open(
      `https://wa.me/62882001079926?text=rate%20${productIndex}%20bintang%20`,
      "_blank"
    );
}

function getStarRating(rating) {
  const fullStars = Math.floor(rating);
  const halfStar = rating % 1 >= 0.5 ? 1 : 0;
  const emptyStars = 5 - fullStars - halfStar;
  let stars = "";
  for (let i = 0; i < fullStars; i++)
    stars += '<i class="bi bi-star-fill"></i>';
  if (halfStar) stars += '<i class="bi bi-star-half"></i>';
  for (let i = 0; i < emptyStars; i++) stars += '<i class="bi bi-star"></i>';
  return stars;
}

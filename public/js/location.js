import { showToast } from "./utils.js";

/**
 * Initialize location form
 */
export function initLocationForm() {
  const locationForm = document.getElementById("location-form");
  if (!locationForm) {
    console.error("Location form not found");
    return;
  }

  // Load existing location data
  loadLocation();

  // Handle form submission
  locationForm.addEventListener("submit", handleLocationSubmit);
}

/**
 * Load location data from API and populate form
 */
function loadLocation() {
  fetch("/api/location")
    .then((res) => {
      if (!res.ok) throw new Error("Gagal memuat data lokasi");
      return res.json();
    })
    .then((data) => {
      const { name, latitude, longitude, address } = data;
      document.getElementById("name").value = name || "";
      document.getElementById("latitude").value = latitude || "";
      document.getElementById("longitude").value = longitude || "";
      document.getElementById("address").value = address || "";
    })
    .catch((error) => {
      console.error("Error loading location:", error.message);
      showToast("Gagal memuat data lokasi", "danger");
    });
}

/**
 * Handle location form submission
 * @param {Event} e - Form submission event
 */
function handleLocationSubmit(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    name: formData.get("name"),
    latitude: parseFloat(formData.get("latitude")),
    longitude: parseFloat(formData.get("longitude")),
    address: formData.get("address"),
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Menyimpan...';

  fetch("/api/location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
    .then((res) => {
      if (!res.ok) throw new Error("Gagal menyimpan lokasi");
      return res.json();
    })
    .then(() => {
      showToast("Lokasi berhasil disimpan!", "success");
      loadLocation();
    })
    .catch((error) => {
      showToast(`Error: ${error.message}`, "danger");
    })
    .finally(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    });
}

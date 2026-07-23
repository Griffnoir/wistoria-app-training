// js/activity.js - Version complète (sauvegarde + partage corrigés)

import { getAll, getPrefs, putItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

// --- Constantes ---
const MET = { walk: 3.5, run: 8.0, bike: 5.5 };
const STEP_LENGTH_M = 0.78;

// --- État ---
let state = {
  tracking: false,
  watchId: null,
  timerInterval: null,
  startTime: null,
  path: [],
  totalDistanceKm: 0,
  steps: 0,
  calories: 0,
  lastPosition: null,
};

// --- Éléments DOM ---
const stepEl = document.getElementById("stepCount");
const distanceEl = document.getElementById("distanceCount");
const caloriesEl = document.getElementById("caloriesCount");
const durationEl = document.getElementById("durationCount");
const startBtn = document.getElementById("startActivityBtn");
const stopBtn = document.getElementById("stopActivityBtn");
const saveBtn = document.getElementById("saveActivityBtn");
const shareBtn = document.getElementById("shareBtn");
const resetBtn = document.getElementById("resetActivityBtn");
const weatherBtn = document.getElementById("weatherBtn");
const historyList = document.getElementById("activityHistoryList");
const activityType = document.getElementById("activityType");
const displayWeight = document.getElementById("displayWeight");
const mapPlaceholder = document.getElementById("mapPlaceholder");
const retryMapBtn = document.getElementById("retryMapBtn");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
const stepsChartCanvas = document.getElementById("stepsChart");

// Contrôles carte
const centerMapBtn = document.getElementById("centerMapBtn");
const fitPathBtn = document.getElementById("fitPathBtn");

// Éléments météo
const weatherModal = document.getElementById("weatherModal");
const closeWeatherBtn = document.getElementById("closeWeatherModal");
const weatherLocation = document.getElementById("weatherLocation");
const weatherEmoji = document.getElementById("weatherEmoji");
const weatherTemp = document.getElementById("weatherTemp");
const weatherDesc = document.getElementById("weatherDesc");
const weatherHumidity = document.getElementById("weatherHumidity");
const weatherWind = document.getElementById("weatherWind");
const weatherUV = document.getElementById("weatherUV");

let map = null;
let polyline = null;
let marker = null;
let startMarker = null;
let endMarker = null;
let stepsChartInstance = null;

// --- Distance Haversine ---
function distanceBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- Icône point bleu ---
function getCurrentIcon() {
  return L.divIcon({
    className: 'current-location-dot',
    html: '<div class="blue-dot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// --- Initialisation de la carte ---
function initMap() {
  if (map) return;
  if (mapPlaceholder) mapPlaceholder.style.display = "none";

  const defaultPos = [48.8566, 2.3522];
  map = L.map("map").setView(defaultPos, 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = [pos.coords.latitude, pos.coords.longitude];
        map.setView(loc, 15);
        if (marker) marker.remove();
        marker = L.marker(loc, { icon: getCurrentIcon() }).addTo(map);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }

  loadHistory();
  renderStepsChart();
  updateButtons();
}

// --- Fonctions UI ---
function updateStats() {
  stepEl.textContent = Math.round(state.steps);
  distanceEl.innerHTML = `${state.totalDistanceKm.toFixed(2)} <small>km</small>`;
  caloriesEl.innerHTML = `${Math.round(state.calories)} <small>kcal</small>`;
}

function updateDuration() {
  if (!state.startTime) return;
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");
  durationEl.textContent = `${mins}:${secs}`;
}

function updateButtons() {
  startBtn.disabled = state.tracking;
  stopBtn.disabled = !state.tracking;
  saveBtn.disabled = state.tracking || state.path.length < 2;
  resetBtn.disabled = false;
  // Le bouton partage est toujours actif si des données existent
  shareBtn.disabled = state.steps === 0 && state.totalDistanceKm === 0;
}

// --- Dessin du tracé ---
function drawPath() {
  if (polyline) {
    polyline.remove();
    polyline = null;
  }
  if (startMarker) {
    startMarker.remove();
    startMarker = null;
  }
  if (endMarker) {
    endMarker.remove();
    endMarker = null;
  }

  if (!map || state.path.length < 2) return;
  
  const latlngs = state.path.map(p => [p.lat, p.lng]);
  polyline = L.polyline(latlngs, {
    color: "#1a73e8",
    weight: 5,
    opacity: 0.9,
    smoothFactor: 1,
  }).addTo(map);

  const first = state.path[0];
  startMarker = L.marker([first.lat, first.lng], {
    icon: L.divIcon({ className: 'start-marker', html: '🟢', iconSize: [20, 20] })
  }).addTo(map).bindPopup("Départ");

  const last = state.path[state.path.length - 1];
  endMarker = L.marker([last.lat, last.lng], {
    icon: L.divIcon({ className: 'end-marker', html: '🔴', iconSize: [20, 20] })
  }).addTo(map).bindPopup("Arrivée");
}

// --- Recentrage ---
function centerOnUser() {
  if (!map) return;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = [pos.coords.latitude, pos.coords.longitude];
        map.setView(loc, 16);
        if (marker) {
          marker.setLatLng(loc);
        } else {
          marker = L.marker(loc, { icon: getCurrentIcon() }).addTo(map);
        }
        toast("Centré sur votre position.");
      },
      () => toast("Impossible de récupérer la position."),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    toast("Géolocalisation non supportée.");
  }
}

// --- Ajuster la vue sur le tracé ---
function fitPath() {
  if (!map || state.path.length < 2) {
    toast("Pas assez de points pour ajuster la vue.");
    return;
  }
  const latlngs = state.path.map(p => [p.lat, p.lng]);
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [30, 30] });
  toast("Vue ajustée sur le tracé.");
}

// --- Réinitialisation ---
export function resetSession() {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.tracking = false;
  state.path = [];
  state.totalDistanceKm = 0;
  state.steps = 0;
  state.calories = 0;
  state.startTime = null;
  state.lastPosition = null;
  if (polyline) {
    polyline.remove();
    polyline = null;
  }
  if (startMarker) {
    startMarker.remove();
    startMarker = null;
  }
  if (endMarker) {
    endMarker.remove();
    endMarker = null;
  }
  if (map) {
    map.setView([48.8566, 2.3522], 15);
  }
  updateStats();
  durationEl.textContent = "00:00";
  updateButtons();
  toast("Session réinitialisée.");
}

function resetSessionInternal() {
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.tracking = false;
  state.path = [];
  state.totalDistanceKm = 0;
  state.steps = 0;
  state.calories = 0;
  state.startTime = null;
  state.lastPosition = null;
  if (polyline) { polyline.remove(); polyline = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
  updateStats();
  durationEl.textContent = "00:00";
  updateButtons();
}

function calculateCalories(met, weightKg, durationHours) {
  return met * weightKg * durationHours;
}

// --- Suivi GPS ---
function startTracking() {
  if (state.tracking) return;
  if (!navigator.geolocation) {
    toast("La géolocalisation n'est pas supportée.");
    return;
  }
  if (!map) {
    toast("La carte n'est pas encore prête. Veuillez réessayer.");
    return;
  }

  const prefs = getPrefs();
  const weight = prefs.weight || 70;
  displayWeight.textContent = weight;

  resetSessionInternal();
  state.startTime = Date.now();
  state.tracking = true;
  updateButtons();

  state.timerInterval = setInterval(updateDuration, 1000);

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const accuracy = pos.coords.accuracy;
      if (accuracy > 30) return;

      if (state.lastPosition) {
        const distMeters = distanceBetween(
          state.lastPosition.lat, state.lastPosition.lng,
          loc.lat, loc.lng
        );
        if (distMeters > 1) {
          state.totalDistanceKm += distMeters / 1000;
          state.steps += distMeters / STEP_LENGTH_M;
          const type = activityType.value;
          const met = MET[type] || MET.walk;
          const hours = (Date.now() - state.startTime) / 3600000;
          state.calories = calculateCalories(met, weight, hours);
          state.path.push(loc);
          drawPath();
          updateStats();
          updateButtons(); // Met à jour le bouton partage
        }
      } else {
        state.path.push(loc);
        map.setView([loc.lat, loc.lng], 15);
        if (startMarker) startMarker.remove();
        startMarker = L.marker([loc.lat, loc.lng], {
          icon: L.divIcon({ className: 'start-marker', html: '🟢', iconSize: [20, 20] })
        }).addTo(map).bindPopup("Départ");
      }
      state.lastPosition = loc;
      if (marker) {
        marker.setLatLng([loc.lat, loc.lng]);
      } else {
        marker = L.marker([loc.lat, loc.lng], { icon: getCurrentIcon() }).addTo(map);
      }
    },
    (err) => {
      toast(`Erreur GPS: ${err.message}`);
      console.error(err);
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );

  toast("Suivi démarré !");
}

function stopTracking() {
  if (!state.tracking) return;
  state.tracking = false;
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  updateButtons();
  toast("Suivi arrêté.");
  if (state.path.length >= 2) {
    saveBtn.disabled = false;
  }
}

// --- SAUVEGARDE ---
async function saveActivity() {
  if (state.tracking) {
    toast("Arrêtez d'abord le suivi.");
    return;
  }
  if (state.path.length < 2) {
    toast("Aucun parcours à sauvegarder.");
    return;
  }

  if (!state.startTime) {
    toast("Erreur : session non valide.");
    return;
  }

  const durationSec = (Date.now() - state.startTime) / 1000;
  if (durationSec < 5) {
    toast("Session trop courte (moins de 5s).");
    return;
  }

  if (state.totalDistanceKm <= 0) {
    toast("Distance nulle, rien à sauvegarder.");
    return;
  }

  const activity = {
    id: uid("activity"),
    date: new Date().toISOString(),
    type: activityType.value || "walk",
    steps: Math.round(state.steps),
    distance: parseFloat(state.totalDistanceKm.toFixed(2)),
    calories: Math.round(state.calories),
    duration: Math.round(durationSec),
    path: state.path.map(p => ({ lat: p.lat, lng: p.lng })),
  };

  console.log("📝 Sauvegarde de l'activité :", activity);

  try {
    await putItem("activities", activity);
    toast("✅ Activité sauvegardée !");
    resetSessionInternal();
    updateButtons();
    await loadHistory();
    await renderStepsChart();
  } catch (e) {
    console.error("❌ Erreur lors de la sauvegarde :", e);
    toast("❌ Erreur lors de la sauvegarde : " + (e.message || "inconnue"));
  }
}

// --- PARTAGE CORRIGÉ ---
async function shareActivity() {
  // Vérifier si on a des données à partager
  if (state.steps === 0 && state.totalDistanceKm === 0) {
    toast("Aucune activité à partager.");
    return;
  }

  // Construire le message
  const stepsText = state.steps > 0 ? `${Math.round(state.steps)} pas` : "0 pas";
  const distanceText = state.totalDistanceKm.toFixed(2);
  const caloriesText = state.calories > 0 ? `🔥 ${Math.round(state.calories)} kcal` : "";
  
  let text = `🏃 ${stepsText}`;
  text += ` (${distanceText} km)`;
  if (caloriesText) text += ` ${caloriesText}`;
  text += ` ! #Wistoria #Fitness`;

  // Ajouter la durée si disponible
  if (state.startTime) {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    if (mins > 0 || secs > 0) {
      text += ` ⏱️ ${mins}min${secs > 0 ? ` ${secs}s` : ''}`;
    }
  }

  console.log("📤 Message de partage :", text);

  try {
    if (navigator.share) {
      // API Web Share (mobile/desktop compatible)
      await navigator.share({
        title: "Mon activité Wistoria",
        text: text,
      });
      toast("✅ Partagé !");
    } else if (navigator.clipboard) {
      // Fallback : copier dans le presse-papiers
      await navigator.clipboard.writeText(text);
      toast("📋 Texte copié dans le presse-papiers !");
    } else {
      // Dernier fallback : ouvrir une fenêtre avec le texte
      const win = window.open('', '_blank', 'width=400,height=200');
      if (win) {
        win.document.write(`
          <html><body style="font-family:sans-serif;padding:20px;text-align:center;">
            <h3>📤 Partager</h3>
            <p style="background:#f0f0f0;padding:15px;border-radius:8px;word-break:break-all;">${text}</p>
            <p>Sélectionnez et copiez le texte ci-dessus.</p>
            <button onclick="window.close()" style="padding:8px 20px;border:none;background:#16c7b7;color:white;border-radius:4px;cursor:pointer;">Fermer</button>
          </body></html>
        `);
        toast("📤 Fenêtre de partage ouverte.");
      } else {
        toast("❌ Impossible de partager.");
      }
    }
  } catch (error) {
    console.error("❌ Erreur de partage :", error);
    // Si l'utilisateur annule, ne pas afficher d'erreur
    if (error.name !== 'AbortError') {
      toast("❌ Erreur lors du partage.");
    }
  }
}

// --- Graphique des pas ---
async function renderStepsChart() {
  if (!stepsChartCanvas) return;
  if (typeof Chart === 'undefined') {
    console.warn("Chart.js non chargé.");
    stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">📊 Graphique indisponible</div>`;
    return;
  }
  try {
    const activities = await getAll("activities");
    if (!activities || activities.length === 0) {
      stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">Pas encore de données.</div>`;
      return;
    }
    const last7 = activities.slice(-7);
    const labels = last7.map(a => new Date(a.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
    const data = last7.map(a => a.steps || 0);
    if (stepsChartInstance) stepsChartInstance.destroy();
    stepsChartInstance = new Chart(stepsChartCanvas, {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["Aucune"],
        datasets: [{
          label: "Pas",
          data: data.length ? data : [0],
          backgroundColor: "rgba(22, 199, 183, 0.7)",
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  } catch (error) {
    console.error("Erreur graphique :", error);
    stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">Erreur de chargement du graphique.</div>`;
  }
}

// --- Historique ---
async function loadHistory() {
  try {
    const activities = await getAll("activities");
    if (!activities || activities.length === 0) {
      historyList.innerHTML = `<div class="empty-state">Aucune activité enregistrée.</div>`;
      return;
    }
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));
    historyList.innerHTML = activities.slice(0, 15).map((act) => {
      const date = new Date(act.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
      const time = new Date(act.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const dur = Math.floor(act.duration / 60) + "min";
      const typeEmoji = act.type === "run" ? "🏃" : act.type === "bike" ? "🚴" : "🚶";
      return `
        <div class="history-item">
          <div class="info">
            <strong>${typeEmoji} ${date} à ${time}</strong>
            <span>${act.steps} pas · ${act.distance.toFixed(2)} km · ${act.calories} kcal · ${dur}</span>
          </div>
          <span class="badge">${act.type || "marche"}</span>
        </div>
      `;
    }).join("");
  } catch (e) {
    console.error("Erreur historique :", e);
    historyList.innerHTML = `<div class="empty-state">Erreur de chargement.</div>`;
  }
}

// --- Réessayer la carte ---
function retryMap() {
  if (map) {
    map.setView([48.8566, 2.3522], 15);
    toast("Carte recentrée.");
    return;
  }
  toast("Tentative de chargement de la carte...");
  if (typeof L === "undefined") {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = initMap;
    document.head.appendChild(script);
  } else {
    initMap();
  }
}

// --- Météo (version avec emojis pour le vent) ---
async function fetchWeather() {
  weatherModal.style.display = "grid";
  weatherLocation.textContent = "Recherche de votre position...";
  weatherEmoji.textContent = "⏳";
  weatherTemp.textContent = "--°C";
  weatherDesc.textContent = "Chargement...";
  weatherHumidity.textContent = "--%";
  weatherWind.textContent = "-- km/h";
  weatherUV.textContent = "--";

  let lat = 48.8566;
  let lon = 2.3522;

  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
        });
      });
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch (e) {
      console.warn("Géolocalisation échouée, fallback sur Paris.", e);
      toast("Position non trouvée, affichage de la météo Paris.");
    }
  }

  try {
    const url = `https://wttr.in/${lat},${lon}?format=j1&lang=fr`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const current = data.current_condition[0];
    const nearest = data.nearest_area?.[0] || {};
    const areaName = nearest.areaName?.[0]?.value || `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
    
    const temp = current.temp_C || "--";
    const desc = current.weatherDesc?.[0]?.value || "Inconnu";
    const humidity = current.humidity || "--";
    
    // --- Gestion du vent avec emoji ---
    let windSpeed = current.windSpeed || "--";
    let windDirText = current.winddir16Point || "";
    
    // Fonction pour obtenir l'emoji du vent en fonction de la vitesse
    function getWindEmoji(speed) {
      const s = parseFloat(speed);
      if (isNaN(s) || s < 0) return "🍃";
      if (s < 5) return "🍃";
      if (s < 15) return "🌬️";
      if (s < 30) return "💨";
      if (s < 50) return "🌪️";
      return "🌀";
    }
    
    if (windSpeed === "N/A" || windSpeed === "" || windSpeed === "--") {
      windSpeed = "🍃 Calme";
    } else {
      const emoji = getWindEmoji(windSpeed);
      if (windDirText && windDirText !== "N/A") {
        windSpeed = `${emoji} ${windSpeed} km/h (${windDirText})`;
      } else {
        windSpeed = `${emoji} ${windSpeed} km/h`;
      }
    }

    // --- Gestion de l'UV ---
    let uv = current.uvIndex || "--";
    if (uv === "0" || uv === 0 || uv === "0.0") {
      uv = "🌙 N/A (nuit)";
    } else if (uv === "N/A" || uv === "--" || uv === "") {
      uv = "N/A";
    } else {
      // Ajouter un emoji UV
      const uvNum = parseFloat(uv);
      if (uvNum <= 2) uv = `🟢 ${uv} (faible)`;
      else if (uvNum <= 5) uv = `🟡 ${uv} (modéré)`;
      else if (uvNum <= 7) uv = `🟠 ${uv} (élevé)`;
      else if (uvNum <= 10) uv = `🔴 ${uv} (très élevé)`;
      else uv = `🟣 ${uv} (extrême)`;
    }

    // --- Emoji météo ---
    let emoji = "🌤️";
    const lowerDesc = desc.toLowerCase();
    if (lowerDesc.includes("pluie") || lowerDesc.includes("averse")) emoji = "🌧️";
    else if (lowerDesc.includes("neige")) emoji = "❄️";
    else if (lowerDesc.includes("orage") || lowerDesc.includes("tonnerre")) emoji = "⛈️";
    else if (lowerDesc.includes("brouillard") || lowerDesc.includes("brume")) emoji = "🌫️";
    else if (lowerDesc.includes("soleil") || lowerDesc.includes("ensoleillé") || lowerDesc.includes("clair")) emoji = "☀️";
    else if (lowerDesc.includes("nuage")) emoji = "☁️";

    // Mise à jour de l'interface
    weatherLocation.textContent = ` ${areaName}`;
    weatherEmoji.textContent = emoji;
    weatherTemp.textContent = `${temp}°C`;
    weatherDesc.textContent = desc;
    weatherHumidity.textContent = `${humidity}%`;
    weatherWind.textContent = windSpeed;
    weatherUV.textContent = uv;

    toast("Météo chargée !");

  } catch (error) {
    console.error("Erreur météo :", error);
    weatherDesc.textContent = "❌ Impossible de charger la météo.";
    weatherEmoji.textContent = "⚠️";
    toast("Erreur de chargement de la météo.");
  }
}

function closeWeather() {
  weatherModal.style.display = "none";
}

// --- Initialisation ---
export function initActivityPage() {
  const prefs = getPrefs();
  displayWeight.textContent = prefs.weight || 70;

  startBtn.addEventListener("click", startTracking);
  stopBtn.addEventListener("click", stopTracking);
  saveBtn.addEventListener("click", saveActivity);
  shareBtn.addEventListener("click", shareActivity);
  resetBtn.addEventListener("click", resetSession);
  weatherBtn.addEventListener("click", fetchWeather);
  closeWeatherBtn.addEventListener("click", closeWeather);
  weatherModal.addEventListener("click", (e) => {
    if (e.target === weatherModal) closeWeather();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && weatherModal.style.display === "grid") {
      closeWeather();
    }
  });

  retryMapBtn.addEventListener("click", retryMap);
  refreshHistoryBtn.addEventListener("click", () => { loadHistory(); renderStepsChart(); });

  centerMapBtn.addEventListener("click", centerOnUser);
  fitPathBtn.addEventListener("click", fitPath);

  try {
    loadHistory();
  } catch (e) { console.warn(e); }
  try {
    renderStepsChart();
  } catch (e) { console.warn(e); }

  if (typeof L !== "undefined") {
    initMap();
  } else {
    if (mapPlaceholder) mapPlaceholder.style.display = "grid";
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = initMap;
    document.head.appendChild(script);
  }

  updateButtons();

  window.addEventListener("beforeunload", () => {
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    if (state.timerInterval) clearInterval(state.timerInterval);
  });
}

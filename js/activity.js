// js/activity.js - Version Leaflet (point bleu, recentrage, objectifs, météo, partage, graphique)

import { getAll, getPrefs, putItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

// --- Constantes ---
const MET = { walk: 3.5, run: 8.0, bike: 5.5 };
const STEP_LENGTH_M = 0.78;
const DAILY_GOAL_STEPS = 10000;

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
  goalDistance: 5,
};

// --- Éléments DOM ---
const stepEl = document.getElementById("stepCount");
const stepGoalEl = document.getElementById("stepGoal");
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
const goalDistanceSelect = document.getElementById("goalDistance");
const displayWeight = document.getElementById("displayWeight");
const mapPlaceholder = document.getElementById("mapPlaceholder");
const retryMapBtn = document.getElementById("retryMapBtn");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
const stepsChartCanvas = document.getElementById("stepsChart");
const goalProgress = document.getElementById("goalProgress");
const goalLabel = document.getElementById("goalLabel");

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
  updateGoalDisplay();
}

// --- Fonctions UI ---
function updateStats() {
  stepEl.textContent = Math.round(state.steps);
  stepGoalEl.textContent = `/ ${DAILY_GOAL_STEPS} 🎯`;
  const progress = Math.min(100, (state.steps / DAILY_GOAL_STEPS) * 100);
  stepEl.style.color = progress >= 100 ? "#62d36f" : "";
  distanceEl.innerHTML = `${state.totalDistanceKm.toFixed(2)} <small>km</small>`;
  caloriesEl.innerHTML = `${Math.round(state.calories)} <small>kcal</small>`;
  updateGoalDisplay();
}

function updateGoalDisplay() {
  const goal = state.goalDistance || 5;
  const current = state.totalDistanceKm || 0;
  const percent = Math.min(100, (current / goal) * 100);
  goalProgress.textContent = `${Math.round(percent)}%`;
  goalLabel.textContent = `${current.toFixed(2)} / ${goal} km`;
  goalProgress.style.color = percent >= 100 ? "#62d36f" : "#16c7b7";
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

  state.goalDistance = parseFloat(goalDistanceSelect.value) || 5;
  
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
          
          if (state.totalDistanceKm >= state.goalDistance) {
            toast(`🎉 Objectif de ${state.goalDistance} km atteint !`);
          }
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

async function saveActivity() {
  if (state.tracking) {
    toast("Arrêtez d'abord le suivi.");
    return;
  }
  if (state.path.length < 2) {
    toast("Aucun parcours à sauvegarder.");
    return;
  }

  const durationSec = (Date.now() - state.startTime) / 1000;
  if (durationSec < 5) {
    toast("Session trop courte (moins de 5s).");
    return;
  }

  const activity = {
    id: uid("activity"),
    date: new Date().toISOString(),
    type: activityType.value,
    steps: Math.round(state.steps),
    distance: state.totalDistanceKm,
    calories: Math.round(state.calories),
    duration: durationSec,
    path: state.path,
    goal: state.goalDistance,
  };

  try {
    await putItem("activities", activity);
    toast("Activité sauvegardée ! ✅");
    resetSessionInternal();
    updateButtons();
    loadHistory();
    renderStepsChart();
  } catch (e) {
    toast("Erreur lors de la sauvegarde.");
    console.error(e);
  }
}

// --- Partager ---
function shareActivity() {
  if (state.steps === 0) {
    toast("Aucune activité à partager.");
    return;
  }
  const text = `🏃 J'ai marché ${Math.round(state.steps)} pas (${state.totalDistanceKm.toFixed(2)} km) ! 🔥 ${Math.round(state.calories)} kcal brûlées ! #Wistoria #Fitness`;
  if (navigator.share) {
    navigator.share({ title: "Mon activité Wistoria", text });
  } else {
    navigator.clipboard?.writeText(text).then(() => toast("Texte copié !"));
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
    const last7 = activities.slice(-7);
    const labels = last7.map(a => new Date(a.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
    const data = last7.map(a => a.steps || 0);
    if (stepsChartInstance) stepsChartInstance.destroy();
    if (last7.length === 0) {
      stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">Pas encore de données.</div>`;
      return;
    }
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
      const goal = act.goal ? `🎯 ${act.goal} km` : '';
      return `
        <div class="history-item">
          <div class="info">
            <strong>${typeEmoji} ${date} à ${time}</strong>
            <span>${act.steps} pas · ${act.distance.toFixed(2)} km · ${act.calories} kcal · ${dur} ${goal}</span>
          </div>
          <span class="badge">${act.type || "marche"}</span>
        </div>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
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

// --- Météo ---
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
  let locationName = "Paris (défaut)";

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
      locationName = `Lat ${lat.toFixed(4)}, Lon ${lon.toFixed(4)}`;
    } catch (e) {
      console.warn("Géolocalisation échouée, fallback sur Paris.", e);
      toast("Position non trouvée, affichage de la météo Paris.");
    }
  }

  weatherLocation.textContent = `📍 ${locationName}`;

  try {
    const url = `https://wttr.in/${lat},${lon}?format=j1&lang=fr&units=m`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const current = data.current_condition[0];
    const humidity = current.humidity || "--";
    const temp = current.temp_C || "--";
    const desc = current.weatherDesc?.[0]?.value || "Inconnu";
    const wind = current.windSpeed || "--";
    const uv = current.uvIndex || "--";

    let emoji = "🌤️";
    const lowerDesc = desc.toLowerCase();
    if (lowerDesc.includes("pluie") || lowerDesc.includes("averse")) emoji = "🌧️";
    else if (lowerDesc.includes("neige")) emoji = "❄️";
    else if (lowerDesc.includes("orage") || lowerDesc.includes("tonnerre")) emoji = "⛈️";
    else if (lowerDesc.includes("brouillard") || lowerDesc.includes("brume")) emoji = "🌫️";
    else if (lowerDesc.includes("soleil") || lowerDesc.includes("ensoleillé") || lowerDesc.includes("clair")) emoji = "☀️";
    else if (lowerDesc.includes("nuage")) emoji = "☁️";

    weatherEmoji.textContent = emoji;
    weatherTemp.textContent = `${temp}°C`;
    weatherDesc.textContent = desc;
    weatherHumidity.textContent = `${humidity}%`;
    weatherWind.textContent = `${wind} km/h`;
    weatherUV.textContent = uv;

    const area = data.nearest_area?.[0]?.areaName?.[0]?.value;
    if (area) {
      weatherLocation.textContent = `📍 ${area}`;
    }

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

  goalDistanceSelect.addEventListener("change", () => {
    state.goalDistance = parseFloat(goalDistanceSelect.value) || 5;
    updateGoalDisplay();
  });

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
  updateGoalDisplay();

  window.addEventListener("beforeunload", () => {
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    if (state.timerInterval) clearInterval(state.timerInterval);
  });
}
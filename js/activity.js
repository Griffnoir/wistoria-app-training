// js/activity.js

import { getAll, getPrefs, putItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

// --- Constantes ---
const MET = { walk: 3.5, run: 8.0, bike: 5.5 };
const STEP_LENGTH_M = 0.78; // Longueur moyenne d'un pas en mètres

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
const historyList = document.getElementById("activityHistoryList");
const activityType = document.getElementById("activityType");
const displayWeight = document.getElementById("displayWeight");
const mapPlaceholder = document.getElementById("mapPlaceholder");
const retryMapBtn = document.getElementById("retryMapBtn");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");

let map = null;
let polyline = null;
let mapInitAttempted = false;

// --- Initialisation de la carte (callback global) ---
window.initMap = function() {
  if (typeof google === "undefined" || !google.maps) {
    console.warn("Google Maps non chargé.");
    return;
  }
  mapPlaceholder.style.display = "none";
  const defaultPos = { lat: 48.8566, lng: 2.3522 };
  map = new google.maps.Map(document.getElementById("map"), {
    center: defaultPos,
    zoom: 15,
    disableDefaultUI: true,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
  // Centrer sur la position actuelle si possible
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setCenter(loc);
      },
      () => { /* silencieux */ },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
  loadHistory();
};

// --- Fonctions de mise à jour UI ---
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
}

function drawPath() {
  if (polyline) {
    polyline.setMap(null);
    polyline = null;
  }
  if (!map || state.path.length < 2) return;
  polyline = new google.maps.Polyline({
    path: state.path,
    geodesic: true,
    strokeColor: "#16c7b7",
    strokeOpacity: 0.9,
    strokeWeight: 5,
  });
  polyline.setMap(map);
  // Centrer sur le dernier point
  const last = state.path[state.path.length - 1];
  map.setCenter(last);
  map.setZoom(15);
}

function resetSession() {
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
    polyline.setMap(null);
    polyline = null;
  }
  updateStats();
  durationEl.textContent = "00:00";
  updateButtons();
}

// --- Calcul des calories ---
function calculateCalories(met, weightKg, durationHours) {
  // Formule standard : MET * poids (kg) * temps (heures)
  return met * weightKg * durationHours;
}

// --- Suivi GPS ---
function startTracking() {
  if (state.tracking) return;
  if (!navigator.geolocation) {
    toast("La géolocalisation n'est pas supportée.");
    return;
  }

  const prefs = getPrefs();
  const weight = prefs.weight || 70;
  displayWeight.textContent = weight;

  // Réinitialiser l'état
  resetSession();
  state.startTime = Date.now();
  state.tracking = true;
  updateButtons();

  // Démarrer le chronomètre
  state.timerInterval = setInterval(updateDuration, 1000);

  // Démarrer le watch GPS
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const accuracy = pos.coords.accuracy;
      // Ignorer les positions trop imprécises (> 30m) pour éviter le bruit
      if (accuracy > 30) return;

      if (state.lastPosition) {
        // Calculer la distance entre les deux points (en mètres)
        const prev = new google.maps.LatLng(state.lastPosition.lat, state.lastPosition.lng);
        const curr = new google.maps.LatLng(loc.lat, loc.lng);
        const distMeters = google.maps.geometry.spherical.computeDistanceBetween(prev, curr);
        // Ignorer les micro-déplacements (< 1m)
        if (distMeters > 1) {
          state.totalDistanceKm += distMeters / 1000;
          state.steps += distMeters / STEP_LENGTH_M;
          // Calcul des calories (basé sur le type d'activité)
          const type = activityType.value;
          const met = MET[type] || MET.walk;
          const hours = (Date.now() - state.startTime) / 3600000;
          state.calories = calculateCalories(met, weight, hours);
          // Ajouter au chemin
          state.path.push(loc);
          // Tracer
          drawPath();
          updateStats();
        }
      } else {
        // Premier point
        state.path.push(loc);
        if (map) map.setCenter(loc);
      }
      state.lastPosition = loc;
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
  // Si un chemin existe, on active le bouton sauvegarder
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
  };

  try {
    await putItem("activities", activity);
    toast("Activité sauvegardée ! ✅");
    resetSession();
    updateButtons();
    loadHistory(); // Rafraîchir l'historique
  } catch (e) {
    toast("Erreur lors de la sauvegarde.");
    console.error(e);
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
    // Trier par date décroissante
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
    console.error(e);
    historyList.innerHTML = `<div class="empty-state">Erreur de chargement.</div>`;
  }
}

// --- Réessayer le chargement de la carte ---
function retryMap() {
  if (typeof google !== "undefined" && google.maps) {
    window.initMap();
    return;
  }
  toast("Rechargement de la carte...");
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=__VOTRE_CLE_API__&callback=initMap&libraries=geometry`;
  document.head.appendChild(script);
}

// --- Initialisation de la page ---
export function initActivityPage() {
  // Afficher le poids
  const prefs = getPrefs();
  displayWeight.textContent = prefs.weight || 70;

  // Événements
  startBtn.addEventListener("click", startTracking);
  stopBtn.addEventListener("click", stopTracking);
  saveBtn.addEventListener("click", saveActivity);
  retryMapBtn.addEventListener("click", retryMap);
  refreshHistoryBtn.addEventListener("click", loadHistory);

  // Charger l'historique immédiatement
  loadHistory();

  // Si la carte est déjà chargée (ex: le script a fini avant le module)
  if (typeof google !== "undefined" && google.maps && !map) {
    window.initMap();
  } else {
    // Afficher le placeholder en attendant
    mapPlaceholder.style.display = "grid";
  }

  // Mettre à jour l'état des boutons au chargement
  updateButtons();
}

// Nettoyage si la page est quittée (optionnel)
window.addEventListener("beforeunload", () => {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
  }
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }
});
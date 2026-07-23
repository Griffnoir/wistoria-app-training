// js/activity.js

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
const historyList = document.getElementById("activityHistoryList");
const activityType = document.getElementById("activityType");
const displayWeight = document.getElementById("displayWeight");
const mapPlaceholder = document.getElementById("mapPlaceholder");
const retryMapBtn = document.getElementById("retryMapBtn");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");

let map = null;
let polyline = null;
let mapLoadTimeout = null;

// --- Fonction d'initialisation de la carte (callback global) ---
function initMap() {
  // Vérifier que Google Maps est chargé
  if (typeof google === "undefined" || !google.maps) {
    console.warn("Google Maps non encore chargé.");
    return;
  }
  // Éviter une double initialisation
  if (map) {
    console.log("Map déjà initialisée.");
    return;
  }

  // Masquer le placeholder
  if (mapPlaceholder) mapPlaceholder.style.display = "none";

  const defaultPos = { lat: 48.8566, lng: 2.3522 };
  try {
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

    // Charger l'historique
    loadHistory();
    // Mettre à jour les boutons
    updateButtons();

    // Annuler le timeout si la carte a réussi à se charger
    clearTimeout(mapLoadTimeout);
    mapLoadTimeout = null;
  } catch (e) {
    console.error("Erreur lors de l'initialisation de la carte:", e);
    toast("Erreur de chargement de la carte.");
    // Réafficher le placeholder avec un message d'erreur
    if (mapPlaceholder) {
      mapPlaceholder.style.display = "grid";
      mapPlaceholder.innerHTML = `
        <div>
          <p style="font-size: 2rem; margin: 0;">🗺️</p>
          <p>Impossible de charger la carte.</p>
          <button class="btn primary" id="retryMapBtn">Réessayer</button>
        </div>
      `;
      document.getElementById("retryMapBtn")?.addEventListener("click", retryMap);
    }
  }
}

// Exposer la fonction globalement pour le callback de Google Maps
window.initMap = initMap;

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

  resetSession();
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
        const prev = new google.maps.LatLng(state.lastPosition.lat, state.lastPosition.lng);
        const curr = new google.maps.LatLng(loc.lat, loc.lng);
        const distMeters = google.maps.geometry.spherical.computeDistanceBetween(prev, curr);
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
        }
      } else {
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
    loadHistory();
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
  if (map) {
    map.setCenter({ lat: 48.8566, lng: 2.3522 });
    toast("Carte recentrée.");
    return;
  }
  toast("Tentative de chargement de la carte...");
  if (typeof google !== "undefined" && google.maps) {
    initMap();
  } else {
    // Supprimer l'ancien script pour éviter les doublons
    const oldScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (oldScript) oldScript.remove();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?AIzaSyBPECdLYBG8GAgJpMN8FIIjsBolflqa4Gw&callback=initMap&libraries=geometry`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    clearTimeout(mapLoadTimeout);
    mapLoadTimeout = setTimeout(() => {
      if (!map) {
        toast("Le chargement de la carte a échoué. Vérifiez votre clé API.");
        if (mapPlaceholder) {
          mapPlaceholder.style.display = "grid";
          mapPlaceholder.innerHTML = `
            <div>
              <p style="font-size: 2rem; margin: 0;">🗺️</p>
              <p>Impossible de charger la carte.</p>
              <p style="font-size: 0.8rem; color: var(--muted);">Vérifiez votre clé API et votre connexion.</p>
              <button class="btn primary" id="retryMapBtn">Réessayer</button>
            </div>
          `;
          document.getElementById("retryMapBtn")?.addEventListener("click", retryMap);
        }
      }
    }, 10000);
  }
}

// --- Initialisation de la page ---
export function initActivityPage() {
  const prefs = getPrefs();
  displayWeight.textContent = prefs.weight || 70;

  startBtn.addEventListener("click", startTracking);
  stopBtn.addEventListener("click", stopTracking);
  saveBtn.addEventListener("click", saveActivity);
  retryMapBtn.addEventListener("click", retryMap);
  refreshHistoryBtn.addEventListener("click", loadHistory);

  loadHistory();

  if (typeof google !== "undefined" && google.maps) {
    initMap();
  } else {
    if (mapPlaceholder) mapPlaceholder.style.display = "grid";
  }

  updateButtons();

  window.addEventListener("beforeunload", () => {
    if (state.watchId) {
      navigator.geolocation.clearWatch(state.watchId);
    }
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
    }
  });
}
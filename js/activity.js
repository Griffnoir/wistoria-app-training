// js/activity.js - Version finale avec menus déroulants, correction des z-index et agrandissement

import { getAll, getPrefs, putItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

// --- Constantes ---
const MET = { walk: 3.5, run: 8.0, bike: 5.5 };
const STEP_LENGTH_M = 0.78;
const SPEECH_INTERVAL = 30000;

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
  routePoints: [],
  routePolyline: null,
  routeMarkers: [],
  isDrawingRoute: false,
  routeDistance: 0,
  voiceEnabled: true,
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
const startRouteBtn = document.getElementById("startRouteBtn");
const cancelLastPointBtn = document.getElementById("cancelLastPointBtn");
const finishRouteBtn = document.getElementById("finishRouteBtn");
const clearRouteBtn = document.getElementById("clearRouteBtn");
const toggleVoiceBtn = document.getElementById("toggleVoiceBtn");
const importGpxBtn = document.getElementById("importGpxBtn");
const toggleMapBtn = document.getElementById("toggleMapBtn");
const historyList = document.getElementById("activityHistoryList");
const activityType = document.getElementById("activityType");
const displayWeight = document.getElementById("displayWeight");
const mapPlaceholder = document.getElementById("mapPlaceholder");
const retryMapBtn = document.getElementById("retryMapBtn");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
const stepsChartCanvas = document.getElementById("stepsChart");
const goalDistanceInput = document.getElementById("goalDistanceKm");
const goalDistanceLabel = document.getElementById("goalDistanceLabel");
const goalProgressBar = document.getElementById("goalProgressBar");
const statusMsg = document.getElementById("statusMessage");

const centerMapBtn = document.getElementById("centerMapBtn");
const fitPathBtn = document.getElementById("fitPathBtn");

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
let speechInterval = null;
let isMapExpanded = false;

// --- Filtre GPS (moyenne glissante) ---
const gpsBuffer = [];
const GPS_BUFFER_SIZE = 3;

function applySmoothing(newLat, newLng) {
  gpsBuffer.push({ lat: newLat, lng: newLng });
  if (gpsBuffer.length > GPS_BUFFER_SIZE) gpsBuffer.shift();
  const avg = gpsBuffer.reduce((acc, p) => {
    acc.lat += p.lat;
    acc.lng += p.lng;
    return acc;
  }, { lat: 0, lng: 0 });
  return {
    lat: avg.lat / gpsBuffer.length,
    lng: avg.lng / gpsBuffer.length,
  };
}

// --- Distance Haversine ---
function distanceBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- Synthèse vocale ---
function speak(text) {
  if (!('speechSynthesis' in window) || !state.voiceEnabled) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  const frenchVoice = voices.find(v => v.lang.startsWith('fr'));
  if (frenchVoice) utterance.voice = frenchVoice;
  window.speechSynthesis.speak(utterance);
}

function startSpeechUpdates() {
  if (speechInterval) clearInterval(speechInterval);
  speak("Suivi démarré.");
  speechInterval = setInterval(() => {
    if (!state.tracking) {
      clearInterval(speechInterval);
      speechInterval = null;
      return;
    }
    if (!state.voiceEnabled) return;
    let message = `Distance : ${state.totalDistanceKm.toFixed(1)} km. Pas : ${Math.round(state.steps)}.`;
    if (state.routePoints.length > 1 && state.routeDistance > 0) {
      const remaining = Math.max(0, state.routeDistance - state.totalDistanceKm);
      message += ` Reste ${remaining.toFixed(1)} km.`;
    }
    if (state.goalDistance > 0) {
      const goalRemaining = Math.max(0, state.goalDistance - state.totalDistanceKm);
      if (goalRemaining > 0) message += ` Objectif : ${goalRemaining.toFixed(1)} km.`;
      else message += " Objectif atteint !";
    }
    speak(message);
  }, SPEECH_INTERVAL);
}

// --- Icônes ---
function getCurrentIcon() {
  return L.divIcon({
    className: 'current-location-dot',
    html: '<div class="blue-dot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function createRouteMarker(index) {
  return L.divIcon({
    className: 'route-marker-number',
    html: `${index + 1}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// --- Initialisation de la carte ---
function initMap() {
  console.log("🚀 initMap() appelée");
  if (map) {
    console.log("⚠️ Carte déjà initialisée");
    return;
  }
  const mapContainer = document.getElementById("map");
  if (!mapContainer) {
    console.error("❌ Élément #map introuvable !");
    toast("Erreur : conteneur de carte manquant.");
    return;
  }
  console.log("✅ Conteneur #map trouvé");

  if (mapPlaceholder) {
    mapPlaceholder.style.display = "none";
    console.log("✅ Placeholder masqué");
  }

  const defaultPos = [48.8566, 2.3522];
  try {
    map = L.map("map").setView(defaultPos, 15);
    console.log("✅ Carte Leaflet créée");

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    console.log("✅ Tuile OSM ajoutée");

    map.on('click', (e) => {
      if (state.isDrawingRoute) {
        addRoutePoint(e.latlng.lat, e.latlng.lng);
      }
    });

    if (navigator.geolocation) {
      console.log("📡 Tentative de géolocalisation...");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          console.log("✅ Position GPS obtenue", pos.coords);
          const loc = [pos.coords.latitude, pos.coords.longitude];
          map.setView(loc, 15);
          if (marker) marker.remove();
          marker = L.marker(loc, { icon: getCurrentIcon() }).addTo(map);
        },
        (err) => {
          console.warn("⚠️ Géolocalisation échouée :", err.message);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      console.warn("⚠️ Geolocation non supportée");
    }

    loadHistory();
    renderStepsChart();
    updateButtons();
    updateGoalDisplay();
    updateRouteButtons();
    updateVoiceButton();

    console.log("✅ initMap() terminée avec succès");
  } catch (error) {
    console.error("❌ ERREUR dans initMap() :", error);
    toast("Erreur d'initialisation de la carte : " + error.message);
  }
}

// --- Gestion de l'itinéraire ---
function startRouteDrawing() {
  if (state.tracking) {
    toast("Arrêtez d'abord le suivi.");
    return;
  }
  clearRoute();
  state.isDrawingRoute = true;
  state.routePoints = [];
  startRouteBtn.textContent = "✏️ Cliquez sur la carte";
  startRouteBtn.disabled = true;
  cancelLastPointBtn.disabled = false;
  finishRouteBtn.disabled = false;
  toast("Cliquez sur la carte.");
  updateStatusMessage();
  updateRouteButtons();
}

function addRoutePoint(lat, lng) {
  if (!state.isDrawingRoute) return;
  state.routePoints.push({ lat, lng });
  const marker = L.marker([lat, lng], { icon: createRouteMarker(state.routePoints.length - 1) }).addTo(map);
  state.routeMarkers.push(marker);
  updateRouteLine();
  calculateRouteDistance();
  toast(`Point ${state.routePoints.length} (${state.routeDistance.toFixed(2)} km)`);
  updateRouteButtons();
}

function cancelLastPoint() {
  if (state.routePoints.length === 0) return;
  const lastMarker = state.routeMarkers.pop();
  if (lastMarker) map.removeLayer(lastMarker);
  state.routePoints.pop();
  updateRouteLine();
  calculateRouteDistance();
  if (state.routePoints.length === 0) cancelLastPointBtn.disabled = true;
  toast("Dernier point supprimé.");
  updateRouteButtons();
}

function finishRoute() {
  if (state.routePoints.length < 2) {
    toast("Il faut au moins 2 points.");
    return;
  }
  state.isDrawingRoute = false;
  startRouteBtn.textContent = "✏️ Tracer itinéraire";
  startRouteBtn.disabled = false;
  cancelLastPointBtn.disabled = true;
  finishRouteBtn.disabled = true;
  calculateRouteDistance();
  if (state.routeDistance > 0) {
    const currentGoal = parseFloat(goalDistanceInput?.value) || 0;
    if (currentGoal === 0 || currentGoal === 5) {
      const newGoal = Math.ceil(state.routeDistance / 0.5) * 0.5;
      if (goalDistanceInput) {
        goalDistanceInput.value = newGoal;
        state.goalDistance = newGoal;
        updateGoalDisplay();
      }
      toast(`🎯 Objectif : ${newGoal.toFixed(1)} km`);
    } else {
      toast(`✅ Itinéraire : ${state.routeDistance.toFixed(2)} km`);
    }
  }
  updateStatusMessage();
  updateRouteButtons();
}

function clearRoute() {
  state.isDrawingRoute = false;
  state.routePoints = [];
  state.routeDistance = 0;
  state.routeMarkers.forEach(m => map.removeLayer(m));
  state.routeMarkers = [];
  if (state.routePolyline) {
    map.removeLayer(state.routePolyline);
    state.routePolyline = null;
  }
  startRouteBtn.textContent = "✏️ Tracer itinéraire";
  startRouteBtn.disabled = false;
  cancelLastPointBtn.disabled = true;
  finishRouteBtn.disabled = true;
  toast("Itinéraire effacé.");
  updateStatusMessage();
  updateRouteButtons();
}

function updateRouteLine() {
  if (state.routePolyline) {
    map.removeLayer(state.routePolyline);
    state.routePolyline = null;
  }
  if (state.routePoints.length < 2) return;
  const latlngs = state.routePoints.map(p => [p.lat, p.lng]);
  state.routePolyline = L.polyline(latlngs, {
    color: '#ff5722',
    weight: 4,
    dashArray: '8 6',
    opacity: 0.9,
  }).addTo(map);
}

function calculateRouteDistance() {
  state.routeDistance = 0;
  for (let i = 1; i < state.routePoints.length; i++) {
    state.routeDistance += distanceBetween(
      state.routePoints[i-1].lat, state.routePoints[i-1].lng,
      state.routePoints[i].lat, state.routePoints[i].lng
    ) / 1000;
  }
}

function updateRouteButtons() {
  if (cancelLastPointBtn) {
    cancelLastPointBtn.disabled = state.routePoints.length === 0 || !state.isDrawingRoute;
  }
  if (finishRouteBtn) {
    finishRouteBtn.disabled = state.routePoints.length < 2 || !state.isDrawingRoute;
  }
  if (startRouteBtn) {
    startRouteBtn.disabled = state.tracking;
  }
}

// --- Fonctions UI ---
function updateStats() {
  stepEl.textContent = Math.round(state.steps);
  distanceEl.innerHTML = `${state.totalDistanceKm.toFixed(2)} <small>km</small>`;
  caloriesEl.innerHTML = `${Math.round(state.calories)} <small>kcal</small>`;
  updateGoalDisplay();
  updateStatusMessage();
}

function updateGoalDisplay() {
  const goal = parseFloat(goalDistanceInput?.value) || 0;
  state.goalDistance = goal;
  const current = state.totalDistanceKm || 0;
  if (goal === 0) {
    if (goalProgressBar) {
      goalProgressBar.style.width = '0%';
      goalProgressBar.style.background = '#666';
    }
    if (goalDistanceLabel) {
      goalDistanceLabel.textContent = `${current.toFixed(1)} km (illimité)`;
    }
    return;
  }
  const percent = Math.min(100, (current / goal) * 100);
  if (goalProgressBar) {
    goalProgressBar.style.width = percent + '%';
    goalProgressBar.style.background = percent >= 100 ? '#62d36f' : '#1a73e8';
  }
  if (goalDistanceLabel) {
    goalDistanceLabel.textContent = `${current.toFixed(1)} / ${goal.toFixed(1)} km`;
  }
}

function updateStatusMessage() {
  if (!statusMsg) return;
  if (state.tracking) {
    let msg = '🟢 En cours...';
    if (state.routePoints.length > 1 && state.routeDistance > 0) {
      const progress = Math.min(100, (state.totalDistanceKm / state.routeDistance) * 100);
      msg += ` Itinéraire : ${Math.round(progress)}%`;
    }
    statusMsg.innerHTML = msg;
  } else if (state.isDrawingRoute) {
    statusMsg.innerHTML = '✏️ Mode tracé - Cliquez sur la carte';
  } else {
    statusMsg.innerHTML = state.totalDistanceKm > 0 ? '⏸️ Arrêté' : '⏸️ En attente';
  }
}

function updateDuration() {
  if (!state.startTime) return;
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");
  durationEl.textContent = `${mins}:${secs}`;
}

function updateButtons() {
  if (startBtn) startBtn.disabled = state.tracking;
  if (stopBtn) stopBtn.disabled = !state.tracking;
  if (saveBtn) saveBtn.disabled = state.tracking || state.path.length < 2;
  if (resetBtn) resetBtn.disabled = false;
  if (shareBtn) shareBtn.disabled = state.steps === 0 && state.totalDistanceKm === 0;
  updateRouteButtons();
}

function updateVoiceButton() {
  if (!toggleVoiceBtn) return;
  toggleVoiceBtn.textContent = state.voiceEnabled ? '🔊 Voix' : '🔇 Voix';
  toggleVoiceBtn.title = state.voiceEnabled ? 'Désactiver la voix' : 'Activer la voix';
}

function toggleVoice() {
  state.voiceEnabled = !state.voiceEnabled;
  updateVoiceButton();
  if (!state.voiceEnabled) {
    window.speechSynthesis.cancel();
    toast("🔇 Voix désactivée");
  } else {
    toast("🔊 Voix activée");
    if (state.tracking) speak("Voix activée.");
  }
}

// --- Agrandissement de la carte ---
function toggleMapSize() {
  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;

  if (!isMapExpanded) {
    const expandedContainer = document.createElement('div');
    expandedContainer.id = 'map-expanded';
    expandedContainer.style.position = 'fixed';
    expandedContainer.style.top = '0';
    expandedContainer.style.left = '0';
    expandedContainer.style.width = '100vw';
    expandedContainer.style.height = '100vh';
    expandedContainer.style.zIndex = '9999';
    expandedContainer.style.background = 'var(--bg-soft)';
    expandedContainer.style.animation = 'zoomIn 0.3s ease';
    expandedContainer.style.padding = '0';
    expandedContainer.style.margin = '0';
    expandedContainer.style.border = 'none';
    expandedContainer.style.borderRadius = '0';
    
    const parent = mapContainer.parentNode;
    parent.removeChild(mapContainer);
    expandedContainer.appendChild(mapContainer);
    document.body.appendChild(expandedContainer);
    
    const closeBtn = document.createElement('button');
    closeBtn.id = 'closeExpandedMapBtn';
    closeBtn.innerHTML = '✕';
    closeBtn.style.position = 'fixed';
    closeBtn.style.top = '16px';
    closeBtn.style.right = '16px';
    closeBtn.style.zIndex = '10001';
    closeBtn.style.background = 'rgba(0,0,0,0.6)';
    closeBtn.style.color = 'white';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '50%';
    closeBtn.style.width = '40px';
    closeBtn.style.height = '40px';
    closeBtn.style.fontSize = '1.4rem';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.backdropFilter = 'blur(4px)';
    closeBtn.addEventListener('click', toggleMapSize);
    document.body.appendChild(closeBtn);
    
    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
    
    isMapExpanded = true;
    if (toggleMapBtn) {
      toggleMapBtn.textContent = '⛶';
      toggleMapBtn.title = 'Réduire la carte';
    }
  } else {
    const expandedContainer = document.getElementById('map-expanded');
    const mapElement = document.getElementById('map');
    const originalWrap = document.querySelector('.activity-map-wrap');
    
    if (expandedContainer && mapElement && originalWrap) {
      expandedContainer.removeChild(mapElement);
      originalWrap.insertBefore(mapElement, originalWrap.querySelector('.map-controls'));
    }
    
    if (expandedContainer) {
      expandedContainer.remove();
    }
    
    const closeBtn = document.getElementById('closeExpandedMapBtn');
    if (closeBtn) closeBtn.remove();
    
    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
    
    isMapExpanded = false;
    if (toggleMapBtn) {
      toggleMapBtn.textContent = '⛶';
      toggleMapBtn.title = 'Agrandir la carte';
    }
  }
}

// --- Dessin du tracé ---
function drawPath() {
  if (polyline) { polyline.remove(); polyline = null; }
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
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
        if (marker) marker.setLatLng(loc);
        else marker = L.marker(loc, { icon: getCurrentIcon() }).addTo(map);
        toast("Centré.");
      },
      () => toast("Position impossible."),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    toast("Géolocalisation non supportée.");
  }
}

function fitPath() {
  if (!map || state.path.length < 2) {
    toast("Pas assez de points.");
    return;
  }
  const latlngs = state.path.map(p => [p.lat, p.lng]);
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [30, 30] });
  toast("Vue ajustée.");
}

// --- Importer GPX ---
function importGPX() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx,.xml';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');
      const trkpts = xmlDoc.getElementsByTagName('trkpt');
      if (trkpts.length === 0) {
        toast("❌ Aucun point GPX trouvé.");
        return;
      }
      const newPath = [];
      for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute('lat'));
        const lng = parseFloat(trkpts[i].getAttribute('lon'));
        if (!isNaN(lat) && !isNaN(lng)) newPath.push({ lat, lng });
      }
      if (newPath.length < 2) {
        toast("❌ Pas assez de points valides.");
        return;
      }
      state.path = newPath;
      state.totalDistanceKm = 0;
      state.steps = 0;
      state.calories = 0;
      for (let i = 1; i < state.path.length; i++) {
        state.totalDistanceKm += distanceBetween(
          state.path[i-1].lat, state.path[i-1].lng,
          state.path[i].lat, state.path[i].lng
        ) / 1000;
      }
      state.steps = state.totalDistanceKm / STEP_LENGTH_M;
      drawPath();
      updateStats();
      toast(`✅ GPX importé : ${state.path.length} points, ${state.totalDistanceKm.toFixed(2)} km`);
      const latlngs = state.path.map(p => [p.lat, p.lng]);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    } catch (error) {
      toast("❌ Erreur GPX : " + error.message);
    }
  };
  input.click();
}

// --- Réinitialisation ---
export function resetSession() {
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (speechInterval) clearInterval(speechInterval);
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
  if (map) map.setView([48.8566, 2.3522], 15);
  updateStats();
  durationEl.textContent = "00:00";
  updateButtons();
  toast("Session réinitialisée.");
}

function resetSessionInternal() {
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (speechInterval) clearInterval(speechInterval);
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

// --- Suivi GPS avec filtrage ---
function startTracking() {
  if (state.tracking) return;
  if (!navigator.geolocation) {
    toast("Géolocalisation non supportée.");
    return;
  }
  if (!map) {
    toast("Carte pas encore prête.");
    return;
  }
  if (state.isDrawingRoute) {
    toast("Terminez ou effacez l'itinéraire d'abord.");
    return;
  }

  const prefs = getPrefs();
  const weight = prefs.weight || 70;
  displayWeight.textContent = weight;

  resetSessionInternal();
  state.startTime = Date.now();
  state.tracking = true;
  updateButtons();

  startSpeechUpdates();
  state.timerInterval = setInterval(updateDuration, 1000);

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const accuracy = pos.coords.accuracy;
      if (accuracy > 20) {
        console.warn("Précision insuffisante :", accuracy, "m");
        return;
      }
      const raw = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const smoothed = applySmoothing(raw.lat, raw.lng);
      const loc = smoothed;

      if (state.lastPosition) {
        const distMeters = distanceBetween(
          state.lastPosition.lat, state.lastPosition.lng,
          loc.lat, loc.lng
        );
        if (distMeters < 2) return;
        state.totalDistanceKm += distMeters / 1000;
        state.steps += distMeters / STEP_LENGTH_M;
        const type = activityType.value;
        const met = MET[type] || MET.walk;
        const hours = (Date.now() - state.startTime) / 3600000;
        state.calories = calculateCalories(met, weight, hours);
        state.path.push(loc);
        drawPath();
        updateStats();
        updateButtons();

        if (state.goalDistance > 0 && state.totalDistanceKm >= state.goalDistance) {
          toast(`🎉 Objectif atteint !`);
          speak("Objectif atteint !");
        }
        if (state.routePoints.length > 1 && state.routeDistance > 0) {
          if (state.totalDistanceKm > state.routeDistance * 1.05) {
            toast("🏁 Dépassement d'itinéraire !");
            speak("Dépassement d'itinéraire.");
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
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
  );

  toast("Suivi démarré !");
}

function stopTracking() {
  if (!state.tracking) return;
  state.tracking = false;
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (speechInterval) clearInterval(speechInterval);
  updateButtons();
  toast("Suivi arrêté.");
  if (state.path.length >= 2) saveBtn.disabled = false;
  updateStatusMessage();
}

// --- Sauvegarde ---
async function saveActivity() {
  if (state.tracking) {
    toast("Arrêtez d'abord le suivi.");
    return;
  }
  if (state.path.length < 2) {
    toast("Aucun parcours.");
    return;
  }
  if (!state.startTime) {
    toast("Session non valide.");
    return;
  }
  const durationSec = (Date.now() - state.startTime) / 1000;
  if (durationSec < 5) {
    toast("Session trop courte.");
    return;
  }
  if (state.totalDistanceKm <= 0) {
    toast("Distance nulle.");
    return;
  }
  const activity = {
    id: uid("activity"),
    date: new Date().toISOString(),
    type: activityType.value || "walk",
    steps: Math.round(state.steps),
    distance: parseFloat(state.totalDistanceKm.toFixed(3)),
    calories: Math.round(state.calories),
    duration: Math.round(durationSec),
    path: state.path.map(p => ({ lat: p.lat, lng: p.lng })),
    goal: state.goalDistance > 0 ? state.goalDistance : null,
    route: state.routePoints.length > 1 ? state.routePoints : null,
  };
  try {
    await putItem("activities", activity);
    toast("✅ Activité sauvegardée !");
    resetSessionInternal();
    updateButtons();
    await loadHistory();
    await renderStepsChart();
  } catch (e) {
    toast("❌ Erreur : " + e.message);
  }
}

// --- Partage ---
async function shareActivity() {
  if (state.steps === 0 && state.totalDistanceKm === 0) {
    toast("Aucune activité.");
    return;
  }
  let text = `🏃 ${Math.round(state.steps)} pas (${state.totalDistanceKm.toFixed(2)} km)`;
  if (state.calories > 0) text += ` 🔥 ${Math.round(state.calories)} kcal`;
  text += ` #Wistoria`;
  if (state.goalDistance > 0) text += ` 🎯 Objectif : ${state.goalDistance} km`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Mon activité", text });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast("📋 Copié !");
    } else {
      const win = window.open('', '_blank', 'width=400,height=200');
      if (win) {
        win.document.write(`
          <html><body style="font-family:sans-serif;padding:20px;text-align:center;">
            <h3>📤 Partager</h3>
            <p style="background:#f0f0f0;padding:15px;border-radius:8px;word-break:break-all;">${text}</p>
            <button onclick="window.close()" style="padding:8px 20px;border:none;background:#16c7b7;color:white;border-radius:4px;cursor:pointer;">Fermer</button>
          </body></html>
        `);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast("❌ Erreur de partage.");
  }
}

// --- Graphique ---
async function renderStepsChart() {
  if (!stepsChartCanvas) return;
  if (typeof Chart === 'undefined') {
    stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">📊 Chart.js non chargé</div>`;
    return;
  }
  try {
    const activities = await getAll("activities");
    if (!activities || activities.length === 0) {
      stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">Pas encore de données.</div>`;
      return;
    }
    const last30 = activities.slice(-30);
    const labels = last30.map(a => new Date(a.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
    const data = last30.map(a => a.steps || 0);
    if (stepsChartInstance) stepsChartInstance.destroy();
    stepsChartInstance = new Chart(stepsChartCanvas, {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["Aucune"],
        datasets: [{
          label: "Pas",
          data: data.length ? data : [0],
          backgroundColor: "rgba(22,199,183,0.7)",
          borderRadius: 4,
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  } catch (e) {
    stepsChartCanvas.parentNode.innerHTML = `<div class="empty-state">Erreur graphique</div>`;
  }
}

// --- Historique ---
async function loadHistory() {
  try {
    const activities = await getAll("activities");
    if (!activities || activities.length === 0) {
      historyList.innerHTML = `<div class="empty-state">Aucune activité.</div>`;
      return;
    }
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));
    historyList.innerHTML = activities.slice(0, 15).map(act => {
      const date = new Date(act.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
      const time = new Date(act.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const dur = Math.floor(act.duration / 60) + "min";
      const typeEmoji = act.type === "run" ? "🏃" : act.type === "bike" ? "🚴" : "🚶";
      const goalText = act.goal ? `🎯 ${act.goal} km` : '♾️ Illimité';
      return `
        <div class="history-item">
          <div class="info">
            <strong>${typeEmoji} ${date} à ${time}</strong>
            <span>${act.steps} pas · ${act.distance.toFixed(2)} km · ${act.calories} kcal · ${dur} ${goalText}</span>
          </div>
          <span class="badge">${act.type || "marche"}</span>
        </div>
      `;
    }).join("");
  } catch (e) {
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
  toast("Rechargement de la carte...");
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
  weatherLocation.textContent = "Recherche...";
  weatherEmoji.textContent = "⏳";
  weatherTemp.textContent = "--°C";
  weatherDesc.textContent = "Chargement...";
  weatherHumidity.textContent = "--%";
  weatherWind.textContent = "-- km/h";
  weatherUV.textContent = "--";

  let lat = 48.8566, lon = 2.3522;
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 });
      });
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch (e) {
      toast("Position non trouvée, fallback Paris.");
    }
  }
  try {
    const url = `https://wttr.in/${lat},${lon}?format=j1&lang=fr`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.current_condition[0];
    const nearest = data.nearest_area?.[0] || {};
    const areaName = nearest.areaName?.[0]?.value || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    const temp = current.temp_C || "--";
    const desc = current.weatherDesc?.[0]?.value || "Inconnu";
    const humidity = current.humidity || "--";
    let wind = current.windSpeed || "--";
    if (wind === "N/A" || wind === "--") wind = "🍃 Calme";
    else wind = `💨 ${wind} km/h`;
    let uv = current.uvIndex || "--";
    if (uv === "0" || uv === 0) uv = "🌙 N/A (nuit)";
    let emoji = "🌤️";
    const d = desc.toLowerCase();
    if (d.includes("pluie")) emoji = "🌧️";
    else if (d.includes("neige")) emoji = "❄️";
    else if (d.includes("orage")) emoji = "⛈️";
    else if (d.includes("brouillard")) emoji = "🌫️";
    else if (d.includes("soleil") || d.includes("ensoleillé")) emoji = "☀️";
    else if (d.includes("nuage")) emoji = "☁️";
    weatherLocation.textContent = `📍 ${areaName}`;
    weatherEmoji.textContent = emoji;
    weatherTemp.textContent = `${temp}°C`;
    weatherDesc.textContent = desc;
    weatherHumidity.textContent = `${humidity}%`;
    weatherWind.textContent = wind;
    weatherUV.textContent = uv;
    toast("Météo chargée !");
  } catch (error) {
    toast("Erreur météo.");
  }
}

function closeWeather() { weatherModal.style.display = "none"; }

// --- Initialisation ---
export function initActivityPage() {
  console.log("📌 initActivityPage() appelée");

  const prefs = getPrefs();
  displayWeight.textContent = prefs.weight || 70;

  // Attacher les événements
  if (startBtn) startBtn.addEventListener("click", startTracking);
  if (stopBtn) stopBtn.addEventListener("click", stopTracking);
  if (saveBtn) saveBtn.addEventListener("click", saveActivity);
  if (shareBtn) shareBtn.addEventListener("click", shareActivity);
  if (resetBtn) resetBtn.addEventListener("click", resetSession);
  if (weatherBtn) weatherBtn.addEventListener("click", fetchWeather);
  if (closeWeatherBtn) closeWeatherBtn.addEventListener("click", closeWeather);
  if (weatherModal) {
    weatherModal.addEventListener("click", (e) => {
      if (e.target === weatherModal) closeWeather();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && weatherModal && weatherModal.style.display === "grid") {
      closeWeather();
    }
  });

  if (retryMapBtn) retryMapBtn.addEventListener("click", retryMap);
  if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener("click", () => { loadHistory(); renderStepsChart(); });
  }

  if (centerMapBtn) centerMapBtn.addEventListener("click", centerOnUser);
  if (fitPathBtn) fitPathBtn.addEventListener("click", fitPath);

  if (startRouteBtn) startRouteBtn.addEventListener("click", startRouteDrawing);
  if (cancelLastPointBtn) cancelLastPointBtn.addEventListener("click", cancelLastPoint);
  if (finishRouteBtn) finishRouteBtn.addEventListener("click", finishRoute);
  if (clearRouteBtn) clearRouteBtn.addEventListener("click", clearRoute);

  if (toggleVoiceBtn) {
    toggleVoiceBtn.addEventListener("click", toggleVoice);
    updateVoiceButton();
  }
  if (importGpxBtn) {
    importGpxBtn.addEventListener("click", importGPX);
  }
  if (toggleMapBtn) {
    toggleMapBtn.addEventListener("click", toggleMapSize);
    toggleMapBtn.textContent = '⛶';
    toggleMapBtn.title = 'Agrandir la carte';
  }

  if (goalDistanceInput) {
    goalDistanceInput.addEventListener("input", () => {
      const val = parseFloat(goalDistanceInput.value) || 0;
      state.goalDistance = val;
      updateGoalDisplay();
    });
  }

  // ===== Gestion des dropdowns (toggle) =====
  document.querySelectorAll('[data-dropdown]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const dropdownId = this.dataset.dropdown;
      const dropdown = document.getElementById(dropdownId);
      if (!dropdown) return;
      // Fermer tous les autres dropdowns
      document.querySelectorAll('.dropdown.open').forEach(d => {
        if (d !== dropdown) d.classList.remove('open');
      });
      // Toggle celui-ci
      dropdown.classList.toggle('open');
    });
  });

  // Fermer les dropdowns si on clique ailleurs
  document.addEventListener('click', function() {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  });

  try { loadHistory(); } catch (e) {}
  try { renderStepsChart(); } catch (e) {}

  if (typeof L !== "undefined") {
    console.log("✅ Leaflet disponible, initMap()");
    initMap();
  } else {
    console.warn("⚠️ Leaflet non disponible, chargement dynamique...");
    if (mapPlaceholder) mapPlaceholder.style.display = "grid";
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      console.log("✅ Leaflet chargé dynamiquement, initMap()");
      initMap();
    };
    script.onerror = () => {
      console.error("❌ Échec du chargement de Leaflet");
      toast("Impossible de charger la carte.");
    };
    document.head.appendChild(script);
  }

  updateButtons();
  updateGoalDisplay();
  updateStatusMessage();
  updateRouteButtons();

  window.addEventListener("beforeunload", () => {
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (speechInterval) clearInterval(speechInterval);
  });

  console.log("✅ initActivityPage() terminée");
}

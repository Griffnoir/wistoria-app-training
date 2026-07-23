// js/activity.js - Version finale avec corrections de la carte, assistance vocale et objectif automatique

import { getAll, getPrefs, putItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

// --- Constantes ---
const MET = { walk: 3.5, run: 8.0, bike: 5.5 };
const STEP_LENGTH_M = 0.78;
const SPEECH_INTERVAL = 30000; // 30 secondes

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
  // Itinéraire
  routePoints: [],
  routePolyline: null,
  routeMarkers: [],
  isDrawingRoute: false,
  routeDistance: 0,
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
  if (!('speechSynthesis' in window)) return;
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
    let message = `Distance parcourue : ${state.totalDistanceKm.toFixed(1)} kilomètres.`;
    if (state.routePoints.length > 1 && state.routeDistance > 0) {
      const remaining = Math.max(0, state.routeDistance - state.totalDistanceKm);
      message += ` Il vous reste ${remaining.toFixed(1)} kilomètres à parcourir.`;
      const progress = (state.totalDistanceKm / state.routeDistance) * 100;
      if (progress >= 100) {
        message += " Objectif atteint !";
      }
    }
    if (state.goalDistance > 0) {
      const goalRemaining = Math.max(0, state.goalDistance - state.totalDistanceKm);
      if (goalRemaining > 0) {
        message += ` Objectif personnel : ${goalRemaining.toFixed(1)} kilomètres restants.`;
      } else {
        message += " Objectif personnel atteint !";
      }
    }
    speak(message);
  }, SPEECH_INTERVAL);
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

// --- Création d'un marqueur numéroté pour l'itinéraire ---
function createRouteMarker(index) {
  return L.divIcon({
    className: 'route-marker-number',
    html: `${index + 1}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// --- Initialisation de la carte (avec logs de debug) ---
function initMap() {
  console.log("🚀 initMap() appelée");
  if (map) {
    console.log("⚠️ Carte déjà initialisée");
    return;
  }
  // Vérifier que le conteneur existe
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

    // Gestion des clics pour l'itinéraire
    map.on('click', (e) => {
      if (state.isDrawingRoute) {
        addRoutePoint(e.latlng.lat, e.latlng.lng);
      }
    });

    // Géolocalisation
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

    // Charger les données
    loadHistory();
    renderStepsChart();
    updateButtons();
    updateGoalDisplay();
    updateRouteButtons();

    console.log("✅ initMap() terminée avec succès");
  } catch (error) {
    console.error("❌ ERREUR dans initMap() :", error);
    toast("Erreur d'initialisation de la carte : " + error.message);
  }
}

// --- Gestion de l'itinéraire ---
function startRouteDrawing() {
  if (state.tracking) {
    toast("Arrêtez d'abord le suivi pour tracer un itinéraire.");
    return;
  }
  clearRoute();
  state.isDrawingRoute = true;
  state.routePoints = [];
  startRouteBtn.textContent = "✏️ Cliquez sur la carte";
  startRouteBtn.disabled = true;
  cancelLastPointBtn.disabled = false;
  finishRouteBtn.disabled = false;
  toast("Cliquez sur la carte pour ajouter des points.");
  updateStatusMessage();
  updateRouteButtons();
}

function addRoutePoint(lat, lng) {
  if (!state.isDrawingRoute) return;
  state.routePoints.push({ lat, lng });
  const marker = L.marker([lat, lng], {
    icon: createRouteMarker(state.routePoints.length - 1),
  }).addTo(map);
  state.routeMarkers.push(marker);
  updateRouteLine();
  calculateRouteDistance();
  toast(`Point ${state.routePoints.length} ajouté (${state.routeDistance.toFixed(2)} km)`);
  updateRouteButtons();
}

function cancelLastPoint() {
  if (state.routePoints.length === 0) return;
  const lastMarker = state.routeMarkers.pop();
  if (lastMarker) map.removeLayer(lastMarker);
  state.routePoints.pop();
  updateRouteLine();
  calculateRouteDistance();
  if (state.routePoints.length === 0) {
    cancelLastPointBtn.disabled = true;
  }
  toast(`Dernier point supprimé. Reste ${state.routePoints.length} points.`);
  updateRouteButtons();
}

function finishRoute() {
  if (state.routePoints.length < 2) {
    toast("Il faut au moins 2 points pour un itinéraire.");
    return;
  }
  state.isDrawingRoute = false;
  startRouteBtn.textContent = "✏️ Tracer itinéraire";
  startRouteBtn.disabled = false;
  cancelLastPointBtn.disabled = true;
  finishRouteBtn.disabled = true;
  calculateRouteDistance();

  // Définir automatiquement l'objectif de distance
  if (state.routeDistance > 0) {
    const currentGoal = parseFloat(goalDistanceInput?.value) || 0;
    if (currentGoal === 0 || currentGoal === 5) {
      const newGoal = Math.ceil(state.routeDistance / 0.5) * 0.5;
      if (goalDistanceInput) {
        goalDistanceInput.value = newGoal;
        state.goalDistance = newGoal;
        updateGoalDisplay();
      }
      toast(`🎯 Objectif automatique : ${newGoal.toFixed(1)} km (basé sur l'itinéraire)`);
    } else {
      toast(`✅ Itinéraire terminé : ${state.routeDistance.toFixed(2)} km (objectif déjà défini)`);
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
    statusMsg.innerHTML = '✏️ Mode tracé - Cliquez sur la carte pour ajouter des points';
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

// --- Dessin du tracé effectué ---
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
  if (speechInterval) {
    clearInterval(speechInterval);
    speechInterval = null;
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
  if (speechInterval) {
    clearInterval(speechInterval);
    speechInterval = null;
  }
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
    toast("La géolocalisation n'est pas supportée.");
    return;
  }
  if (!map) {
    toast("La carte n'est pas encore prête. Veuillez réessayer.");
    return;
  }

  if (state.isDrawingRoute) {
    toast("Vous ne pouvez pas démarrer le suivi en mode tracé. Terminez ou effacez l'itinéraire.");
    return;
  }

  const prefs = getPrefs();
  const weight = prefs.weight || 70;
  displayWeight.textContent = weight;

  resetSessionInternal();
  state.startTime = Date.now();
  state.tracking = true;
  updateButtons();

  // Démarrer l'assistance vocale
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
          toast(`🎉 Objectif de ${state.goalDistance} km atteint !`);
          speak("Objectif atteint ! Félicitations !");
        }
        if (state.routePoints.length > 1 && state.routeDistance > 0) {
          const progress = (state.totalDistanceKm / state.routeDistance) * 100;
          if (progress > 100) {
            toast("🏁 Vous avez dépassé l'itinéraire !");
            speak("Vous avez dépassé l'itinéraire.");
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
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  if (speechInterval) {
    clearInterval(speechInterval);
    speechInterval = null;
  }
  updateButtons();
  toast("Suivi arrêté.");
  if (state.path.length >= 2) {
    saveBtn.disabled = false;
  }
  updateStatusMessage();
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
    distance: parseFloat(state.totalDistanceKm.toFixed(3)),
    calories: Math.round(state.calories),
    duration: Math.round(durationSec),
    path: state.path.map(p => ({ lat: p.lat, lng: p.lng })),
    goal: state.goalDistance > 0 ? state.goalDistance : null,
    route: state.routePoints.length > 1 ? state.routePoints : null,
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

// --- PARTAGE ---
async function shareActivity() {
  if (state.steps === 0 && state.totalDistanceKm === 0) {
    toast("Aucune activité à partager.");
    return;
  }

  const stepsText = state.steps > 0 ? `${Math.round(state.steps)} pas` : "0 pas";
  const distanceText = state.totalDistanceKm.toFixed(2);
  const caloriesText = state.calories > 0 ? `🔥 ${Math.round(state.calories)} kcal` : "";
  
  let text = `🏃 ${stepsText}`;
  text += ` (${distanceText} km)`;
  if (caloriesText) text += ` ${caloriesText}`;
  text += ` ! #Wistoria #Fitness`;

  if (state.startTime) {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    if (mins > 0 || secs > 0) {
      text += ` ⏱️ ${mins}min${secs > 0 ? ` ${secs}s` : ''}`;
    }
  }

  if (state.goalDistance > 0) {
    text += ` 🎯 Objectif : ${state.goalDistance} km`;
  }

  console.log("📤 Message de partage :", text);

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Mon activité Wistoria",
        text: text,
      });
      toast("✅ Partagé !");
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast("📋 Texte copié dans le presse-papiers !");
    } else {
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
    
    let windSpeed = current.windSpeed || "--";
    let windDirText = current.winddir16Point || "";
    
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

    let uv = current.uvIndex || "--";
    if (uv === "0" || uv === 0 || uv === "0.0") {
      uv = "🌙 N/A (nuit)";
    } else if (uv === "N/A" || uv === "--" || uv === "") {
      uv = "N/A";
    } else {
      const uvNum = parseFloat(uv);
      if (uvNum <= 2) uv = `🟢 ${uv} (faible)`;
      else if (uvNum <= 5) uv = `🟡 ${uv} (modéré)`;
      else if (uvNum <= 7) uv = `🟠 ${uv} (élevé)`;
      else if (uvNum <= 10) uv = `🔴 ${uv} (très élevé)`;
      else uv = `🟣 ${uv} (extrême)`;
    }

    let emoji = "🌤️";
    const lowerDesc = desc.toLowerCase();
    if (lowerDesc.includes("pluie") || lowerDesc.includes("averse")) emoji = "🌧️";
    else if (lowerDesc.includes("neige")) emoji = "❄️";
    else if (lowerDesc.includes("orage") || lowerDesc.includes("tonnerre")) emoji = "⛈️";
    else if (lowerDesc.includes("brouillard") || lowerDesc.includes("brume")) emoji = "🌫️";
    else if (lowerDesc.includes("soleil") || lowerDesc.includes("ensoleillé") || lowerDesc.includes("clair")) emoji = "☀️";
    else if (lowerDesc.includes("nuage")) emoji = "☁️";

    weatherLocation.textContent = `📍 ${areaName}`;
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
  console.log("📌 initActivityPage() appelée");

  const prefs = getPrefs();
  displayWeight.textContent = prefs.weight || 70;

  // Événements
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

  if (goalDistanceInput) {
    goalDistanceInput.addEventListener("input", () => {
      const val = parseFloat(goalDistanceInput.value) || 0;
      state.goalDistance = val;
      updateGoalDisplay();
    });
  }

  try {
    loadHistory();
  } catch (e) { console.warn(e); }
  try {
    renderStepsChart();
  } catch (e) { console.warn(e); }

  // Initialisation de la carte
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
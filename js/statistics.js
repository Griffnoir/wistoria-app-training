import { calculateProgram, getAll } from "./storage.js";
import { getAll } from "./storage.js";

let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach((chart) => chart.destroy?.());
  chartInstances = [];
}

export function computeActivityStats(activities) {
  if (!activities || activities.length === 0) {
    return {
      totalSessions: 0,
      totalSteps: 0,
      totalDistance: 0,
      totalCalories: 0,
      totalDuration: 0,
      avgDistance: 0,
    };
  }
  const totalSessions = activities.length;
  const totalSteps = activities.reduce((sum, a) => sum + (a.steps || 0), 0);
  const totalDistance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);
  const totalCalories = activities.reduce((sum, a) => sum + (a.calories || 0), 0);
  const totalDuration = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  const avgDistance = totalDistance / totalSessions;
  return { totalSessions, totalSteps, totalDistance, totalCalories, totalDuration, avgDistance };
}

export function dailyActivityData(activities) {
  // Regrouper par jour (date sans heure)
  const map = new Map();
  activities.forEach(a => {
    const date = a.date.slice(0,10); // YYYY-MM-DD
    const existing = map.get(date) || { distance: 0, steps: 0, calories: 0 };
    existing.distance += a.distance || 0;
    existing.steps += a.steps || 0;
    existing.calories += a.calories || 0;
    map.set(date, existing);
  });
  // Trier par date
  const sorted = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([date]) => date);
  const distances = sorted.map(([, data]) => data.distance);
  const steps = sorted.map(([, data]) => data.steps);
  const calories = sorted.map(([, data]) => data.calories);
  return { labels, distances, steps, calories };
}

// Modifier renderStatisticsPage pour inclure l'activité
export async function renderStatisticsPage() {
  destroyCharts();
  const [programs, history, activities] = await Promise.all([
    getAll("programs"),
    getAll("history"),
    getAll("activities")
  ]);

  // 1. Statistiques d'entraînement (existantes)
  const stats = computeStats(programs, history);
  const metrics = document.getElementById("statsMetrics");
  if (metrics) {
    metrics.innerHTML = `
      <div class="metric panel"><span class="label">Séances</span><strong>${stats.totalSessions}</strong><small>réalisées</small></div>
      <div class="metric panel"><span class="label">Temps total</span><strong>${formatDuration(stats.totalSeconds)}</strong><small>enregistré</small></div>
      <div class="metric panel"><span class="label">XP</span><strong>${stats.xp}</strong><small>niveau ${stats.level}</small></div>
      <div class="metric panel"><span class="label">Programmes</span><strong>${stats.programCount}</strong><small>créés</small></div>`;
  }

  // 2. Statistiques d'activité physique (nouvelles)
  const activityStats = computeActivityStats(activities);
  const activityMetrics = document.getElementById("activityMetrics");
  if (activityMetrics) {
    const totalHours = Math.floor(activityStats.totalDuration / 3600);
    const totalMins = Math.round((activityStats.totalDuration % 3600) / 60);
    const durationStr = totalHours > 0 ? `${totalHours}h ${totalMins}min` : `${totalMins} min`;
    activityMetrics.innerHTML = `
      <div class="metric panel"><span class="label">Sessions act.</span><strong>${activityStats.totalSessions}</strong><small>enregistrées</small></div>
      <div class="metric panel"><span class="label">Pas</span><strong>${activityStats.totalSteps.toLocaleString()}</strong><small>total</small></div>
      <div class="metric panel"><span class="label">Distance</span><strong>${activityStats.totalDistance.toFixed(1)} km</strong><small>${activityStats.avgDistance.toFixed(1)} km/session</small></div>
      <div class="metric panel"><span class="label">Calories</span><strong>${activityStats.totalCalories.toLocaleString()}</strong><small>brûlées</small></div>
    `;
  }

  // 3. Graphiques d'entraînement (existants)
  const frequency = frequencyByDay(history);
  makeChart(document.getElementById("frequencyChart"), {
    type: "line",
    data: {
      labels: frequency.labels,
      datasets: [{
        label: "Séances",
        data: frequency.values,
        borderColor: "#7c5cff",
        backgroundColor: "rgba(124, 92, 255, 0.16)",
        fill: true,
        tension: 0.35
      }]
    },
    options: chartOptions()
  });

  const muscles = muscleDistribution(programs);
  makeChart(document.getElementById("muscleChart"), {
    type: "doughnut",
    data: {
      labels: muscles.labels,
      datasets: [{
        data: muscles.values,
        backgroundColor: ["#16c7b7", "#7c5cff", "#ffb35c", "#ff5f7e", "#62d36f", "#4aa3ff", "#f7f8ff"]
      }]
    },
    options: chartOptions(false)
  });

  // 4. Graphique d'activité physique (nouveau)
  const activityData = dailyActivityData(activities);
  const activityCanvas = document.getElementById("activityChart");
  if (activityCanvas && activityData.labels.length > 0) {
    makeChart(activityCanvas, {
      type: "bar",
      data: {
        labels: activityData.labels.map(d => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })),
        datasets: [
          {
            label: "Distance (km)",
            data: activityData.distances,
            backgroundColor: "rgba(22, 199, 183, 0.7)",
            borderRadius: 4,
            yAxisID: "y",
          },
          {
            label: "Pas (×1000)",
            data: activityData.steps.map(s => s / 1000),
            backgroundColor: "rgba(124, 92, 255, 0.7)",
            borderRadius: 4,
            yAxisID: "y1",
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--muted") || "#9aa6bd" } }
        },
        scales: {
          x: { ticks: { color: "#9aa6bd" }, grid: { color: "rgba(255,255,255,.06)" } },
          y: { type: "linear", position: "left", ticks: { color: "#9aa6bd" }, grid: { color: "rgba(255,255,255,.06)" }, title: { display: true, text: "km", color: "#9aa6bd" } },
          y1: { type: "linear", position: "right", ticks: { color: "#9aa6bd" }, grid: { draw: false }, title: { display: true, text: "pas (×1000)", color: "#9aa6bd" } }
        }
      }
    });
  } else if (activityCanvas) {
    // Si pas de données, afficher un message
    const parent = activityCanvas.parentNode;
    parent.innerHTML = `<div class="empty-state">Aucune activité enregistrée pour le moment.</div>`;
  }

  // 5. Historique d'entraînement (existant)
  const historyList = document.getElementById("historyList");
  if (historyList) {
    historyList.innerHTML = history.length
      ? history.slice().reverse().map((item) => `
        <div class="plan-item">
          <strong>${item.programName}</strong>
          <p>${new Date(item.date).toLocaleString("fr-FR")} · ${formatDuration(item.duration)} · ${item.xp} XP</p>
        </div>`).join("")
      : `<div class="empty-state">L'historique apparaîtra après ta première séance terminée.</div>`;
  }
}

// Il faut aussi adapter chartOptions pour qu'elle fonctionne avec les graphiques à double axe
// On laisse la fonction existante, elle est utilisée pour les autres.

export function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${value}s`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes} min`;
}

export function computeStats(programs, history) {
  const totalSessions = history.length;
  const totalSeconds = history.reduce((sum, item) => sum + Number(item.duration || 0), 0);
  const xp = history.reduce((sum, item) => sum + Number(item.xp || 0), 0);
  const level = Math.max(1, Math.floor(xp / 500) + 1);
  const nextLevelXp = level * 500;
  const levelProgress = nextLevelXp ? ((xp % 500) / 500) * 100 : 0;
  const exercises = programs.flatMap((program) => program.exercises || []);
  const categories = exercises.reduce((map, exercise) => {
    map[exercise.category] = (map[exercise.category] || 0) + 1;
    return map;
  }, {});

  return {
    totalSessions,
    totalSeconds,
    xp,
    level,
    levelProgress,
    programCount: programs.length,
    exerciseCount: exercises.length,
    categories
  };
}

export function getBadges(stats, history) {
  const badges = [];
  if (stats.totalSessions >= 1) badges.push("Première séance");
  if (stats.totalSessions >= 7) badges.push("7 séances régulières");
  if (stats.totalSeconds >= 3600) badges.push("1h de souplesse");
  if (history.some((item) => item.focus?.includes("Adducteurs"))) badges.push("Grand écart en progression");
  if (!badges.length) badges.push("Crée ta première séance");
  return badges;
}

function weekKey(date) {
  const d = new Date(date);
  const first = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - first) / 86400000);
  return `S${Math.ceil((days + first.getDay() + 1) / 7)}`;
}

export function weeklyMinutes(history) {
  const buckets = {};
  history.forEach((item) => {
    const key = weekKey(item.date);
    buckets[key] = (buckets[key] || 0) + Math.round(Number(item.duration || 0) / 60);
  });
  const entries = Object.entries(buckets).slice(-8);
  return entries.length ? entries : [["Semaine", 0]];
}

export function frequencyByDay(history) {
  const labels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const values = Array(7).fill(0);
  history.forEach((item) => {
    const day = new Date(item.date).getDay();
    const index = day === 0 ? 6 : day - 1;
    values[index] += 1;
  });
  return { labels, values };
}

export function muscleDistribution(programs) {
  const map = {};
  programs.forEach((program) => {
    (program.exercises || []).forEach((exercise) => {
      map[exercise.category] = (map[exercise.category] || 0) + Number(exercise.duration || 0) * Number(exercise.sets || 1);
    });
  });
  const labels = Object.keys(map);
  const values = labels.map((label) => Math.round(map[label] / 60));
  return { labels: labels.length ? labels : ["Aucune"], values: values.length ? values : [0] };
}

function makeChart(canvas, config) {
  if (!canvas || !window.Chart) return;
  chartInstances.push(new Chart(canvas, config));
}

export async function renderDashboardCharts() {
  destroyCharts();
  const [programs, history] = await Promise.all([getAll("programs"), getAll("history")]);
  const weekly = weeklyMinutes(history);
  makeChart(document.getElementById("weeklyChart"), {
    type: "bar",
    data: {
      labels: weekly.map(([label]) => label),
      datasets: [{
        label: "Minutes",
        data: weekly.map(([, value]) => value),
        backgroundColor: "rgba(22, 199, 183, 0.72)",
        borderRadius: 8
      }]
    },
    options: chartOptions()
  });

  const stats = computeStats(programs, history);
  const ring = document.getElementById("xpRing");
  if (ring) {
    ring.style.setProperty("--value", `${stats.levelProgress * 3.6}deg`);
    ring.innerHTML = `<div><strong>${stats.level}</strong><small>Niveau</small></div>`;
  }

  const badges = document.getElementById("badgeList");
  if (badges) badges.innerHTML = getBadges(stats, history).map((badge) => `<div class="badge">${badge}</div>`).join("");
}

export async function renderStatisticsPage() {
  destroyCharts();
  const [programs, history] = await Promise.all([getAll("programs"), getAll("history")]);
  const stats = computeStats(programs, history);
  const metrics = document.getElementById("statsMetrics");
  if (metrics) {
    metrics.innerHTML = `
      <div class="metric panel"><span class="label">Séances</span><strong>${stats.totalSessions}</strong><small>réalisées</small></div>
      <div class="metric panel"><span class="label">Temps total</span><strong>${formatDuration(stats.totalSeconds)}</strong><small>enregistré</small></div>
      <div class="metric panel"><span class="label">XP</span><strong>${stats.xp}</strong><small>niveau ${stats.level}</small></div>`;
  }

  const frequency = frequencyByDay(history);
  makeChart(document.getElementById("frequencyChart"), {
    type: "line",
    data: {
      labels: frequency.labels,
      datasets: [{
        label: "Séances",
        data: frequency.values,
        borderColor: "#7c5cff",
        backgroundColor: "rgba(124, 92, 255, 0.16)",
        fill: true,
        tension: 0.35
      }]
    },
    options: chartOptions()
  });

  const muscles = muscleDistribution(programs);
  makeChart(document.getElementById("muscleChart"), {
    type: "doughnut",
    data: {
      labels: muscles.labels,
      datasets: [{
        data: muscles.values,
        backgroundColor: ["#16c7b7", "#7c5cff", "#ffb35c", "#ff5f7e", "#62d36f", "#4aa3ff", "#f7f8ff"]
      }]
    },
    options: chartOptions(false)
  });

  const historyList = document.getElementById("historyList");
  if (historyList) {
    historyList.innerHTML = history.length
      ? history.slice().reverse().map((item) => `
        <div class="plan-item">
          <strong>${item.programName}</strong>
          <p>${new Date(item.date).toLocaleString("fr-FR")} · ${formatDuration(item.duration)} · ${item.xp} XP</p>
        </div>`).join("")
      : `<div class="empty-state">L'historique apparaîtra après ta première séance terminée.</div>`;
  }
}

export function chartOptions(showLegend = true) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: showLegend,
        labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--muted") || "#9aa6bd" }
      }
    },
    scales: showLegend ? {
      x: { ticks: { color: "#9aa6bd" }, grid: { color: "rgba(255,255,255,.06)" } },
      y: { ticks: { color: "#9aa6bd" }, grid: { color: "rgba(255,255,255,.06)" } }
    } : undefined
  };
}

export async function renderMetrics(targetId) {
  const [programs, history] = await Promise.all([getAll("programs"), getAll("history")]);
  const node = document.getElementById(targetId);
  if (!node) return;
  const stats = computeStats(programs, history);
  const totalPlanned = programs.reduce((sum, program) => sum + calculateProgram(program).totalSeconds, 0);
  node.innerHTML = `
    <div class="metric panel"><span class="label">Programmes</span><strong>${stats.programCount}</strong><small>personnalisés</small></div>
    <div class="metric panel"><span class="label">Exercices</span><strong>${stats.exerciseCount}</strong><small>dans tes routines</small></div>
    <div class="metric panel"><span class="label">Temps suivi</span><strong>${formatDuration(stats.totalSeconds)}</strong><small>historique</small></div>
    <div class="metric panel"><span class="label">Volume créé</span><strong>${formatDuration(totalPlanned)}</strong><small>programmé</small></div>`;
}

import { observeCards } from "./animation.js";
import { initCalendarPage, renderTodayPlans } from "./calendar.js";
import { initManualPage } from "./manual.js";
import { initMusicGlobal, initMusicPage } from "./music.js";
import { toast } from "./notifications.js";
import { speak } from "./sound.js";
import {
  calculateProgram,
  createProgramFromGoal,
  exportData,
  getAll,
  getPrefs,
  importData,
  savePrefs,
  setActiveProgram
} from "./storage.js";
import { renderDashboardCharts, renderMetrics, renderStatisticsPage } from "./statistics.js";
import { initSessionPage } from "./timer.js";
import { generateProgramFromPrompt, initWorkoutPage } from "./workout.js";

let currentPage = document.body.dataset.page;
let loaderTimer;
let deferredInstallPrompt = null;

const navItems = [
  ["index.html", "H", "Accueil", "home"],
  ["dashboard.html", "D", "Tableau de bord", "dashboard"],
  ["workout.html", "W", "Mes entrainements", "workout"],
  ["session.html", "T", "Session active", "session"],
  ["music.html", "M", "Musique", "music"],
  ["calendar.html", "C", "Calendrier", "calendar"],
  ["statistics.html", "S", "Statistiques", "statistics"],
  ["settings.html", "P", "Parametres", "settings"],
  // Nouvelle entrée
  ["activity.html", "A", "Activité", "activity"]
];

const pageExtras = ["exerciseDialog", "planDialog"];

function applyTheme() {
  document.documentElement.dataset.theme = getPrefs().theme;
}

function ensureLoader() {
  let loader = document.querySelector(".app-loader");
  if (loader) return loader;
  loader = document.createElement("div");
  loader.className = "app-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.innerHTML = `
    <section class="loader-card">
      <div class="loader-mark"><img src="assets/icons/icon.svg" alt=""></div>
      <h2>Wistoria Training</h2>
      <p data-loader-message>Preparation de ton espace d'entrainement.</p>
      <div class="loader-progress" aria-hidden="true"><span></span></div>
    </section>`;
  document.body.append(loader);
  return loader;
}

function showLoader(message = "Chargement de la section.") {
  const loader = ensureLoader();
  clearTimeout(loaderTimer);
  loader.querySelector("[data-loader-message]").textContent = message;
  loader.classList.remove("leaving");
  loader.classList.add("visible");
}

function hideLoader(minDelay = 360) {
  const loader = ensureLoader();
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => {
    loader.classList.add("leaving");
    loader.classList.remove("visible");
  }, minDelay);
}

function animateMain() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("page-enter");
  void main.offsetWidth;
  main.classList.add("page-enter");
}

function renderNavigation() {
  const sidebar = document.querySelector("[data-sidebar]");
  const bottom = document.querySelector("[data-bottom-nav]");
  const links = navItems.map(([href, icon, label, key]) => `
    <a class="nav-link ${currentPage === key ? "active" : ""}" href="${href}">
      <span class="nav-icon">${icon}</span>
      <span>${label}</span>
    </a>`).join("");

  if (sidebar) {
    sidebar.innerHTML = `
      <a class="brand" href="index.html">
        <img src="assets/icons/icon.svg" alt="">
        <span><strong>Wistoria</strong><span>Training App</span></span>
      </a>
      <nav class="nav-list">${links}</nav>
      <div class="sidebar-card">
        <p>Programmes libres, minuteurs, voix, suivi XP, musique et PWA hors ligne.</p>
        <button class="btn primary" data-quick-session>Session rapide</button>
      </div>`;
  }

  if (bottom) {
    bottom.innerHTML = navItems.slice(0, 5).map(([href, icon, label, key]) =>
      `<a class="${currentPage === key ? "active" : ""}" href="${href}" aria-label="${label}">${icon}</a>`
    ).join("");
  }
}

function canRoute(url) {
  return location.protocol !== "file:" && url.origin === location.origin && /\.html$/.test(url.pathname);
}

async function navigateTo(href, options = {}) {
  const url = new URL(href, location.href);
  if (!canRoute(url)) {
    location.href = url.href;
    return;
  }

  showLoader("Transition fluide vers la prochaine section.");
  const response = await fetch(url.href, { cache: "no-cache" });
  if (!response.ok) {
    hideLoader(0);
    location.href = url.href;
    return;
  }

  const html = await response.text();
  const nextDocument = new DOMParser().parseFromString(html, "text/html");
  const nextMain = nextDocument.querySelector(".main");
  if (!nextMain) {
    hideLoader(0);
    location.href = url.href;
    return;
  }

  const swapPage = async () => {
    document.querySelector(".main").innerHTML = nextMain.innerHTML;
    pageExtras.forEach((id) => document.getElementById(id)?.remove());
    pageExtras.forEach((id) => {
      const node = nextDocument.getElementById(id);
      if (node) document.body.append(node);
    });

    currentPage = nextDocument.body.dataset.page;
    document.body.dataset.page = currentPage;
    document.title = nextDocument.title;
    document.body.classList.remove("nav-open");
    renderNavigation();
  };

  if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await document.startViewTransition(swapPage).finished;
  } else {
    await swapPage();
  }

  if (!options.replace) history.pushState({ page: currentPage }, "", url.href);
  await runCurrentPage();
  animateMain();
  if (url.hash) {
    requestAnimationFrame(() => document.querySelector(url.hash)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  hideLoader(180);
}

function attachGlobalActions() {
  document.addEventListener("click", async (event) => {
    const menu = event.target.closest("[data-menu]");
    if (menu) {
      document.body.classList.toggle("nav-open");
      return;
    }

    const anchor = event.target.closest("a[href]");
    if (anchor && !anchor.target && !anchor.hasAttribute("download")) {
      const url = new URL(anchor.getAttribute("href"), location.href);
      if (canRoute(url)) {
        event.preventDefault();
        await navigateTo(url.href);
        return;
      }
    }

    if (event.target.matches("[data-quick-session]")) {
      const program = await createProgramFromGoal("Mobilite");
      setActiveProgram(program.id);
      toast("Seance rapide creee.");
      await navigateTo("session.html");
    }

    // app.js (extrait modifié dans la partie attachGlobalActions)
    if (event.target.matches("[data-generate-session]")) {
      // Utiliser la nouvelle fonction intelligente
      const { generateSmartProgram } = await import("./workout.js");
      const program = await generateSmartProgram();
      setActiveProgram(program.id);
      await navigateTo("workout.html");
    }

    if (event.target.matches("[data-export]")) {
      await exportJson();
    }

    if (event.target.matches("[data-fullscreen]")) {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
  });

  document.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") document.body.classList.remove("nav-open");
    if (event.key.toLowerCase() === "n" && event.altKey) await navigateTo("workout.html");
    if (event.key.toLowerCase() === "m" && event.altKey) await navigateTo("music.html");
    if (event.key === " " && currentPage === "session") event.preventDefault();
  });

  window.addEventListener("popstate", () => navigateTo(location.href, { replace: true }));
  window.wistoriaNavigate = navigateTo;
}

async function exportJson() {
  const data = await exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `wistoria-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Export JSON genere.");
}

// app.js - dans initSettingsPage()

function initSettingsPage() {
  const prefs = getPrefs();
  updateInstallButton();
  Object.entries(prefs).forEach(([key, value]) => {
    const field = document.getElementById(key);
    if (!field) return;
    field.value = String(value);
  });

  
  document.getElementById("settingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = savePrefs({
      theme: document.getElementById("theme").value,
      voiceEnabled: document.getElementById("voiceEnabled").value === "true",
      soundVolume: Number(document.getElementById("soundVolume").value),
      vibrationEnabled: document.getElementById("vibrationEnabled").value === "true",
      timeUnit: document.getElementById("timeUnit").value,
      dailyGoal: Number(document.getElementById("dailyGoal").value || 20),
      personalGoals: document.getElementById("personalGoals").value,
      musicDucking: document.getElementById("musicDucking").value === "true",
      musicPauseOnStop: document.getElementById("musicPauseOnStop").value === "true",
      spotifyClientId: document.getElementById("spotifyClientId").value.trim(),
      boomplayWorkoutUrl: document.getElementById("boomplayWorkoutUrl").value.trim(),
      // AJOUT
    weight: Number(document.getElementById("weight").value || 70)
    });
    document.documentElement.dataset.theme = next.theme;
    toast("Parametres enregistres.");
  });

  document.getElementById("testVoiceBtn")?.addEventListener("click", () => speak("Commencez l'etirement. 10 secondes restantes."));
  document.getElementById("installAppBtn")?.addEventListener("click", installApp);
  document.getElementById("importFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    await importData(data);
    applyTheme();
    toast("Import termine.");
  });
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function updateInstallButton() {
  const button = document.getElementById("installAppBtn");
  const state = document.getElementById("installAppState");
  if (!button) return;

  if (isAppInstalled()) {
    button.disabled = true;
    button.textContent = "Application installee";
    if (state) state.textContent = "Wistoria est deja installee sur cet appareil.";
    return;
  }

  button.disabled = false;
  button.textContent = deferredInstallPrompt ? "Installer l'application" : "Telecharger l'application";
  if (state) {
    state.textContent = deferredInstallPrompt
      ? "Installation disponible depuis ce navigateur."
      : "Si rien ne s'ouvre, utilise le menu du navigateur puis Installer l'application ou Ajouter a l'ecran d'accueil.";
  }
}

  // ... (le reste du code existant)

  // Gestion du bouton de mise à jour
  const checkBtn = document.getElementById("checkUpdateBtn");
  const forceBtn = document.getElementById("forceUpdateBtn");
  const statusEl = document.getElementById("updateStatus");

  if (checkBtn) {
    checkBtn.addEventListener("click", async () => {
      if (!("serviceWorker" in navigator)) {
        statusEl.textContent = "❌ Service Worker non supporté.";
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      try {
        await registration.update();
        statusEl.textContent = "✅ Vérification effectuée. Aucune mise à jour trouvée.";
        // Vérifier s'il y a un nouveau worker en attente
        if (registration.waiting) {
          statusEl.textContent = "🔄 Une mise à jour est disponible. Cliquez sur 'Appliquer'.";
          forceBtn.style.display = "inline-flex";
          // On peut aussi proposer de recharger automatiquement
        } else {
          forceBtn.style.display = "none";
          // Vérifier après un délai si un worker est en attente
          setTimeout(() => {
            if (registration.waiting) {
              statusEl.textContent = "🔄 Une mise à jour est disponible. Cliquez sur 'Appliquer'.";
              forceBtn.style.display = "inline-flex";
            }
          }, 1000);
        }
      } catch (err) {
        statusEl.textContent = "❌ Erreur lors de la vérification : " + err.message;
      }
    });
  }

  if (forceBtn) {
    forceBtn.addEventListener("click", () => {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.ready.then((registration) => {
        const waiting = registration.waiting;
        if (waiting) {
          // Envoyer un message au service worker pour qu'il prenne le contrôle
          waiting.postMessage({ type: "SKIP_WAITING" });
          // Recharger la page après un court délai
          setTimeout(() => {
            window.location.reload();
          }, 500);
        } else {
          statusEl.textContent = "⚠️ Aucune mise à jour en attente.";
          forceBtn.style.display = "none";
        }
      });
    });
  }

  // Écouter les changements de service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      statusEl.textContent = "✅ Mise à jour appliquée. Rechargement...";
      setTimeout(() => window.location.reload(), 500);
    });
  }

  
async function installApp() {
  if (isAppInstalled()) {
    toast("Wistoria est deja installee.");
    updateInstallButton();
    return;
  }

  if (!deferredInstallPrompt) {
    toast("Installation directe indisponible ici. Utilise le menu du navigateur pour installer l'app.");
    updateInstallButton();
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallButton();
  toast(choice.outcome === "accepted" ? "Installation lancee." : "Installation annulee.");
}

async function renderHome() {
  await renderMetrics("homeMetrics");
  await renderTodayPlans();
  const list = document.getElementById("homePrograms");
  if (!list) return;
  const programs = await getAll("programs");
  list.innerHTML = programs.length
    ? programs.slice(0, 3).map((program) => {
      const calc = calculateProgram(program);
      return `
        <article class="program-card">
          <header>
            <div>
              <h3>${program.name}</h3>
              <p>${program.description || "Routine personnalisee"}</p>
            </div>
          </header>
          <div class="chips">
            <span class="chip teal">${program.goal}</span>
            <span class="chip amber">${calc.totalMinutes} min</span>
            <span class="chip">${calc.difficulty}</span>
          </div>
          <div class="toolbar">
            <button class="btn primary" data-home-start="${program.id}">Lancer</button>
            <a class="btn" href="workout.html">Modifier</a>
          </div>
        </article>`;
    }).join("")
    : `<div class="empty-state">Aucun programme pour le moment. Cree ta premiere routine ou utilise la seance rapide.</div>`;

  list.addEventListener("click", async (event) => {
    const id = event.target.dataset.homeStart;
    if (!id) return;
    setActiveProgram(id);
    await navigateTo("session.html");
  });
}

async function renderDashboard() {
  await renderMetrics("dashboardMetrics");
  await renderDashboardCharts();
}

async function runCurrentPage() {
  if (currentPage === "home") await renderHome();
  if (currentPage === "dashboard") await renderDashboard();
  if (currentPage === "workout") await initWorkoutPage();
  if (currentPage === "session") await initSessionPage();
  if (currentPage === "music") await initMusicPage();
  if (currentPage === "manual") initManualPage();
  if (currentPage === "calendar") await initCalendarPage();
  if (currentPage === "statistics") await renderStatisticsPage();
  if (currentPage === "settings") initSettingsPage();
  observeCards();
  if (currentPage === "activity") {
    const { initActivityPage } = await import("./activity.js");
    initActivityPage();
  }
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }
}

async function init() {
  showLoader("Preparation de ton espace d'entrainement.");
  applyTheme();
  renderNavigation();
  attachGlobalActions();
  await initMusicGlobal();
  history.replaceState({ page: currentPage }, "", location.href);
  await runCurrentPage();
  animateMain();
  registerServiceWorker();
  hideLoader(520);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  toast("Wistoria est installee.");
});

init().catch((error) => {
  console.error(error);
  toast(error.message || "Erreur inattendue.");
});

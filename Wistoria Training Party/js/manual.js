const MANUAL_SEEN_KEY = "wistoria:manualTutorialSeen";

let manualSections = [];
let currentIndex = 0;
let mode = "beginner";

function sectionTitle(section) {
  return section.dataset.title || section.querySelector("h2")?.textContent || "Section";
}

function buildToc() {
  const toc = document.getElementById("manualToc");
  if (!toc) return;
  toc.innerHTML = manualSections.map((section, index) => `
    <a href="#${section.id}" data-manual-jump="${index}">
      <span class="nav-icon">${index + 1}</span>
      <span>${sectionTitle(section)}</span>
    </a>`).join("");
}

function setActiveSection(index) {
  currentIndex = Math.max(0, Math.min(manualSections.length - 1, index));
  const section = manualSections[currentIndex];
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelectorAll("[data-manual-jump]").forEach((link) => {
    link.classList.toggle("active", Number(link.dataset.manualJump) === currentIndex);
  });
}

function applyManualMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll("[data-manual-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.manualMode === mode);
  });
  document.querySelectorAll(".advanced-note").forEach((node) => {
    node.classList.toggle("manual-hidden", mode !== "advanced");
  });
}

function filterManual(query) {
  const normalized = query.trim().toLowerCase();
  manualSections.forEach((section) => {
    const text = section.textContent.toLowerCase();
    section.classList.toggle("manual-hidden", Boolean(normalized) && !text.includes(normalized));
  });
  document.querySelectorAll("[data-manual-jump]").forEach((link) => {
    const section = manualSections[Number(link.dataset.manualJump)];
    link.classList.toggle("manual-hidden", section?.classList.contains("manual-hidden"));
  });
}

function openTutorial(force = false) {
  if (!force && localStorage.getItem(MANUAL_SEEN_KEY)) return;
  const overlay = document.createElement("div");
  overlay.className = "manual-tutorial";
  overlay.innerHTML = `
    <section class="panel tutorial-card">
      <div>
        <h2>Bienvenue dans Wistoria</h2>
        <p>Le guide t'aide a creer tes programmes, lancer tes seances, suivre ta progression et garder ta musique active.</p>
      </div>
      <div class="tutorial-steps">
        <div class="tutorial-step">1. Cree ton objectif</div>
        <div class="tutorial-step">2. Ajoute tes exercices</div>
        <div class="tutorial-step">3. Lance la session</div>
        <div class="tutorial-step">4. Suis XP et stats</div>
      </div>
      <div class="toolbar">
        <button class="btn primary" data-close-tutorial>Commencer</button>
        <button class="btn" data-manual-mode="advanced">Voir mode avance</button>
      </div>
    </section>`;
  document.body.append(overlay);
  localStorage.setItem(MANUAL_SEEN_KEY, "true");
}

export function initManualPage() {
  manualSections = [...document.querySelectorAll(".manual-section")];
  currentIndex = 0;
  buildToc();
  applyManualMode(mode);

  document.getElementById("manualSearch")?.addEventListener("input", (event) => {
    filterManual(event.target.value);
  });

  document.getElementById("manualPrev")?.addEventListener("click", () => setActiveSection(currentIndex - 1));
  document.getElementById("manualNext")?.addEventListener("click", () => setActiveSection(currentIndex + 1));
  document.getElementById("restartTutorialBtn")?.addEventListener("click", () => openTutorial(true));

  document.querySelector(".manual-layout")?.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-manual-jump]");
    const modeButton = event.target.closest("[data-manual-mode]");
    const demo = event.target.closest("[data-demo]");

    if (jump) {
      event.preventDefault();
      setActiveSection(Number(jump.dataset.manualJump));
    }
    if (modeButton) applyManualMode(modeButton.dataset.manualMode);
    if (demo) {
      demo.closest(".manual-video").querySelector("span").textContent = "Demo : Parametres -> Mes entrainements -> Ajouter un exercice -> Lancer.";
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-tutorial]")) {
      event.target.closest(".manual-tutorial")?.remove();
    }
    if (event.target.matches(".manual-tutorial [data-manual-mode]")) {
      applyManualMode(event.target.dataset.manualMode);
      event.target.closest(".manual-tutorial")?.remove();
    }
  }, { once: false });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = manualSections.findIndex((section) => section === entry.target);
      if (index >= 0) {
        currentIndex = index;
        document.querySelectorAll("[data-manual-jump]").forEach((link) => {
          link.classList.toggle("active", Number(link.dataset.manualJump) === index);
        });
      }
    });
  }, { threshold: 0.45 });
  manualSections.forEach((section) => observer.observe(section));

  openTutorial(false);
}

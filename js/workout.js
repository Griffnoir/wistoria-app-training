// workout.js
import {
  calculateProgram,
  createProgramFromGoal,
  deleteItem,
  EXERCISE_LIBRARY,
  getAll,
  putItem,
  setActiveProgram,
  uid
} from "./storage.js";
import { toast } from "./notifications.js";

let programs = [];
let selectedProgram = null;
let editingExerciseId = null;
let formVisible = false; // état du formulaire

const $ = (id) => document.getElementById(id);

function emptyProgram() {
  return {
    id: uid("program"),
    name: "",
    description: "",
    goal: "Mobilité",
    level: "Débutant",
    days: "",
    favorite: false,
    color: "#16c7b7",
    exercises: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function readProgramForm() {
  return {
    ...selectedProgram,
    id: $("programId").value || selectedProgram?.id || uid("program"),
    name: $("programName").value.trim() || "Programme sans titre",
    goal: $("programGoal").value,
    level: $("programLevel").value,
    days: $("programDays").value.trim(),
    description: $("programDescription").value.trim(),
    updatedAt: new Date().toISOString()
  };
}

function writeProgramForm(program) {
  selectedProgram = program;
  $("programId").value = program.id;
  $("programName").value = program.name || "";
  $("programGoal").value = program.goal || "Mobilité";
  $("programLevel").value = program.level || "Débutant";
  $("programDays").value = program.days || "";
  $("programDescription").value = program.description || "";
  renderExercises();
  renderSummary();
  toggleFormVisibility(true); // Affiche le formulaire
}

function toggleFormVisibility(show) {
  const formContainer = document.querySelector(".form-container");
  if (!formContainer) return;
  formContainer.style.display = show ? "block" : "none";
  formVisible = show;
  // Mettre à jour le texte du bouton "Nouveau" selon l'état
  const newBtn = $("newProgramBtn");
  if (newBtn) newBtn.textContent = show ? "Fermer" : "Nouveau";
}

function exerciseIcon(category) {
  const icons = {
    Hanches: "◇",
    "Ischio-jambiers": "△",
    Adducteurs: "◌",
    Dos: "⌁",
    Épaules: "□",
    Jambes: "▱",
    "Mobilité générale": "✦"
  };
  return icons[category] || "✦";
}

function renderPrograms() {
  const list = $("programList");
  if (!list) return;
  const query = ($("programSearch")?.value || "").toLowerCase();
  const filtered = programs.filter((program) =>
    [program.name, program.goal, program.level, program.description].join(" ").toLowerCase().includes(query)
  );

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">Aucun programme. Crée une routine ou génère une base modifiable.</div>`;
    return;
  }

  list.innerHTML = filtered.map((program) => {
    const calc = calculateProgram(program);
    return `
      <article class="program-card" data-program-id="${program.id}">
        <header>
          <div>
            <h3>${program.favorite ? "★ " : ""}${program.name}</h3>
            <p>${program.description || "Programme personnalisé"}</p>
          </div>
          <button class="btn icon-btn" data-favorite="${program.id}" aria-label="Favori">★</button>
        </header>
        <div class="chips">
          <span class="chip teal">${program.goal}</span>
          <span class="chip">${program.level}</span>
          <span class="chip amber">${calc.totalMinutes} min</span>
          <span class="chip">${calc.exerciseCount} exercices</span>
        </div>
        <div class="toolbar">
          <button class="btn" data-edit="${program.id}">Modifier</button>
          <button class="btn primary" data-start="${program.id}">Lancer</button>
          <button class="btn" data-duplicate="${program.id}">Dupliquer</button>
          <button class="btn warning" data-delete="${program.id}">Supprimer</button>
        </div>
      </article>`;
  }).join("");
}

function renderSummary() {
  const node = $("builderSummary");
  if (!node || !selectedProgram) return;
  const calc = calculateProgram(selectedProgram);
  node.innerHTML = `
    <div class="metric panel"><span class="label">Durée estimée</span><strong>${calc.totalMinutes}</strong><small>minutes</small></div>
    <div class="metric panel"><span class="label">Exercices</span><strong>${calc.exerciseCount}</strong><small>${calc.setCount} séries</small></div>
    <div class="metric panel"><span class="label">Difficulté</span><strong>${calc.difficulty}</strong><small>${selectedProgram.level}</small></div>
    <div class="metric panel"><span class="label">Muscles</span><strong>${calc.categories.length}</strong><small>${calc.categories.join(", ") || "À définir"}</small></div>`;
}

function renderExercises() {
  const list = $("exerciseList");
  if (!list || !selectedProgram) return;
  if (!selectedProgram.exercises?.length) {
    list.innerHTML = `<div class="empty-state">Ajoute un exercice pour composer ton programme.</div>`;
    return;
  }

  list.innerHTML = selectedProgram.exercises.map((exercise, index) => `
    <article class="exercise-card" draggable="true" data-exercise-id="${exercise.id}" data-index="${index}">
      <div class="exercise-thumb">
        ${exercise.media ? `<img src="${exercise.media}" alt="">` : `<strong>${exerciseIcon(exercise.category)}</strong>`}
      </div>
      <div>
        <header>
          <div>
            <h3>${exercise.name}</h3>
            <p>${exercise.description || exercise.target || ""}</p>
          </div>
          <span class="chip teal">${exercise.category}</span>
        </header>
        <div class="chips">
          <span class="chip">${exercise.duration}s</span>
          <span class="chip">${exercise.sets} séries</span>
          <span class="chip">${exercise.rest}s repos</span>
          <span class="chip amber">${exercise.target || "Objectif libre"}</span>
        </div>
        <div class="exercise-actions">
          <button class="btn" data-edit-exercise="${exercise.id}">Modifier</button>
          <button class="btn" data-copy-exercise="${exercise.id}">Dupliquer</button>
          <button class="btn warning" data-remove-exercise="${exercise.id}">Supprimer</button>
        </div>
      </div>
    </article>`).join("");
}

function readExerciseForm() {
  return {
    id: editingExerciseId || uid("exercise"),
    name: $("exerciseName").value.trim() || "Exercice sans titre",
    category: $("exerciseCategory").value,
    duration: Number($("exerciseDuration").value || 30),
    sets: Number($("exerciseSets").value || 1),
    rest: Number($("exerciseRest").value || 0),
    media: $("exerciseMedia").value.trim() || "assets/images/stretch-hips.svg",
    target: $("exerciseTarget").value.trim(),
    description: $("exerciseDescription").value.trim(),
    cues: $("exerciseCues").value.trim()
  };
}

function writeExerciseForm(exercise) {
  editingExerciseId = exercise?.id || null;
  $("exerciseId").value = exercise?.id || "";
  $("exerciseName").value = exercise?.name || "";
  $("exerciseCategory").value = exercise?.category || "Hanches";
  $("exerciseDuration").value = exercise?.duration || 60;
  $("exerciseSets").value = exercise?.sets || 3;
  $("exerciseRest").value = exercise?.rest || 30;
  $("exerciseMedia").value = exercise?.media || "";
  $("exerciseTarget").value = exercise?.target || "";
  $("exerciseDescription").value = exercise?.description || "";
  $("exerciseCues").value = exercise?.cues || "";
}

async function saveSelected() {
  const name = $("programName").value.trim();
  if (!name) {
    toast("Veuillez donner un nom au programme.");
    return;
  }
  selectedProgram = readProgramForm();
  selectedProgram.exercises = selectedProgram.exercises || [];
  if (selectedProgram.exercises.length === 0) {
    toast("Ajoutez au moins un exercice.");
    return;
  }
  if (!selectedProgram.createdAt) selectedProgram.createdAt = new Date().toISOString();
  await putItem("programs", selectedProgram);
  programs = await getAll("programs");
  renderPrograms();
  renderSummary();
  toast("Programme enregistré.");
  // Optionnel : masquer le formulaire après sauvegarde
  toggleFormVisibility(false);
}

function openExerciseDialog(exercise = null) {
  writeExerciseForm(exercise || EXERCISE_LIBRARY[0]);
  $("exerciseDialog").showModal();
}

// Glisser-déposer amélioré
function attachDragAndDrop() {
  const list = $("exerciseList");
  if (!list) return;
  let draggedId = null;

  list.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-exercise-id]");
    if (!card) return;
    draggedId = card.dataset.exerciseId;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedId);
  });

  list.addEventListener("dragend", (event) => {
    const card = event.target.closest("[data-exercise-id]");
    if (card) card.classList.remove("dragging");
    document.querySelectorAll(".drop-zone").forEach(el => el.remove());
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    const target = event.target.closest("[data-exercise-id]");
    if (!target) return;
    let zone = target.querySelector(".drop-zone");
    if (!zone) {
      zone = document.createElement("div");
      zone.className = "drop-zone";
      zone.style.height = "3px";
      zone.style.background = "var(--teal)";
      zone.style.margin = "4px 0";
      zone.style.borderRadius = "2px";
      target.before(zone);
    }
  });

  list.addEventListener("dragleave", (event) => {
    const target = event.target.closest("[data-exercise-id]");
    if (target) {
      const zone = target.querySelector(".drop-zone");
      if (zone) zone.remove();
    }
  });

  list.addEventListener("drop", async (event) => {
    event.preventDefault();
    document.querySelectorAll(".drop-zone").forEach(el => el.remove());
    const target = event.target.closest("[data-exercise-id]");
    if (!target || !draggedId || draggedId === target.dataset.exerciseId) return;

    const from = selectedProgram.exercises.findIndex((item) => item.id === draggedId);
    const to = selectedProgram.exercises.findIndex((item) => item.id === target.dataset.exerciseId);
    if (from === -1 || to === -1) return;

    const [moved] = selectedProgram.exercises.splice(from, 1);
    selectedProgram.exercises.splice(to, 0, moved);
    renderExercises();
    renderSummary();
    // Sauvegarde automatique après réorganisation
    await saveSelected();
    toast("Ordre des exercices mis à jour.");
  });
}

// Génération intelligente
export async function generateSmartProgram() {
  const goal = prompt("Objectif (Grand écart, High kicks, Mobilité, Récupération, Combat) :", "Mobilité") || "Mobilité";
  const level = prompt("Niveau (Débutant, Intermédiaire, Avancé, Expert) :", "Intermédiaire") || "Intermédiaire";
  const durationMin = parseInt(prompt("Durée souhaitée (minutes) :", "15")) || 15;

  const allExercises = EXERCISE_LIBRARY;
  const filtered = allExercises.filter(ex =>
    ex.target && ex.target.toLowerCase().includes(goal.toLowerCase())
  );
  const pool = filtered.length ? filtered : allExercises;

  const count = Math.min(4, Math.max(2, Math.floor(durationMin / 5)));
  const shuffled = pool.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);

  const totalSeconds = durationMin * 60;
  const exercises = selected.map((ex, index) => {
    const baseDuration = ex.duration || 30;
    let sets = Math.max(1, Math.floor((totalSeconds / count / baseDuration) / 2) * 2 || 2);
    let duration = Math.min(120, Math.max(20, Math.floor(totalSeconds / count / sets)));
    // Ajustement pour éviter trop de séries si duration est petite
    if (duration < 20) { duration = 30; sets = Math.max(1, Math.floor(totalSeconds / count / 30)); }
    return {
      ...ex,
      id: uid("exercise"),
      duration,
      sets,
      rest: Math.max(10, Math.floor(duration / 3)),
    };
  });

  const program = {
    id: uid("program"),
    name: `${goal} - ${level} (${durationMin}min)`,
    description: `Séance générée pour ${goal}, niveau ${level}.`,
    goal,
    level,
    days: "",
    favorite: false,
    color: "#16c7b7",
    exercises,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await putItem("programs", program);
  toast(`Programme "${program.name}" créé.`);
  return program;
}

export async function initWorkoutPage() {
  programs = await getAll("programs");
  // Par défaut, masquer le formulaire
  toggleFormVisibility(false);
  renderPrograms();
  attachDragAndDrop();

  // Bouton Nouveau / Fermer
  $("newProgramBtn")?.addEventListener("click", () => {
    if (formVisible) {
      toggleFormVisibility(false);
    } else {
      writeProgramForm(emptyProgram());
    }
  });

  $("saveProgramBtn")?.addEventListener("click", saveSelected);
  $("programSearch")?.addEventListener("input", renderPrograms);
  $("addExerciseBtn")?.addEventListener("click", () => openExerciseDialog(null));

  // Fermeture du formulaire si on clique sur "Annuler" dans le dialog exercise (géré plus bas)

  $("exerciseForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter?.value;
    if (submitter === "cancel") return $("exerciseDialog").close();
    const exercise = readExerciseForm();
    if (!exercise.name) {
      toast("Le nom de l'exercice est requis.");
      return;
    }
    const existing = selectedProgram.exercises.findIndex((item) => item.id === exercise.id);
    if (existing >= 0) selectedProgram.exercises[existing] = exercise;
    else selectedProgram.exercises.push(exercise);
    $("exerciseDialog").close();
    renderExercises();
    renderSummary();
    // Sauvegarder automatiquement après ajout/modification d'exercice
    await saveSelected();
  });

  // Gestion des événements sur les cartes programmes
  document.addEventListener("click", async (event) => {
    const target = event.target;
    const edit = target.dataset.edit;
    const start = target.dataset.start;
    const duplicate = target.dataset.duplicate;
    const remove = target.dataset.delete;
    const favorite = target.dataset.favorite;
    const editExercise = target.dataset.editExercise;
    const copyExercise = target.dataset.copyExercise;
    const removeExercise = target.dataset.removeExercise;

    if (edit) {
      const program = programs.find((p) => p.id === edit);
      if (program) writeProgramForm(program);
    }
    if (start) {
      setActiveProgram(start);
      if (window.wistoriaNavigate) await window.wistoriaNavigate("session.html");
      else location.href = "session.html";
    }
    if (duplicate) {
      const source = programs.find((program) => program.id === duplicate);
      if (!source) return;
      const copy = {
        ...source,
        id: uid("program"),
        name: `${source.name} (copie)`,
        exercises: source.exercises.map((exercise) => ({ ...exercise, id: uid("exercise") })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await putItem("programs", copy);
      programs = await getAll("programs");
      renderPrograms();
      toast("Programme dupliqué.");
    }
    if (remove && confirm("Supprimer ce programme ?")) {
      await deleteItem("programs", remove);
      programs = await getAll("programs");
      if (selectedProgram && selectedProgram.id === remove) {
        writeProgramForm(programs[0] || emptyProgram());
      }
      renderPrograms();
      toast("Programme supprimé.");
    }
    if (favorite) {
      const program = programs.find((item) => item.id === favorite);
      if (program) {
        program.favorite = !program.favorite;
        await putItem("programs", program);
        programs = await getAll("programs");
        renderPrograms();
        toast(program.favorite ? "Ajouté aux favoris." : "Retiré des favoris.");
      }
    }
    if (editExercise) {
      const ex = selectedProgram?.exercises.find((item) => item.id === editExercise);
      if (ex) openExerciseDialog(ex);
    }
    if (copyExercise) {
      const exercise = selectedProgram?.exercises.find((item) => item.id === copyExercise);
      if (exercise) {
        selectedProgram.exercises.push({
          ...exercise,
          id: uid("exercise"),
          name: `${exercise.name} (copie)`
        });
        renderExercises();
        renderSummary();
        await saveSelected();
        toast("Exercice dupliqué.");
      }
    }
    if (removeExercise) {
      if (!selectedProgram) return;
      selectedProgram.exercises = selectedProgram.exercises.filter((item) => item.id !== removeExercise);
      renderExercises();
      renderSummary();
      await saveSelected();
      toast("Exercice supprimé.");
    }
  });
}

// On garde l'ancienne fonction pour compatibilité si besoin
export async function generateProgramFromPrompt() {
  const goal = prompt("Objectif de la séance ?", "High kicks") || "Mobilité";
  const program = await createProgramFromGoal(goal);
  toast("Séance générée. Tu peux tout modifier.");
  return program;
}
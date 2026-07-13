import { getAll, putItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

let viewDate = new Date();
let plans = [];
let history = [];
let programs = [];

function dateKey(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

function monthLabel(date) {
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function renderProgramOptions() {
  const select = document.getElementById("planProgram");
  if (!select) return;
  select.innerHTML = `<option value="">Aucun</option>` + programs
    .map((program) => `<option value="${program.id}">${program.name}</option>`)
    .join("");
}

function renderCalendar() {
  const title = document.getElementById("calendarTitle");
  const grid = document.getElementById("calendarGrid");
  if (!title || !grid) return;

  title.textContent = monthLabel(viewDate);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  const planned = new Set(plans.map((plan) => plan.date));
  const done = new Set(history.map((item) => dateKey(item.date)));
  const today = dateKey(new Date());

  for (let i = 0; i < offset; i += 1) cells.push(`<div class="calendar-cell muted"></div>`);
  for (let day = 1; day <= days; day += 1) {
    const key = dateKey(new Date(year, month, day));
    cells.push(`
      <button class="calendar-cell ${key === today ? "today" : ""} ${done.has(key) ? "done" : ""}" data-date="${key}">
        <strong>${day}</strong>
        ${planned.has(key) ? `<span>Planifié</span>` : ""}
        ${done.has(key) ? `<em>Terminé</em>` : ""}
      </button>`);
  }

  grid.innerHTML = `
    <div class="calendar-weekdays">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>`;
}

function renderPlans() {
  const list = document.getElementById("planList");
  const todayPlans = document.getElementById("todayPlans");
  const markup = plans.length
    ? plans.slice().sort((a, b) => a.date.localeCompare(b.date)).map((plan) => {
      const program = programs.find((item) => item.id === plan.programId);
      return `<div class="plan-item"><strong>${plan.title}</strong><p>${new Date(plan.date).toLocaleDateString("fr-FR")} ${program ? `· ${program.name}` : ""}</p></div>`;
    }).join("")
    : `<div class="empty-state">Aucun objectif planifié pour le moment.</div>`;
  if (list) list.innerHTML = markup;

  if (todayPlans) {
    const key = dateKey(new Date());
    const items = plans.filter((plan) => plan.date === key);
    todayPlans.innerHTML = items.length
      ? items.map((plan) => `<div class="plan-item"><strong>${plan.title}</strong><p>Aujourd'hui</p></div>`).join("")
      : `<div class="empty-state">Rien de planifié aujourd'hui. Tu peux ajouter un objectif dans le calendrier.</div>`;
  }
}

async function refresh() {
  [plans, history, programs] = await Promise.all([getAll("plans"), getAll("history"), getAll("programs")]);
  renderProgramOptions();
  renderCalendar();
  renderPlans();
}

export async function initCalendarPage() {
  await refresh();
  document.getElementById("prevMonth")?.addEventListener("click", () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("nextMonth")?.addEventListener("click", () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById("addPlanBtn")?.addEventListener("click", () => {
    document.getElementById("planDate").value = dateKey(new Date());
    document.getElementById("planDialog").showModal();
  });
  document.getElementById("calendarGrid")?.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-date]");
    if (!cell) return;
    document.getElementById("planDate").value = cell.dataset.date;
    document.getElementById("planDialog").showModal();
  });
  document.getElementById("planForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") return document.getElementById("planDialog").close();
    await putItem("plans", {
      id: uid("plan"),
      date: document.getElementById("planDate").value,
      title: document.getElementById("planTitle").value.trim() || "Objectif souplesse",
      programId: document.getElementById("planProgram").value,
      done: false
    });
    document.getElementById("planDialog").close();
    toast("Objectif planifié.");
    await refresh();
  });
}

export async function renderTodayPlans() {
  [plans, history, programs] = await Promise.all([getAll("plans"), getAll("history"), getAll("programs")]);
  renderPlans();
}

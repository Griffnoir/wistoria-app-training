import { getActiveProgram, getItem, saveSessionHistory } from "./storage.js";
import { beep, speak, vibrate } from "./sound.js";
import { toast } from "./notifications.js";

export class SessionTimer {
  constructor(program) {
    this.program = program;
    this.steps = this.buildSteps(program);
    this.index = 0;
    this.remaining = this.steps[0]?.duration || 0;
    this.running = false;
    this.interval = null;
    this.elapsed = 0;
    this.completedSets = 0;
    this.completedExercises = 0;
    this.warned = false;
  }

  buildSteps(program) {
    const steps = [];
    (program?.exercises || []).forEach((exercise, exerciseIndex) => {
      const sets = Number(exercise.sets || 1);
      for (let set = 1; set <= sets; set += 1) {
        steps.push({
          type: "work",
          exercise,
          exerciseIndex,
          set,
          duration: Number(exercise.duration || 30)
        });
        if (Number(exercise.rest || 0) > 0 && set < sets) {
          steps.push({
            type: "rest",
            exercise,
            exerciseIndex,
            set,
            duration: Number(exercise.rest || 0)
          });
        }
      }
    });
    return steps;
  }

  get current() {
    return this.steps[this.index] || null;
  }

  start(onTick, onDone) {
    if (!this.current) return;
    this.running = true;
    window.dispatchEvent(new CustomEvent("wistoria:workout-start"));
    this.announceStep();
    this.tick(onTick);
    this.interval = setInterval(() => {
      if (!this.running) return;
      this.remaining -= 1;
      this.elapsed += 1;

      if (this.remaining === 10 && !this.warned) {
        this.warned = true;
        beep(940, 0.1);
        speak("10 secondes restantes");
        vibrate([40]);
      }

      if (this.remaining <= 0) {
        this.completeStep(onTick, onDone);
      } else {
        this.tick(onTick);
      }
    }, 1000);
  }

  pause() {
    this.running = false;
    speak("Pause");
  }

  resume(onTick, onDone) {
    if (!this.interval) {
      this.start(onTick, onDone);
      return;
    }
    this.running = true;
    speak("Reprise");
  }

  skip(onTick, onDone) {
    this.completeStep(onTick, onDone);
  }

  restart(onTick) {
    clearInterval(this.interval);
    this.interval = null;
    this.index = 0;
    this.remaining = this.steps[0]?.duration || 0;
    this.elapsed = 0;
    this.completedSets = 0;
    this.completedExercises = 0;
    this.warned = false;
    this.running = false;
    this.tick(onTick);
    speak("Séance recommencée");
  }

  async stop(onDone) {
    clearInterval(this.interval);
    this.interval = null;
    this.running = false;
    window.dispatchEvent(new CustomEvent("wistoria:workout-stop"));
    if (this.elapsed > 10) {
      await saveSessionHistory({
        program: this.program,
        elapsedSeconds: this.elapsed,
        completedExercises: this.completedExercises,
        completedSets: this.completedSets
      });
      toast("Séance enregistrée.");
    }
    if (onDone) onDone(false);
  }

  async completeStep(onTick, onDone) {
    const current = this.current;
    if (current?.type === "work") {
      this.completedSets += 1;
      const next = this.steps[this.index + 1];
      if (!next || next.exercise?.id !== current.exercise?.id) this.completedExercises += 1;
    }

    this.index += 1;
    this.warned = false;

    if (this.index >= this.steps.length) {
      clearInterval(this.interval);
      this.interval = null;
      this.running = false;
      this.remaining = 0;
      this.tick(onTick);
      await saveSessionHistory({
        program: this.program,
        elapsedSeconds: this.elapsed,
        completedExercises: this.completedExercises,
        completedSets: this.completedSets
      });
      beep(1040, 0.24);
      vibrate([100, 60, 100]);
      speak("Séance terminée. Beau travail.");
      toast("Séance terminée et enregistrée.");
      if (onDone) onDone(true);
      return;
    }

    this.remaining = this.current.duration;
    this.announceStep();
    this.tick(onTick);
  }

  announceStep() {
    const current = this.current;
    if (!current) return;
    beep(current.type === "rest" ? 520 : 760, 0.12);
    vibrate(current.type === "rest" ? [40, 30, 40] : [70]);
    if (current.type === "rest") {
      speak("Repos");
    } else {
      const prefix = current.set > 1 ? `Série ${current.set}. ` : "";
      speak(`${prefix}Commencez l'étirement. ${current.exercise.name}`);
    }
  }

  tick(onTick) {
    if (onTick) onTick(this.snapshot());
  }

  snapshot() {
    const current = this.current;
    const completedDuration = this.steps.slice(0, this.index).reduce((sum, step) => sum + step.duration, 0);
    const totalDuration = this.steps.reduce((sum, step) => sum + step.duration, 0);
    const currentElapsed = current ? current.duration - this.remaining : 0;
    const progress = totalDuration ? ((completedDuration + currentElapsed) / totalDuration) * 100 : 0;

    return {
      program: this.program,
      current,
      index: this.index,
      totalSteps: this.steps.length,
      remaining: this.remaining,
      elapsed: this.elapsed,
      completedSets: this.completedSets,
      completedExercises: this.completedExercises,
      progress: Math.max(0, Math.min(100, progress))
    };
  }
}

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const min = Math.floor(safe / 60).toString().padStart(2, "0");
  const sec = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function renderSnapshot(snapshot) {
  const current = snapshot.current;
  const exercise = current?.exercise;
  const image = document.getElementById("sessionImage");
  document.getElementById("timerNumber").textContent = formatSeconds(snapshot.remaining);
  document.getElementById("sessionProgress").style.width = `${snapshot.progress}%`;
  document.getElementById("sessionExercise").textContent = current?.type === "rest" ? "Repos" : exercise?.name || "Session";
  document.getElementById("sessionCue").textContent = current?.type === "rest"
    ? "Respire, relâche la tension et prépare la prochaine série."
    : exercise?.cues || "Reste actif, calme et précis.";
  document.getElementById("sessionSet").textContent = current ? `${current.set}/${exercise?.sets || 1}` : "-";
  document.getElementById("sessionStep").textContent = `${Math.min(snapshot.index + 1, snapshot.totalSteps)}/${snapshot.totalSteps || 0}`;
  document.getElementById("sessionTotal").textContent = `${Math.round(snapshot.elapsed / 60)} min`;
  if (image && exercise?.media) image.src = exercise.media;

  const chips = document.getElementById("sessionChips");
  if (chips) {
    chips.innerHTML = current
      ? `<span class="chip teal">${snapshot.program.name}</span><span class="chip amber">${exercise.category}</span><span class="chip">${current.type === "rest" ? "Repos" : "Travail"}</span>`
      : "";
  }
}

export async function initSessionPage() {
  const activeId = getActiveProgram();
  const program = activeId ? await getItem("programs", activeId) : null;
  let timer = program ? new SessionTimer(program) : null;
  if (timer) renderSnapshot(timer.snapshot());

  const start = document.getElementById("startTimerBtn");
  const pause = document.getElementById("pauseTimerBtn");
  const skip = document.getElementById("skipTimerBtn");
  const restart = document.getElementById("restartTimerBtn");
  const stop = document.getElementById("stopTimerBtn");
  const number = document.getElementById("timerNumber");

  if (!program) {
    start?.addEventListener("click", () => {
      toast("Crée ou lance d'abord un programme depuis Mes entraînements.");
      if (window.wistoriaNavigate) window.wistoriaNavigate("workout.html");
      else location.href = "workout.html";
    });
    return;
  }

  start?.addEventListener("click", () => {
    if (!timer.running && timer.interval) {
      timer.resume(renderSnapshot);
    } else if (!timer.interval) {
      timer.start(renderSnapshot, () => number?.classList.remove("pulse-timer"));
      number?.classList.add("pulse-timer");
    }
  });
  pause?.addEventListener("click", () => timer.pause());
  skip?.addEventListener("click", () => timer.skip(renderSnapshot));
  restart?.addEventListener("click", () => timer.restart(renderSnapshot));
  stop?.addEventListener("click", () => timer.stop(() => number?.classList.remove("pulse-timer")));
}

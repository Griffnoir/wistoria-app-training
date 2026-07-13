const DB_NAME = "wistoria-training-db";
const DB_VERSION = 2;
const STORES = ["programs", "history", "plans", "records", "musicTracks", "musicPlaylists"];

export const DEFAULT_PREFS = {
  theme: "dark",
  voiceEnabled: true,
  soundVolume: 0.55,
  vibrationEnabled: true,
  timeUnit: "seconds",
  dailyGoal: 20,
  personalGoals: "",
  musicDucking: true,
  musicPauseOnStop: true,
  spotifyClientId: "",
  boomplayWorkoutUrl: "https://www.boomplay.com/"
};

export const EXERCISE_LIBRARY = [
  {
    name: "Frog Stretch",
    category: "Adducteurs",
    duration: 60,
    sets: 3,
    rest: 30,
    target: "Ouverture des hanches et relâchement des adducteurs",
    description: "Genoux ouverts, bassin reculé, colonne longue. Cherche une tension progressive sans douleur.",
    cues: "Respire lentement. Garde les genoux alignés et relâche les épaules.",
    media: "assets/images/stretch-hips.svg"
  },
  {
    name: "Front Split Hold",
    category: "Ischio-jambiers",
    duration: 45,
    sets: 3,
    rest: 35,
    target: "Progression grand écart facial et coups de pied hauts",
    description: "Jambe avant longue, bassin carré, appuis contrôlés. Descends seulement dans une amplitude respirable.",
    cues: "Change de côté à chaque série. Reste actif dans la jambe arrière.",
    media: "assets/images/stretch-split.svg"
  },
  {
    name: "Hip Switch Flow",
    category: "Hanches",
    duration: 50,
    sets: 2,
    rest: 20,
    target: "Mobilité dynamique pour transitions de combat",
    description: "Assis en 90/90, alterne les côtés sans écraser le bas du dos.",
    cues: "Mouvement fluide, respiration régulière, buste fier.",
    media: "assets/images/stretch-hips.svg"
  },
  {
    name: "High Kick Chamber",
    category: "Jambes",
    duration: 40,
    sets: 4,
    rest: 25,
    target: "Contrôle actif de la chambre du coup de pied",
    description: "Monte le genou, maintiens le bassin stable, puis tends lentement la jambe.",
    cues: "Travaille lentement. Priorité au contrôle, pas à la hauteur.",
    media: "assets/images/martial-flow.svg"
  }
];

let dbPromise;

export function uid(prefix = "id") {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
}

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function transact(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAll(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getItem(storeName, id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export function putItem(storeName, item) {
  return transact(storeName, "readwrite", (store) => store.put(item));
}

export function deleteItem(storeName, id) {
  return transact(storeName, "readwrite", (store) => store.delete(id));
}

export function getPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("wistoria:prefs") || "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  const next = { ...getPrefs(), ...prefs };
  localStorage.setItem("wistoria:prefs", JSON.stringify(next));
  return next;
}

export function setActiveProgram(id) {
  localStorage.setItem("wistoria:activeProgram", id);
}

export function getActiveProgram() {
  return localStorage.getItem("wistoria:activeProgram");
}

export async function exportData() {
  const [programs, history, plans, records, musicTracks, musicPlaylists] = await Promise.all(
    STORES.map((store) => getAll(store))
  );

  return {
    exportedAt: new Date().toISOString(),
    app: "Wistoria App Training",
    preferences: getPrefs(),
    programs,
    history,
    plans,
    records,
    musicTracks: musicTracks.map(({ blob, ...track }) => ({
      ...track,
      hasAudioFile: Boolean(blob)
    })),
    musicPlaylists
  };
}

export async function importData(data) {
  if (!data || typeof data !== "object") throw new Error("Fichier JSON invalide.");
  if (data.preferences) savePrefs(data.preferences);

  const imports = [
    ["programs", data.programs || []],
    ["history", data.history || []],
    ["plans", data.plans || []],
    ["records", data.records || []],
    ["musicPlaylists", data.musicPlaylists || []]
  ];

  for (const [store, rows] of imports) {
    for (const row of rows) {
      if (row && row.id) await putItem(store, row);
    }
  }
}

export function calculateProgram(program) {
  const exercises = program?.exercises || [];
  const workSeconds = exercises.reduce((sum, item) => sum + Number(item.duration || 0) * Number(item.sets || 1), 0);
  const restSeconds = exercises.reduce((sum, item) => sum + Number(item.rest || 0) * Math.max(Number(item.sets || 1) - 1, 0), 0);
  const totalSeconds = workSeconds + restSeconds;
  const categories = [...new Set(exercises.map((item) => item.category).filter(Boolean))];
  const setCount = exercises.reduce((sum, item) => sum + Number(item.sets || 1), 0);
  const difficultyScore = totalSeconds / 420 + setCount / 8 + categories.length / 5;
  const difficulty = difficultyScore < 2 ? "Doux" : difficultyScore < 4 ? "Modéré" : difficultyScore < 6 ? "Intense" : "Expert";

  return {
    exerciseCount: exercises.length,
    setCount,
    totalSeconds,
    totalMinutes: Math.round(totalSeconds / 60),
    categories,
    difficulty
  };
}

export async function createProgramFromGoal(goal = "Mobilité") {
  const pool = {
    "Grand écart": ["Front Split Hold", "Frog Stretch", "Hip Switch Flow"],
    "High kicks": ["High Kick Chamber", "Hip Switch Flow", "Front Split Hold"],
    Mobilité: ["Hip Switch Flow", "Frog Stretch", "High Kick Chamber"],
    Récupération: ["Frog Stretch", "Front Split Hold"],
    Combat: ["High Kick Chamber", "Hip Switch Flow", "Frog Stretch"],
    Personnalisé: ["Frog Stretch", "Hip Switch Flow"]
  }[goal] || EXERCISE_LIBRARY.map((item) => item.name);

  const exercises = pool
    .map((name) => EXERCISE_LIBRARY.find((item) => item.name === name))
    .filter(Boolean)
    .map((item) => ({ ...item, id: uid("exercise") }));

  const program = {
    id: uid("program"),
    name: `${goal} personnalisé`,
    description: "Séance générée automatiquement, entièrement modifiable.",
    goal,
    level: "Intermédiaire",
    days: "",
    favorite: false,
    color: "#16c7b7",
    exercises,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await putItem("programs", program);
  return program;
}

export async function saveSessionHistory({ program, elapsedSeconds, completedExercises, completedSets }) {
  const calc = calculateProgram(program);
  const xp = Math.max(10, Math.round((elapsedSeconds || calc.totalSeconds) / 12) + completedSets * 8);
  const history = {
    id: uid("history"),
    programId: program?.id || null,
    programName: program?.name || "Séance rapide",
    date: new Date().toISOString(),
    duration: elapsedSeconds || calc.totalSeconds,
    completedExercises,
    completedSets,
    xp,
    focus: calc.categories
  };
  await putItem("history", history);
  return history;
}

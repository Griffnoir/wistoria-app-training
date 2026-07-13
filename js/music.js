import { getAll, getPrefs, putItem, savePrefs, deleteItem, uid } from "./storage.js";
import { toast } from "./notifications.js";

const MUSIC_STATE_KEY = "wistoria:musicState";
const MINI_PLAYER_HIDDEN_KEY = "wistoria:miniPlayerHidden";
const SPOTIFY_TOKEN_KEY = "wistoria:spotifyToken";
const SPOTIFY_VERIFIER_KEY = "wistoria:spotifyVerifier";
const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative"
];

const AUTO_CATEGORIES = [
  { name: "Combat", icon: "◇", mood: "Musique énergique pour rounds, garde et explosivité." },
  { name: "Intensité", icon: "🔥", mood: "Ambiance motivante pour séries longues et effort soutenu." },
  { name: "Flexibilité", icon: "☾", mood: "Sons calmes pour respiration, relâchement et grand écart." },
  { name: "Échauffement", icon: "⚡", mood: "Rythme dynamique pour préparer les hanches et les jambes." }
];

let audio;
let tracks = [];
let playlists = [];
let queue = [];
let currentIndex = 0;
let objectUrl = null;
let previousVolume = null;
let resumeAfterWorkoutStart = false;

function readState() {
  try {
    return {
      volume: 0.7,
      shuffle: false,
      repeat: false,
      queueIds: [],
      currentTrackId: null,
      ...JSON.parse(localStorage.getItem(MUSIC_STATE_KEY) || "{}")
    };
  } catch {
    return { volume: 0.7, shuffle: false, repeat: false, queueIds: [], currentTrackId: null };
  }
}

function writeState(next) {
  localStorage.setItem(MUSIC_STATE_KEY, JSON.stringify({ ...readState(), ...next }));
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

function currentTrack() {
  return queue[currentIndex] || null;
}

function isAudioFile(file) {
  return ["audio/mpeg", "audio/wav", "audio/ogg", "audio/x-wav"].includes(file.type) || /\.(mp3|wav|ogg)$/i.test(file.name);
}

function parseFileName(fileName) {
  const clean = fileName.replace(/\.(mp3|wav|ogg)$/i, "");
  const parts = clean.split(" - ");
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  return { artist: "Bibliothèque locale", title: clean };
}

async function refreshMusicData() {
  [tracks, playlists] = await Promise.all([getAll("musicTracks"), getAll("musicPlaylists")]);
  const state = readState();
  const stateQueue = state.queueIds.map((id) => tracks.find((track) => track.id === id)).filter(Boolean);
  queue = stateQueue.length ? stateQueue : tracks;
  currentIndex = Math.max(0, queue.findIndex((track) => track.id === state.currentTrackId));
  if (currentIndex < 0) currentIndex = 0;
}

async function loadTrack(track, autoplay = false) {
  if (!track || !audio) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = track.blob ? URL.createObjectURL(track.blob) : "";
  if (!objectUrl) {
    toast("Cette piste n'a pas de fichier local disponible.");
    return;
  }
  audio.src = objectUrl;
  audio.volume = readState().volume;
  writeState({ currentTrackId: track.id, queueIds: queue.map((item) => item.id) });
  updateMusicUi();
  if (autoplay) {
    try {
      await audio.play();
    } catch {
      toast("Lecture bloquée par le navigateur. Appuie sur Lecture.");
    }
  }
}

function pickNextIndex(direction = 1) {
  const state = readState();
  if (!queue.length) return 0;
  if (state.shuffle && queue.length > 1) {
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * queue.length);
    return next;
  }
  return (currentIndex + direction + queue.length) % queue.length;
}

async function playTrackList(list, startId = null) {
  queue = list.filter(Boolean);
  if (!queue.length) {
    toast("Ajoute d'abord des fichiers audio locaux.");
    return;
  }
  currentIndex = startId ? Math.max(0, queue.findIndex((track) => track.id === startId)) : 0;
  await loadTrack(currentTrack(), true);
}

async function togglePlay() {
  if (!audio) return;
  if (!currentTrack()) {
    await playTrackList(tracks);
    return;
  }
  if (!audio.src) await loadTrack(currentTrack());
  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      toast("Lecture bloquée par le navigateur. Réessaie après une interaction.");
    }
  } else {
    audio.pause();
  }
  updateMusicUi();
}

async function nextTrack(direction = 1) {
  if (!queue.length) return;
  currentIndex = pickNextIndex(direction);
  await loadTrack(currentTrack(), true);
}

function updateMusicUi() {
  const track = currentTrack();
  const title = track?.title || "Aucune piste";
  const artist = track?.artist || "Ma bibliothèque locale";
  const playLabel = audio && !audio.paused ? "⏸" : "▶";
  const duration = audio?.duration || track?.duration || 0;
  const current = audio?.currentTime || 0;
  const progress = duration ? (current / duration) * 100 : 0;
  const state = readState();

  document.querySelectorAll("[data-music-title]").forEach((node) => { node.textContent = title; });
  document.querySelectorAll("[data-music-artist]").forEach((node) => { node.textContent = artist; });
  document.querySelectorAll("[data-music-play]").forEach((node) => { node.textContent = playLabel; });

  const pageTitle = document.getElementById("musicTitle");
  const pageArtist = document.getElementById("musicArtist");
  const pagePlay = document.getElementById("musicPlay");
  const pageSeek = document.getElementById("musicSeek");
  const pageCurrent = document.getElementById("musicCurrent");
  const pageDuration = document.getElementById("musicDuration");
  const pageVolume = document.getElementById("musicVolume");
  const pageShuffle = document.getElementById("musicShuffle");
  const pageRepeat = document.getElementById("musicRepeat");

  if (pageTitle) pageTitle.textContent = title;
  if (pageArtist) pageArtist.textContent = artist;
  if (pagePlay) pagePlay.textContent = playLabel;
  if (pageSeek) pageSeek.value = String(progress);
  if (pageCurrent) pageCurrent.textContent = formatTime(current);
  if (pageDuration) pageDuration.textContent = formatTime(duration);
  if (pageVolume) pageVolume.value = String(state.volume);
  pageShuffle?.classList.toggle("primary", state.shuffle);
  pageRepeat?.classList.toggle("primary", state.repeat);
}

function exposeMusicApi() {
  window.wistoriaMusicPlayer = {
    play: togglePlay,
    next: () => nextTrack(1),
    previous: () => nextTrack(-1),
    state: () => ({
      isPlaying: Boolean(audio && !audio.paused),
      currentTime: audio?.currentTime || 0,
      duration: audio?.duration || 0,
      track: currentTrack()?.title || null,
      queueLength: queue.length
    })
  };
}

function isMiniPlayerHidden() {
  return localStorage.getItem(MINI_PLAYER_HIDDEN_KEY) === "true";
}

function applyMiniPlayerMode() {
  const hidden = isMiniPlayerHidden();
  const player = document.querySelector(".music-mini-player");
  const launcher = document.querySelector(".music-song-fab");
  const toggle = document.querySelector("[data-music-toggle-mini]");

  document.body.classList.toggle("music-mini-hidden", hidden);
  player?.classList.toggle("is-hidden", hidden);
  if (launcher) launcher.hidden = !hidden;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!hidden));
    toggle.setAttribute("aria-label", hidden ? "Afficher le lecteur audio" : "Masquer le lecteur audio");
  }
}

function toggleMiniPlayerMode() {
  localStorage.setItem(MINI_PLAYER_HIDDEN_KEY, String(!isMiniPlayerHidden()));
  applyMiniPlayerMode();
}

function renderMiniPlayer() {
  if (document.querySelector(".music-mini-player")) return;
  document.body.classList.add("has-music-player");
  const player = document.createElement("section");
  player.className = "music-mini-player";
  player.setAttribute("aria-label", "Mini lecteur audio");
  player.innerHTML = `
    <div class="mini-cover">♪</div>
    <div class="mini-meta">
      <strong data-music-title>Musique prête</strong>
      <span data-music-artist>Importe ou lance une playlist</span>
    </div>
    <div class="music-controls">
      <button class="btn icon-btn" data-music-action="prev" aria-label="Précédent">‹</button>
      <button class="btn primary icon-btn" data-music-action="play" data-music-play aria-label="Lecture ou pause">▶</button>
      <button class="btn icon-btn" data-music-action="next" aria-label="Suivant">›</button>
      <button class="btn icon-btn" data-open-music-panel aria-label="Ouvrir le lecteur">▣</button>
      <button class="btn icon-btn mini-toggle" data-music-toggle-mini aria-expanded="true" aria-label="Masquer le lecteur audio">⌄</button>
    </div>`;
  const launcher = document.createElement("button");
  launcher.className = "btn primary icon-btn music-song-fab";
  launcher.type = "button";
  launcher.hidden = true;
  launcher.setAttribute("data-music-toggle-mini", "");
  launcher.setAttribute("aria-label", "Afficher le lecteur audio");
  launcher.textContent = "♪";
  document.body.append(player, launcher);
  applyMiniPlayerMode();
}

function openMusicOverlay() {
  if (document.querySelector(".music-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "music-overlay";
  overlay.innerHTML = `
    <section class="panel music-hero-player">
      <div class="section-head">
        <div class="track-meta">
          <h2 data-music-title>Musique</h2>
          <p data-music-artist>Ambiance d'entraînement</p>
        </div>
        <button class="btn icon-btn" data-close-music-panel aria-label="Fermer">×</button>
      </div>
      <div class="album-cover"><span>♪</span></div>
      <div class="music-controls">
        <button class="btn icon-btn" data-music-action="shuffle">⤨</button>
        <button class="btn icon-btn" data-music-action="prev">‹</button>
        <button class="btn primary icon-btn" data-music-action="play" data-music-play>▶</button>
        <button class="btn icon-btn" data-music-action="next">›</button>
        <button class="btn icon-btn" data-music-action="repeat">↻</button>
        <a class="btn" href="music.html">Bibliothèque</a>
      </div>
    </section>`;
  document.body.append(overlay);
  updateMusicUi();
}

function renderTrackList() {
  const list = document.getElementById("trackList");
  if (!list) return;
  const query = (document.getElementById("musicSearch")?.value || "").toLowerCase();
  const filtered = tracks.filter((track) =>
    [track.title, track.artist, track.category].join(" ").toLowerCase().includes(query)
  );
  list.innerHTML = filtered.length
    ? filtered.map((track) => `
      <article class="track-item">
        <input type="checkbox" data-track-check="${track.id}" aria-label="Sélectionner ${track.title}">
        <div>
          <strong>${track.title}</strong>
          <span>${track.artist} · ${track.category} · ${track.type || "audio"}</span>
        </div>
        <div class="toolbar">
          <button class="btn" data-play-track="${track.id}">Lire</button>
          <button class="btn warning" data-delete-track="${track.id}">Supprimer</button>
        </div>
      </article>`).join("")
    : `<div class="empty-state">Importe des fichiers MP3, WAV ou OGG pour créer ta bibliothèque locale.</div>`;
}

function renderAutoPlaylists() {
  const node = document.getElementById("autoPlaylists");
  if (!node) return;
  node.innerHTML = AUTO_CATEGORIES.map((category) => {
    const count = tracks.filter((track) => track.category === category.name).length;
    return `
      <article class="playlist-card">
        <div>
          <span class="nav-icon">${category.icon}</span>
          <h3>${category.name}</h3>
          <p>${category.mood}</p>
        </div>
        <button class="btn" data-play-category="${category.name}">${count || "Tout"} piste${count > 1 ? "s" : ""}</button>
      </article>`;
  }).join("");
}

async function handleImport(files) {
  const category = document.getElementById("playlistCategory")?.value || "Flexibilité";
  const accepted = [...files].filter(isAudioFile);
  if (!accepted.length) {
    toast("Formats acceptés : MP3, WAV, OGG.");
    return;
  }
  for (const file of accepted) {
    const meta = parseFileName(file.name);
    await putItem("musicTracks", {
      id: uid("track"),
      title: meta.title,
      artist: meta.artist,
      album: "Ma bibliothèque locale",
      category,
      type: file.type || "audio",
      size: file.size,
      blob: file,
      createdAt: new Date().toISOString()
    });
  }
  await refreshMusicData();
  renderTrackList();
  renderAutoPlaylists();
  updateMusicUi();
  toast(`${accepted.length} piste(s) importée(s).`);
}

async function createPlaylistFromSelection() {
  const selectedIds = [...document.querySelectorAll("[data-track-check]:checked")].map((node) => node.dataset.trackCheck);
  if (!selectedIds.length) {
    toast("Sélectionne au moins une piste.");
    return;
  }
  const name = prompt("Nom de la playlist ?", "Playlist Wistoria");
  if (!name) return;
  await putItem("musicPlaylists", {
    id: uid("playlist"),
    name,
    category: document.getElementById("playlistCategory")?.value || "Flexibilité",
    trackIds: selectedIds,
    createdAt: new Date().toISOString()
  });
  playlists = await getAll("musicPlaylists");
  toast("Playlist créée.");
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", data);
}

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function spotifyConnect() {
  const clientId = document.getElementById("spotifyClientId")?.value.trim() || getPrefs().spotifyClientId;
  if (!clientId) {
    toast("Ajoute d'abord ton Client ID Spotify.");
    return;
  }
  savePrefs({ spotifyClientId: clientId });
  if (location.protocol === "file:") {
    toast("Spotify OAuth demande une URL web. Ouvre l'app via http://127.0.0.1:4173/music.html.");
    return;
  }
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = base64Url(await sha256(verifier));
  sessionStorage.setItem(SPOTIFY_VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SPOTIFY_SCOPES.join(" "),
    redirect_uri: `${location.origin}${location.pathname}`,
    code_challenge_method: "S256",
    code_challenge: challenge
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return;
  const prefs = getPrefs();
  const verifier = sessionStorage.getItem(SPOTIFY_VERIFIER_KEY);
  if (!prefs.spotifyClientId || !verifier) return;
  const body = new URLSearchParams({
    client_id: prefs.spotifyClientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${location.origin}${location.pathname}`,
    code_verifier: verifier
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    toast("Connexion Spotify refusée.");
    return;
  }
  const token = await response.json();
  localStorage.setItem(SPOTIFY_TOKEN_KEY, JSON.stringify({
    ...token,
    expiresAt: Date.now() + token.expires_in * 1000
  }));
  history.replaceState({}, "", location.pathname);
  toast("Spotify connecté.");
}

function spotifyToken() {
  try {
    const token = JSON.parse(localStorage.getItem(SPOTIFY_TOKEN_KEY) || "{}");
    if (!token.access_token || Date.now() > token.expiresAt) return null;
    return token.access_token;
  } catch {
    return null;
  }
}

async function spotifyApi(path, options = {}) {
  const token = spotifyToken();
  if (!token) {
    toast("Connecte Spotify d'abord.");
    return null;
  }
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return {};
  if (!response.ok) {
    toast("Spotify n'a pas accepté cette action.");
    return null;
  }
  return response.json();
}

async function renderSpotifyPlaylists() {
  const list = document.getElementById("spotifyList");
  if (!list) return;
  const data = await spotifyApi("/me/playlists?limit=8");
  if (!data?.items) return;
  list.innerHTML = data.items.map((playlist) => `
    <div class="plan-item">
      <strong>${playlist.name}</strong>
      <p>${playlist.tracks.total} titres · Spotify</p>
      <div class="toolbar">
        <a class="btn" href="${playlist.external_urls.spotify}" target="_blank" rel="noreferrer">Ouvrir</a>
        <button class="btn" data-spotify-uri="${playlist.uri}">Lire via Connect</button>
      </div>
    </div>`).join("");
}

async function spotifyPlayback(action, uri = null) {
  if (action === "play") {
    await spotifyApi("/me/player/play", {
      method: "PUT",
      body: uri ? JSON.stringify({ context_uri: uri }) : "{}"
    });
  }
  if (action === "pause") await spotifyApi("/me/player/pause", { method: "PUT" });
  if (action === "next") await spotifyApi("/me/player/next", { method: "POST" });
  if (action === "previous") await spotifyApi("/me/player/previous", { method: "POST" });
}

function loadSpotifySdk() {
  if (!spotifyToken()) {
    toast("Connecte Spotify avant Spotify Connect.");
    return;
  }
  if (window.Spotify) {
    toast("Spotify Connect est déjà chargé.");
    return;
  }
  const script = document.createElement("script");
  script.src = "https://sdk.scdn.co/spotify-player.js";
  document.head.append(script);
  window.onSpotifyWebPlaybackSDKReady = () => {
    const player = new Spotify.Player({
      name: "Wistoria App Training",
      getOAuthToken: (cb) => cb(spotifyToken()),
      volume: readState().volume
    });
    player.addListener("ready", ({ device_id }) => toast(`Spotify Connect prêt : ${device_id.slice(0, 6)}...`));
    player.addListener("not_ready", () => toast("Spotify Connect indisponible."));
    player.connect();
  };
}

function attachMusicEvents() {
  document.addEventListener("click", async (event) => {
    const action = event.target.dataset.musicAction;
    if (action === "play") await togglePlay();
    if (action === "prev") await nextTrack(-1);
    if (action === "next") await nextTrack(1);
    if (action === "shuffle") {
      writeState({ shuffle: !readState().shuffle });
      updateMusicUi();
    }
    if (action === "repeat") {
      writeState({ repeat: !readState().repeat });
      updateMusicUi();
    }
    if (event.target.matches("[data-open-music-panel]")) openMusicOverlay();
    if (event.target.matches("[data-close-music-panel]")) event.target.closest(".music-overlay")?.remove();
    if (event.target.closest("[data-music-toggle-mini]")) toggleMiniPlayerMode();
  });

  window.addEventListener("wistoria:speech-start", () => {
    if (!audio || audio.paused || !getPrefs().musicDucking) return;
    previousVolume = audio.volume;
    audio.volume = Math.max(0.08, previousVolume * 0.32);
  });
  window.addEventListener("wistoria:speech-end", () => {
    if (audio && previousVolume !== null) audio.volume = previousVolume;
    previousVolume = null;
  });
  window.addEventListener("wistoria:workout-stop", () => {
    if (!audio || audio.paused || !getPrefs().musicPauseOnStop) return;
    resumeAfterWorkoutStart = true;
    audio.pause();
  });
  window.addEventListener("wistoria:workout-start", async () => {
    if (resumeAfterWorkoutStart && audio?.src) {
      resumeAfterWorkoutStart = false;
      await audio.play().catch(() => {});
    }
  });
}

export async function initMusicGlobal() {
  audio = audio || new Audio();
  audio.preload = "metadata";
  audio.volume = readState().volume;
  audio.addEventListener("timeupdate", updateMusicUi);
  audio.addEventListener("loadedmetadata", updateMusicUi);
  audio.addEventListener("play", updateMusicUi);
  audio.addEventListener("pause", updateMusicUi);
  audio.addEventListener("ended", async () => {
    if (readState().repeat) {
      audio.currentTime = 0;
      await audio.play();
    } else {
      await nextTrack(1);
    }
  });
  renderMiniPlayer();
  attachMusicEvents();
  exposeMusicApi();
  await refreshMusicData();
  if (currentTrack()) await loadTrack(currentTrack(), false);
  updateMusicUi();
}

export async function initMusicPage() {
  await handleSpotifyCallback();
  await refreshMusicData();
  const prefs = getPrefs();
  const spotifyInput = document.getElementById("spotifyClientId");
  const boomplayInput = document.getElementById("boomplayWorkoutUrl");
  if (spotifyInput) spotifyInput.value = prefs.spotifyClientId || "";
  if (boomplayInput) boomplayInput.value = prefs.boomplayWorkoutUrl || "https://www.boomplay.com/";

  renderTrackList();
  renderAutoPlaylists();
  updateMusicUi();

  document.getElementById("musicImport")?.addEventListener("change", (event) => handleImport(event.target.files || []));
  document.getElementById("musicSearch")?.addEventListener("input", renderTrackList);
  document.getElementById("createPlaylistBtn")?.addEventListener("click", createPlaylistFromSelection);
  document.getElementById("musicPlay")?.addEventListener("click", togglePlay);
  document.getElementById("musicPrev")?.addEventListener("click", () => nextTrack(-1));
  document.getElementById("musicNext")?.addEventListener("click", () => nextTrack(1));
  document.getElementById("musicShuffle")?.addEventListener("click", () => {
    writeState({ shuffle: !readState().shuffle });
    updateMusicUi();
  });
  document.getElementById("musicRepeat")?.addEventListener("click", () => {
    writeState({ repeat: !readState().repeat });
    updateMusicUi();
  });
  document.getElementById("musicVolume")?.addEventListener("input", (event) => {
    const volume = Number(event.target.value);
    writeState({ volume });
    if (audio) audio.volume = volume;
  });
  document.getElementById("musicSeek")?.addEventListener("input", (event) => {
    if (!audio?.duration) return;
    audio.currentTime = (Number(event.target.value) / 100) * audio.duration;
  });

  document.addEventListener("click", async (event) => {
    const playId = event.target.dataset.playTrack;
    const deleteId = event.target.dataset.deleteTrack;
    const category = event.target.dataset.playCategory;
    const spotifyUri = event.target.dataset.spotifyUri;
    if (playId) await playTrackList(tracks, playId);
    if (deleteId && confirm("Supprimer cette piste locale ?")) {
      await deleteItem("musicTracks", deleteId);
      await refreshMusicData();
      renderTrackList();
      renderAutoPlaylists();
      updateMusicUi();
    }
    if (category) {
      const list = tracks.filter((track) => track.category === category);
      await playTrackList(list.length ? list : tracks);
    }
    if (spotifyUri) await spotifyPlayback("play", spotifyUri);
  });

  document.getElementById("spotifyConnect")?.addEventListener("click", spotifyConnect);
  document.getElementById("spotifyPlaylists")?.addEventListener("click", renderSpotifyPlaylists);
  document.getElementById("spotifyDevice")?.addEventListener("click", loadSpotifySdk);
  document.getElementById("spotifyPrev")?.addEventListener("click", () => spotifyPlayback("previous"));
  document.getElementById("spotifyToggle")?.addEventListener("click", async () => {
    const state = await spotifyApi("/me/player");
    await spotifyPlayback(state?.is_playing ? "pause" : "play");
  });
  document.getElementById("spotifyNext")?.addEventListener("click", () => spotifyPlayback("next"));
  document.getElementById("saveBoomplay")?.addEventListener("click", () => {
    savePrefs({ boomplayWorkoutUrl: document.getElementById("boomplayWorkoutUrl").value.trim() || "https://www.boomplay.com/" });
    toast("Lien Boomplay enregistré.");
  });
  document.getElementById("openBoomplay")?.addEventListener("click", () => {
    const url = document.getElementById("boomplayWorkoutUrl").value.trim() || getPrefs().boomplayWorkoutUrl;
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

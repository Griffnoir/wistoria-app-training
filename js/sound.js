import { getPrefs } from "./storage.js";

let audioContext;

function getAudioContext() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioContext = new Ctx();
  }
  return audioContext;
}

export function beep(frequency = 720, duration = 0.13) {
  const prefs = getPrefs();
  if (Number(prefs.soundVolume) <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.value = Number(prefs.soundVolume) * 0.18;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  oscillator.stop(ctx.currentTime + duration);
}

export function vibrate(pattern = [80]) {
  if (getPrefs().vibrationEnabled && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export function speak(text) {
  const prefs = getPrefs();
  if (!prefs.voiceEnabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 1;
  utterance.pitch = 1.04;
  utterance.volume = Math.max(0, Math.min(1, Number(prefs.soundVolume) || 0.6));
  utterance.onstart = () => window.dispatchEvent(new CustomEvent("wistoria:speech-start"));
  utterance.onend = () => window.dispatchEvent(new CustomEvent("wistoria:speech-end"));
  utterance.onerror = () => window.dispatchEvent(new CustomEvent("wistoria:speech-end"));
  window.speechSynthesis.speak(utterance);
}

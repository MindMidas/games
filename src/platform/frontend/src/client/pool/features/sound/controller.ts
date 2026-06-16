export type PoolSoundId = "ball_hit" | "rail_hit" | "pocket" | "endgame" | "new_message" | "draw_offer";

const ENDGAME_AUDIO = new Audio(new URL("./end.mp3", import.meta.url).href);
const NOTIFY_HREF = new URL("./notify.mp3", import.meta.url).href;
const DRAW_OFFER_HREF = new URL("./ds.mp3", import.meta.url).href;

function playOneShotHref(href: string, volume = 1): void {
  if (!href) {
    return;
  }
  try {
    const el = new Audio(href);
    el.volume = volume;
    void el.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function playAudioFile(audio: HTMLAudioElement, volume = 1): void {
  if (!audio) {
    return;
  }
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

let audioCtx: AudioContext | null = null;
let webAudioUnlocked = false;
let removeWebAudioUnlockListeners: (() => void) | null = null;

function canUnlockWebAudio(event: Event): boolean {
  if (!event.isTrusted) {
    return false;
  }
  return !navigator.userActivation || navigator.userActivation.isActive;
}

function clearWebAudioUnlockListeners(): void {
  removeWebAudioUnlockListeners?.();
  removeWebAudioUnlockListeners = null;
}

function getContext(): AudioContext | null {
  if (!webAudioUnlocked) {
    return null;
  }
  if (!audioCtx) {
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    audioCtx = new AudioContextCtor();
  }
  return audioCtx;
}

function unlockWebAudioFromGesture(event: Event): void {
  if (!canUnlockWebAudio(event)) {
    return;
  }
  webAudioUnlocked = true;
  const ctx = getContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === "running") {
    clearWebAudioUnlockListeners();
    return;
  }
  if (ctx.state !== "suspended") {
    return;
  }
  void ctx.resume()
    .then(() => {
      if (ctx.state === "running") {
        clearWebAudioUnlockListeners();
      }
    })
    .catch(() => {});
}

function playBallHit(intensity = 0.55): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== "running") {
    return;
  }
  const t = ctx.currentTime;
  const gain = 0.12 + intensity * 0.38;
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);

  const ping = ctx.createOscillator();
  ping.type = "sine";
  const f0 = 920 + intensity * 480;
  ping.frequency.setValueAtTime(f0, t);
  ping.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + 0.018);
  const pingGain = ctx.createGain();
  pingGain.gain.setValueAtTime(0.55, t);
  pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  ping.connect(pingGain);
  pingGain.connect(master);
  ping.start(t);
  ping.stop(t + 0.05);

  const n = Math.floor(ctx.sampleRate * 0.012);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.16));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bpf = ctx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.value = 1800 + intensity * 900;
  bpf.Q.value = 0.85;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.34, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
  src.connect(bpf);
  bpf.connect(noiseGain);
  noiseGain.connect(master);
  src.start(t);
}

function playRailHit(intensity = 0.55): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== "running") {
    return;
  }
  const t = ctx.currentTime;
  const gain = 0.035 + intensity * 0.09;
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);

  const thud = ctx.createOscillator();
  thud.type = "triangle";
  const f0 = 320 + intensity * 140;
  thud.frequency.setValueAtTime(f0, t);
  thud.frequency.exponentialRampToValueAtTime(140, t + 0.028);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.38, t);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  thud.connect(thudGain);
  thudGain.connect(master);
  thud.start(t);
  thud.stop(t + 0.045);

  const n = Math.floor(ctx.sampleRate * 0.01);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.28));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 650 + intensity * 200;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.1, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
  src.connect(lpf);
  lpf.connect(noiseGain);
  noiseGain.connect(master);
  src.start(t);
}

function playPocket(intensity = 0.55): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== "running") {
    return;
  }
  const t = ctx.currentTime;
  const gain = 0.14 + intensity * 0.36;
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);

  const rumble = ctx.createOscillator();
  rumble.type = "sine";
  rumble.frequency.setValueAtTime(95, t);
  rumble.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.7, t);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  rumble.connect(rumbleGain);
  rumbleGain.connect(master);
  rumble.start(t);
  rumble.stop(t + 0.15);

  const n = Math.floor(ctx.sampleRate * 0.035);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.3));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 520;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.28, t + 0.008);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(lpf);
  lpf.connect(noiseGain);
  noiseGain.connect(master);
  src.start(t + 0.008);
}

const SOUND_MAP: Record<PoolSoundId, (intensity?: number) => void> = {
  ball_hit: playBallHit,
  rail_hit: playRailHit,
  pocket: playPocket,
  endgame: () => playAudioFile(ENDGAME_AUDIO, 0.1),
  new_message: () => playOneShotHref(NOTIFY_HREF, 1),
  draw_offer: () => playOneShotHref(DRAW_OFFER_HREF, 1),
};

if (typeof window !== "undefined") {
  let unlockHookInstalled = false;
  const unlockOptions: AddEventListenerOptions = { capture: true, passive: true };
  const installWebAudioUnlock = () => {
    if (unlockHookInstalled) return;
    unlockHookInstalled = true;
    window.addEventListener("pointerdown", unlockWebAudioFromGesture, unlockOptions);
    window.addEventListener("keydown", unlockWebAudioFromGesture, unlockOptions);
    removeWebAudioUnlockListeners = () => {
      window.removeEventListener("pointerdown", unlockWebAudioFromGesture, unlockOptions);
      window.removeEventListener("keydown", unlockWebAudioFromGesture, unlockOptions);
    };
  };
  installWebAudioUnlock();
}

export function playGameSound(id: PoolSoundId, intensity = 0.55): void {
  const play = SOUND_MAP[id];
  if (!play) {
    return;
  }
  try {
    if (id === "ball_hit" || id === "rail_hit" || id === "pocket") {
      const clamped = Math.min(1, Math.max(0, Number(intensity) || 0));
      play(clamped);
    } else {
      play();
    }
  } catch (err) {
    console.warn("Pool sound error:", err);
  }
}

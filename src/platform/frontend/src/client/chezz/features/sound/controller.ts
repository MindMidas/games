const SOUND_FILES = {
  move: new Audio(new URL("./move.mp3", import.meta.url).href),
  land: new Audio(new URL("./move.mp3", import.meta.url).href),
  capture: new Audio(new URL("./capture.mp3", import.meta.url).href),
  notify: new Audio(new URL("./notify.mp3", import.meta.url).href),
  fling: new Audio(new URL("./fling.mp3", import.meta.url).href),
  canon: new Audio(new URL("./canon.mp3", import.meta.url).href),
  zombie: new Audio(new URL("./zombie.mp3", import.meta.url).href),
  end: new Audio(new URL("./end.mp3", import.meta.url).href),
  ds: new Audio(new URL("./ds.mp3", import.meta.url).href),
};

/** Fresh element per play - avoids shared-node races and survives animation starting after HTTP (gesture may be gone). */
const ONESHOT_HREF = {
  fling: new URL("./fling.mp3", import.meta.url).href,
  canon: new URL("./canon.mp3", import.meta.url).href,
};

type GameSoundId = keyof typeof SOUND_MAP;

interface WebKitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function playOneShotHref(href: string, volume = 1): void {
  if (!href) return;
  try {
    const el = new Audio(href);
    el.volume = volume;
    void el.play().catch(() => {});
  } catch {}
}

function playAudioFile(audio: HTMLAudioElement | null | undefined, volume = 1): void {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch {}
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
    const AudioContextCtor = window.AudioContext || (window as WebKitAudioWindow).webkitAudioContext;
    if (!AudioContextCtor) return null;
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

function playIllegalChessComStyle(): void {
  try {
    const ctx = getContext();
    if (!ctx || ctx.state !== "running") return;
    const run = () => {
      const t = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(155, t);
      osc.frequency.exponentialRampToValueAtTime(52, t + 0.1);
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.5, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g1);
      g1.connect(master);
      osc.start(t);
      osc.stop(t + 0.13);

      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(420, t);
      osc2.frequency.exponentialRampToValueAtTime(95, t + 0.038);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.14, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.048);
      osc2.connect(g2);
      g2.connect(master);
      osc2.start(t);
      osc2.stop(t + 0.055);

      const n = Math.floor(ctx.sampleRate * 0.028);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i += 1) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.22));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bpf = ctx.createBiquadFilter();
      bpf.type = "bandpass";
      bpf.frequency.value = 2400;
      bpf.Q.value = 0.65;
      const g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.1, t);
      g3.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
      src.connect(bpf);
      bpf.connect(g3);
      g3.connect(master);
      src.start(t);
    };
    run();
  } catch {}
}

const NOTIFY_HREF = new URL("./notify.mp3", import.meta.url).href;
const DRAW_OFFER_HREF = new URL("./ds.mp3", import.meta.url).href;

const SOUND_MAP = {
  illegal: () => playIllegalChessComStyle(),

  move: () => playAudioFile(SOUND_FILES.move, 1),
  land: () => playAudioFile(SOUND_FILES.land, 0.72),
  capture: () => playAudioFile(SOUND_FILES.capture, 1),
  shoot: () => playOneShotHref(ONESHOT_HREF.canon, 0.68),
  fling: () => playOneShotHref(ONESHOT_HREF.fling, 0.9),
  zombie: () => playAudioFile(SOUND_FILES.zombie, 0.5),
  promotion: () => playAudioFile(SOUND_FILES.zombie, 0.5),
  endgame: () => playAudioFile(SOUND_FILES.end, 0.1),
  draw_offer: () => playOneShotHref(DRAW_OFFER_HREF, 1),
  new_message: () => playOneShotHref(NOTIFY_HREF, 1),
};

if (typeof window !== "undefined") {
  let unlockHookInstalled = false;
  const unlockOptions: AddEventListenerOptions = { capture: true, passive: true };
  const installWebAudioUnlock = (): void => {
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

export function playGameSound(id: string): void {
  if (!(id in SOUND_MAP)) return;
  const soundId = id as GameSoundId;
  const play = SOUND_MAP[soundId];
  if (!play) return;
  try {
    play();
  } catch (err) {
    console.warn("Sound error:", err);
  }
}

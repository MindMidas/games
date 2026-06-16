import { animateCueStrikeFromTrajectory } from "../../game/cueStickOverlay.js";
import type { PoolState, PoolTrajectory } from "../../game/contracts.js";
import { clearGlobalCueOverlay, playTrajectory } from "../../game/trajectory.js";

interface ShotPayload extends Partial<PoolState> {
  seq?: number;
  last_shot_seq?: number;
  next_state?: Partial<PoolState>;
  trajectory?: PoolTrajectory | null;
}

interface NormalizedShot {
  seq: number;
  trajectory?: PoolTrajectory | null;
  next_state?: Partial<PoolState>;
}

interface ShotPipelineHandlers {
  applyState?: (nextState: Partial<PoolState>) => void;
  syncShell?: () => void;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

function shotSeq(raw: ShotPayload | null | undefined): number {
  return Number(raw?.seq ?? raw?.last_shot_seq ?? raw?.stream_seq ?? raw?.next_state?.stream_seq);
}

/** Normalize HTTP and SSE shot payloads into one playback shape. */
function normalizeShot(raw: ShotPayload): NormalizedShot {
  const seq = shotSeq(raw);
  let next_state = raw.next_state;
  if ((!next_state || typeof next_state !== "object") && raw.table) {
    next_state = {
      ok: raw.ok !== false,
      game_id: raw.game_id,
      table: raw.table,
      can_place_cue: raw.can_place_cue,
      can_fire_shot: raw.can_fire_shot,
      stream_seq: Number.isFinite(seq) ? seq : raw.stream_seq,
      status: raw.status,
      mode: raw.mode,
      clock_a_ms: raw.clock_a_ms,
      clock_b_ms: raw.clock_b_ms,
      clock_active_color: raw.clock_active_color,
      clock_anchor_iso: raw.clock_anchor_iso,
    };
  }
  return { seq, trajectory: raw.trajectory, next_state };
}

/** Keep cue strike and table trajectory playback ordered as one visual operation. */
export async function playShotVisuals(trajectory: PoolTrajectory | null | undefined): Promise<void> {
  if (!trajectory?.samples?.length) return;
  let trajectoryPromise: Promise<void> | null = null;
  await animateCueStrikeFromTrajectory(trajectory, {
    durationMs: 165,
    fadeMs: 220,
    waitMs: 700,
    onHit: () => {
      if (!trajectoryPromise) trajectoryPromise = playTrajectory(trajectory);
    },
  });
  if (trajectoryPromise) {
    await trajectoryPromise;
  } else {
    await playTrajectory(trajectory);
  }
}

/** Serialize remote shots so state applies only after each visual playback completes. */
export function createPoolShotPipeline(handlers: ShotPipelineHandlers = {}) {
  let lastSeq = -1;
  let chain = Promise.resolve();
  let playing = false;

  function reset(fromSeq = -1): void {
    lastSeq = Number.isFinite(fromSeq) && fromSeq >= 0 ? fromSeq : -1;
    chain = Promise.resolve();
    playing = false;
  }

  function schedule(raw: ShotPayload): Promise<void> {
    const shot = normalizeShot(raw);
    const hasState = shot.next_state && typeof shot.next_state === "object";
    const hasTrajectory = Boolean(shot.trajectory?.samples?.length);
    if (!hasState && !hasTrajectory) return chain;

    if (Number.isFinite(shot.seq)) {
      if (shot.seq <= lastSeq) return chain;
      lastSeq = shot.seq;
    }

    chain = chain.then(async () => {
      playing = true;
      try {
        handlers.onPlaybackStart?.();
        clearGlobalCueOverlay();
        await playShotVisuals(shot.trajectory);
        clearGlobalCueOverlay();
        if (hasState && shot.next_state && typeof handlers.applyState === "function") {
          handlers.applyState(shot.next_state);
          handlers.syncShell?.();
        }
      } catch (error) {
        console.error("[pool] shot pipeline", error);
      } finally {
        playing = false;
        handlers.onPlaybackEnd?.();
      }
    });
    return chain;
  }

  return {
    schedule,
    reset,
    whenIdle: (): Promise<void> => chain,
    getLastSeq: (): number => lastSeq,
    isPlaying: (): boolean => playing,
  };
}

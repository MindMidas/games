import type { PoolReplayEntry, PoolTable } from "./contracts.js";

const SHOT_LABELS = new Set(["Shot", "Break"]);
const PLACE_CUE_LABEL = "PlaceCue";

export interface ShotRow {
  entryIndex: number;
  rowIndex0: number;
}

export function isPlaceCueEntry(entry: PoolReplayEntry | null | undefined): boolean {
  return String(entry?.label || "").trim() === PLACE_CUE_LABEL;
}

export function isShotEntry(entry: PoolReplayEntry | null | undefined): boolean {
  return SHOT_LABELS.has(String(entry?.label || "").trim());
}

export function shotRows(entries: PoolReplayEntry[] | null | undefined): ShotRow[] {
  const rows: ShotRow[] = [];
  for (let index = 1; index < (entries?.length || 0); index += 1) {
    if (isShotEntry(entries?.[index])) rows.push({ entryIndex: index, rowIndex0: rows.length });
  }
  return rows;
}

export function shotRowCount(entries: PoolReplayEntry[] | null | undefined): number {
  return shotRows(entries).length;
}

export function prevShotEntryIndex(entries: PoolReplayEntry[], fromIndex: number): number | null {
  for (let index = Math.min(Math.max(0, fromIndex), entries.length - 1) - 1; index >= 0; index -= 1) {
    if (isShotEntry(entries[index])) return index;
  }
  return null;
}

export function nextShotEntryIndex(entries: PoolReplayEntry[], fromIndex: number, liveIndex: number): number | null {
  const end = Math.min(Math.max(0, liveIndex), entries.length - 1);
  for (let index = Math.min(Math.max(0, fromIndex), end) + 1; index <= end; index += 1) {
    if (isShotEntry(entries[index])) return index;
  }
  return null;
}

export function entryIndexForShotRow(entries: PoolReplayEntry[], rowIndex: number): number | null {
  return shotRows(entries)[rowIndex]?.entryIndex ?? null;
}

export function lastShotBeforeIndex(entries: PoolReplayEntry[], fromIndex: number): number | null {
  return prevShotEntryIndex(entries, fromIndex);
}

/** Resolve the frame shown immediately before replaying a shot. */
export function shotAnimationStartIndex(entries: PoolReplayEntry[], shotEntryIndex: number): number {
  const index = Math.max(0, Number(shotEntryIndex) || 0);
  if (!entries.length || index === 0) return 0;
  for (let prior = index - 1; prior >= 0; prior -= 1) {
    if (isPlaceCueEntry(entries[prior]) || isShotEntry(entries[prior])) return prior;
  }
  return Math.max(0, index - 1);
}

export function shotStartEntryIndex(entries: PoolReplayEntry[], shotEntryIndex: number): number {
  return shotAnimationStartIndex(entries, shotEntryIndex);
}

/** Patch pre-shot cue placement only when persistence omitted an intermediate PlaceCue row. */
export function needsTrajectoryPreShotPatch(entries: PoolReplayEntry[], shotEntryIndex: number): boolean {
  const index = Math.max(0, Number(shotEntryIndex) || 0);
  const priorIndex = shotAnimationStartIndex(entries, index);
  const priorEntry = entries[priorIndex];
  if (!priorEntry || isPlaceCueEntry(priorEntry) || priorIndex === 0 || !isShotEntry(priorEntry)) return false;
  return Boolean(entries[index]?.trajectory?.samples?.[0]?.balls);
}

export function resolvePreShotTable(entries: PoolReplayEntry[], shotEntryIndex: number): PoolTable | null {
  const priorIndex = shotAnimationStartIndex(entries, Math.max(0, Number(shotEntryIndex) || 0));
  const snapshot = entries[priorIndex]?.snapshot;
  if (!snapshot) return null;
  return { ...snapshot, ball_in_hand: false, ball_in_hand_for_player_id: null };
}

export function shotEntryToPlayFrom(entries: PoolReplayEntry[], exploreIndex: number, liveIndex: number): number | null {
  const end = Math.min(Math.max(0, Number(liveIndex) || 0), entries.length - 1);
  const index = Math.min(Math.max(0, exploreIndex), end);
  return isShotEntry(entries[index + 1]) ? index + 1 : nextShotEntryIndex(entries, index, liveIndex);
}

export function activeShotRowIndex(entries: PoolReplayEntry[], exploreIndex: number, liveIndex: number): number {
  const rows = shotRows(entries);
  if (!rows.length) return -1;
  const index = Math.max(0, Number(exploreIndex) || 0);
  if (index >= (Number(liveIndex) || 0)) return rows.length - 1;

  for (const { entryIndex, rowIndex0 } of rows) {
    if (index === entryIndex) return Math.min(rowIndex0 + 1, rows.length - 1);
  }
  for (const { entryIndex, rowIndex0 } of rows) {
    if (index >= shotStartEntryIndex(entries, entryIndex) && index < entryIndex) return rowIndex0;
  }
  return rows[0].rowIndex0;
}

export function canStepBackInReplay(entries: PoolReplayEntry[], exploreIndex: number, liveIndex: number): boolean {
  const row = activeShotRowIndex(entries, exploreIndex, liveIndex);
  if (row > 0) return true;
  const firstShot = row === 0 ? entryIndexForShotRow(entries, 0) : null;
  return firstShot != null && exploreIndex > shotStartEntryIndex(entries, firstShot);
}

export function prevStepExploreTarget(entries: PoolReplayEntry[], exploreIndex: number, liveIndex: number): number | null {
  const row = activeShotRowIndex(entries, exploreIndex, liveIndex);
  const shot = row > 0
    ? entryIndexForShotRow(entries, row - 1)
    : row === 0
      ? entryIndexForShotRow(entries, 0)
      : null;
  if (shot == null) return null;
  const target = shotStartEntryIndex(entries, shot);
  return row > 0 || exploreIndex > target ? target : null;
}

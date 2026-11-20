import { regionObs } from '../domain/observations';
import { signsAt, type SignHit } from '../domain/signs';
import { signsEnd } from '../domain/stopOrGo';
import { state } from '../state';
import type { Region, TerrainPoint } from '../types';

/**
 * Regobs signs in the point's region over the 48 h that count for the chosen
 * day, weighted for the point's height and aspect. null when the region is
 * unknown or the day's observations aren't loaded (still loading, or failed).
 */
export function regionSigns(region: Region | null, terrain: TerrainPoint | null | undefined): SignHit[] | null {
  if (!region || state.obsDate !== state.date) return null;
  const obs = regionObs(state.obs, state.regions, region);
  return signsAt(obs, signsEnd(state.date), { elev: terrain?.elev, sector: terrain?.sector });
}

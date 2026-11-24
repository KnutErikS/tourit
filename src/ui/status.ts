import { $ } from '../util';
import { count } from '../analytics/count';

/** stale = showing a copy stored on the device (no network). */
export type StatusKind = 'ok' | 'busy' | 'err' | 'stale' | '';

/** The status line at the top of the panel. */
export function setStatus(text: string, kind: StatusKind = ''): void {
  $('statustext').textContent = text;
  $('status').className = kind;
}

let demErrors = 0;
/** Report elevation fetch failures, but only the first couple so we don't spam. */
export function reportDemError(e: Error): void {
  count('fail-dem');
  demErrors++;
  if (demErrors < 3) setStatus(`Fikk ikke hentet høydedata fra Kartverket (${e.message}).`, 'err');
}

import { $ } from '../util';

export type StatusKind = 'ok' | 'busy' | 'err' | '';

/** The status line at the top of the panel. */
export function setStatus(text: string, kind: StatusKind = ''): void {
  $('statustext').textContent = text;
  $('status').className = kind;
}

let demErrors = 0;
/** Report elevation fetch failures, but only the first couple so we don't spam. */
export function reportDemError(e: Error): void {
  demErrors++;
  if (demErrors < 3) setStatus(`Fikk ikke hentet høydedata fra Kartverket (${e.message}).`, 'err');
}

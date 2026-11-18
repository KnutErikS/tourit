import * as L from 'leaflet';
import type { DemTile } from '../types';
import { getDem } from './dem';

export type DrawFn = (tile: HTMLCanvasElement, dem: DemTile, coords: L.Coords) => void;

interface Options {
  minZoom: number;
  draw: DrawFn;
  /** Oversampling factor per zoom (see getDem). Default 1. */
  oversample?: (z: number) => number;
  onError?: (e: Error) => void;
}

/** A canvas GridLayer whose tiles are drawn from Kartverket elevation data. */
export function computedLayer({ minZoom, draw, oversample, onError }: Options): L.GridLayer {
  class ComputedLayer extends L.GridLayer {
    createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 256;
      getDem(coords.x, coords.y, coords.z, oversample ? oversample(coords.z) : 1)
        .then((dem) => {
          draw(tile, dem, coords);
          done(undefined, tile);
        })
        .catch((e: Error) => {
          onError?.(e);
          done(undefined, tile);
        });
      return tile;
    }
  }
  return new ComputedLayer({
    minZoom,
    maxNativeZoom: 15,
    maxZoom: 17,
    pane: 'terrain',
    keepBuffer: 1,
    attribution: 'Høydedata © <a href="https://hoydedata.no" target="_blank" rel="noopener">Kartverket</a>',
  });
}

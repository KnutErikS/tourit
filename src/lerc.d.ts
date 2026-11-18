// Minimal types for lerc@2 (Esri's pure-JS LERC decoder, no bundled types).
declare module 'lerc' {
  export interface LercPixelBlock {
    width: number;
    height: number;
    pixels: ArrayLike<number>[];
    mask?: Uint8Array | null;
  }
  const Lerc: {
    decode(input: ArrayBuffer, options?: Record<string, unknown>): LercPixelBlock;
  };
  export default Lerc;
}

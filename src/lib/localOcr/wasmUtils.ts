export function detectWasmSimdSupport(): boolean {
  try {
    // Minimal valid WASM SIMD (v128.const) feature-probe module
    const simdProbe = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00,
      0x0a, 0x16, 0x01, 0x14, 0x00,
      0xfd, 0x0c,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x0b,
    ]);
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(simdProbe);
  } catch {
    return false;
  }
}

export function resolveWasmThreadCount(): number {
  const g = globalThis as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
  const canThread =
    g.crossOriginIsolated === true && typeof g.SharedArrayBuffer === 'function';
  if (!canThread) {
    return 1;
  }
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 2;
  return Math.max(1, Math.min(4, cores));
}

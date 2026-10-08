import { WebGPURenderer } from 'three/webgpu';

export interface RendererOptions {
  forceWebGL: boolean;
  antialias: boolean;
}

/** three.js WebGPURenderer: WebGPU when the browser has it, WebGL2 otherwise (§6.1). */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  opts: RendererOptions,
): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: opts.antialias,
    forceWebGL: opts.forceWebGL,
    powerPreference: 'high-performance',
  });
  await renderer.init();
  renderer.info.autoReset = false;
  return renderer;
}

export function backendName(renderer: WebGPURenderer): string {
  const backend = renderer.backend as { isWebGPUBackend?: boolean };
  return backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
}

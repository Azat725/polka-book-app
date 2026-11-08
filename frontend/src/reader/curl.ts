import { curvePoint } from './geometry';

export interface CurlAnimation {
  finished: Promise<void>;
  cancel(): void;
}

export async function animatePageCurl(
  host: HTMLElement,
  source: HTMLCanvasElement,
  direction: 1 | -1,
  duration: number,
  sourceRect: DOMRect,
): Promise<CurlAnimation> {
  const THREE = await import('three');
  const width = host.clientWidth,
    height = host.clientHeight;
  const hostRect = host.getBoundingClientRect();
  const pageWidth = sourceRect.width,
    pageHeight = sourceRect.height;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'reader-curl-canvas';
  const overlay = document.createElement('div');
  overlay.className = 'reader-curl';
  overlay.append(renderer.domElement);
  host.append(overlay);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    -width / 2,
    width / 2,
    height / 2,
    -height / 2,
    0.1,
    5000,
  );
  camera.position.z = 2000;
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const geometry = new THREE.PlaneGeometry(pageWidth, pageHeight, 40, 1);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const centerX = sourceRect.left - hostRect.left + pageWidth / 2 - width / 2;
  const centerY = height / 2 - (sourceRect.top - hostRect.top + pageHeight / 2);
  mesh.position.set(centerX, centerY, 10);
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 2.3));
  const light = new THREE.DirectionalLight(0xfff5dd, 1.8);
  light.position.set(width, height, 1000);
  scene.add(light);
  const positions = geometry.attributes.position;
  const originals = new Float32Array(positions.array);
  const start = performance.now();
  let frame = 0,
    ended = false;
  let resolveFinished: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  function finish() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    overlay.remove();
    resolveFinished();
  }
  function lost(event: Event) {
    event.preventDefault();
    finish();
  }
  renderer.domElement.addEventListener('webglcontextlost', lost);

  function render(now: number) {
    if (ended) return;
    const linear = Math.min(1, (now - start) / Math.max(100, duration));
    const progress = 1 - Math.pow(1 - linear, 3);
    for (let index = 0; index < positions.count; index++) {
      const originalX = originals[index * 3];
      const normalized =
        direction > 0
          ? (originalX + pageWidth / 2) / pageWidth
          : (pageWidth / 2 - originalX) / pageWidth;
      const [x, z] = curvePoint(normalized, progress);
      positions.setXYZ(
        index,
        direction > 0 ? x * pageWidth - pageWidth / 2 : pageWidth / 2 - x * pageWidth,
        originals[index * 3 + 1],
        z * pageWidth,
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    material.opacity = linear > 0.88 ? (1 - linear) / 0.12 : 1;
    renderer.render(scene, camera);
    if (linear < 1) frame = requestAnimationFrame(render);
    else finish();
  }
  frame = requestAnimationFrame(render);
  return { finished, cancel: finish };
}

export function pageSnapshot(page: HTMLElement): HTMLCanvasElement | null {
  const original = page.querySelector('canvas');
  if (!original || !original.width || !original.height) return null;
  const snapshot = document.createElement('canvas');
  const bounds = page.getBoundingClientRect();
  const ratio = Math.min(1.5, Math.sqrt(3_000_000 / (bounds.width * bounds.height)));
  snapshot.width = Math.ceil(bounds.width * ratio);
  snapshot.height = Math.ceil(bounds.height * ratio);
  const context = snapshot.getContext('2d');
  if (!context) return null;
  context.filter = getComputedStyle(page).filter;
  context.drawImage(original, 0, 0, snapshot.width, snapshot.height);
  context.filter = 'none';
  for (const highlight of page.querySelectorAll<HTMLElement>('.pdf-highlight')) {
    const rect = highlight.getBoundingClientRect();
    context.fillStyle = getComputedStyle(highlight).backgroundColor;
    context.globalAlpha = 0.38;
    context.fillRect(
      (rect.left - bounds.left) * ratio,
      (rect.top - bounds.top) * ratio,
      rect.width * ratio,
      rect.height * ratio,
    );
  }
  context.globalAlpha = 1;
  // Keep CSS dimensions so the effect aligns with the text-layer page exactly.
  snapshot.style.width = `${bounds.width}px`;
  snapshot.style.height = `${bounds.height}px`;
  return snapshot;
}

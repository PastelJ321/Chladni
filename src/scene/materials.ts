import * as THREE from 'three';
import { seededRandom } from '../model/physics';

export function createMaterials() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(512, 512);
  const random = seededRandom(42);
  for (let y = 0; y < 512; y++) {
    const stripe = 124 + random() * 8;
    for (let x = 0; x < 512; x++) {
      const index = (y * 512 + x) * 4;
      image.data[index] = 128;
      image.data[index + 1] = stripe + random() * 3;
      image.data[index + 2] = 252;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const brush = new THREE.CanvasTexture(canvas);
  brush.wrapS = brush.wrapT = THREE.RepeatWrapping;
  brush.repeat.set(2, 3);
  const roughnessCanvas = document.createElement('canvas');
  roughnessCanvas.width = 512;
  roughnessCanvas.height = 512;
  const roughnessContext = roughnessCanvas.getContext('2d')!;
  for (let y = 0; y < 512; y++) {
    const value = Math.floor(142 + random() * 66);
    roughnessContext.fillStyle = `rgb(${value},${value},${value})`;
    roughnessContext.fillRect(0, y, 512, 1);
  }
  const roughness = new THREE.CanvasTexture(roughnessCanvas);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  roughness.repeat.set(2, 2);
  const aluminum = new THREE.MeshPhysicalMaterial({
    color: '#929e9f',
    metalness: 0.96,
    roughness: 0.56,
    roughnessMap: roughness,
    anisotropy: 0.55,
    anisotropyRotation: Math.PI / 2,
    normalMap: brush,
    normalScale: new THREE.Vector2(0.15, 0.15),
  });
  const steel = new THREE.MeshStandardMaterial({
    color: '#b2b8b7',
    metalness: 0.96,
    roughness: 0.24,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: '#272e2c',
    metalness: 0.72,
    roughness: 0.4,
  });
  const black = new THREE.MeshStandardMaterial({
    color: '#1a201e',
    metalness: 0.17,
    roughness: 0.66,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: '#151a18',
    metalness: 0,
    roughness: 0.88,
  });
  const cone = new THREE.MeshStandardMaterial({
    color: '#343936',
    metalness: 0.05,
    roughness: 0.83,
    side: THREE.DoubleSide,
  });
  const copper = new THREE.MeshStandardMaterial({
    color: '#957051',
    metalness: 0.85,
    roughness: 0.34,
  });
  const ceramic = new THREE.MeshStandardMaterial({
    color: '#363c3a',
    metalness: 0.25,
    roughness: 0.67,
  });
  const sand = new THREE.MeshStandardMaterial({ color: '#ddd2b5', roughness: 0.88, metalness: 0 });
  return {
    aluminum,
    steel,
    darkMetal,
    black,
    rubber,
    cone,
    copper,
    ceramic,
    sand,
    brush,
    roughness,
  };
}

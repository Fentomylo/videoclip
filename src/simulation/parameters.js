import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export function createParameters() {
  return {
    dt: uniform(1 / 60),
    timeScale: uniform(1.0),
    initialSpeed: uniform(0.4),
    maxSpeed: uniform(6.0),
    particleSize: uniform(0.25),

    bioMode: uniform(1.0), // 1: Sutura, 2: Hemorragia, 3: Disección
    flowStrength: uniform(1.5),
    cohesionStrength: uniform(1.0),
    alignmentStrength: uniform(1.2),

    radialEnabled: uniform(1.0),
    attractor: uniform(new THREE.Vector3(0.0, 0.0, 0.0)),
    radialStrength: uniform(3.0),
    softening: uniform(0.7),

    vortexEnabled: uniform(1.0),
    vortexStrength: uniform(2.2),

    dragEnabled: uniform(1.0),
    dragCoefficient: uniform(0.14)
  };
}
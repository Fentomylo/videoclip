import * as THREE from 'three/webgpu';
import { Fn, If, color, hash, instanceIndex, instancedArray, max, mix, sin, cos, step, uint, uv, vec3, vec4 } from 'three/tsl';

export function createSimulation({ renderer, scene, params, count = 2048 }) {
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');

  const BOUNDS_W = 24.0;
  const BOUNDS_H = 13.5;

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const p = positionBuffer.element(i);
    const v = velocityBuffer.element(i);

    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const r3 = hash(i.add(uint(37)));
    const r4 = hash(i.add(uint(53)));
    const r5 = hash(i.add(uint(71)));
    const r6 = hash(i.add(uint(89)));

    p.assign(vec3(r1.sub(0.5).mul(BOUNDS_W), r2.sub(0.5).mul(BOUNDS_H), r3.sub(0.5).mul(4.0)));
    v.assign(vec3(r4, r5, r6).sub(0.5).mul(params.initialSpeed));
  })().compute(count).setName('Initialize Agents');

  const updateParticles = Fn(() => {
    const p = positionBuffer.element(instanceIndex);
    const v = velocityBuffer.element(instanceIndex);

    const dt = params.dt.mul(params.timeScale);
    const force = vec3(0.0).toVar();

    const angleX = sin(p.y.mul(0.3)).mul(cos(p.z.mul(0.3)));
    const angleY = cos(p.x.mul(0.3)).mul(sin(p.z.mul(0.3)));
    const flowDirection = vec3(angleX, angleY, 0.0).normalize();
    force.addAssign(flowDirection.mul(params.flowStrength));

    const toAttractor = params.attractor.sub(p);
    const distance = max(toAttractor.length(), params.softening);
    const steeringForce = toAttractor.div(distance).mul(params.radialStrength).mul(params.radialEnabled);
    force.addAssign(steeringForce);

    const zAxis = vec3(0.0, 0.0, 1.0);
    const tangent = zAxis.cross(toAttractor.normalize());
    force.addAssign(tangent.mul(params.vortexStrength).mul(params.vortexEnabled));

    force.addAssign(v.mul(params.dragCoefficient).mul(params.dragEnabled).mul(-1.0));

    v.addAssign(force.mul(dt));

    const speed = v.length();
    If(speed.greaterThan(params.maxSpeed), () => {
      v.assign(v.normalize().mul(params.maxSpeed));
    });

    p.addAssign(v.mul(dt));

    const halfW = BOUNDS_W * 0.5;
    const halfH = BOUNDS_H * 0.5;

    If(p.x.greaterThan(halfW), () => { p.x.assign(p.x.sub(BOUNDS_W)); });
    If(p.x.lessThan(-halfW), () => { p.x.assign(p.x.add(BOUNDS_W)); });
    If(p.y.greaterThan(halfH), () => { p.y.assign(p.y.sub(BOUNDS_H)); });
    If(p.y.lessThan(-halfH), () => { p.y.assign(p.y.add(BOUNDS_H)); });
  })().compute(count).setName('Update Agent Behaviors');

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = params.particleSize;

  material.colorNode = Fn(() => {
    const speed = velocityBuffer.toAttribute().length();
    const t = speed.div(params.maxSpeed).clamp(0.0, 1.0);
    const slow = color('#ff1a40');
    const fast = color('#ffffff');
    return vec4(mix(slow, fast, t), 1.0);
  })();

  material.opacityNode = step(uv().xy.sub(0.5).length(), 0.5).mul(0.8);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() { renderer.compute(updateParticles); }
  function dispose() { geometry.dispose(); material.dispose(); scene.remove(mesh); }

  return { count, positionBuffer, velocityBuffer, reset, stepSimulation, dispose };
}
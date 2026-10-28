import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export function createParameters() {
  return {
    dt: uniform(1 / 60),
    timeScale: uniform(1.0),
    time: uniform(0.0),            // se incrementa en main.js (anima el flow field)
    initialSpeed: uniform(0.4),
    maxSpeed: uniform(6.0),
    maxForce: uniform(14.0),
    particleSize: uniform(0.25),

    // ---- CORAZÓN ----
    beat: uniform(0.0),            // envolvente del latido (la calcula main.js)
    beatStrength: uniform(1.0),    // cuánto se infla el corazón

    // Percepción de los agentes
    perception: uniform(1.0),        // multiplicador del radio de visión de cada modo
    separationRadius: uniform(0.7),

    // Ganancias maestras (1.0 = valor base de cada modo)
    flowStrength: uniform(1.0),
    cohesionStrength: uniform(1.0),
    alignmentStrength: uniform(1.0),

    radialEnabled: uniform(1.0),
    attractor: uniform(new THREE.Vector3(0.0, 0.0, 0.0)),
    radialStrength: uniform(1.0),
    softening: uniform(0.7),

    vortexEnabled: uniform(1.0),
    vortexStrength: uniform(1.0),

    dragEnabled: uniform(1.0),
    dragCoefficient: uniform(0.3),

    // ---- Instrumento CICATRIZ ----
    cutRadius: uniform(1.1),   // radio de la zona que se abre bajo el bisturí
    gape: uniform(1.0),        // cuánto se separan los labios de la herida
    healRate: uniform(1.0),    // qué tan rápido se vuelve a cerrar
    bleedRate: uniform(1.0),   // cuánta sangre suelta
    gravity: uniform(2.5),     // qué tan rápido cae la sangre

    // ---- Instrumento PHYSARUM (venas) ----
    sensorAngle: uniform(0.55),  // apertura de los sensores izq/der (rad)
    sensorDist: uniform(0.35),   // qué tan lejos "huele" cada agente
    turnRate: uniform(9.0),      // qué tan fuerte gira hacia el rastro (rad/s)
    evaporation: uniform(0.8),   // qué tan rápido se borra el rastro

    // ---- Gestos del intérprete sobre las venas (los pone main.js) ----
    veinGrow: uniform(0.0),      // 1 mientras se mantiene G: el bisturí alimenta y atrae → crecen venas
    veinCut: uniform(0.0),       // 1 mientras se mantiene H: el bisturí corta y ahuyenta → se rompen
    veinWave: uniform(-1.0)      // radio de la onda que sale del corazón con cada latido (-1 = sin onda)
  };
}
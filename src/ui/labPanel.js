function rangeRow(parent, label, object, key, min, max, step, onInput, getValue) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const lab = document.createElement('label');
  const name = document.createElement('span');
  const value = document.createElement('span');
  value.className = 'value';
  name.textContent = label;
  lab.append(name, value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(object[key]);
  const fmt = (n) => Number(n).toFixed(step >= 1 ? 0 : step < 0.01 ? 3 : 2);
  const refresh = () => {
    object[key] = Number(input.value);
    value.textContent = fmt(input.value);
    onInput?.(object[key]);
  };
  input.addEventListener('input', refresh);
  refresh();
  wrap.append(lab, input);
  parent.append(wrap);
  return {
    input,
    refresh() {
      if (getValue) {
        const next = Number(getValue());
        object[key] = next;
        input.value = String(next);
        value.textContent = fmt(next);
      }
    }
  };
}

function button(parent, label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', (e) => { onClick(e); b.blur(); });   // blur: que Espacio no "clickee" el botón
  parent.append(b);
  return b;
}

function group(parent, title) {
  const g = document.createElement('div');
  g.className = 'group';
  g.innerHTML = `<h2>${title}</h2>`;
  parent.append(g);
  return g;
}

export function createLabPanel({
  params, onReset, onModeChange, onPauseChange, onBeat
}) {
  const refreshers = [];
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.innerHTML = `
    <h1>INSTRUMENTO · CIRUGÍA</h1>
    <p><strong>1</strong> Hueso · <strong>2</strong> Nervios · <strong>3</strong> Hemorragia · <strong>4</strong> Cicatriz · <strong>5</strong> Physarum. <strong>WASD</strong>: Bisturí. <strong>Espacio</strong>: Latido. <strong>M</strong>: Música. <strong>Z/X/C</strong>: Letra. <strong>V</strong>: Invertir color. <strong>F</strong>: Pantalla completa.</p>
  `;

  // ---------- CORAZÓN ----------
  const heartGroup = group(panel, 'Corazón (fondo)');
  const strengthState = { v: params.beatStrength.value };
  refreshers.push(rangeRow(heartGroup, 'Fuerza del latido', strengthState, 'v', 0, 3, 0.05, (v) => params.beatStrength.value = v, () => params.beatStrength.value));
  button(heartGroup, 'Latido (Espacio)', onBeat);

  // ---------- INSTRUMENTO (pocos controles expresivos) ----------
  const sim = group(panel, 'Bisturí y Tejido');
  const state = {
    timeScale: params.timeScale.value,
    radialStrength: params.radialStrength.value,
    vortexStrength: params.vortexStrength.value,
    flowStrength: params.flowStrength.value
  };
  refreshers.push(rangeRow(sim, 'Velocidad Global', state, 'timeScale', 0, 2, 0.01, (v) => params.timeScale.value = v, () => params.timeScale.value));
  refreshers.push(rangeRow(sim, 'Fuerza del Bisturí', state, 'radialStrength', -6, 6, 0.05, (v) => params.radialStrength.value = v, () => params.radialStrength.value));
  refreshers.push(rangeRow(sim, 'Intensidad de Corte / Giro', state, 'vortexStrength', -6, 6, 0.05, (v) => params.vortexStrength.value = v, () => params.vortexStrength.value));
  refreshers.push(rangeRow(sim, 'Temblor (flow field)', state, 'flowStrength', 0, 5, 0.05, (v) => params.flowStrength.value = v, () => params.flowStrength.value));
  const cutState = { cutRadius: params.cutRadius.value };
  refreshers.push(rangeRow(sim, 'Radio del Bisturí', cutState, 'cutRadius', 0.3, 3, 0.05, (v) => params.cutRadius.value = v, () => params.cutRadius.value));

  // ---------- AVANZADO (plegado) ----------
  const adv = document.createElement('details');
  adv.innerHTML = '<summary>Avanzado (escenas 3, 4 y 5)</summary>';
  panel.append(adv);

  const advState = {
    cohesionStrength: params.cohesionStrength.value,
    particleSize: params.particleSize.value
  };
  refreshers.push(rangeRow(adv, 'Cohesión Celular', advState, 'cohesionStrength', 0, 3, 0.05, (v) => params.cohesionStrength.value = v, () => params.cohesionStrength.value));
  refreshers.push(rangeRow(adv, 'Grosor de Filamentos', advState, 'particleSize', 0.1, 0.6, 0.01, (v) => params.particleSize.value = v, () => params.particleSize.value));

  const scarState = {
    gape: params.gape.value,
    healRate: params.healRate.value,
    bleedRate: params.bleedRate.value,
    gravity: params.gravity.value
  };
  refreshers.push(rangeRow(adv, 'Cicatriz · Apertura', scarState, 'gape', 0, 3, 0.05, (v) => params.gape.value = v, () => params.gape.value));
  refreshers.push(rangeRow(adv, 'Cicatriz · Cierre', scarState, 'healRate', 0, 4, 0.05, (v) => params.healRate.value = v, () => params.healRate.value));
  refreshers.push(rangeRow(adv, 'Cicatriz · Sangrado', scarState, 'bleedRate', 0, 4, 0.05, (v) => params.bleedRate.value = v, () => params.bleedRate.value));
  refreshers.push(rangeRow(adv, 'Cicatriz · Gravedad', scarState, 'gravity', 0, 8, 0.1, (v) => params.gravity.value = v, () => params.gravity.value));

  const physState = {
    sensorAngle: params.sensorAngle.value,
    sensorDist: params.sensorDist.value,
    turnRate: params.turnRate.value,
    evaporation: params.evaporation.value
  };
  refreshers.push(rangeRow(adv, 'Physarum · Ángulo sensor', physState, 'sensorAngle', 0.1, 1.4, 0.01, (v) => params.sensorAngle.value = v, () => params.sensorAngle.value));
  refreshers.push(rangeRow(adv, 'Physarum · Distancia sensor', physState, 'sensorDist', 0.1, 1.2, 0.01, (v) => params.sensorDist.value = v, () => params.sensorDist.value));
  refreshers.push(rangeRow(adv, 'Physarum · Giro', physState, 'turnRate', 1, 20, 0.5, (v) => params.turnRate.value = v, () => params.turnRate.value));
  refreshers.push(rangeRow(adv, 'Physarum · Evaporación', physState, 'evaporation', 0.1, 4, 0.05, (v) => params.evaporation.value = v, () => params.evaporation.value));

  const actions = group(panel, 'Acciones');
  button(actions, 'Reiniciar Sistema (R)', onReset);
  button(actions, 'Pausar / Continuar', onPauseChange);
  button(actions, 'Ocultar Panel (P)', onModeChange);

  document.body.append(panel);

  return {
    element: panel,
    setVisible(visible) { panel.classList.toggle('hidden', !visible); },
    refresh() { for (const item of refreshers) item.refresh(); }
  };
}
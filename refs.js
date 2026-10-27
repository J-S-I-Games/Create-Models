(function (g) {
'use strict';
const PI = Math.PI;
const VIEWS = {
  front:  { name: 'Frontal',           dir: [0, 0, -1], u: [1, 0, 0],  v: [0, 1, 0],  n: [0, 0, 1],  euler: [0, 0, 0] },
  back:   { name: 'Trasera',           dir: [0, 0, 1],  u: [-1, 0, 0], v: [0, 1, 0],  n: [0, 0, -1], euler: [0, PI, 0] },
  right:  { name: 'Lateral derecha',   dir: [-1, 0, 0], u: [0, 0, -1], v: [0, 1, 0],  n: [1, 0, 0],  euler: [0, PI / 2, 0] },
  left:   { name: 'Lateral izquierda', dir: [1, 0, 0],  u: [0, 0, 1],  v: [0, 1, 0],  n: [-1, 0, 0], euler: [0, -PI / 2, 0] },
  top:    { name: 'Superior',          dir: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, -1], n: [0, 1, 0],  euler: [-PI / 2, 0, 0] },
  bottom: { name: 'Inferior',          dir: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, 1],  n: [0, -1, 0], euler: [PI / 2, 0, 0] }
};
const DEPTH = 50; 
function viewOf(forward, ortho, tol) { 
  if (!ortho) return null;
  const l = Math.hypot(forward[0], forward[1], forward[2]) || 1, f = forward.map(x => x / l), t = tol || 0.9998;
  for (const k in VIEWS) { const d = VIEWS[k].dir; if (f[0] * d[0] + f[1] * d[1] + f[2] * d[2] >= t) return k; }
  return null;
}
function placement(view, x, y) { 
  const V = VIEWS[view];
  return { pos: [0, 1, 2].map(i => V.dir[i] * DEPTH + V.u[i] * x + V.v[i] * y), euler: V.euler.slice() };
}
function sanitize(list) { 
  if (!Array.isArray(list)) return [];
  const num = (v, d, a, b) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
  return list.filter(r => r && typeof r.data === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(r.data) && VIEWS[r.view]).map(r => ({
    name: String(r.name || 'Imagen').slice(0, 80), view: r.view, x: num(r.x, 0, -1e4, 1e4), y: num(r.y, 0, -1e4, 1e4),
    size: num(r.size, 8, 0.01, 1e4), opacity: num(r.opacity, 0.5, 0, 1), visible: r.visible !== false, data: r.data
  }));
}
g.JSIRefs = { VIEWS, DEPTH, viewOf, placement, sanitize };
if (typeof module !== 'undefined') module.exports = g.JSIRefs;
})(typeof window !== 'undefined' ? window : globalThis);
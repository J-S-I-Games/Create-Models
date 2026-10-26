/* Create Models: modificadores sobre una "sopa de triángulos" (Float32Array, 9 floats por triángulo).
   Sin dependencias: cada función recibe posiciones y devuelve posiciones nuevas. */
(function (g) {
'use strict';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => { a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; return a; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const nrm3 = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const len2 = a => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

function weld(P) { // une vértices en la misma posición
  const map = new Map(), pos = [], tris = [];
  const id = i => {
    const k = Math.round(P[i] * 1e4) + ',' + Math.round(P[i + 1] * 1e4) + ',' + Math.round(P[i + 2] * 1e4);
    let v = map.get(k);
    if (v === undefined) { v = pos.length; map.set(k, v); pos.push([P[i], P[i + 1], P[i + 2]]); }
    return v;
  };
  for (let t = 0; t + 8 < P.length; t += 9) {
    const a = id(t), b = id(t + 3), c = id(t + 6);
    if (a !== b && b !== c && a !== c) tris.push([a, b, c]);
  }
  return { pos, tris };
}
function soup(pos, tris) {
  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((v, k) => out.set(pos[v], i * 9 + k * 3)));
  return out;
}

// Mirror: copia reflejada en un eje local (0=X, 1=Y, 2=Z) con el sentido de las caras invertido
function mirror(P, axis) {
  const out = new Float32Array(P.length * 2);
  out.set(P);
  for (let t = 0; t < P.length; t += 9) {
    const q = Array.from(P.subarray(t, t + 9));
    for (let k = 0; k < 3; k++) q[k * 3 + axis] *= -1;
    out.set([q[0], q[1], q[2], q[6], q[7], q[8], q[3], q[4], q[5]], P.length + t);
  }
  return out;
}

// Solidify: segunda capa desplazada hacia adentro + borde en los contornos abiertos
function solidify(P, th) {
  const { pos, tris } = weld(P), N = pos.length, n = pos.map(() => [0, 0, 0]);
  tris.forEach(([a, b, c]) => { const f = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a])); [a, b, c].forEach(i => add(n[i], f)); });
  const all = pos.concat(pos.map((p, i) => { const u = nrm(n[i]); return [p[0] - u[0] * th, p[1] - u[1] * th, p[2] - u[2] * th]; }));
  const out = tris.map(t => t.slice());
  tris.forEach(([a, b, c]) => out.push([a + N, c + N, b + N]));
  const dir = new Set();
  tris.forEach(t => { for (let k = 0; k < 3; k++) dir.add(t[k] + '>' + t[(k + 1) % 3]); });
  dir.forEach(d => {
    const [u, v] = d.split('>').map(Number);
    if (!dir.has(v + '>' + u)) out.push([u, u + N, v + N], [u, v + N, v]);
  });
  return soup(all, out);
}

// Subdivision Surface: subdivisión de Loop (cada triángulo en 4, con suavizado)
function subdivide(P) {
  const { pos, tris } = weld(P), E = new Map(), nb = pos.map(() => new Set());
  tris.forEach(([a, b, c]) => [[a, b, c], [b, c, a], [c, a, b]].forEach(([x, y, z]) => {
    const k = ek(x, y);
    if (!E.has(k)) E.set(k, { a: x, b: y, o: [] });
    E.get(k).o.push(z); nb[x].add(y); nb[y].add(x);
  }));
  const bd = pos.map(() => []);
  E.forEach(e => { if (e.o.length === 1) { bd[e.a].push(e.b); bd[e.b].push(e.a); } });
  const out = pos.map((p, i) => {
    if (bd[i].length) return bd[i].length === 2 ? p.map((v, k) => 0.75 * v + 0.125 * (pos[bd[i][0]][k] + pos[bd[i][1]][k])) : p.slice();
    const n = nb[i].size, beta = n === 3 ? 3 / 16 : 3 / (8 * n), s = [0, 0, 0];
    nb[i].forEach(j => add(s, pos[j]));
    return p.map((v, k) => (1 - n * beta) * v + beta * s[k]);
  });
  const mid = new Map();
  E.forEach((e, k) => {
    const A = pos[e.a], B = pos[e.b];
    mid.set(k, out.length);
    out.push(e.o.length === 2
      ? A.map((v, i) => 0.375 * (v + B[i]) + 0.125 * (pos[e.o[0]][i] + pos[e.o[1]][i]))
      : A.map((v, i) => 0.5 * (v + B[i])));
  });
  const nt = [];
  tris.forEach(([a, b, c]) => {
    const ab = mid.get(ek(a, b)), bc = mid.get(ek(b, c)), ca = mid.get(ek(c, a));
    nt.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  });
  return soup(out, nt);
}

// Bevel (chaflán): cada cara plana se encoge, las aristas se cubren con una tira y los vértices con un polígono
function bevel(P, amt) {
  const { pos, tris } = weld(P), np = pos.slice(), out = [], E = new Map(), badV = new Set();
  const fn = tris.map(([a, b, c]) => nrm(cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]))));
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const key = ek(t[k], t[(k + 1) % 3]); if (!E.has(key)) E.set(key, []); E.get(key).push(i); } });
  const par = tris.map((_, i) => i), find = x => (par[x] === x ? x : (par[x] = find(par[x])));
  E.forEach((l, key) => {
    if (l.length === 2 && dot(fn[l[0]], fn[l[1]]) > 0.999) par[find(l[0])] = find(l[1]);
    if (l.length !== 2) key.split('_').forEach(v => badV.add(+v));
  });
  const gid = tris.map((_, i) => find(i)), groups = new Map();
  tris.forEach((t, i) => { if (!groups.has(gid[i])) groups.set(gid[i], []); groups.get(gid[i]).push(i); });
  const iv = new Map(), loops = new Map();
  groups.forEach((ts, g) => {
    const next = new Map();
    let ok = true;
    ts.forEach(i => {
      const t = tris[i];
      for (let k = 0; k < 3; k++) {
        const u = t[k], v = t[(k + 1) % 3];
        if (E.get(ek(u, v)).some(j => j !== i && gid[j] === g)) continue;
        if (next.has(u)) ok = false;
        next.set(u, v);
      }
    });
    if (!ok || !next.size) return;
    const loop = [next.keys().next().value];
    for (;;) {
      const v = next.get(loop[loop.length - 1]);
      if (v === undefined || loop.length > next.size) return;
      if (v === loop[0]) break;
      loop.push(v);
    }
    if (loop.length !== next.size) return; // varios contornos: se deja la cara como está
    const c = [0, 0, 0];
    loop.forEach(v => add(c, pos[v]));
    c.forEach((_, k) => { c[k] /= loop.length; });
    const rad = loop.reduce((s, v) => s + len(sub(pos[v], c)), 0) / loop.length, k = Math.min(0.9, amt / (rad || 1)), m = new Map();
    loop.forEach(v => { m.set(v, np.length); np.push(lerp(pos[v], c, k)); });
    iv.set(g, m); loops.set(g, loop);
    for (let i = 1; i < loop.length - 1; i++) out.push([m.get(loop[0]), m.get(loop[i]), m.get(loop[i + 1])]);
  });
  tris.forEach((t, i) => { if (!iv.has(gid[i])) out.push(t); });
  loops.forEach((loop, g) => loop.forEach((u, idx) => {
    const v = loop[(idx + 1) % loop.length], l = E.get(ek(u, v)), j = l.find(x => gid[x] !== g);
    if (l.length !== 2 || j === undefined) return;
    const g2 = gid[j], m1 = iv.get(g), m2 = iv.get(g2);
    if (!m2 || g > g2 || m2.get(u) === undefined || m2.get(v) === undefined) return; // una sola vez por arista
    out.push([m1.get(u), m2.get(u), m2.get(v)], [m1.get(u), m2.get(v), m1.get(v)]);
  }));
  const at = new Map();
  iv.forEach((m, g) => m.forEach((ni, v) => { if (!at.has(v)) at.set(v, []); at.get(v).push({ ni, g }); }));
  at.forEach((list, v) => {
    if (list.length < 3 || badV.has(v)) return;
    const n = [0, 0, 0];
    list.forEach(o => add(n, fn[groups.get(o.g)[0]]));
    if (len(n) < 1e-6) return;
    const u = nrm(n), t1 = nrm(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), t2 = cross(u, t1);
    list.forEach(o => { const d = sub(np[o.ni], pos[v]); o.a = Math.atan2(dot(d, t2), dot(d, t1)); });
    list.sort((x, y) => x.a - y.a);
    for (let i = 1; i < list.length - 1; i++) out.push([list[0].ni, list[i].ni, list[i + 1].ni]);
  });
  return soup(np, out);
}

// Desenvolver UV: devuelve 2 floats por vértice. kind: 'box' (atlas de 6 caras), 'plane', 'cyl', 'sph'
function unwrap(P, kind) {
  const n = P.length / 3, uv = new Float32Array(n * 2), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const sz = mx.map((v, k) => v - mn[k] || 1), c = mx.map((v, k) => (v + mn[k]) / 2);
  const set = (i, u, v) => { uv[i * 2] = u; uv[i * 2 + 1] = v; };
  if (kind === 'plane') {
    const k = sz.indexOf(Math.min(...sz)), a = (k + 1) % 3, b = (k + 2) % 3; // se proyecta a lo largo del eje más fino
    for (let i = 0; i < n; i++) set(i, (P[i * 3 + a] - mn[a]) / sz[a], (P[i * 3 + b] - mn[b]) / sz[b]);
  } else if (kind === 'cyl' || kind === 'sph') {
    for (let t = 0; t + 2 < n; t += 3) {
      const u = [], v = [];
      for (let k = 0; k < 3; k++) {
        const i = t + k, x = P[i * 3] - c[0], y = P[i * 3 + 1] - c[1], z = P[i * 3 + 2] - c[2];
        u.push(Math.atan2(x, z) / (2 * Math.PI) + 0.5);
        v.push(kind === 'cyl' ? (P[i * 3 + 1] - mn[1]) / sz[1] : 0.5 + Math.asin(Math.max(-1, Math.min(1, y / (Math.hypot(x, y, z) || 1)))) / Math.PI);
      }
      if (Math.max(...u) - Math.min(...u) > 0.5) for (let k = 0; k < 3; k++) if (u[k] < 0.5) u[k] += 1; // costura
      for (let k = 0; k < 3; k++) set(t + k, u[k], v[k]);
    }
  } else { // caja: cada cara en su celda de un atlas de 3x2
    const L = [p => [-p[2], p[1]], p => [p[2], p[1]], p => [p[0], -p[2]], p => [p[0], p[2]], p => [p[0], p[1]], p => [-p[0], p[1]]];
    const gi = [], loc = [], bb = Array.from({ length: 6 }, () => [1e9, 1e9, -1e9, -1e9]);
    for (let t = 0; t + 2 < n; t += 3) {
      const A = [P[t * 3], P[t * 3 + 1], P[t * 3 + 2]], B = [P[t * 3 + 3], P[t * 3 + 4], P[t * 3 + 5]], C = [P[t * 3 + 6], P[t * 3 + 7], P[t * 3 + 8]];
      const nn = cross(sub(B, A), sub(C, A)).map(Math.abs), nv = cross(sub(B, A), sub(C, A));
      const d = nn[0] >= nn[1] && nn[0] >= nn[2] ? 0 : nn[1] >= nn[2] ? 1 : 2, g = d * 2 + (nv[d] < 0 ? 1 : 0);
      gi.push(g);
      [A, B, C].forEach(q => { const l = L[g](q); loc.push(l); const b = bb[g]; b[0] = Math.min(b[0], l[0]); b[1] = Math.min(b[1], l[1]); b[2] = Math.max(b[2], l[0]); b[3] = Math.max(b[3], l[1]); });
    }
    const cw = 1 / 3, ch = 1 / 2, m = 0.02;
    loc.forEach((l, i) => {
      const g = gi[(i / 3) | 0], b = bb[g], w = b[2] - b[0] || 1, h = b[3] - b[1] || 1, s = Math.min((cw - 2 * m) / w, (ch - 2 * m) / h);
      set(i, (g % 3) * cw + (cw - w * s) / 2 + (l[0] - b[0]) * s, Math.floor(g / 3) * ch + (ch - h * s) / 2 + (l[1] - b[1]) * s);
    });
  }
  return uv;
}

// ---------- UV: proyección desde la vista, Smart UV, Unwrap, islas y superposiciones ----------
// Todo trabaja sobre la sopa de triángulos (3 vértices por triángulo) y devuelve 2 floats por vértice.
function weldAll(S) { // une vértices por posición pero conserva TODOS los triángulos (la numeración no cambia)
  const map = new Map(), pos = [], tris = [];
  const id = i => {
    const k = Math.round(S[i * 3] * 1e4) + ',' + Math.round(S[i * 3 + 1] * 1e4) + ',' + Math.round(S[i * 3 + 2] * 1e4);
    let v = map.get(k);
    if (v === undefined) { v = pos.length; map.set(k, v); pos.push([S[i * 3], S[i * 3 + 1], S[i * 3 + 2]]); }
    return v;
  };
  for (let t = 0; t < S.length / 9; t++) tris.push([id(t * 3), id(t * 3 + 1), id(t * 3 + 2)]);
  return { pos, tris };
}
function fromView(S, proj) { // proyección desde la vista: proj(p) -> [x, y] en pantalla (y hacia arriba); se ajusta a 0-1 sin deformar
  const n = S.length / 3, xy = [];
  let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (let i = 0; i < n; i++) { const q = proj([S[i * 3], S[i * 3 + 1], S[i * 3 + 2]]); xy.push(q); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const w = x1 - x0 || 1, h = y1 - y0 || 1, k = 1 / Math.max(w, h), uv = new Float32Array(n * 2);
  xy.forEach((q, i) => { uv[i * 2] = (q[0] - x0) * k + (1 - w * k) / 2; uv[i * 2 + 1] = (q[1] - y0) * k + (1 - h * k) / 2; });
  return uv;
}
function charts(S, o) { // islas por ángulo; unfold=false: proyección plana por isla (Smart UV); unfold=true: se desarrolla la isla triángulo a triángulo (Unwrap)
  const { pos, tris } = weldAll(S), nT = tris.length, cosA = Math.cos((o.angle || 66) * Math.PI / 180);
  const nrm = tris.map(([a, b, c]) => nrm3(cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]))));
  const E = new Map();
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const key = ek(t[k], t[(k + 1) % 3]); if (!E.has(key)) E.set(key, []); E.get(key).push(i); } });
  const nb = tris.map(() => []);
  E.forEach(l => { for (let i = 0; i < l.length; i++) for (let j = 0; j < l.length; j++) if (i !== j) nb[l[i]].push(l[j]); });
  const seen = new Uint8Array(nT), list = [];
  for (let s0 = 0; s0 < nT; s0++) {
    if (seen[s0]) continue;
    seen[s0] = 1;
    const ts = [s0], q = [s0];
    while (q.length) {
      const c = q.shift();
      nb[c].forEach(m => {
        if (seen[m]) return;
        if (dot(nrm[m], o.unfold ? nrm[c] : nrm[s0]) < cosA) return;
        seen[m] = 1; ts.push(m); q.push(m);
      });
    }
    list.push(ts);
  }
  const c2 = new Array(nT);
  list.forEach(ts => {
    if (!o.unfold) { // proyección plana a lo largo de la normal media de la isla
      const n = nrm3(ts.reduce((a, t) => add(a, nrm[t]), [0, 0, 0])), u = nrm3(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n)), v = cross(n, u);
      ts.forEach(t => { c2[t] = tris[t].map(i => [dot(pos[i], u), dot(pos[i], v)]); });
      return;
    }
    const placed = new Set();
    const first = ts[0], [a, b, c] = tris[first], e = sub(pos[b], pos[a]), L = len(e) || 1e-9, x = dot(sub(pos[c], pos[a]), e) / L;
    c2[first] = [[0, 0], [L, 0], [x, Math.sqrt(Math.max(0, len2(sub(pos[c], pos[a])) - x * x))]];
    placed.add(first);
    const q = [first];
    while (q.length) {
      const p = q.shift();
      nb[p].forEach(m => {
        if (placed.has(m) || !ts.includes(m)) return;
        const shared = tris[m].filter(v => tris[p].includes(v));
        if (shared.length !== 2) return;
        const [va, vb] = shared, at = (t, v) => c2[t][tris[t].indexOf(v)], A = at(p, va), B = at(p, vb);
        const third = tris[m].find(v => !shared.includes(v)), cp = c2[p][tris[p].findIndex(v => !shared.includes(v))];
        const ex = [B[0] - A[0], B[1] - A[1]], Le = Math.hypot(ex[0], ex[1]) || 1e-9, ux = [ex[0] / Le, ex[1] / Le], uy = [-ux[1], ux[0]];
        const da2 = len2(sub(pos[third], pos[va])), db2 = len2(sub(pos[third], pos[vb])), px = (da2 - db2 + Le * Le) / (2 * Le), py = Math.sqrt(Math.max(0, da2 - px * px));
        const side = (cp[0] - A[0]) * uy[0] + (cp[1] - A[1]) * uy[1] >= 0 ? 1 : -1; // el tercer vértice va del lado opuesto al del triángulo anterior
        const T = [A[0] + ux[0] * px - uy[0] * py * side, A[1] + ux[1] * px - uy[1] * py * side];
        c2[m] = tris[m].map(v => (v === va ? A : v === vb ? B : T));
        placed.add(m); q.push(m);
      });
    }
    ts.forEach(t => { if (!c2[t]) c2[t] = [[0, 0], [1, 0], [0, 1]]; });
  });
  return packCharts(list, c2, nT);
}
function packCharts(list, c2, nT, norot) { // gira cada isla a su caja mínima y las ordena en filas dentro de 0-1
  const info = list.map(ts => {
    let best = null;
    for (let k = 0; k < (norot ? 1 : 12); k++) {
      const a = k * Math.PI / 12, c = Math.cos(a), s = Math.sin(a);
      let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
      ts.forEach(t => c2[t].forEach(([x, y]) => { const X = x * c - y * s, Y = x * s + y * c; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }));
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area < best.area - 1e-12) best = { a, area, x0, y0, w: x1 - x0 || 1e-6, h: y1 - y0 || 1e-6 };
    }
    return { ts, ...best };
  });
  const m = 0.01, order = info.slice().sort((a, b) => b.h - a.h);
  let sc = Math.sqrt(0.7 / (info.reduce((s, i) => s + i.w * i.h, 0) || 1)), place;
  sc = Math.min(sc, (1 - 2 * m) / Math.max(...info.map(i => i.w)));
  for (let tries = 0; tries < 60; tries++) {
    let x = m, y = m, rowH = 0;
    place = new Map();
    order.forEach(i => {
      const w = i.w * sc, h = i.h * sc;
      if (x + w + m > 1 && x > m) { x = m; y += rowH + m; rowH = 0; }
      place.set(i, [x, y]); x += w + m; rowH = Math.max(rowH, h);
    });
    if (y + rowH + m <= 1) break;
    sc *= 0.93;
  }
  const uv = new Float32Array(nT * 6);
  info.forEach(i => {
    const [px, py] = place.get(i), c = Math.cos(i.a), s = Math.sin(i.a);
    i.ts.forEach(t => c2[t].forEach(([x, y], k) => { uv[t * 6 + k * 2] = (x * c - y * s - i.x0) * sc + px; uv[t * 6 + k * 2 + 1] = (x * s + y * c - i.y0) * sc + py; }));
  });
  return uv;
}
function triSub(P, mask) {
  const idx = [];
  for (let t = 0; t < P.length / 9; t++) if (!mask || mask[t]) idx.push(t);
  const S = new Float32Array(idx.length * 9);
  idx.forEach((t, i) => S.set(P.subarray(t * 9, t * 9 + 9), i * 9));
  return { idx, S };
}
// kind: 'view' (o.proj), 'smart', 'unwrap', 'box', 'plane', 'cyl', 'sph'. o.mask limita el cálculo a los triángulos marcados; o.base conserva el UV del resto.
function uvTool(P, kind, o) {
  o = o || {};
  const nT = P.length / 9, out = new Float32Array(nT * 6);
  if (o.base && o.base.length === nT * 6) out.set(o.base);
  const { idx, S } = triSub(P, o.mask);
  if (!idx.length) return out;
  const sub6 = kind === 'view' ? fromView(S, o.proj) : kind === 'smart' ? charts(S, { angle: o.angle, unfold: false }) : kind === 'unwrap' ? charts(S, { angle: o.angle, unfold: true }) : unwrap(S, kind);
  idx.forEach((t, i) => out.set(sub6.subarray(i * 6, i * 6 + 6), t * 6));
  return out;
}
function islandIds(nT, keyOf) { // islas UV: triángulos que comparten un vértice con la misma posición y el mismo UV
  const par = Array.from({ length: nT }, (_, i) => i), find = x => (par[x] === x ? x : (par[x] = find(par[x]))), owner = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const key = keyOf(t * 3 + k); if (owner.has(key)) par[find(t)] = find(owner.get(key)); else owner.set(key, t); }
  const ids = new Int32Array(nT), map = new Map();
  for (let t = 0; t < nT; t++) { const r = find(t); if (!map.has(r)) map.set(r, map.size); ids[t] = map.get(r); }
  return ids;
}
function uvOverlap(nT, uvOf, N) { // celdas del espacio UV cubiertas por más de un triángulo (superposición dentro de una isla o entre islas)
  N = N || 128;
  const own = new Int32Array(N * N).fill(-1), mask = new Uint8Array(N * N), e = 1e-9;
  let count = 0;
  for (let t = 0; t < nT; t++) {
    const a = uvOf(t * 3), b = uvOf(t * 3 + 1), c = uvOf(t * 3 + 2), den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) * N)), x1 = Math.min(N - 1, Math.floor(Math.max(a[0], b[0], c[0]) * N));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) * N)), y1 = Math.min(N - 1, Math.floor(Math.max(a[1], b[1], c[1]) * N));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = (x + 0.5) / N, py = (y + 0.5) / N;
      const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      if (l1 <= e || l2 <= e || 1 - l1 - l2 <= e) continue; // solo el interior: las aristas compartidas no cuentan
      const i = y * N + x;
      if (own[i] < 0) own[i] = t; else if (own[i] !== t && !mask[i]) { mask[i] = 1; count++; }
    }
  }
  return { mask, count, N };
}

function packIslands(nT, uvOf, isl) { // reubica todas las islas UV dentro de 0-1 sin girarlas ni deformarlas
  const lists = [], c2 = [];
  for (let t = 0; t < nT; t++) { (lists[isl[t]] = lists[isl[t]] || []).push(t); c2[t] = [0, 1, 2].map(k => uvOf(t * 3 + k).slice()); }
  return packCharts(lists.filter(Boolean), c2, nT, true);
}

g.JSIMods = { mirror, solidify, subdivide, bevel, unwrap, uvTool, islandIds, uvOverlap, packIslands };
if (typeof module !== 'undefined') module.exports = g.JSIMods;
})(typeof window !== 'undefined' ? window : globalThis);
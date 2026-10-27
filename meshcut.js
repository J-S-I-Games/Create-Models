
(function (g) {
'use strict';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ekey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

function fromSoup(P, UV, faceTris) {
  const map = new Map(), pos = [], nT = Math.floor(P.length / 9);
  const id = i => {
    const k = Math.round(P[i * 3] * 1e4) + ',' + Math.round(P[i * 3 + 1] * 1e4) + ',' + Math.round(P[i * 3 + 2] * 1e4);
    let v = map.get(k);
    if (v === undefined) { v = pos.length; map.set(k, v); pos.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); }
    return v;
  };
  const tris = [], tuv = [];
  for (let t = 0; t < nT; t++) {
    const a = id(t * 3), b = id(t * 3 + 1), c = id(t * 3 + 2);
    if (a === b || b === c || a === c) { tris.push(null); tuv.push(null); continue; }
    tris.push([a, b, c]);
    tuv.push(UV ? [0, 1, 2].map(k => [UV[(t * 3 + k) * 2], UV[(t * 3 + k) * 2 + 1]]) : null);
  }
  const E = new Map();
  tris.forEach((t, i) => { if (!t) return; for (let k = 0; k < 3; k++) { const key = ekey(t[k], t[(k + 1) % 3]); if (!E.has(key)) E.set(key, []); E.get(key).push(i); } });
  const poly = ts => {
    if (ts.length === 1) return { v: tris[ts[0]].slice(), uv: tuv[ts[0]] ? tuv[ts[0]].map(u => u.slice()) : null };
    const dirs = new Set(), uvOf = new Map(), next = new Map();
    let cnt = 0, ok = true;
    ts.forEach(i => { const t = tris[i]; for (let k = 0; k < 3; k++) dirs.add(t[k] + '>' + t[(k + 1) % 3]); });
    ts.forEach(i => {
      const t = tris[i];
      for (let k = 0; k < 3; k++) {
        const u = t[k], v = t[(k + 1) % 3];
        if (dirs.has(v + '>' + u)) continue;
        if (next.has(u)) ok = false;
        next.set(u, v); cnt++;
        if (tuv[i] && !uvOf.has(u)) uvOf.set(u, tuv[i][k]);
      }
    });
    if (!ok || cnt < 3) return null;
    const loop = [next.keys().next().value];
    for (;;) {
      const v = next.get(loop[loop.length - 1]);
      if (v === undefined || loop.length > cnt) return null;
      if (v === loop[0]) break;
      loop.push(v);
    }
    if (loop.length !== cnt) return null;
    return { v: loop, uv: uvOf.size === loop.length ? loop.map(u => uvOf.get(u).slice()) : null };
  };
  let groups;
  if (faceTris && faceTris.reduce((s, n) => s + n, 0) === nT) {
    groups = [];
    let c = 0;
    faceTris.forEach(n => { const gr = []; for (let k = 0; k < n; k++) if (tris[c + k]) gr.push(c + k); c += n; if (gr.length) groups.push(gr); });
  } else { 
    const par = tris.map((_, i) => i), find = x => (par[x] === x ? x : (par[x] = find(par[x])));
    const nrm = tris.map(t => { if (!t) return null; const n = cross(sub(pos[t[1]], pos[t[0]]), sub(pos[t[2]], pos[t[0]])), l = len(n) || 1; return mul(n, 1 / l); });
    E.forEach(l => { if (l.length === 2 && dot(nrm[l[0]], nrm[l[1]]) > 0.9999) par[find(l[0])] = find(l[1]); });
    const gm = new Map();
    tris.forEach((t, i) => { if (!t) return; const r = find(i); if (!gm.has(r)) gm.set(r, []); gm.get(r).push(i); });
    const all = [...gm.values()], singles = all.filter(x => x.length === 1).map(x => x[0]).sort((a, b) => a - b);
    groups = all.filter(x => x.length > 1);
    const sset = new Set(singles), used = new Set();
    singles.forEach(t => {
      if (used.has(t)) return;
      used.add(t);
      if (sset.has(t + 1) && !used.has(t + 1)) { const p = poly([t, t + 1]); if (p && p.v.length === 4) { used.add(t + 1); groups.push([t, t + 1]); return; } }
      groups.push([t]);
    });
  }
  const faces = [];
  groups.forEach(gr => { const p = poly(gr); if (p) faces.push(p); else gr.forEach(i => faces.push(poly([i]))); });
  faces.forEach((f, i) => { f.origin = i; });
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  pos.forEach(p => p.forEach((v, k) => { mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v); }));
  return { pos, faces, scale: len(sub(mx, mn)) || 1 };
}
function clone(M) {
  return { pos: M.pos.map(p => p.slice()), faces: M.faces.map((f, i) => ({ v: f.v.slice(), uv: f.uv ? f.uv.map(u => u.slice()) : null, origin: i })), scale: M.scale };
}
function faceNormal(M, f) {
  let x = 0, y = 0, z = 0;
  const n = f.v.length;
  for (let i = 0; i < n; i++) {
    const a = M.pos[f.v[i]], b = M.pos[f.v[(i + 1) % n]];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}
const proj2 = N => {
  const a = [Math.abs(N[0]), Math.abs(N[1]), Math.abs(N[2])], d = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
  return p => (d === 0 ? [p[1], p[2]] : d === 1 ? [p[0], p[2]] : [p[0], p[1]]);
};
function inPoly(M, f, p) {
  const q = proj2(faceNormal(M, f)), pt = q(p), V = f.v.map(i => q(M.pos[i]));
  let c = false;
  for (let i = 0, j = V.length - 1; i < V.length; j = i++) {
    if ((V[i][1] > pt[1]) !== (V[j][1] > pt[1]) && pt[0] < (V[j][0] - V[i][0]) * (pt[1] - V[i][1]) / (V[j][1] - V[i][1]) + V[i][0]) c = !c;
  }
  return c;
}
function triangulate(poly, pos) {
  const n = poly.length;
  if (n === 3) return [[0, 1, 2]];
  const N = faceNormal({ pos }, { v: poly });
  const idx = poly.map((_, i) => i), out = [];
  const inTri = (p, a, b, c) => dot(cross(sub(b, a), sub(p, a)), N) >= -1e-12 && dot(cross(sub(c, b), sub(p, b)), N) >= -1e-12 && dot(cross(sub(a, c), sub(p, c)), N) >= -1e-12;
  while (idx.length > 3) {
    let cut = false;
    for (let k = 0; k < idx.length && !cut; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = pos[poly[i0]], b = pos[poly[i1]], c = pos[poly[i2]];
      if (dot(cross(sub(b, a), sub(c, b)), N) <= 1e-12) continue;
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inTri(pos[poly[j]], a, b, c))) continue;
      out.push([i0, i1, i2]); idx.splice(k, 1); cut = true;
    }
    if (!cut) { for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i + 1]]); return out; }
  }
  out.push([idx[0], idx[1], idx[2]]);
  return out;
}
function toSoup(M) { 
  const P = [], UV = [], faceTris = [], hasUV = M.faces.every(f => f.uv);
  M.faces.forEach(f => {
    const tri = triangulate(f.v, M.pos);
    faceTris.push(tri.length);
    tri.forEach(t => t.forEach(i => { P.push(...M.pos[f.v[i]]); if (hasUV) UV.push(...f.uv[i]); }));
  });
  return { P: Float32Array.from(P), UV: hasUV ? Float32Array.from(UV) : null, faceTris };
}
function insertOnEdge(M, a, b, list) {
  M.faces.forEach(f => {
    const n = f.v.length;
    for (let k = 0; k < n; k++) {
      const x = f.v[k], y = f.v[(k + 1) % n];
      let ins;
      if (x === a && y === b) ins = list;
      else if (x === b && y === a) ins = list.slice().reverse().map(o => ({ id: o.id, t: 1 - o.t }));
      else continue;
      f.v.splice(k + 1, 0, ...ins.map(o => o.id));
      if (f.uv) f.uv.splice(k + 1, 0, ...ins.map(o => lerp2(f.uv[k], f.uv[(k + 1) % n], o.t)));
      break;
    }
  });
}

function ringOf(M, a, b) {
  const eq = new Map();
  M.faces.forEach((f, i) => { if (f.v.length === 4) f.v.forEach((v, k) => { const key = ekey(v, f.v[(k + 1) % 4]); if (!eq.has(key)) eq.set(key, []); eq.get(key).push(i); }); });
  const qs = eq.get(ekey(a, b));
  if (!qs) return null;
  const ring = { items: [], edges: new Map([[ekey(a, b), { s: a, o: b }]]), twist: false }, seen = new Set();
  const walk = (fi, ea, eb) => {
    while (fi !== undefined && !seen.has(fi)) {
      seen.add(fi);
      const q = M.faces[fi].v;
      let i = -1;
      for (let k = 0; k < 4 && i < 0; k++) if (ekey(q[k], q[(k + 1) % 4]) === ekey(ea, eb)) i = k;
      const partner = v => (v === q[i] ? q[(i + 3) % 4] : q[(i + 2) % 4]);
      const xs = partner(ea), xo = partner(eb), key = ekey(xs, xo);
      ring.items.push({ fi, i, s: ea });
      if (ring.edges.has(key)) { if (ring.edges.get(key).s !== xs) ring.twist = true; } else ring.edges.set(key, { s: xs, o: xo });
      fi = (eq.get(key) || []).find(x => x !== fi); ea = xs; eb = xo;
    }
  };
  walk(qs[0], a, b);
  if (qs[1] !== undefined) walk(qs[1], a, b);
  return ring.twist ? null : ring;
}
const cutFracs = (n, f) => { 
  const t = [];
  for (let k = 1; k <= n; k++) { const u = k / (n + 1); t.push(u + (f >= 0 ? (1 - u) : u) * f); }
  return t;
};
function ringSegments(M, ring, n, f) { 
  const tt = cutFracs(n, f), out = [];
  ring.items.forEach(({ fi, i, s }) => {
    const q = M.faces[fi].v, fr = q[i] === s ? tt : tt.slice().reverse().map(x => 1 - x);
    fr.forEach(x => out.push([lerp3(M.pos[q[i]], M.pos[q[(i + 1) % 4]], x), lerp3(M.pos[q[(i + 3) % 4]], M.pos[q[(i + 2) % 4]], x)]));
  });
  return out;
}
function loopCut(M, ring, n, f) { 
  const tt = cutFracs(n, f), ids = new Map();
  ring.edges.forEach((e, key) => {
    ids.set(key, tt.map(x => { M.pos.push(lerp3(M.pos[e.s], M.pos[e.o], x)); return M.pos.length - 1; }));
  });
  const strips = [], dead = new Set();
  ring.items.forEach(({ fi, i }) => {
    const F = M.faces[fi], q = F.v, u = F.uv;
    const eIn = ring.edges.get(ekey(q[i], q[(i + 1) % 4])), eOut = ring.edges.get(ekey(q[(i + 3) % 4], q[(i + 2) % 4]));
    const fromIn = q[i] === eIn.s, fromOut = q[(i + 3) % 4] === eOut.s;
    const idIn = ids.get(ekey(q[i], q[(i + 1) % 4])), idOut = ids.get(ekey(q[(i + 3) % 4], q[(i + 2) % 4]));
    const fr = fromIn ? tt : tt.slice().reverse().map(x => 1 - x);
    const E = [q[i], ...(fromIn ? idIn : idIn.slice().reverse()), q[(i + 1) % 4]];
    const X = [q[(i + 3) % 4], ...(fromOut ? idOut : idOut.slice().reverse()), q[(i + 2) % 4]];
    const Eu = u && [u[i], ...fr.map(x => lerp2(u[i], u[(i + 1) % 4], x)), u[(i + 1) % 4]];
    const Xu = u && [u[(i + 3) % 4], ...fr.map(x => lerp2(u[(i + 3) % 4], u[(i + 2) % 4], x)), u[(i + 2) % 4]];
    for (let k = 0; k <= n; k++) strips.push({ v: [E[k], E[k + 1], X[k + 1], X[k]], uv: u && [Eu[k], Eu[k + 1], Xu[k + 1], Xu[k]], origin: F.origin });
    dead.add(fi);
  });
  M.faces = M.faces.filter((_, i) => !dead.has(i)).concat(strips);
  ring.edges.forEach((e, key) => insertOnEdge(M, e.s, e.o, ids.get(key).map((id, k) => ({ id, t: tt[k] }))));
  return M;
}


function rayFaces(M, o, d) {
  const hits = [];
  M.faces.forEach((f, i) => {
    const N = faceNormal(M, f), den = dot(N, d);
    if (Math.abs(den) < 1e-14) return;
    const t = dot(N, sub(M.pos[f.v[0]], o)) / den;
    if (t <= 0) return;
    const p = add(o, mul(d, t));
    if (inPoly(M, f, p)) hits.push({ t, f: i, p });
  });
  return hits.sort((a, b) => a.t - b.t);
}
function visible(M, cam, p) { 
  const s = cam.project(p), r = cam.ray(s[0], s[1]), dd = dot(r.d, r.d), tp = dot(sub(p, r.o), r.d) / dd;
  const h = rayFaces(M, r.o, r.d)[0];
  return !h || h.t >= tp - (M.scale * 1e-3 + 1e-6) / Math.sqrt(dd);
}
function segT(r, a, b) {
  const v = sub(b, a), w = sub(r.o, a), A = dot(r.d, r.d), B = dot(r.d, v), C = dot(v, v), D = dot(r.d, w), E = dot(v, w), den = A * C - B * B;
  return den < 1e-14 ? 0 : Math.min(1, Math.max(0, (A * E - B * D) / den));
}
function edgeList(M) {
  const m = new Map();
  M.faces.forEach(f => f.v.forEach((v, k) => { const w = f.v[(k + 1) % f.v.length], key = ekey(v, w); if (!m.has(key)) m.set(key, [Math.min(v, w), Math.max(v, w)]); }));
  return m;
}
function edgeAt(M, cam, sx, sy, rad, ok) {
  let best = rad, hit = null;
  const S = M.pos.map(p => cam.project(p));
  edgeList(M).forEach(([a, b], key) => {
    if (ok && !ok(a, b)) return;
    const A = S[a], B = S[b], dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((sx - A[0]) * dx + (sy - A[1]) * dy) / l2)) : 0;
    const d = Math.hypot(sx - (A[0] + u * dx), sy - (A[1] + u * dy));
    if (d >= best) return;
    const t = segT(cam.ray(sx, sy), M.pos[a], M.pos[b]), p = lerp3(M.pos[a], M.pos[b], t);
    if (visible(M, cam, p)) { best = d; hit = { kind: 'e', a, b, t, p }; }
  });
  return hit;
}
function faceEdgeAt(M, cam, sx, sy, ok) { 
  const r = cam.ray(sx, sy), h = rayFaces(M, r.o, r.d)[0];
  if (!h) return null;
  const F = M.faces[h.f], n = F.v.length;
  let best = Infinity, hit = null;
  for (let k = 0; k < n; k++) {
    const a = F.v[k], b = F.v[(k + 1) % n];
    if (ok && !ok(a, b)) continue;
    const A = cam.project(M.pos[a]), B = cam.project(M.pos[b]), dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((sx - A[0]) * dx + (sy - A[1]) * dy) / l2)) : 0, d = Math.hypot(sx - (A[0] + u * dx), sy - (A[1] + u * dy));
    if (d < best) { best = d; hit = [a, b]; }
  }
  if (!hit) return null;
  const t = segT(r, M.pos[hit[0]], M.pos[hit[1]]);
  return { kind: 'e', a: hit[0], b: hit[1], t, p: lerp3(M.pos[hit[0]], M.pos[hit[1]], t), f: h.f };
}
function snapAt(M, cam, sx, sy) {
  const used = new Set();
  M.faces.forEach(f => f.v.forEach(v => used.add(v)));
  let best = 10, hv = -1;
  used.forEach(v => { const s = cam.project(M.pos[v]), d = Math.hypot(s[0] - sx, s[1] - sy); if (d < best && visible(M, cam, M.pos[v])) { best = d; hv = v; } });
  if (hv >= 0) return { kind: 'v', v: hv, p: M.pos[hv].slice() };
  const e = edgeAt(M, cam, sx, sy, 8);
  if (e) return e;
  const r = cam.ray(sx, sy), h = rayFaces(M, r.o, r.d)[0];
  return h ? { kind: 'f', f: h.f, p: h.p } : null;
}
function incident(M, d) {
  if (d.kind === 'f') return [d.f];
  const out = [];
  M.faces.forEach((f, i) => {
    if (d.kind === 'v') { if (f.v.includes(d.v)) out.push(i); return; }
    const n = f.v.length;
    for (let k = 0; k < n; k++) if (ekey(f.v[k], f.v[(k + 1) % n]) === ekey(d.a, d.b)) { out.push(i); break; }
  });
  return out;
}
function resolvePath(M, cam, A, B) {
  const sA = cam.project(A.p), sB = cam.project(B.p), r = [sB[0] - sA[0], sB[1] - sA[1]];
  const ex = { v: new Set(), e: new Set() };
  [A, B].forEach(d => { if (d.kind === 'v') ex.v.add(d.v); else if (d.kind === 'e') ex.e.add(ekey(d.a, d.b)); });
  const S = M.pos.map(p => cam.project(p)), cr = [];
  edgeList(M).forEach(([a, b], key) => {
    if (ex.e.has(key) || ex.v.has(a) || ex.v.has(b)) return;
    const q0 = S[a], s = [S[b][0] - q0[0], S[b][1] - q0[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) return;
    const w = [q0[0] - sA[0], q0[1] - sA[1]], u = (w[0] * s[1] - w[1] * s[0]) / den, t2 = (w[0] * r[1] - w[1] * r[0]) / den;
    if (u <= 1e-6 || u >= 1 - 1e-6 || t2 < -1e-9 || t2 > 1 + 1e-9) return;
    const ray = cam.ray(sA[0] + r[0] * u, sA[1] + r[1] * u), t = segT(ray, M.pos[a], M.pos[b]), p = lerp3(M.pos[a], M.pos[b], t);
    if (!visible(M, cam, p)) return;
    const tol = 1e-4;
    cr.push(t < tol ? { kind: 'v', v: a, p: M.pos[a].slice(), u } : t > 1 - tol ? { kind: 'v', v: b, p: M.pos[b].slice(), u } : { kind: 'e', a, b, t, p, u });
  });
  cr.sort((x, y) => x.u - y.u);
  const seq = [A];
  cr.forEach(c => { const l = seq[seq.length - 1]; if (c.kind === 'v' && l.kind === 'v' && l.v === c.v) return; if (len(sub(c.p, l.p)) < M.scale * 1e-5) return; seq.push(c); });
  const l = seq[seq.length - 1];
  if (len(sub(B.p, l.p)) >= M.scale * 1e-5) seq.push(B); else seq[seq.length - 1] = B;
  const faces = [];
  for (let i = 0; i + 1 < seq.length; i++) {
    const fa = incident(M, seq[i]), fb = incident(M, seq[i + 1]), sh = fa.filter(x => fb.includes(x));
    if (!sh.length) return null;
    faces.push(sh.length === 1 ? sh[0] : -1);
  }
  return { seq, faces };
}

function newVert(M, p, eps) {
  for (let i = 0; i < M.pos.length; i++) if (len(sub(M.pos[i], p)) < eps) return i;
  M.pos.push(p.slice());
  return M.pos.length - 1;
}
function pointOnEdge(M, P, eps) { 
  for (let i = 0; i < M.pos.length; i++) if (len(sub(M.pos[i], P)) < eps) return i;
  for (const f of M.faces) {
    const n = f.v.length;
    for (let k = 0; k < n; k++) {
      const x = f.v[k], y = f.v[(k + 1) % n], a = M.pos[x], ab = sub(M.pos[y], a), l2 = dot(ab, ab);
      const t = l2 ? dot(sub(P, a), ab) / l2 : 0;
      if (t <= 0 || t >= 1 || len(sub(P, lerp3(a, M.pos[y], t))) >= eps) continue;
      M.pos.push(P.slice());
      const id = M.pos.length - 1;
      insertOnEdge(M, x, y, [{ id, t }]);
      return id;
    }
  }
  return -1;
}
function affineUV(M, F, p) { 
  const P0 = M.pos[F.v[0]], n = F.v.length;
  let best = -1, j = 1, k = 2;
  for (let a = 1; a < n; a++) for (let b = a + 1; b < n; b++) { const c = len(cross(sub(M.pos[F.v[a]], P0), sub(M.pos[F.v[b]], P0))); if (c > best) { best = c; j = a; k = b; } }
  if (best < 1e-12) return F.uv[0].slice();
  const u = sub(M.pos[F.v[j]], P0), v = sub(M.pos[F.v[k]], P0), w = sub(p, P0);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), det = uu * vv - uv * uv, wu = dot(w, u), wv = dot(w, v);
  const al = (wu * vv - wv * uv) / det, be = (wv * uu - wu * uv) / det;
  return [F.uv[0][0] + al * (F.uv[j][0] - F.uv[0][0]) + be * (F.uv[k][0] - F.uv[0][0]), F.uv[0][1] + al * (F.uv[j][1] - F.uv[0][1]) + be * (F.uv[k][1] - F.uv[0][1])];
}
function extendToEdge(M, F, p, dir, eps) { 
  const q = proj2(faceNormal(M, F)), P2 = q(p), D2 = q(add(p, dir)), d = [D2[0] - P2[0], D2[1] - P2[1]], n = F.v.length;
  let best = null;
  for (let k = 0; k < n; k++) {
    const x = M.pos[F.v[k]], y = M.pos[F.v[(k + 1) % n]], X = q(x), Y = q(y), s = [Y[0] - X[0], Y[1] - X[1]], den = d[0] * s[1] - d[1] * s[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = [X[0] - P2[0], X[1] - P2[1]], u = (w[0] * s[1] - w[1] * s[0]) / den, t = (w[0] * d[1] - w[1] * d[0]) / den;
    if (u > 1e-9 && t >= -1e-9 && t <= 1 + 1e-9 && (!best || u < best.u)) best = { u, t: Math.min(1, Math.max(0, t)), x, y };
  }
  return best ? pointOnEdge(M, lerp3(best.x, best.y, best.t), eps) : -1;
}
function splitFace(M, F, run) { 
  const a = run[0], b = run[run.length - 1], n = F.v.length, ia = F.v.indexOf(a), ib = F.v.indexOf(b), inner = run.slice(1, -1);
  if (a === b || ia < 0 || ib < 0) return;
  if (!inner.length && ((ia + 1) % n === ib || (ib + 1) % n === ia)) return;
  const seg = (i, j) => { const o = []; for (let k = i; ; k = (k + 1) % n) { o.push(k); if (k === j) break; } return o; };
  const uvIn = F.uv ? inner.map(v => affineUV(M, F, M.pos[v])) : null;
  const mk = (S, ri, ru) => ({ v: S.map(k => F.v[k]).concat(ri), uv: F.uv ? S.map(k => F.uv[k].slice()).concat(ru) : null, origin: F.origin });
  const A = mk(seg(ia, ib), inner.slice().reverse(), uvIn && uvIn.slice().reverse()), B = mk(seg(ib, ia), inner, uvIn);
  M.faces.splice(M.faces.indexOf(F), 1, A, B);
}
function applyRun(M, run, eps) {
  const inF = new Set();
  M.faces.forEach(f => f.v.forEach(v => inF.add(v)));
  const need = [run.v[0], run.v[run.v.length - 1]].filter(v => inF.has(v));
  const cands = M.faces.filter(f => f.origin === run.f && need.every(v => f.v.includes(v)));
  if (!cands.length) return;
  const mid = run.v.length > 2 ? M.pos[run.v[1]] : lerp3(M.pos[run.v[0]], M.pos[run.v[1]], 0.5);
  const F = cands.length === 1 ? cands[0] : (cands.find(f => inPoly(M, f, mid)) || cands[0]), v = run.v.slice();
  if (!F.v.includes(v[0])) { const b = extendToEdge(M, F, M.pos[v[0]], sub(M.pos[v[0]], M.pos[v[1]]), eps); if (b < 0) return; v.unshift(b); }
  const n = v.length;
  if (!F.v.includes(v[n - 1])) { const b = extendToEdge(M, F, M.pos[v[n - 1]], sub(M.pos[v[n - 1]], M.pos[v[n - 2]]), eps); if (b < 0) return; v.push(b); }
  splitFace(M, F, v);
}
function knife(M0, pts, faces) { 
  const M = clone(M0), eps = M.scale * 1e-4;
  const vid = pts.map(d => {
    if (d.kind === 'v') return d.v;
    const id = d.kind === 'e' ? pointOnEdge(M, d.p, eps) : -1;
    return id >= 0 ? id : newVert(M, d.p, eps);
  });
  const runs = [];
  let cur = null;
  for (let i = 0; i < faces.length; i++) {
    const a = vid[i], b = vid[i + 1], f = faces[i];
    if (f < 0 || a === b) { cur = null; continue; }
    if (cur && cur.f === f && cur.v[cur.v.length - 1] === a) cur.v.push(b);
    else { cur = { f, v: [a, b] }; runs.push(cur); }
  }
  runs.forEach(r => applyRun(M, r, eps));
  M.faces = M.faces.filter(f => f.v.length >= 3);
  return M;
}

g.JSIMesh = { fromSoup, clone, toSoup, ekey, ringOf, ringSegments, loopCut, edgeAt, faceEdgeAt, rayFaces, snapAt, resolvePath, knife };
if (typeof module !== 'undefined') module.exports = g.JSIMesh;
})(typeof window !== 'undefined' ? window : globalThis);
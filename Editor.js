(() => {
'use strict';
const $ = s => document.querySelector(s);
const view = $('#viewport');

/* ---------- Escena ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // ligero para PCs de gama baja
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2b2e);
const persp = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
persp.position.set(5, 4, 6);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
let camera = persp, orthoH = 4;
function fitOrtho() {
  const a = view.clientWidth / Math.max(1, view.clientHeight);
  ortho.left = -orthoH * a; ortho.right = orthoH * a; ortho.top = orthoH; ortho.bottom = -orthoH; ortho.updateProjectionMatrix();
}
const grid = new THREE.GridHelper(20, 20, 0x777777, 0x3a3a3a);
const axes = new THREE.AxesHelper(2);
scene.add(grid, axes);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(5, 10, 7);
scene.add(sun);
{ // entorno suave para que los metales y el brillo se vean bien
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#d5deea'); gr.addColorStop(0.5, '#7a8190'); gr.addColorStop(1, '#2a2c31');
  cx.fillStyle = gr; cx.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(cv); tex.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex).texture; pm.dispose();
}
const root = new THREE.Group(); // aquí viven los objetos editables
scene.add(root);

// Renderizado bajo demanda: solo dibuja cuando algo cambió
let need = true;
const render = () => { need = true; };
const CLAY = new THREE.MeshStandardMaterial({ color: 0xb4b8c0, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
const WIRE = new THREE.MeshBasicMaterial({ color: 0xb4b8c0, wireframe: true });
let viewMode = 'mat'; // mat = materiales, solid = sólido, wire = alámbrico
let refsReady = false; // se activa cuando ya existe el sistema de imágenes de referencia (más abajo en este archivo)
(function loop() {
  requestAnimationFrame(loop);
  if (!need) return;
  need = false;
  if (refsReady) refSync();
  const swap = viewMode !== 'mat';
  if (swap) root.children.forEach(o => { o._m = o.material; o.material = viewMode === 'wire' ? WIRE : CLAY; });
  renderer.render(scene, camera);
  if (swap) root.children.forEach(o => { o.material = o._m; });
})();
new ResizeObserver(() => {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); persp.aspect = w / h; persp.updateProjectionMatrix(); fitOrtho(); render();
}).observe(view);

const orbit = new THREE.OrbitControls(camera, renderer.domElement);
orbit.addEventListener('change', () => { render(); autoPerspCheck(); });
const tc = new THREE.TransformControls(camera, renderer.domElement);
scene.add(tc);
tc.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
tc.addEventListener('change', () => { refreshProps(); render(); });
tc.addEventListener('mouseUp', () => { if (edit) finishEditDrag(); else commit(); });

/* ---------- Primitivas ---------- */
const GEO = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: () => new THREE.ConeGeometry(0.5, 1, 24),
  plane: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  torus: () => new THREE.TorusGeometry(0.4, 0.15, 12, 24).rotateX(Math.PI / 2),
  ico: () => new THREE.IcosahedronGeometry(0.5, 1)
};
const LABEL = { box: 'Cubo', sphere: 'Esfera', cylinder: 'Cilindro', cone: 'Cono', plane: 'Plano', torus: 'Toro', ico: 'Icosfera' };
const ICON = { box: '▣', sphere: '●', cylinder: '▥', cone: '▲', plane: '▭', torus: '◎', ico: '⬢' };
const counters = {};

function addObject(type, d = {}) {
  const m = d.material || {};
  const mat = new THREE.MeshStandardMaterial({
    color: m.color || '#9aa4b2', metalness: m.metalness ?? 0.1, roughness: m.roughness ?? 0.6,
    wireframe: !!m.wireframe, opacity: m.opacity ?? 1, transparent: (m.opacity ?? 1) < 1, side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide
  });
  const o = new THREE.Mesh(GEO[type](), mat);
  o.userData.type = type;
  counters[type] = (counters[type] || 0) + 1;
  o.name = d.name || `${LABEL[type]}.${String(counters[type]).padStart(3, '0')}`;
  if (d.position) o.position.fromArray(d.position);
  if (d.rotation) o.rotation.set(d.rotation[0], d.rotation[1], d.rotation[2]);
  if (d.scale) o.scale.fromArray(d.scale);
  if (d.vertices) {
    if (d.soup) { o.geometry.dispose(); o.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(d.vertices, 3)); o.userData.soup = true; o.userData.smooth = !!d.smooth; }
    else { const P = o.geometry.attributes.position; P.array.set(d.vertices); P.needsUpdate = true; }
    shade(o); o.userData.edited = true;
  }
  if (d.soup && Array.isArray(d.faces) && d.faces.reduce((s, n) => s + n, 0) * 3 === o.geometry.attributes.position.count) o.userData.faceTris = d.faces;
  if (Array.isArray(d.uv) && o.geometry.attributes.uv && d.uv.length === o.geometry.attributes.uv.count * 2) {
    o.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2)); o.userData.customUV = true;
  }
  if (typeof m.map === 'string' && m.map.startsWith('data:image/')) setTexture(o, m.map);
  if (d.visible === false) o.visible = false;
  root.add(o);
  return o;
}
function disposeObj(o) { o.geometry.dispose(); o.material.dispose(); }

/* ---------- Selección ---------- */
let sel = null;
function select(o) {
  if (edit) exitEdit();
  sel = o || null;
  if (sel) tc.attach(sel); else tc.detach();
  uvRebuild();
  refreshProps(); refreshList(); render();
}
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = null, downOnGizmo = false;
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; downOnGizmo = tc.axis !== null; });
renderer.domElement.addEventListener('pointerup', e => {
  if (noPick) return;
  if (!down || downOnGizmo || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  if (edit) return editPick(e);
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(root.children.filter(o => o.visible), false)[0];
  select(hit ? hit.object : null);
});

/* ---------- Modo edición (Tab): vértice / arista / malla ---------- */
let edit = false, ed = null;
const pivot = new THREE.Object3D();
scene.add(pivot);

function enterEdit() {
  if (!sel) return toast('Selecciona un objeto primero');
  const o = sel, G = o.geometry, P = G.attributes.position, I = G.index;
  const vid = [], map = new Map(), uniq = [];
  // Une los vértices duplicados (misma posición) para que se muevan juntos
  for (let i = 0; i < P.count; i++) {
    const k = [P.getX(i), P.getY(i), P.getZ(i)].map(v => Math.round(v * 1e4)).join();
    let u = map.get(k);
    if (u === undefined) { u = uniq.length; map.set(k, u); uniq.push({ idx: [] }); }
    uniq[u].idx.push(i); vid[i] = u;
  }
  const pv = u => new THREE.Vector3().fromBufferAttribute(P, uniq[u].idx[0]);
  const cnt = I ? I.count : P.count, vi = j => (I ? I.getX(j) : j);
  const tris = [], nrm = [], em = new Map();
  const ft = o.userData.faceTris; // topología guardada: cada cara es un rango de triángulos
  let fOf = null;
  if (ft && !I && ft.reduce((s, n) => s + n, 0) * 3 === P.count) { fOf = []; let c0 = 0; ft.forEach((n, i) => { for (let k = 0; k < n; k++) fOf[c0++] = i; }); }
  for (let j = 0; j < cnt; j += 3) {
    const t = [vid[vi(j)], vid[vi(j + 1)], vid[vi(j + 2)]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) { tris.push(null); nrm.push(null); continue; }
    const a = pv(t[0]);
    nrm.push(pv(t[1]).sub(a).cross(pv(t[2]).sub(a)).normalize());
    tris.push(t);
    const ti = tris.length - 1;
    [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([x, y]) => {
      const k = x < y ? x + '_' + y : y + '_' + x;
      let e = em.get(k);
      if (!e) { e = { a: Math.min(x, y), b: Math.max(x, y), t: [] }; em.set(k, e); }
      e.t.push(ti);
    });
  }
  // Triángulos coplanares vecinos = una misma cara; su diagonal no se dibuja como arista
  const par = tris.map((_, i) => i), find = x => (par[x] === x ? x : (par[x] = find(par[x])));
  const edges = [];
  em.forEach(e => {
    if (e.t.length === 2 && (fOf ? fOf[e.t[0]] === fOf[e.t[1]] : nrm[e.t[0]].dot(nrm[e.t[1]]) > 0.9999)) par[find(e.t[0])] = find(e.t[1]);
    else edges.push([e.a, e.b]);
  });
  const fm = new Map(), faceOfTri = [];
  tris.forEach((t, i) => {
    if (!t) return;
    const r = find(i);
    if (!fm.has(r)) fm.set(r, { tris: [], verts: new Set() });
    const f = fm.get(r); f.tris.push(i); t.forEach(v => f.verts.add(v));
  });
  const faces = [...fm.values()];
  faces.forEach((f, k) => f.tris.forEach(t => { faceOfTri[t] = k; }));

  const common = { depthTest: false };
  ed = {
    obj: o, uniq, edges, faces, faceOfTri, tris, selV: new Set(), mode: 'v', base: null,
    pts: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ ...common, size: 8, sizeAttenuation: false, vertexColors: true })),
    ln: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ ...common, vertexColors: true })),
    fm: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ ...common, color: 0xe8872b, transparent: true, opacity: 0.5, side: THREE.DoubleSide }))
  };
  [ed.pts, ed.ln, ed.fm].forEach(m => { m.renderOrder = 10; m.frustumCulled = false; o.add(m); });
  edit = true;
  tc.detach(); refreshEdit(); updateTitle(); updateTools();
}
function exitEdit() {
  if (!edit) return;
  [ed.pts, ed.ln, ed.fm].forEach(m => { ed.obj.remove(m); m.geometry.dispose(); m.material.dispose(); });
  edit = false; ed = null; tc.detach(); updateTitle(); updateTools();
}
function toggleEdit() {
  if (edit) { exitEdit(); if (sel) tc.attach(sel); render(); } else enterEdit();
}
function setEMode(m) {
  if (!edit) enterEdit();
  if (!edit) return;
  ed.mode = m; refreshEdit(); updateTools();
}
function updateTools() {
  $('#emodes').hidden = !edit; setHint();
  document.querySelectorAll('[data-act="edit"]').forEach(b => b.classList.toggle('on', edit));
  document.querySelectorAll('[data-emode]').forEach(b => b.classList.toggle('on', edit && ed.mode === b.dataset.emode));
}
function refreshEdit() {
  const o = ed.obj, P = o.geometry.attributes.position, sv = ed.selV;
  const OR = [0.91, 0.53, 0.17], GR = [0.9, 0.9, 0.95], LB = [0.45, 0.6, 0.85];
  const U = ed.uniq.map(u => [P.getX(u.idx[0]), P.getY(u.idx[0]), P.getZ(u.idx[0])]);
  const mk = (pos, col) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  };
  const set = (m, g) => { m.geometry.dispose(); m.geometry = g; };
  const pc = [], lp = [], lc = [], fp = [];
  U.forEach((p, i) => pc.push(...(sv.has(i) ? OR : GR)));
  ed.edges.forEach(([a, b]) => { lp.push(...U[a], ...U[b]); const c = sv.has(a) && sv.has(b) ? OR : LB; lc.push(...c, ...c); });
  if (ed.mode === 'f') ed.faces.forEach(f => {
    if ([...f.verts].every(v => sv.has(v))) f.tris.forEach(t => ed.tris[t].forEach(v => fp.push(...U[v])));
  });
  set(ed.pts, mk(U.flat(), pc)); set(ed.ln, mk(lp, lc)); set(ed.fm, mk(fp));
  ed.pts.visible = ed.mode === 'v';
  render();
}
function updatePivot() {
  if (!ed.selV.size) { tc.detach(); render(); return; }
  const o = ed.obj, P = o.geometry.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  o.updateMatrixWorld(true);
  ed.selV.forEach(i => { v.fromBufferAttribute(P, ed.uniq[i].idx[0]).applyMatrix4(o.matrixWorld); c.add(v); });
  pivot.position.copy(c.divideScalar(ed.selV.size));
  pivot.rotation.set(0, 0, 0); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(true);
  tc.attach(pivot); render();
}
const segDist = (px, py, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};
function editPick(e) {
  const o = ed.obj, r = renderer.domElement.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top, P = o.geometry.attributes.position;
  o.updateMatrixWorld(true);
  const S = ed.uniq.map(u => {
    const p = new THREE.Vector3().fromBufferAttribute(P, u.idx[0]).applyMatrix4(o.matrixWorld).project(camera);
    return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height, z: p.z };
  });
  let hit = null, best;
  if (ed.mode === 'v') {
    best = 14; S.forEach((s, i) => { const d = Math.hypot(s.x - mx, s.y - my); if (s.z < 1 && d < best) { best = d; hit = [i]; } });
  } else if (ed.mode === 'e') {
    best = 10; ed.edges.forEach(([a, b]) => { const d = segDist(mx, my, S[a], S[b]); if (d < best) { best = d; hit = [a, b]; } });
  } else {
    mouse.set(mx / r.width * 2 - 1, -(my / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
    const h = ray.intersectObject(o, false)[0];
    const f = h && ed.faceOfTri[h.faceIndex];
    if (f !== undefined && f !== null) hit = [...ed.faces[f].verts];
  }
  if (!e.shiftKey) ed.selV.clear();
  if (hit) {
    if (e.shiftKey && hit.every(i => ed.selV.has(i))) hit.forEach(i => ed.selV.delete(i));
    else hit.forEach(i => ed.selV.add(i));
  }
  updatePivot(); refreshEdit();
}
// Mover / rotar / escalar la selección: el gizmo actúa sobre un pivote y se aplica a los vértices
function startEditDrag() {
  if (!edit || !ed.selV.size) return;
  const o = ed.obj, P = o.geometry.attributes.position;
  pivot.updateMatrixWorld(true); o.updateMatrixWorld(true);
  ed.M0i = pivot.matrixWorld.clone().invert(); ed.Wi = o.matrixWorld.clone().invert(); ed.moved = false;
  ed.base = [...ed.selV].map(i => ({ i, w: new THREE.Vector3().fromBufferAttribute(P, ed.uniq[i].idx[0]).applyMatrix4(o.matrixWorld) }));
}
function dragEdit() {
  if (!edit || !ed.base) return;
  pivot.updateMatrixWorld(true);
  const D = new THREE.Matrix4().multiplyMatrices(pivot.matrixWorld, ed.M0i), P = ed.obj.geometry.attributes.position, p = new THREE.Vector3();
  ed.base.forEach(b => {
    p.copy(b.w).applyMatrix4(D).applyMatrix4(ed.Wi);
    ed.uniq[b.i].idx.forEach(k => P.setXYZ(k, p.x, p.y, p.z));
  });
  P.needsUpdate = true; ed.moved = true; refreshEdit();
}
function finishEditDrag() {
  if (!ed || !ed.base) return;
  const moved = ed.moved; ed.base = null;
  if (!moved) return;
  shade(ed.obj);
  ed.obj.userData.edited = true;
  updatePivot(); commit();
}
tc.addEventListener('mouseDown', startEditDrag);
tc.addEventListener('objectChange', dragEdit);

/* ---------- Transformación modal: G / R / S + mover el mouse ---------- */
let mod = null, leftDown = false, noPick = false, mxy = [0, 0];
const hint = $('#hint');
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const MT = { translate: 'Mover', rotate: 'Rotar', scale: 'Escalar' };
function setHint() {
  hint.textContent = lc
    ? (lc.phase ? 'Deslizar el corte   ·   mové el mouse   ·   clic o Enter: aplicar   ·   Esc / clic derecho: dejarlo centrado'
      : 'Loop Cut: ' + lc.n + (lc.n > 1 ? ' cortes' : ' corte') + '   ·   rueda o + / −: cantidad   ·   clic: elegir y deslizar   ·   Enter: aplicar centrado   ·   Esc: cancelar   ·   botón central: girar la vista')
    : kn ? 'Cuchillo: ' + kn.pts.length + (kn.pts.length === 1 ? ' punto' : ' puntos') + '   ·   clic: agregar punto   ·   Enter: cortar   ·   Backspace: quitar el último   ·   Esc: cancelar   ·   botón central: girar la vista'
    : mod ? `${MT[mod.mode]}${mod.axis ? ' · eje ' + mod.axis.toUpperCase() : ''}   ·   X Y Z eje   ·   clic aplicar   ·   Esc / clic derecho cancelar`
    : edit ? 'Tab salir   ·   1 2 3 modo   ·   G R S transformar   ·   Ctrl+R Loop Cut   ·   K cuchillo'
    : 'G mover   ·   R rotar   ·   S escalar   ·   Tab modo edición   ·   Ctrl+Z deshacer';
}
function planePt(xy, c) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((xy[0] - r.left) / r.width * 2 - 1, -((xy[1] - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), c);
  return ray.ray.intersectPlane(pl, new THREE.Vector3()) || c.clone();
}
function startModal(mode) {
  if (mod) return;
  if (!(edit ? ed.selV.size : sel)) return toast(edit ? 'Selecciona vértices, aristas o caras primero' : 'Selecciona un objeto primero');
  const c = new THREE.Vector3();
  if (edit) { startEditDrag(); c.copy(pivot.position); } else sel.getWorldPosition(c);
  mod = { mode, axis: null, c, start: mxy.slice(), hold: leftDown, p: planePt(mxy, c) };
  if (!edit) Object.assign(mod, { p0: sel.position.clone(), q0: sel.quaternion.clone(), s0: sel.scale.clone() });
  tc.enabled = false; orbit.enabled = false; setHint();
}
function updateModal() {
  if (!mod) return;
  const m = mod, ax = m.axis ? AX[m.axis] : null, r = renderer.domElement.getBoundingClientRect();
  const sp = m.c.clone().project(camera), cx = r.left + (sp.x + 1) / 2 * r.width, cy = r.top + (1 - sp.y) / 2 * r.height;
  const view = camera.getWorldDirection(new THREE.Vector3()).negate();
  if (m.mode === 'translate') {
    let d = planePt(mxy, m.c).sub(m.p);
    if (ax) d = ax.clone().multiplyScalar(d.dot(ax));
    if (edit) pivot.position.copy(m.c).add(d); else sel.position.copy(m.p0).add(d);
  } else if (m.mode === 'rotate') {
    let a = -(Math.atan2(mxy[1] - cy, mxy[0] - cx) - Math.atan2(m.start[1] - cy, m.start[0] - cx));
    if (ax && ax.dot(view) < 0) a = -a;
    const q = new THREE.Quaternion().setFromAxisAngle(ax || view, a);
    if (edit) pivot.quaternion.copy(q); else sel.quaternion.copy(q).multiply(m.q0);
  } else {
    const f = Math.max(Math.hypot(mxy[0] - cx, mxy[1] - cy), 1) / Math.max(Math.hypot(m.start[0] - cx, m.start[1] - cy), 30);
    const s = new THREE.Vector3(1, 1, 1);
    if (m.axis) s[m.axis] = f; else s.setScalar(f);
    if (edit) pivot.scale.copy(s); else sel.scale.copy(m.s0).multiply(s).clampScalar(0.001, 1e6);
  }
  if (edit) dragEdit(); else { refreshProps(); render(); }
}
function endModal() { mod = null; tc.enabled = true; orbit.enabled = true; setHint(); render(); }
function confirmModal() {
  if (!mod) return;
  if (edit) finishEditDrag(); else { commit(); refreshProps(); }
  endModal();
}
function cancelModal() {
  if (!mod) return;
  if (edit) { pivot.position.copy(mod.c); pivot.quaternion.set(0, 0, 0, 1); pivot.scale.set(1, 1, 1); dragEdit(); ed.base = null; }
  else { sel.position.copy(mod.p0); sel.quaternion.copy(mod.q0); sel.scale.copy(mod.s0); refreshProps(); }
  endModal();
}
// Captura el mouse antes que la cámara y el gizmo mientras dura la transformación
window.addEventListener('pointermove', e => { mxy = [e.clientX, e.clientY]; updateModal(); cutMove(); }, true);
window.addEventListener('pointerdown', e => {
  if (e.button === 0) leftDown = true;
  if ((lc || kn) && e.button !== 1) { e.stopPropagation(); e.preventDefault(); cutClick(e); return; }
  if (!mod) return;
  e.stopPropagation(); e.preventDefault();
  if (e.button === 2) cancelModal();
  else if (e.button === 0 && !mod.hold) { noPick = true; confirmModal(); }
}, true);
window.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  leftDown = false;
  if (mod && mod.hold) { noPick = true; confirmModal(); } // G/R/S con el clic izquierdo mantenido: al soltar se aplica
  if (noPick) setTimeout(() => { noPick = false; });
}, true);

/* ---------- Menú de edición (Tab), selección y vistas ---------- */
function selOp(k) {
  if (!edit) return toast('Entra al modo edición (Tab) para seleccionar vértices');
  const n = ed.uniq.length, sv = ed.selV;
  if (k === 'all') for (let i = 0; i < n; i++) sv.add(i);
  else if (k === 'none') sv.clear();
  else for (let i = 0; i < n; i++) { if (sv.has(i)) sv.delete(i); else sv.add(i); }
  updatePivot(); refreshEdit();
}
function setView(x, y, z, free) { // free: no cambia la proyección
  if (!free && $('#autopersp').checked && camera !== ortho) setProj('ortho', true); // vistas numéricas en ortográfica (Auto Perspective)
  const d = camera.position.distanceTo(orbit.target) || 8;
  camera.position.copy(orbit.target).addScaledVector(new THREE.Vector3(x, y, z).normalize(), d);
  orbit.update(); render();
}
function frameAll() {
  if (!root.children.length) return toast('La escena está vacía');
  const b = new THREE.Box3().setFromObject(root), c = b.getCenter(new THREE.Vector3());
  const dist = b.getSize(new THREE.Vector3()).length() * 1.4 + 1;
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c); camera.position.copy(c).addScaledVector(dir, dist); orbit.update(); render();
}

/* ---------- Corte en bucle (Ctrl+R) y Cuchillo (K) sobre la malla poligonal (meshcut.js) ---------- */
let lc = null, kn = null, cutQ = false;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function cutNav(on) { orbit.mouseButtons.MIDDLE = on ? THREE.MOUSE.ROTATE : THREE.MOUSE.DOLLY; } // con una herramienta de corte, el botón central gira la vista (para seguir el loop por detrás)
function camOf(o) { // cámara para JSIMesh: todo se calcula en el espacio local del objeto (respeta posición, rotación y escala)
  o.updateMatrixWorld(true);
  const W = o.matrixWorld.clone(), Wi = W.clone().invert(), v = new THREE.Vector3();
  return {
    project(p) {
      camera.updateMatrixWorld();
      const r = renderer.domElement.getBoundingClientRect();
      v.set(p[0], p[1], p[2]).applyMatrix4(W).project(camera);
      return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top];
    },
    ray(sx, sy) {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set((sx - r.left) / r.width * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const a = ray.ray.origin.clone().applyMatrix4(Wi), b = ray.ray.origin.clone().add(ray.ray.direction).applyMatrix4(Wi);
      return { o: a.toArray(), d: b.sub(a).toArray() };
    }
  };
}
function meshOf(o) { // malla poligonal del objeto, con UV y la topología guardada si existe
  const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  return JSIMesh.fromSoup(g.attributes.position.array, g.attributes.uv ? g.attributes.uv.array : null, o.userData.faceTris);
}
function commitMesh(o, M, mode) { // escribe la malla cortada en la geometría real y reconstruye la edición
  const { P, UV, faceTris } = JSIMesh.toSoup(M);
  exitEdit();
  applyGeo(o, P, undefined, faceTris);
  if (UV) { o.geometry.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); o.userData.customUV = true; uvRebuild(); }
  enterEdit(); setEMode(mode); commit(); render();
}
function lineObj(o, color) {
  const l = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, depthTest: false }));
  l.renderOrder = 11; l.frustumCulled = false; o.add(l);
  return l;
}
function setPos(obj, pos, col) {
  obj.geometry.dispose();
  obj.geometry = new THREE.BufferGeometry();
  obj.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) obj.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}
function dropObj(obj) { if (obj.parent) obj.parent.remove(obj); obj.geometry.dispose(); obj.material.dispose(); }
function cutMove() { // un cálculo por cuadro como máximo
  if (cutQ) return;
  cutQ = true;
  requestAnimationFrame(() => { cutQ = false; if (lc) loopMove(); else if (kn) knifeMove(); });
}

/* Loop Cut: elegir arista, cantidad de cortes (rueda o + / -), clic para fijar y deslizar con el mouse */
function startLoopCut() {
  if (!edit) return toast('Ctrl+R funciona en modo edición (Tab)');
  if (lc || kn || mod) return;
  const o = ed.obj, M = meshOf(o), qe = new Set();
  M.faces.forEach(f => { if (f.v.length === 4) f.v.forEach((v, k) => qe.add(JSIMesh.ekey(v, f.v[(k + 1) % 4]))); });
  if (!qe.size) return toast('Esta malla no tiene quads para cortar', true);
  lc = { o, M, qe, ok: (a, b) => qe.has(JSIMesh.ekey(a, b)), cam: camOf(o), phase: 0, n: 1, f: 0, ring: null, edge: null, line: lineObj(o, 0xffe14d) };
  tc.enabled = false; cutNav(true); loopMove();
}
function loopMove() {
  if (!lc) return;
  if (lc.phase) {
    const d = (mxy[0] - lc.start[0]) * lc.dir[0] + (mxy[1] - lc.start[1]) * lc.dir[1];
    lc.f = clamp(2 * d / (lc.len * lc.len), -0.95, 0.95);
  } else {
    // como en Blender: la cara bajo el cursor elige la arista más cercana; si el cursor está fuera de la malla, se busca una arista cercana
    lc.edge = JSIMesh.faceEdgeAt(lc.M, lc.cam, mxy[0], mxy[1], lc.ok) || JSIMesh.edgeAt(lc.M, lc.cam, mxy[0], mxy[1], 12, lc.ok);
    lc.ring = lc.edge && JSIMesh.ringOf(lc.M, lc.edge.a, lc.edge.b);
  }
  loopDraw();
}
function loopDraw() {
  const pos = [];
  if (lc.ring) JSIMesh.ringSegments(lc.M, lc.ring, lc.n, lc.f).forEach(([a, b]) => pos.push(...a, ...b));
  setPos(lc.line, pos); setHint(); render();
}
function loopN(d) { lc.n = clamp(lc.n + d, 1, 30); loopDraw(); }
function startSlide() {
  const e = lc.ring.edges.get(JSIMesh.ekey(lc.edge.a, lc.edge.b)), s = lc.cam.project(lc.M.pos[e.s]), t = lc.cam.project(lc.M.pos[e.o]);
  lc.phase = 1; lc.start = mxy.slice(); lc.dir = [t[0] - s[0], t[1] - s[1]]; lc.len = Math.hypot(lc.dir[0], lc.dir[1]) || 1;
  setHint();
}
function confirmLoop() {
  if (!lc || !lc.ring) return toast('Apunta a una arista con quads para cortar');
  const o = lc.o, mode = ed.mode, n = lc.n, M2 = JSIMesh.loopCut(JSIMesh.clone(lc.M), lc.ring, n, lc.f);
  endCut(); commitMesh(o, M2, mode);
  toast(n > 1 ? n + ' cortes creados' : 'Corte creado');
}
function endCut() {
  if (!lc) return;
  dropObj(lc.line); lc = null; tc.enabled = true; cutNav(false); setHint(); render();
}

/* Knife: clic en vértices, aristas o caras; el recorrido cruza las aristas visibles que corta la línea en pantalla */
function startKnife() {
  if (!edit) return toast('K (cuchillo) funciona en modo edición (Tab)');
  if (lc || kn || mod) return;
  const o = ed.obj, dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  dots.renderOrder = 12; dots.frustumCulled = false; o.add(dots);
  kn = { o, M: meshOf(o), cam: camOf(o), pts: [], segs: [], hover: null, prev: null, line: lineObj(o, 0xffe14d), dots };
  tc.enabled = false; cutNav(true); knifeMove();
}
function knifeMove() {
  if (!kn) return;
  kn.hover = JSIMesh.snapAt(kn.M, kn.cam, mxy[0], mxy[1]);
  const last = kn.pts[kn.pts.length - 1];
  kn.prev = kn.hover && last ? JSIMesh.resolvePath(kn.M, kn.cam, last, kn.hover) : null;
  knifeDraw();
}
function knifeDraw() {
  const lp = [], dp = [], dc = [], OR = [0.94, 0.54, 0.22], YE = [1, 0.88, 0.3], CY = [0.4, 0.9, 1];
  const chain = kn.segs.flatMap(s => s.seq);
  for (let i = 0; i + 1 < chain.length; i++) lp.push(...chain[i].p, ...chain[i + 1].p);
  chain.forEach(d => { dp.push(...d.p); dc.push(...(kn.pts.includes(d) ? OR : YE)); });
  if (kn.prev) {
    const s = kn.prev.seq;
    for (let i = 0; i + 1 < s.length; i++) lp.push(...s[i].p, ...s[i + 1].p);
    s.slice(1, -1).forEach(d => { dp.push(...d.p); dc.push(...YE); });
  }
  if (kn.hover) { dp.push(...kn.hover.p); dc.push(...CY); }
  setPos(kn.line, lp); setPos(kn.dots, dp, dc); setHint(); render();
}
function knifeAdd() {
  const h = kn.hover;
  if (!h) return toast('Apunta a una cara, arista o vértice visible');
  const last = kn.pts[kn.pts.length - 1];
  if (!last) { kn.pts.push(h); kn.segs.push({ seq: [h], faces: [] }); }
  else {
    if (Math.hypot(h.p[0] - last.p[0], h.p[1] - last.p[1], h.p[2] - last.p[2]) < kn.M.scale * 1e-5) return;
    const r = JSIMesh.resolvePath(kn.M, kn.cam, last, h);
    if (!r) return toast('Ese tramo no cruza caras visibles continuas', true);
    kn.pts.push(h); kn.segs.push({ seq: r.seq.slice(1), faces: r.faces });
  }
  kn.prev = null; knifeDraw();
}
function knifeBack() { if (kn.pts.length) { kn.pts.pop(); kn.segs.pop(); } knifeMove(); }
function knifeConfirm() {
  const seq = kn.segs.flatMap(s => s.seq), faces = kn.segs.flatMap(s => s.faces);
  if (seq.length < 2) return toast('Agrega al menos dos puntos al recorrido', true);
  const M2 = JSIMesh.knife(kn.M, seq, faces), o = kn.o, mode = ed.mode, same = M2.faces.length === kn.M.faces.length && M2.pos.length === kn.M.pos.length;
  endKnife();
  if (same) return toast('El recorrido no dividió ninguna cara', true);
  commitMesh(o, M2, mode); toast('Corte aplicado');
}
function endKnife() {
  if (!kn) return;
  dropObj(kn.line); dropObj(kn.dots); kn = null; tc.enabled = true; cutNav(false); setHint(); render();
}

/* Entrada de las dos herramientas */
function cutClick(e) {
  if (e.button === 0) noPick = true;
  if (lc) {
    if (e.button === 2) { if (lc.phase) { lc.f = 0; confirmLoop(); } else endCut(); }
    else if (e.button === 0) { if (lc.phase) confirmLoop(); else if (lc.ring) startSlide(); }
  } else if (kn) {
    if (e.button === 2) endKnife(); else if (e.button === 0) knifeAdd();
  }
}
function cutKey(e, k) {
  if (lc) {
    if (k === 'escape') { if (lc.phase) { lc.f = 0; confirmLoop(); } else endCut(); }
    else if (k === 'enter') confirmLoop();
    else if (k === '+' || k === '=' || k === 'arrowup' || k === 'pageup') loopN(1);
    else if (k === '-' || k === '_' || k === 'arrowdown' || k === 'pagedown') loopN(-1);
  } else if (k === 'escape') endKnife();
  else if (k === 'enter') knifeConfirm();
  else if (k === 'backspace') knifeBack();
}
window.addEventListener('wheel', e => { if (!lc) return; e.preventDefault(); e.stopPropagation(); loopN(e.deltaY < 0 ? 1 : -1); }, { capture: true, passive: false });

/* ---------- Editor UV (ventana izquierda) ---------- */
const uvw = $('#uvwin'), uvc = $('#uvcanvas'), uvx = uvc.getContext('2d');
let ue = null, uvHover = false, uvMode = 'v', uvShowOv = false, uvOvQ = false, uvM = [0, 0];
// ue: { o, A (atributo uv real), tris, glist (grupos: misma posición + mismo UV), gid, edges, isl, fot, sel, v: {s, x, y}, drag, tool, ov }
const uvPt = i => [ue.A.getX(i) * ue.v.s + ue.v.x, (1 - ue.A.getY(i)) * ue.v.s + ue.v.y];
function uvFit() {
  const r = uvc.getBoundingClientRect(), s = Math.min(r.width, r.height) * 0.84;
  ue.v = { s, x: (r.width - s) / 2, y: (r.height - s) / 2 };
}
function uvRebuild() {
  if (uvw.hidden) return;
  const o = sel, g = o && o.geometry;
  if (!o || !g.attributes.uv) { ue = null; return uvDraw(); }
  const P = g.attributes.position, A = g.attributes.uv, n = P.count, I = g.index, cnt = I ? I.count : n, vi = j => (I ? I.getX(j) : j);
  const groups = new Map(), gid = new Int32Array(n), glist = [], keep = ue && ue.o === o ? ue.v : null;
  for (let i = 0; i < n; i++) { // los puntos en la misma posición y con el mismo UV se mueven juntos
    const k = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4) + '|' + Math.round(A.getX(i) * 1e4) + ',' + Math.round(A.getY(i) * 1e4);
    let gi = groups.get(k);
    if (gi === undefined) { gi = glist.length; groups.set(k, gi); glist.push([]); }
    glist[gi].push(i); gid[i] = gi;
  }
  const tris = [], edges = [], seen = new Set();
  for (let j = 0; j + 2 < cnt; j += 3) {
    const t = [vi(j), vi(j + 1), vi(j + 2)];
    tris.push(t);
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3], ga = gid[a], gb = gid[b], key = ga < gb ? ga + '_' + gb : gb + '_' + ga;
      if (ga !== gb && !seen.has(key)) { seen.add(key); edges.push(a, b); }
    }
  }
  const isl = JSIMods.islandIds(tris.length, c => gid[tris[(c / 3) | 0][c % 3]]), ft = o.userData.faceTris;
  let fot = null;
  if (ft && !I && ft.reduce((s, m) => s + m, 0) === tris.length) { fot = []; let c0 = 0; ft.forEach((m, i) => { for (let k = 0; k < m; k++) fot[c0++] = i; }); }
  ue = { o, A, tris, glist, gid, edges, isl, fot, sel: new Set(), v: keep, drag: null, tool: null, ov: null };
  if (!keep) uvFit();
  if (uvShowOv) uvOverlapNow(); else uvDraw();
}
function uvOverlapNow() {
  if (!ue) return;
  const A = ue.A, tr = ue.tris;
  ue.ov = JSIMods.uvOverlap(tr.length, c => { const v = tr[(c / 3) | 0][c % 3]; return [A.getX(v), A.getY(v)]; }, 128);
  uvDraw();
}
function uvOvSoon() { if (uvOvQ) return; uvOvQ = true; requestAnimationFrame(() => { uvOvQ = false; if (uvShowOv) uvOverlapNow(); }); }
const inTri2 = (px, py, a, b, c) => {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]), d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]), d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
function uvDraw() {
  if (uvw.hidden) return;
  const r = uvc.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, c = uvx;
  if (uvc.width !== Math.round(r.width * dpr)) { uvc.width = Math.round(r.width * dpr); uvc.height = Math.round(r.height * dpr); }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#17171a'; c.fillRect(0, 0, r.width, r.height);
  if (!ue) { c.fillStyle = '#85858f'; c.font = '12px system-ui'; c.textAlign = 'center'; c.fillText('Selecciona un objeto', r.width / 2, r.height / 2); return; }
  const { s, x, y } = ue.v, m = ue.o.material.map, T = ue.tris, S = ue.sel;
  if (m && m.image) c.drawImage(m.image, x, y, s, s); else { c.fillStyle = '#222226'; c.fillRect(x, y, s, s); }
  c.lineWidth = 1; // cuadrícula de coordenadas (cada 0.1; más marcada en 0, 0.5 y 1)
  for (let i = 0; i <= 10; i++) {
    c.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.10)';
    c.beginPath(); c.moveTo(x + s * i / 10, y); c.lineTo(x + s * i / 10, y + s); c.moveTo(x, y + s * i / 10); c.lineTo(x + s, y + s * i / 10); c.stroke();
  }
  c.strokeStyle = '#7a7a84'; c.strokeRect(x, y, s, s);
  c.fillStyle = '#9a9aa4'; c.font = '10px system-ui'; c.textAlign = 'left'; c.fillText('0', x + 2, y + s + 11); c.fillText('0.5', x + s / 2 - 8, y + s + 11); c.textAlign = 'right'; c.fillText('1', x + s - 2, y + s + 11); c.fillText('1', x - 4, y + 9);
  const path = p => { c.beginPath(); c.moveTo(p[0][0], p[0][1]); c.lineTo(p[1][0], p[1][1]); c.lineTo(p[2][0], p[2][1]); c.closePath(); };
  if (T.length < 8000) T.forEach((t, i) => { c.fillStyle = 'hsla(' + ((ue.isl[i] * 67) % 360) + ',65%,55%,0.17)'; path(t.map(uvPt)); c.fill(); }); // cada isla con su color
  T.forEach(t => { if (t.every(v => S.has(v))) { c.fillStyle = 'rgba(240,138,56,.32)'; path(t.map(uvPt)); c.fill(); } });
  if (uvShowOv && ue.ov) { // superposiciones en rojo
    const N = ue.ov.N, cs = s / N;
    c.fillStyle = 'rgba(255,50,50,.6)';
    for (let i = 0; i < N * N; i++) if (ue.ov.mask[i]) c.fillRect(x + (i % N) * cs, y + (1 - (((i / N) | 0) + 1) / N) * s, cs + 0.5, cs + 0.5);
  }
  c.lineWidth = 1; c.strokeStyle = 'rgba(120,165,255,.9)'; c.beginPath();
  for (let i = 0; i < ue.edges.length; i += 2) { const a = ue.edges[i], b = ue.edges[i + 1]; if (S.has(a) && S.has(b)) continue; const pa = uvPt(a), pb = uvPt(b); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); }
  c.stroke();
  c.lineWidth = 2; c.strokeStyle = '#f08a38'; c.beginPath();
  for (let i = 0; i < ue.edges.length; i += 2) { const a = ue.edges[i], b = ue.edges[i + 1]; if (!(S.has(a) && S.has(b))) continue; const pa = uvPt(a), pb = uvPt(b); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); }
  c.stroke();
  ue.glist.forEach(l => {
    const on = S.has(l[0]);
    if (!on && uvMode !== 'v') return;
    const p = uvPt(l[0]), z = on ? 5 : 2.5;
    c.fillStyle = on ? '#f08a38' : '#e4e4e8'; c.fillRect(p[0] - z / 2, p[1] - z / 2, z, z);
  });
  const d = ue.drag;
  if (d && d.t === 'box') { c.setLineDash([4, 3]); c.lineWidth = 1; c.strokeStyle = '#f08a38'; c.strokeRect(d.mx, d.my, d.cx - d.mx, d.cy - d.my); c.setLineDash([]); }
  if (ue.tool) { c.fillStyle = '#f08a38'; c.font = '11px system-ui'; c.textAlign = 'left'; c.fillText({ move: 'Mover', rot: 'Rotar', scale: 'Escalar' }[ue.tool.m] + (ue.tool.axis ? ' · eje ' + ue.tool.axis.toUpperCase() : '') + ' · clic aplica, Esc cancela', 8, 14); }
}
function uvPos(e) { const r = uvc.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function uvTouch() { ue.A.needsUpdate = true; render(); uvDraw(); if (uvShowOv) uvOvSoon(); }
function uvNear(mx, my) { // grupo de puntos más cercano
  let best = 9, hit = -1;
  ue.glist.forEach((l, gi) => { const p = uvPt(l[0]), d = Math.hypot(p[0] - mx, p[1] - my); if (d < best) { best = d; hit = gi; } });
  return hit;
}
function uvEdgeNear(mx, my) {
  let best = 8, hit = null;
  for (let i = 0; i < ue.edges.length; i += 2) {
    const a = uvPt(ue.edges[i]), b = uvPt(ue.edges[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / l2)) : 0, d = Math.hypot(mx - (a[0] + u * dx), my - (a[1] + u * dy));
    if (d < best) { best = d; hit = [ue.edges[i], ue.edges[i + 1]]; }
  }
  return hit;
}
function uvTriAt(mx, my) {
  for (let t = ue.tris.length - 1; t >= 0; t--) { const p = ue.tris[t].map(uvPt); if (inTri2(mx, my, p[0], p[1], p[2])) return t; }
  return -1;
}
function uvTrisOf(t, mode) { // caras (o islas) a las que pertenece el triángulo
  const out = [];
  ue.tris.forEach((_, i) => { if (mode === 'i' ? ue.isl[i] === ue.isl[t] : ue.fot ? ue.fot[i] === ue.fot[t] : i === t) out.push(i); });
  return out;
}
function uvIdx(list) { // índices de vértice de una lista de triángulos, con sus puntos pegados (misma posición y UV)
  const r = [];
  list.forEach(t => ue.tris[t].forEach(v => ue.glist[ue.gid[v]].forEach(i => r.push(i))));
  return r;
}
function uvPick(mx, my) { // elemento bajo el cursor según el modo (vértice, arista, cara o isla)
  if (uvMode === 'v') { const gi = uvNear(mx, my); return gi >= 0 ? ue.glist[gi] : null; }
  if (uvMode === 'e') { const e = uvEdgeNear(mx, my); return e ? [...ue.glist[ue.gid[e[0]]], ...ue.glist[ue.gid[e[1]]]] : null; }
  const t = uvTriAt(mx, my);
  return t >= 0 ? uvIdx(uvTrisOf(t, uvMode)) : null;
}
function uvSetMode(m) {
  uvMode = m;
  if (ue) ue.sel.clear();
  document.querySelectorAll('[data-um]').forEach(b => b.classList.toggle('on', b.dataset.um === uvMode));
  uvDraw();
}
uvc.addEventListener('contextmenu', e => e.preventDefault());
uvc.addEventListener('pointerenter', () => { uvHover = true; });
uvc.addEventListener('pointerleave', () => { uvHover = false; });
uvc.addEventListener('pointerdown', e => {
  if (!ue) return;
  if (ue.tool) { e.preventDefault(); if (e.button === 2) uvToolEnd(false); else if (e.button === 0) uvToolEnd(true); return; }
  uvc.setPointerCapture(e.pointerId);
  const [mx, my] = uvPos(e);
  if (e.button === 1 || e.button === 2) { ue.drag = { t: 'pan', mx, my, x: ue.v.x, y: ue.v.y }; return; }
  const items = uvPick(mx, my);
  if (items) {
    const all = items.every(i => ue.sel.has(i));
    if (e.shiftKey && all) { items.forEach(i => ue.sel.delete(i)); return uvDraw(); }
    if (!all) { if (!e.shiftKey) ue.sel.clear(); items.forEach(i => ue.sel.add(i)); }
    ue.drag = { t: 'move', mx, my, moved: false, base: [...ue.sel].map(i => [i, ue.A.getX(i), ue.A.getY(i)]) };
  } else {
    if (!e.shiftKey) ue.sel.clear();
    ue.drag = { t: 'box', mx, my, cx: mx, cy: my };
  }
  uvDraw();
});
uvc.addEventListener('pointermove', e => {
  uvM = uvPos(e);
  if (!ue) return;
  if (ue.tool) return uvToolUpdate();
  if (!ue.drag) return;
  const [mx, my] = uvM, d = ue.drag, s = ue.v.s;
  if (d.t === 'pan') { ue.v.x = d.x + mx - d.mx; ue.v.y = d.y + my - d.my; uvDraw(); }
  else if (d.t === 'move') {
    const du = (mx - d.mx) / s, dv = -(my - d.my) / s;
    d.base.forEach(([i, u, v]) => ue.A.setXY(i, u + du, v + dv));
    d.moved = true; uvTouch();
  } else { d.cx = mx; d.cy = my; uvDraw(); }
});
uvc.addEventListener('pointerup', () => {
  if (!ue || !ue.drag) return;
  const d = ue.drag; ue.drag = null;
  if (d.t === 'move' && d.moved) { ue.o.userData.customUV = true; commit(); }
  else if (d.t === 'box') {
    const x0 = Math.min(d.mx, d.cx), x1 = Math.max(d.mx, d.cx), y0 = Math.min(d.my, d.cy), y1 = Math.max(d.my, d.cy), inside = p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    if (uvMode === 'v') ue.glist.forEach(l => { if (inside(uvPt(l[0]))) l.forEach(i => ue.sel.add(i)); });
    else if (uvMode === 'e') { for (let i = 0; i < ue.edges.length; i += 2) if (inside(uvPt(ue.edges[i])) && inside(uvPt(ue.edges[i + 1]))) [...ue.glist[ue.gid[ue.edges[i]]], ...ue.glist[ue.gid[ue.edges[i + 1]]]].forEach(v => ue.sel.add(v)); }
    else ue.tris.forEach((t, i) => { const q = t.map(uvPt), cx = (q[0][0] + q[1][0] + q[2][0]) / 3, cy = (q[0][1] + q[1][1] + q[2][1]) / 3; if (inside([cx, cy])) uvIdx(uvTrisOf(i, uvMode)).forEach(v => ue.sel.add(v)); });
  }
  uvDraw();
});
uvc.addEventListener('wheel', e => {
  if (!ue) return;
  e.preventDefault();
  const [mx, my] = uvPos(e), f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  ue.v.x = mx - (mx - ue.v.x) * f; ue.v.y = my - (my - ue.v.y) * f; ue.v.s *= f; uvDraw();
}, { passive: false });
/* G / R / S dentro del editor UV (con el mouse sobre el mapa): mover, rotar y escalar lo seleccionado */
function uvStartTool(m) {
  if (!ue || !ue.sel.size) return toast('Selecciona puntos, aristas, caras o islas en el editor UV primero');
  const ids = [...ue.sel], A = ue.A;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  ids.forEach(i => { const u = A.getX(i), v = A.getY(i); x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); });
  ue.tool = { m, axis: null, c: [(x0 + x1) / 2, (y0 + y1) / 2], s0: uvM.slice(), base: ids.map(i => [i, A.getX(i), A.getY(i)]) };
  uvDraw();
}
function uvToolUpdate() {
  const t = ue.tool, s = ue.v.s, A = ue.A, cs = [t.c[0] * s + ue.v.x, (1 - t.c[1]) * s + ue.v.y];
  let f;
  if (t.m === 'move') { const du = t.axis === 'y' ? 0 : (uvM[0] - t.s0[0]) / s, dv = t.axis === 'x' ? 0 : -(uvM[1] - t.s0[1]) / s; f = (u, v) => [u + du, v + dv]; }
  else if (t.m === 'rot') { const a = -(Math.atan2(uvM[1] - cs[1], uvM[0] - cs[0]) - Math.atan2(t.s0[1] - cs[1], t.s0[0] - cs[0])), co = Math.cos(a), si = Math.sin(a); f = (u, v) => { const x = u - t.c[0], y = v - t.c[1]; return [t.c[0] + x * co - y * si, t.c[1] + x * si + y * co]; }; }
  else { const k = Math.hypot(uvM[0] - cs[0], uvM[1] - cs[1]) / Math.max(Math.hypot(t.s0[0] - cs[0], t.s0[1] - cs[1]), 20), kx = t.axis === 'y' ? 1 : k, ky = t.axis === 'x' ? 1 : k; f = (u, v) => [t.c[0] + (u - t.c[0]) * kx, t.c[1] + (v - t.c[1]) * ky]; }
  t.base.forEach(([i, u, v]) => { const q = f(u, v); A.setXY(i, q[0], q[1]); });
  uvTouch();
}
function uvToolEnd(ok) {
  const t = ue.tool;
  if (!ok) { t.base.forEach(([i, u, v]) => ue.A.setXY(i, u, v)); uvTouch(); }
  ue.tool = null;
  if (ok) { ue.o.userData.customUV = true; commit(); }
  uvDraw();
}
function uvKeys(e, k) { // devuelve true si la tecla se usó en el editor UV
  if (uvw.hidden || !ue) return false;
  if (ue.tool) {
    e.preventDefault();
    if (k === 'escape') uvToolEnd(false); else if (k === 'enter') uvToolEnd(true);
    else if (k === 'x' || k === 'y') { ue.tool.axis = ue.tool.axis === k ? null : k; uvToolUpdate(); }
    return true;
  }
  if (!uvHover || e.ctrlKey || e.metaKey) return false;
  if (k === 'g') uvStartTool('move'); else if (k === 'r') uvStartTool('rot'); else if (k === 's') uvStartTool('scale');
  else if (k === 'a') { if (ue.sel.size) ue.sel.clear(); else ue.glist.forEach(l => l.forEach(i => ue.sel.add(i))); uvDraw(); }
  else if (k === 'l') { const t = uvTriAt(uvM[0], uvM[1]); if (t >= 0) { uvIdx(uvTrisOf(t, 'i')).forEach(i => ue.sel.add(i)); uvDraw(); } }
  else if (k.length === 1 && '1234'.includes(k)) uvSetMode('vefi'[+k - 1]);
  else return false;
  e.preventDefault();
  return true;
}
function uvToggle() {
  uvw.hidden = !uvw.hidden;
  $('#toolbar [data-act="uv"]').classList.toggle('on', !uvw.hidden);
  if (!uvw.hidden) { ue = null; uvRebuild(); }
}
function uvOp(k) { // botones del editor UV
  if (!ue) return toast('Selecciona un objeto primero');
  const A = ue.A;
  if (k === 'ovl') {
    uvShowOv = !uvShowOv; $('#uvovl').classList.toggle('on', uvShowOv);
    if (uvShowOv) { uvOverlapNow(); toast(ue.ov.count ? 'Hay superposiciones UV: se marcan en rojo' : 'No hay superposiciones UV'); } else uvDraw();
    return;
  }
  if (k === 'pack') {
    const tr = ue.tris, out = JSIMods.packIslands(tr.length, c => { const v = tr[(c / 3) | 0][c % 3]; return [A.getX(v), A.getY(v)]; }, ue.isl);
    tr.forEach((t, i) => t.forEach((v, j) => A.setXY(v, out[i * 6 + j * 2], out[i * 6 + j * 2 + 1])));
    ue.o.userData.customUV = true; uvTouch(); commit(); toast(ue.isl.length ? 'Islas empaquetadas dentro de 0–1' : '');
    return;
  }
  const ids = ue.sel.size ? [...ue.sel] : [...Array(A.count).keys()];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  ids.forEach(i => { const u = A.getX(i), v = A.getY(i); x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); });
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0 || 1, h = y1 - y0 || 1;
  ids.forEach(i => {
    let u = A.getX(i) - cx, v = A.getY(i) - cy;
    if (k === 'fu') u = -u; else if (k === 'fv') v = -v;
    else if (k === 'rot') { const t = u; u = -v; v = t; }
    else if (k === 'big') { u *= 1.1; v *= 1.1; } else if (k === 'small') { u /= 1.1; v /= 1.1; }
    else if (k === 'fit') { A.setXY(i, (A.getX(i) - x0) / w, (A.getY(i) - y0) / h); return; }
    A.setXY(i, u + cx, v + cy);
  });
  ue.o.userData.customUV = true; uvTouch(); commit();
}
function uvAction(k) { if (k === 'close') uvToggle(); else uvOp(k); }
const UVMSG = { unwrap: 'Unwrap aplicado', smart: 'Smart UV Project aplicado', box: 'Proyección cúbica aplicada', cyl: 'Proyección cilíndrica aplicada', sph: 'Proyección esférica aplicada', plane: 'Proyección plana aplicada', view: 'UV proyectados desde la vista actual', orig: 'UV restablecidos' };
function uvProject(kind) { // genera UV; si hay caras seleccionadas (en 3D o en el editor UV) solo se tocan esas
  if (!sel) return toast('Selecciona un objeto primero');
  const o = sel, wasEdit = edit, mode = edit && ed.mode;
  if (kind === 'orig') {
    if (edit) return toast('Sal del modo edición (Tab) primero');
    const A0 = !o.userData.soup && GEO[o.userData.type]().attributes.uv;
    if (A0 && A0.count === o.geometry.attributes.uv.count) o.geometry.setAttribute('uv', A0);
    else { o.geometry.deleteAttribute('uv'); shade(o); }
    o.userData.customUV = false;
  } else {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, P = new Float32Array(g.attributes.position.array), nT = P.length / 9;
    let mask = null;
    if (edit && ed.selV.size) { // caras seleccionadas en el modo edición 3D
      mask = new Uint8Array(nT);
      ed.faces.forEach(f => { if ([...f.verts].every(v => ed.selV.has(v))) f.tris.forEach(t => { mask[t] = 1; }); });
    } else if (!edit && ue && ue.o === o && ue.sel.size) { // triángulos seleccionados en el editor UV
      mask = new Uint8Array(nT);
      ue.tris.forEach((t, i) => { if (t.every(v => ue.sel.has(v))) mask[i] = 1; });
    }
    if (mask && !mask.some(x => x)) mask = null;
    let proj = null;
    if (kind === 'view') { const cam = camOf(o); proj = p => { const s = cam.project(p); return [s[0], -s[1]]; }; } // la cámara actual (ortográfica o perspectiva) decide el UV
    const uvs = JSIMods.uvTool(P, kind, { mask, base: g.attributes.uv ? new Float32Array(g.attributes.uv.array) : null, proj }), keepF = o.userData.faceTris;
    if (wasEdit) exitEdit();
    applyGeo(o, P, undefined, keepF);
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); o.userData.customUV = true;
    if (wasEdit) { enterEdit(); setEMode(mode); }
  }
  commit(); render(); uvRebuild();
  toast(UVMSG[kind]);
}
document.addEventListener('change', e => {
  if (e.target.id !== 'uvproj') return;
  if (e.target.value) uvProject(e.target.value);
  e.target.value = '';
});

/* ---------- Imágenes de referencia (solo se ven en la vista ortográfica asignada) ---------- */
const refGroup = new THREE.Group();
scene.add(refGroup);
let refs = [], refId = 0, refOrd = 0, autoOrtho = false;
const refDir = new THREE.Vector3(), vname = $('#vname');
const camDir = () => camera.getWorldDirection(refDir).toArray();
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function refsOut() { return refs.slice().sort((a, b) => a.ord - b.ord).map(r => ({ name: r.name, view: r.view, x: r.x, y: r.y, size: r.size, opacity: r.opacity, visible: r.visible, data: r.data })); }
function refPlace(r) { // posición y orientación dentro del plano de su vista; el ancho/alto no deforman la imagen
  const pl = JSIRefs.placement(r.view, r.x, r.y);
  r.mesh.position.set(pl.pos[0], pl.pos[1], pl.pos[2]); r.mesh.rotation.set(pl.euler[0], pl.euler[1], pl.euler[2]);
  r.mesh.scale.set(r.size, r.size * r.aspect, 1); r.mesh.material.opacity = r.opacity;
}
function refMake(d, cb) {
  const im = new Image();
  im.onload = () => {
    const tex = new THREE.Texture(im);
    tex.needsUpdate = true; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    // sin luces ni sombras (MeshBasicMaterial), detrás del modelo (el plano está lejos en el eje de la vista) y sin intervenir en la selección
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: d.opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.raycast = () => {}; mesh.renderOrder = -5; mesh.visible = false;
    refGroup.add(mesh);
    const r = Object.assign({}, d, { id: ++refId, mesh, aspect: im.height / im.width });
    refs.push(r); refPlace(r); refList(); render();
    if (cb) cb(r);
  };
  im.onerror = () => toast('No se pudo leer la imagen de referencia', true);
  im.src = d.data;
}
function refDispose(r) { refGroup.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.map.dispose(); r.mesh.material.dispose(); }
function loadRefs(list) { // abre las imágenes guardadas en el proyecto (reemplaza las actuales)
  refs.slice().forEach(refDispose); refs = [];
  JSIRefs.sanitize(list).forEach(d => refMake(Object.assign(d, { ord: ++refOrd })));
  refList();
}
function refSync() { // la visibilidad sale del estado real de la cámara: proyección ortográfica alineada con la vista asignada
  const v = JSIRefs.viewOf(camDir(), camera === ortho), t = v ? JSIRefs.VIEWS[v].name : '';
  refs.forEach(r => { r.mesh.visible = r.visible && r.view === v; });
  if (vname.textContent !== t) vname.textContent = t;
}
function autoPerspCheck() { // al girar la vista fuera de los ejes se vuelve a perspectiva (como "Auto Perspective" de Blender)
  if (!refsReady || !autoOrtho || camera !== ortho || JSIRefs.viewOf(camDir(), true)) return;
  autoOrtho = false;
  Promise.resolve().then(() => setProj('persp'));
}
function refList() {
  const L = $('#reflist');
  L.innerHTML = '';
  if (!refs.length) { L.innerHTML = '<div class="empty">Sin imágenes. Importa una para usarla como guía.</div>'; return; }
  const opts = Object.keys(JSIRefs.VIEWS).map(k => `<option value="${k}">${JSIRefs.VIEWS[k].name}</option>`).join('');
  refs.slice().sort((a, b) => a.ord - b.ord).forEach(r => {
    const d = document.createElement('div');
    d.className = 'refcard'; d.dataset.i = r.id;
    d.innerHTML = `<div class="refhead"><b title="${escH(r.name)}">${escH(r.name)}</b><button data-ref="eye" title="Mostrar / ocultar">${r.visible ? '◉' : '○'}</button><button data-ref="del" title="Eliminar">✕</button></div>
      <div class="row"><label>Vista</label><select data-rk="view">${opts}</select></div>
      <div class="row"><label>Opacidad</label><input type="range" min="0" max="1" step="0.01" value="${r.opacity}" data-rk="opacity"></div>
      <div class="row"><label>Tamaño</label><input type="number" step="0.5" min="0.1" value="${r.size}" data-rk="size"></div>
      <div class="row"><label>Posición</label><input type="number" step="0.5" value="${r.x}" data-rk="x"><input type="number" step="0.5" value="${r.y}" data-rk="y"></div>`;
    d.querySelector('[data-rk="view"]').value = r.view;
    if (!r.visible) d.classList.add('hid');
    L.append(d);
  });
}
$('#reflist').addEventListener('input', e => {
  const k = e.target.dataset.rk, card = e.target.closest('[data-i]'), r = card && refs.find(q => q.id === +card.dataset.i);
  if (!k || !r) return;
  if (k === 'view') r.view = e.target.value;
  else { const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return; r[k] = k === 'opacity' ? clamp(v, 0, 1) : k === 'size' ? Math.max(0.01, v) : v; }
  refPlace(r); dirty = true; updateTitle(); render();
});
function refAction(b) {
  if (b.dataset.ref === 'add') return $('#reffile').click();
  const card = b.closest('[data-i]'), r = card && refs.find(q => q.id === +card.dataset.i);
  if (!r) return;
  if (b.dataset.ref === 'eye') r.visible = !r.visible;
  else { refDispose(r); refs = refs.filter(q => q !== r); }
  refList(); dirty = true; updateTitle(); render();
}
function importRefs(files) {
  [...files].forEach(file => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast(file.name + ': usa PNG, JPG o WebP', true);
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => { // máximo 2048 px para cuidar la memoria y el tamaño del .JSI
        const s = Math.min(1, 2048 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(im.width * s)); cv.height = Math.max(1, Math.round(im.height * s));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        const free = ['front', 'right', 'top', 'back', 'left', 'bottom'].find(v => !refs.some(r => r.view === v)) || 'front';
        refMake({ name: file.name.replace(/\.[^.]+$/, ''), view: free, x: 0, y: 0, size: 6, opacity: 0.5, visible: true, ord: ++refOrd, data: cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9) }, () => { dirty = true; updateTitle(); toast('Referencia importada: se ve en la vista ' + JSIRefs.VIEWS[free].name.toLowerCase() + ' ortográfica'); });
      };
      im.onerror = () => toast('No se pudo leer ' + file.name, true);
      im.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}
$('#reffile').onchange = e => { importRefs(e.target.files); e.target.value = ''; };
refsReady = true;

/* ---------- Visualización: modos de vista, proyección y visibilidad ---------- */
function updateVBar() {
  document.querySelectorAll('[data-vm]').forEach(b => b.classList.toggle('on', b.dataset.vm === viewMode));
  document.querySelectorAll('[data-proj]').forEach(b => b.classList.toggle('on', (b.dataset.proj === 'ortho') === (camera === ortho)));
}
function setViewMode(m) { viewMode = m; updateVBar(); render(); }
function setProj(mode, auto) {
  const to = mode === 'ortho' ? ortho : persp;
  if (to === camera) return;
  const dir = camera.position.clone().sub(orbit.target).normalize(), k = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
  if (to === ortho) { orthoH = camera.position.distanceTo(orbit.target) * k; ortho.zoom = 1; fitOrtho(); }
  const dist = to === ortho ? camera.position.distanceTo(orbit.target) : orthoH / ortho.zoom / k;
  to.position.copy(orbit.target).addScaledVector(dir, dist); to.quaternion.copy(camera.quaternion);
  camera = to; orbit.object = to; tc.camera = to;
  to.updateMatrixWorld(); orbit.update(); updateVBar(); render();
  autoOrtho = !!auto; // true solo si la ortográfica la activó una vista numérica (al girar se vuelve a perspectiva)
}
function toggleVis(o) {
  if (edit) return toast('Sal del modo edición (Tab) primero');
  o.visible = !o.visible;
  if (!o.visible && o === sel) select(null); else refreshList();
  render(); commit();
}
function hideSel() { if (sel) toggleVis(sel); else toast('Selecciona un objeto primero'); }
function showAll() {
  if (edit) return toast('Sal del modo edición (Tab) primero');
  root.children.forEach(o => { o.visible = true; });
  refreshList(); render(); commit();
}

/* ---------- Geometría editada: normales, UV y reemplazo de malla ---------- */
function shade(o) {
  const g = o.geometry;
  g.computeVertexNormals();
  if (!g.index) {
    const P = g.attributes.position, N = g.attributes.normal, n = P.count;
    if (o.userData.smooth) { // suaviza promediando las normales de vértices en la misma posición
      const acc = new Map(), key = i => Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4);
      for (let i = 0; i < n; i++) { const k = key(i), a = acc.get(k) || [0, 0, 0]; a[0] += N.getX(i); a[1] += N.getY(i); a[2] += N.getZ(i); acc.set(k, a); }
      for (let i = 0; i < n; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; N.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
      N.needsUpdate = true;
    }
    if (!g.attributes.uv) { // proyección en caja, para poder texturizar mallas editadas
      const uv = new Float32Array(n * 2);
      for (let t = 0; t + 2 < n; t += 3) {
        const A = [P.getX(t), P.getY(t), P.getZ(t)], u = [P.getX(t + 1) - A[0], P.getY(t + 1) - A[1], P.getZ(t + 1) - A[2]], v = [P.getX(t + 2) - A[0], P.getY(t + 2) - A[1], P.getZ(t + 2) - A[2]];
        const nx = Math.abs(u[1] * v[2] - u[2] * v[1]), ny = Math.abs(u[2] * v[0] - u[0] * v[2]), nz = Math.abs(u[0] * v[1] - u[1] * v[0]);
        for (let k = 0; k < 3; k++) {
          const x = P.getX(t + k), y = P.getY(t + k), z = P.getZ(t + k);
          const c = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
          uv[(t + k) * 2] = c[0]; uv[(t + k) * 2 + 1] = c[1];
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
  }
  g.computeBoundingSphere(); g.computeBoundingBox();
}
function applyGeo(o, arr, smooth, faceTris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  if (!o.userData.soup) o.userData.smooth = o.userData.type === 'sphere' || o.userData.type === 'torus';
  if (smooth !== undefined) o.userData.smooth = smooth;
  o.geometry.dispose(); o.geometry = g;
  o.userData.edited = true; o.userData.soup = true; o.userData.customUV = false; o.userData.faceTris = faceTris;
  shade(o); uvRebuild();
}

/* ---------- Modificadores (se aplican sobre la malla; Ctrl+Z los deshace) ---------- */
const MODTXT = { mirror: 'Mirror aplicado', subdivide: 'Subdivisión aplicada', bevel: 'Bisel aplicado', solidify: 'Grosor aplicado' };
function applyMod(name, ...args) {
  if (!sel) return toast('Selecciona un objeto primero');
  if (edit) return toast('Sal del modo edición (Tab) primero');
  const g = sel.geometry.index ? sel.geometry.toNonIndexed() : sel.geometry;
  const P = new Float32Array(g.attributes.position.array);
  if (name === 'subdivide' && P.length / 9 * 4 > 60000) return toast('Demasiados triángulos para subdividir', true);
  let out;
  try { out = JSIMods[name](P, ...args); } catch (e) { return toast('No se pudo aplicar: ' + e.message, true); }
  if (!out.length) return toast('El modificador no generó geometría', true);
  applyGeo(sel, out, name === 'subdivide' ? true : undefined);
  commit(); render(); toast(MODTXT[name]);
}
function modAction(b) {
  const k = b.dataset.mod, v = id => Math.max(0.001, parseFloat($(id).value) || 0.1);
  if (k === 'mirror') applyMod('mirror', +b.dataset.a);
  else if (k === 'bevel') applyMod('bevel', v('#m-bevel'));
  else if (k === 'solidify') applyMod('solidify', v('#m-solid'));
  else applyMod('subdivide');
}

/* ---------- Materiales y texturas ---------- */
const PRESETS = {
  'Mate': { metalness: 0, roughness: 1, opacity: 1 },
  'Plástico': { metalness: 0, roughness: 0.35, opacity: 1 },
  'Metal': { color: '#c4c8d0', metalness: 1, roughness: 0.25, opacity: 1 },
  'Oro': { color: '#f2c14e', metalness: 1, roughness: 0.3, opacity: 1 },
  'Vidrio': { color: '#bfe6ff', metalness: 0, roughness: 0.05, opacity: 0.35 }
};
let matClip = null;
function setMat(o, d) {
  const m = o.material;
  if (d.color) m.color.set(d.color);
  ['metalness', 'roughness', 'opacity', 'wireframe'].forEach(k => { if (d[k] !== undefined) m[k] = d[k]; });
  m.transparent = m.opacity < 1;
  refreshProps(); render();
}
function setTexture(o, url, cb) {
  const im = new Image();
  im.onload = () => {
    const t = new THREE.Texture(im);
    t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    o.material.map = t; o.material.needsUpdate = true; o.userData.texURL = url;
    render(); uvDraw(); if (cb) cb();
  };
  im.onerror = () => toast('No se pudo leer la imagen', true);
  im.src = url;
}
function importTexture(file) {
  if (!sel) return toast('Selecciona un objeto primero');
  if (!file || !/^image\//.test(file.type)) return toast('Elige un archivo de imagen', true);
  const o = sel, r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => { // se reduce a 1024 px como máximo para que el .JSI no pese de más
      const s = Math.min(1, 1024 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(im.width * s)); cv.height = Math.max(1, Math.round(im.height * s));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      o.material.color.set('#ffffff');
      setTexture(o, cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88), () => { refreshProps(); commit(); });
    };
    im.onerror = () => toast('No se pudo leer la imagen', true);
    im.src = r.result;
  };
  r.readAsDataURL(file);
}
function matAction(k) {
  if (!sel) return toast('Selecciona un objeto primero');
  const m = sel.material;
  if (k === 'tex') $('#texfile').click();
  else if (k === 'untex') { m.map = null; m.needsUpdate = true; sel.userData.texURL = undefined; render(); commit(); }
  else if (k === 'copy') {
    matClip = { color: '#' + m.color.getHexString(), metalness: m.metalness, roughness: m.roughness, opacity: m.opacity, wireframe: m.wireframe, tex: sel.userData.texURL };
    toast('Material copiado');
  } else if (k === 'paste') {
    if (!matClip) return toast('Primero copia un material', true);
    setMat(sel, matClip);
    if (matClip.tex) setTexture(sel, matClip.tex, commit);
    else { m.map = null; m.needsUpdate = true; sel.userData.texURL = undefined; commit(); }
  }
}
$('#texfile').onchange = e => { importTexture(e.target.files[0]); e.target.value = ''; };
document.addEventListener('change', e => {
  if (e.target.id !== 'preset' || !e.target.value || !sel) return;
  setMat(sel, PRESETS[e.target.value]); commit(); e.target.value = '';
});

/* ---------- Panel de propiedades ---------- */
const props = $('#props');
const axes3 = (label, key) => `<div class="row"><label>${label}</label>${['x', 'y', 'z'].map(a =>
  `<input type="number" step="0.1" data-k="${key}${a}">`).join('')}</div>`;
props.innerHTML =
  `<div class="row"><label>Nombre</label><input type="text" data-k="name"></div>` +
  axes3('Posición', 'p') + axes3('Rotación °', 'r') + axes3('Escala', 's') +
  `<div class="row"><label>Color</label><input type="color" data-k="color"></div>
   <div class="row"><label>Metal</label><input type="range" min="0" max="1" step="0.01" data-k="metal"></div>
   <div class="row"><label>Rugosidad</label><input type="range" min="0" max="1" step="0.01" data-k="rough"></div>
   <div class="row"><label>Malla</label><input type="checkbox" data-k="wire"></div>
   <div class="row"><label>Opacidad</label><input type="range" min="0.05" max="1" step="0.01" data-k="opac"></div>
   <div class="row"><label>Preset</label><select id="preset"><option value="">Elegir…</option>${Object.keys(PRESETS).map(k => `<option>${k}</option>`).join('')}</select></div>
   <div class="row"><label>Textura</label><button data-mat="tex">Cargar imagen</button><button data-mat="untex">Quitar</button></div>
   <div class="row"><label>UV</label><button data-act="uv">Abrir editor UV</button></div>
   <div class="row"><label>Material</label><button data-mat="copy">Copiar</button><button data-mat="paste">Pegar</button></div>`;
const F = {};
props.querySelectorAll('[data-k]').forEach(i => { F[i.dataset.k] = i; });
const D = Math.PI / 180;
const num = (el, def = 0) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : def; };

function refreshProps() {
  props.disabled = !sel;
  if (!sel) return;
  const f = v => +v.toFixed(3);
  ['x', 'y', 'z'].forEach(a => {
    F['p' + a].value = f(sel.position[a]);
    F['r' + a].value = f(sel.rotation[a] / D);
    F['s' + a].value = f(sel.scale[a]);
  });
  if (document.activeElement !== F.name) F.name.value = sel.name;
  F.color.value = '#' + sel.material.color.getHexString();
  F.metal.value = sel.material.metalness;
  F.rough.value = sel.material.roughness;
  F.wire.checked = sel.material.wireframe;
  F.opac.value = sel.material.opacity;
}
props.addEventListener('input', () => {
  if (!sel) return;
  sel.position.set(num(F.px), num(F.py), num(F.pz));
  sel.rotation.set(num(F.rx) * D, num(F.ry) * D, num(F.rz) * D);
  const s = el => { const v = num(el, 1); return v === 0 ? 0.001 : v; };
  sel.scale.set(s(F.sx), s(F.sy), s(F.sz));
  sel.name = F.name.value || sel.name;
  const m = sel.material;
  m.color.set(F.color.value); m.metalness = num(F.metal); m.roughness = num(F.rough); m.wireframe = F.wire.checked; m.opacity = num(F.opac, 1); m.transparent = m.opacity < 1;
  refreshList(); render();
});
props.addEventListener('change', () => { refreshProps(); if (edit) updatePivot(); commit(); });

/* ---------- Lista de objetos ---------- */
function refreshList() {
  const L = $('#list');
  L.innerHTML = '';
  if (!root.children.length) { L.innerHTML = '<div class="empty">Escena vacía. Usa el menú Agregar.</div>'; return; }
  root.children.forEach(o => {
    const d = document.createElement('div');
    d.className = 'item' + (o === sel ? ' sel' : '');
    d.innerHTML = `<i>${ICON[o.userData.type]}</i>`;
    d.append(o.name);
    const eye = document.createElement('span');
    eye.className = 'eye'; eye.textContent = o.visible ? '◉' : '○'; eye.title = 'Mostrar / ocultar (H)';
    eye.onclick = ev => { ev.stopPropagation(); toggleVis(o); };
    d.append(eye);
    if (!o.visible) d.classList.add('hid');
    d.onclick = () => select(o);
    L.append(d);
  });
}

/* ---------- Serialización .JSI ---------- */
function serialize(withRefs) { // withRefs: solo al guardar el archivo (el historial de deshacer no copia las imágenes)
  return JSON.stringify({
    format: 'JSI', version: 1,
    refs: withRefs ? refsOut() : undefined,
    scene: { background: '#' + scene.background.getHexString(), grid: grid.visible },
    objects: root.children.map(o => ({
      type: o.userData.type, name: o.name,
      position: o.position.toArray(),
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: o.scale.toArray(),
      soup: o.userData.soup || undefined,
      smooth: o.userData.smooth || undefined,
      faces: o.userData.faceTris || undefined,
      uv: o.userData.customUV ? Array.from(o.geometry.attributes.uv.array, v => +v.toFixed(5)) : undefined,
      visible: o.visible ? undefined : false,
      vertices: o.userData.edited ? Array.from(o.geometry.attributes.position.array, v => +v.toFixed(5)) : undefined,
      material: { color: '#' + o.material.color.getHexString(), metalness: o.material.metalness, roughness: o.material.roughness, wireframe: o.material.wireframe, opacity: o.material.opacity, map: o.userData.texURL }
    }))
  }, null, 1);
}
function validate(d) {
  const bad = m => { throw new Error(m); };
  if (!d || d.format !== 'JSI') bad('No es un archivo .JSI válido.');
  if (!Array.isArray(d.objects)) bad('El archivo no contiene la lista de objetos.');
  if (d.refs !== undefined && !Array.isArray(d.refs)) bad('Las imágenes de referencia del archivo no son válidas.');
  const v3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  d.objects.forEach((o, i) => {
    if (!o || !GEO[o.type]) bad(`Objeto ${i + 1}: tipo desconocido.`);
    if (!v3(o.position) || !v3(o.rotation) || !v3(o.scale)) bad(`Objeto ${i + 1}: transformación inválida.`);
    if (o.material && typeof o.material !== 'object') bad(`Objeto ${i + 1}: material inválido.`);
    if (o.vertices !== undefined && (!Array.isArray(o.vertices) || (o.soup ? o.vertices.length % 9 !== 0 : o.vertices.length !== GEO[o.type]().attributes.position.array.length) || !o.vertices.every(Number.isFinite))) bad(`Objeto ${i + 1}: vértices inválidos.`);
    if (o.uv !== undefined && (!Array.isArray(o.uv) || !o.uv.every(Number.isFinite))) bad(`Objeto ${i + 1}: UV inválidos.`);
    if (o.faces !== undefined && (!Array.isArray(o.faces) || !o.faces.every(Number.isInteger))) bad(`Objeto ${i + 1}: caras inválidas.`);
  });
}
function loadData(d, keepCounters) {
  validate(d);
  const keep = root.children.indexOf(sel);
  const wasEdit = edit && keepCounters;
  exitEdit(); tc.detach(); sel = null;
  root.children.slice().forEach(o => { root.remove(o); disposeObj(o); });
  if (!keepCounters) Object.keys(counters).forEach(k => delete counters[k]);
  d.objects.forEach(o => addObject(o.type, o));
  if (d.scene) {
    if (/^#[0-9a-f]{6}$/i.test(d.scene.background)) scene.background.set(d.scene.background);
    grid.visible = d.scene.grid !== false;
  }
  if (!keepCounters || d.refs !== undefined) loadRefs(d.refs || []); // deshacer/rehacer no toca las referencias
  $('#bg').value = '#' + scene.background.getHexString();
  $('#gridv').checked = grid.visible;
  select(keep >= 0 ? root.children[keep] : null);
  if (wasEdit && sel) enterEdit();
}

/* ---------- Historial (deshacer / rehacer) ---------- */
let hist = [], idx = -1, dirty = false;
function commit() {
  const s = serialize();
  if (hist[idx] === s) return;
  hist = hist.slice(0, idx + 1); hist.push(s);
  if (hist.length > 100) hist.shift();
  idx = hist.length - 1; dirty = true; updateTitle();
}
function undo() { if (idx > 0) { idx--; loadData(JSON.parse(hist[idx]), true); dirty = true; } else toast('Nada que deshacer'); }
function redo() { if (idx < hist.length - 1) { idx++; loadData(JSON.parse(hist[idx]), true); dirty = true; } else toast('Nada que rehacer'); }

/* ---------- Acciones ---------- */
let projectName = '';
function updateTitle() { $('#title').textContent = (projectName || 'Sin título') + (dirty ? ' •' : '') + (edit ? '  [MODO EDICIÓN]' : ''); }
let tt;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(tt); tt = setTimeout(() => t.className = '', 2800);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const safe = s => (s || 'modelo').replace(/[^\w\-.]+/g, '_');

function newProject() {
  if (dirty && !confirm('Hay cambios sin guardar. ¿Crear un proyecto nuevo igualmente?')) return;
  loadData({ format: 'JSI', objects: [], scene: { background: '#2b2b2e', grid: true } });
  projectName = ''; hist = []; idx = -1; commit(); dirty = false; updateTitle();
}
function saveAs() {
  const n = prompt('Nombre del proyecto:', projectName || 'proyecto');
  if (!n) return;
  projectName = safe(n.replace(/\.jsi$/i, '')); save();
}
function save() {
  if (!projectName) return saveAs();
  download(projectName + '.JSI', serialize(true), 'application/json');
  dirty = false; updateTitle(); toast('Proyecto guardado: ' + projectName + '.JSI');
}
function openFile(f) {
  if (!f) return;
  if (dirty && !confirm('Hay cambios sin guardar. ¿Abrir otro proyecto igualmente?')) return;
  const r = new FileReader();
  r.onerror = () => toast('No se pudo leer el archivo.', true);
  r.onload = () => {
    try {
      loadData(JSON.parse(r.result));
      projectName = safe(f.name.replace(/\.(jsi|json)$/i, ''));
      hist = []; idx = -1; commit(); dirty = false; updateTitle();
      toast('Proyecto abierto: ' + f.name);
    } catch (e) { toast('Error al abrir: ' + (e instanceof SyntaxError ? 'el archivo no es JSON válido.' : e.message), true); }
  };
  r.readAsText(f);
}
function duplicate() {
  if (edit) return toast('Sal del modo edición (Tab) primero');
  if (!sel) return toast('Selecciona un objeto primero');
  const d = JSON.parse(serialize()).objects[root.children.indexOf(sel)];
  d.name += ' copia'; d.position[0] += 0.6;
  select(addObject(d.type, d)); commit();
}
function remove() {
  if (edit) return toast('Sal del modo edición (Tab) para eliminar el objeto');
  if (!sel) return toast('Selecciona un objeto primero');
  const o = sel; select(null); root.remove(o); disposeObj(o); refreshList(); commit(); render();
}
function exportOBJ() {
  if (!root.children.length) return toast('No hay objetos para exportar', true);
  const base = safe(projectName || 'modelo');
  let obj = `# Create Models\nmtllib ${base}.mtl\n`, mtl = '# Create Models\n', off = 1;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const f = x => +x.toFixed(6);
  root.children.filter(o => o.visible).forEach((o, k) => {
    o.updateMatrixWorld(true);
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, I = g.index;
    const mn = `mat_${k}_${safe(o.name)}`, c = o.material.color, ks = f(o.material.metalness * 0.5);
    mtl += `newmtl ${mn}\nKd ${f(c.r)} ${f(c.g)} ${f(c.b)}\nKa 0 0 0\nKs ${ks} ${ks} ${ks}\nNs ${f((1 - o.material.roughness) * 100)}\nd 1\n\n`;
    obj += `o ${safe(o.name)}_${k}\nusemtl ${mn}\n`;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); obj += `v ${f(v.x)} ${f(v.y)} ${f(v.z)}\n`; }
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < N.count; i++) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); obj += `vn ${f(n.x)} ${f(n.y)} ${f(n.z)}\n`; }
    const cnt = I ? I.count : P.count;
    for (let t = 0; t < cnt; t += 3) {
      const a = [0, 1, 2].map(j => (I ? I.getX(t + j) : t + j) + off);
      obj += `f ${a.map(i => i + '//' + i).join(' ')}\n`;
    }
    off += P.count;
  });
  download(base + '.obj', obj, 'text/plain');
  setTimeout(() => download(base + '.mtl', mtl, 'text/plain'), 300);
  toast('Exportado ' + base + '.obj y ' + base + '.mtl (guarda ambos en la misma carpeta)');
}
function setTool(t) {
  tc.setMode(t);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  render();
}
const ACT = {
  new: newProject, edit: toggleEdit, cut: startLoopCut, knife: startKnife, uv: uvToggle, hide: hideSel, showall: showAll,
  vsolid: () => setViewMode('solid'), vwire: () => setViewMode('wire'), vmat: () => setViewMode('mat'),
  projp: () => setProj('persp'), projo: () => setProj('ortho'), projt: () => setProj(camera === ortho ? 'persp' : 'ortho'), selall: () => selOp('all'), selnone: () => selOp('none'), selinv: () => selOp('inv'),
  vfront: () => setView(0, 0, 1), vside: () => setView(1, 0, 0), vtop: () => setView(0, 1, 0.0001), vpersp: () => { setProj('persp'); setView(5, 4, 6, true); },
  vback: () => setView(0, 0, -1), vleft: () => setView(-1, 0, 0), vbottom: () => setView(0, -1, 0.0001),
  vall: frameAll, axes: () => { axes.visible = !axes.visible; render(); }, open: () => $('#file').click(), save, saveas: saveAs, obj: exportOBJ,
  undo, redo, dup: duplicate, del: remove,
  focus: () => { if (sel) { orbit.target.copy(sel.position); orbit.update(); render(); } }
};
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || mod || lc || kn) return;
  if (b.dataset.act) ACT[b.dataset.act]();
  else if (b.dataset.add) { select(addObject(b.dataset.add)); commit(); }
  else if (b.dataset.tool) setTool(b.dataset.tool);
  else if (b.dataset.emode) setEMode(b.dataset.emode);
  else if (b.dataset.vm) setViewMode(b.dataset.vm);
  else if (b.dataset.proj) setProj(b.dataset.proj);
  else if (b.dataset.mat) matAction(b.dataset.mat);
  else if (b.dataset.mod) modAction(b);
  else if (b.dataset.uv) uvAction(b.dataset.uv);
  else if (b.dataset.um) uvSetMode(b.dataset.um);
  else if (b.dataset.ref) refAction(b);

  const dd = b.closest('.dd'); if (dd) { dd.style.display = 'none'; setTimeout(() => dd.style.display = '', 150); }
});
$('#file').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
$('#bg').oninput = e => { scene.background.set(e.target.value); render(); };
$('#bg').onchange = commit;
$('#gridv').onchange = e => { grid.visible = e.target.checked; render(); commit(); };

document.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (uvKeys(e, k)) return;
  if (lc || kn) { e.preventDefault(); cutKey(e, k); return; }
  if (mod) {
    e.preventDefault();
    if (k === 'escape') cancelModal();
    else if (k === 'enter') confirmModal();
    else if (/^[xyz]$/.test(k)) { mod.axis = mod.axis === k ? null : k; setHint(); updateModal(); }
    return;
  }
  if (e.key === 'Tab') { e.preventDefault(); toggleEdit(); }
  else if (/^Numpad[01357]$/.test(e.code)) ACT[(c && { Numpad1: 'vback', Numpad3: 'vleft', Numpad7: 'vbottom' }[e.code]) || { Numpad1: 'vfront', Numpad3: 'vside', Numpad7: 'vtop', Numpad0: 'vpersp', Numpad5: 'projt' }[e.code]]();
  else if (c && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (c && k === 'y') { e.preventDefault(); redo(); }
  else if (c && k === 'd') { e.preventDefault(); duplicate(); }
  else if (c && k === 's') { e.preventDefault(); save(); }
  else if (c && k === 'o') { e.preventDefault(); ACT.open(); }
  else if (k === 'delete' || k === 'x') remove();
  else if (c && k === 'r') { e.preventDefault(); startLoopCut(); }
  else if (k === 'k') startKnife();
  else if (k === 'g') startModal('translate');
  else if (k === 'r') startModal('rotate');
  else if (k === 's') startModal('scale');
  else if (edit && '123'.includes(k)) setEMode('vef'[k - 1]);
  else if (k === 'f') ACT.focus();
  else if (k === 'u') uvToggle();
  else if (k === 'h') { if (e.altKey) showAll(); else hideSel(); }
  else if (k === 'a') { if (edit) selOp(ed.selV.size === ed.uniq.length ? 'none' : 'all'); }
  else if (c && k === 'i') { e.preventDefault(); selOp('inv'); }
  else if (k === 'escape') { if (edit) { ed.selV.clear(); updatePivot(); refreshEdit(); } else select(null); }
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Inicio ---------- */
addObject('box', { position: [0, 0.5, 0] });
commit(); dirty = false; updateTitle(); refreshList(); refreshProps(); setHint();
})();
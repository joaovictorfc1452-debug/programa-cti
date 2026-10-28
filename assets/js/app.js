/* Planta Elétrica BIM — interface
   Núcleo (estado, salvamento, navegação) · Planta (editor 2D) · Vista 3D · Folhas e relatório */
(function () {
'use strict';
/* ===================== núcleo: estado, armazenamento, navegação ===================== */
const E = window.PEB;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 1) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const ni = (n) => nf(n, 0);
const sec = (s) => (s == null ? '—' : nf(s, s % 1 ? 1 : 0));
const sci = (x) => { if (!(x > 0)) return '0'; const e = Math.floor(Math.log10(x)); const m = x / 10 ** e; return nf(m, 2) + '×10' + String(e).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]); };
const CORES = ['#D9480F', '#1C7ED6', '#2B8A3E', '#AE3EC9', '#E67700', '#0C8599', '#C2255C', '#5C940D', '#7048E8', '#B08900', '#1098AD', '#E8590C', '#495057', '#9C36B5'];
const corCirc = (cid) => { const n = parseInt(String(cid).slice(1), 10) || 1; return CORES[(n - 1) % CORES.length]; };

const VIEWS = [
  ['planta', 'Planta'], ['vista-3d', 'Vista 3D'], ['cargas', 'Previsão de cargas'], ['quadro', 'Quadro de cargas'],
  ['unifilar', 'Unifilar'], ['entrada', 'Entrada CPFL'], ['spda', 'SPDA'], ['nr10', 'NR-10'],
  ['materiais', 'Materiais'], ['verificacao', 'Verificação'], ['relatorio', 'Relatório']
];

const S = {
  P: null, R: null, view: 'planta', tool: 'sel', sel: null, hiCirc: null,
  z: 60, px: 40, py: 40, undo: [], redo: [], pristine: true,
  layers: { eletr: true, rotulos: true, cores: true, alertas: true, grade: true },
  opt: { tugH: 0.3, tue: 'chuveiro' }, eletrA: null, inspOpen: false,
  saveTimer: null, saveState: 'idle', savedAt: null, dl: null
};

/* ---------- armazenamento: db privado do usuário → navegador → memória ---------- */
const Store = {
  mode: 'mem', db: null, uid: null, idx: {}, ultimo: null, chain: Promise.resolve(),
  async init() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        const [db, user, dl] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads')]);
        S.dl = dl || null;
        const id = user ? await user.id() : null;
        if (db && id) {
          this.db = db; this.uid = id; this.mode = 'db';
          const snap = await this.ws().get();
          if (snap.exists) { const d = snap.data() || {}; this.idx = JSON.parse(JSON.stringify(d.idx || {})); this.ultimo = d.ultimo || null; }
          return;
        }
      }
    } catch (e) { console.warn('db indisponível', e); this.db = null; }
    try {
      localStorage.setItem('peb:t', '1'); localStorage.removeItem('peb:t');
      this.mode = 'local';
      this.idx = JSON.parse(localStorage.getItem('peb:idx') || '{}');
      this.ultimo = localStorage.getItem('peb:ultimo');
    } catch (e) { this.mode = 'mem'; }
  },
  ws() { return this.db.doc('data/users/' + this.uid + '/workspace'); },
  ref(id) { return this.ws().collection('projetos').doc(id); },
  list() { return Object.entries(this.idx).map(([id, v]) => Object.assign({ id }, v)).sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0)); },
  async load(id) {
    if (this.mode === 'db') { const s = await this.ref(id).get(); return s.exists ? JSON.parse(JSON.stringify(s.data())) : null; }
    if (this.mode === 'local') { const t = localStorage.getItem('peb:p:' + id); return t ? JSON.parse(t) : null; }
    return null;
  },
  save(P) {
    const snap = JSON.parse(JSON.stringify(P));
    this.idx[P.id] = { nome: P.nome, atualizado: P.atualizado || Date.now() };
    this.ultimo = P.id;
    const idx = JSON.parse(JSON.stringify(this.idx)), ultimo = this.ultimo;
    const run = async () => {
      if (this.mode === 'db') { await this.ref(P.id).set(snap); await this.ws().set({ idx, ultimo }); }
      else if (this.mode === 'local') { localStorage.setItem('peb:p:' + P.id, JSON.stringify(snap)); localStorage.setItem('peb:idx', JSON.stringify(idx)); localStorage.setItem('peb:ultimo', ultimo); }
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  },
  remove(id) {
    delete this.idx[id]; if (this.ultimo === id) this.ultimo = null;
    const idx = JSON.parse(JSON.stringify(this.idx)), ultimo = this.ultimo;
    const run = async () => {
      if (this.mode === 'db') { await this.ref(id).delete(); await this.ws().set({ idx, ultimo }); }
      else if (this.mode === 'local') { localStorage.removeItem('peb:p:' + id); localStorage.setItem('peb:idx', JSON.stringify(idx)); }
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }
};

function scheduleSave() {
  if (Store.mode === 'mem') { S.saveState = 'mem'; renderSaveChip(); return; }
  clearTimeout(S.saveTimer);
  S.saveState = 'pend'; renderSaveChip();
  S.saveTimer = setTimeout(async () => {
    S.saveState = 'busy'; renderSaveChip();
    const size = JSON.stringify(S.P).length;
    if (size > 240000) { S.saveState = 'erro'; renderSaveChip(); toast('Projeto grande demais para salvar (limite ~250 kB). Exporte o JSON.'); return; }
    try { await Store.save(S.P); S.saveState = 'ok'; S.savedAt = Date.now(); }
    catch (e) { console.warn(e); S.saveState = 'erro'; if (e && e.code === 'quota_exceeded') toast('Espaço de armazenamento cheio: exclua projetos antigos.'); }
    renderSaveChip();
  }, 1100);
}
function renderSaveChip() {
  const el = $('#saveChip'); if (!el) return;
  const m = { db: 'na sua conta', local: 'neste navegador', mem: '' }[Store.mode];
  const st = {
    idle: ['', S.pristine ? 'Exemplo — edite para salvar' : '—'], pend: ['busy', 'Alterações pendentes'], busy: ['busy', 'Salvando…'],
    ok: ['ok', 'Salvo ' + m], erro: ['warn', 'Não foi possível salvar'], mem: ['warn', 'Sem armazenamento: exporte o JSON']
  }[S.saveState] || ['', '—'];
  el.className = 'chip ' + st[0];
  el.lastElementChild.textContent = st[1];
}

/* ---------- mutações e desfazer ---------- */
const snapshot = () => JSON.stringify(S.P);
function pushUndo(prev) { S.undo.push(prev); if (S.undo.length > 80) S.undo.shift(); S.redo.length = 0; }
function mutate(fn, opts) { const prev = snapshot(); fn(S.P); pushUndo(prev); changed(opts); }
function changed(opts) {
  S.P.atualizado = Date.now(); S.pristine = false;
  recompute(); validarSel(); renderAll();
  if (!opts || opts.save !== false) scheduleSave();
}
function recompute() {
  try { S.R = E.derivar(S.P); }
  catch (e) { console.error(e); toast('Erro no cálculo: ' + e.message); }
}
function desfazer() { if (!S.undo.length) return; S.redo.push(snapshot()); S.P = JSON.parse(S.undo.pop()); recompute(); validarSel(); renderAll(); scheduleSave(); }
function refazer() { if (!S.redo.length) return; S.undo.push(snapshot()); S.P = JSON.parse(S.redo.pop()); recompute(); validarSel(); renderAll(); scheduleSave(); }
function validarSel() {
  const s = S.sel; if (!s) return;
  if (s.t === 'amb' && !S.P.amb.some((a) => a.id === s.id)) S.sel = null;
  else if (s.t === 'dev' && !S.P.dev.some((d) => d.id === s.id)) S.sel = null;
  else if (s.t === 'edge' && !(S.R && S.R.edges.some((e) => e.id === s.id))) S.sel = null;
  if (S.hiCirc && !(S.R && S.R.circ.some((c) => c.id === S.hiCirc))) S.hiCirc = null;
}
const devById = (id) => S.P.dev.find((d) => d.id === id);
const ambById = (id) => S.P.amb.find((a) => a.id === id);
const circById = (id) => S.R && S.R.circ.find((c) => c.id === id);

function abrirProjeto(p) {
  S.P = E.migrar(p); S.undo = []; S.redo = []; S.sel = null; S.hiCirc = null; S.pristine = false;
  S.saveState = 'ok'; recompute(); renderAll(); requestAnimationFrame(fitPlan);
}

/* ---------- navegação ---------- */
function renderTabs() {
  const nav = $('#tabs');
  const R = S.R;
  const ne = R ? R.resumo.nErro : 0, na = R ? R.resumo.nAviso : 0;
  nav.innerHTML = VIEWS.map(([id, n]) => {
    let b = '';
    if (id === 'verificacao') b = ne ? `<span class="badge">${ne}</span>` : na ? `<span class="badge warn">${na}</span>` : '<span class="badge ok">✓</span>';
    return `<button class="tab" role="tab" data-v="${id}" aria-selected="${S.view === id}">${n}${b}</button>`;
  }).join('');
}
function setView(v, push) {
  if (!VIEWS.some(([id]) => id === v)) v = 'planta';
  S.view = v;
  for (const [id] of VIEWS) { const el = $('#v-' + id); if (el) el.hidden = id !== v; }
  if (push !== false && location.hash.slice(1) !== v) { try { history.replaceState(null, '', '#' + v); } catch (e) { location.hash = v; } }
  renderTabs(); renderView();
  if (v === 'planta') requestAnimationFrame(() => { sizePlan(); renderPlan(); });
}
function renderView() {
  const v = S.view;
  if (v === 'planta') { renderRail(); renderHud(); renderPlan(); renderInsp(); }
  else if (v === 'vista-3d') render3dView();
  else { const fn = SHEETS[v]; if (fn) { const el = $('#v-' + v); const st = el.scrollTop; el.innerHTML = fn(); el.scrollTop = st; } }
}
function renderAll() {
  $('#projNome').value = S.P.nome;
  $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
  renderTabs(); renderStatus(); renderSaveChip(); renderView();
}
function renderStatus() {
  const R = S.R; if (!R) return;
  const en = R.entrada;
  const fasesTxt = { 1: 'monofásico', 2: 'bifásico', 3: 'trifásico' }[en.fases];
  $('#status').innerHTML = [
    `Carga instalada <b>${nf(en.C, 2)} kW</b>`, `Demanda <b>${nf(en.D, 2)} kVA</b>`,
    `Categoria GED-13 <b>${en.cat.c}</b> (${fasesTxt})`, `<b>${R.circ.length}</b> circuitos`,
    `Alimentador <b>${sec(R.alim.S)} mm²</b>`,
    `<b>${R.resumo.nErro}</b> erros · <b>${R.resumo.nAviso}</b> avisos`,
    `<span id="cursorPos"></span>`
  ].join('<span aria-hidden="true">·</span>');
}

/* ---------- modal, aviso, exportação ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}
function abrirModal(html) { $('#dialog').innerHTML = html; $('#modal').hidden = false; const f = $('#dialog').querySelector('input, button'); if (f) f.focus(); }
function fecharModal() { $('#modal').hidden = true; $('#dialog').innerHTML = ''; }

async function baixar(nome, conteudo) {
  if (S.dl) {
    try { await S.dl.save({ filename: nome, data: conteudo }); toast('Arquivo pronto: ' + nome); return; }
    catch (e) { if (e && e.code === 'declined') return; if (e && e.code === 'rate_limited') { toast('Aguarde: já há um download em confirmação.'); return; } }
  }
  if (!window.claude) {
    // arquivo aberto direto no navegador: download comum
    try {
      const tipos = { json: 'application/json', html: 'text/html', svg: 'image/svg+xml', csv: 'text/csv' };
      const ext = nome.split('.').pop();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([conteudo], { type: (tipos[ext] || 'text/plain') + ';charset=utf-8' }));
      a.download = nome; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('Arquivo baixado: ' + nome); return;
    } catch (e) { /* cai no modal abaixo */ }
  }
  abrirModal(`<h2>${esc(nome)}</h2><p class="note">O download direto não está disponível nesta visualização. Copie o conteúdo e salve com o nome acima.</p>
    <textarea class="dump" id="dumpTxt" readonly>${esc(conteudo)}</textarea>
    <div class="row"><button class="btn pri" data-act="copiar-dump">Copiar</button><button class="btn" data-act="fechar">Fechar</button></div>`);
}
async function copiarTexto(txt, el) {
  try { await navigator.clipboard.writeText(txt); toast('Copiado.'); }
  catch (e) { if (el) { el.focus(); el.select(); } toast('Selecione e copie manualmente (Ctrl+C).'); }
}
const slug = (s) => String(s || 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'projeto';

function menuExportar(btn) {
  fecharMenus();
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'menuExp';
  m.style.top = (r.bottom + 6) + 'px';
  m.style.right = Math.max(16, innerWidth - r.right) + 'px';
  m.innerHTML = `
    <button data-exp="json">Projeto BIM (.json) — modelo completo</button>
    <button data-exp="html">Relatório técnico (.html)</button>
    <button data-exp="svg">Planta elétrica (.svg)</button>
    <button data-exp="unifilar">Diagrama unifilar (.svg)</button>
    <button data-exp="csv">Lista de materiais (.csv)</button>
    <button data-exp="quadro">Quadro de cargas (.csv)</button>`;
  document.body.appendChild(m);
}
function fecharMenus() { $$('.menu').forEach((m) => m.remove()); }
function exportar(tipo) {
  const base = slug(S.P.nome);
  if (tipo === 'json') baixar(base + '.json', JSON.stringify(S.P, null, 1));
  if (tipo === 'html') baixar(base + '-relatorio.html', relatorioStandalone());
  if (tipo === 'svg') baixar(base + '-planta.svg', planSVGStatic(true));
  if (tipo === 'unifilar') baixar(base + '-unifilar.svg', unifilarSVG(true));
  if (tipo === 'csv') baixar(base + '-materiais.csv', csvMateriais());
  if (tipo === 'quadro') baixar(base + '-quadro-de-cargas.csv', csvQuadro());
}
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function csvMateriais() {
  const rows = [['Grupo', 'Item', 'Unidade', 'Quantidade']].concat(S.R.bom.map((b) => [b.grupo, b.item, b.unid, b.qtd]));
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n');
}
function csvQuadro() {
  const rows = [['Circuito', 'Descrição', 'Tensão (V)', 'Fase', 'Potência (VA)', 'Ib (A)', 'Circuitos agrupados', 'FCA', 'FCT', 'Seção (mm²)', 'PE (mm²)', 'Iz corrigida (A)', 'Disjuntor (A)', 'Polos', 'DR', 'Queda (%)', 'Comprimento (m)']];
  for (const c of S.R.circ) rows.push([c.id, c.desc, c.v, c.fase, Math.round(c.va), nf(c.ib, 2), c.nGrupo, nf(c.fca, 2), nf(c.fct, 2), sec(c.secao), sec(c.pe), nf(c.iz, 1), c.disj, c.polos, c.dr ? c.drIn + ' A / 30 mA' : '', nf(c.dv, 2), nf(c.comp, 1)]);
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n');
}

/* ---------- projetos ---------- */
function modalProjetos(confirmId) {
  const lista = Store.list();
  const atualNaLista = lista.some((p) => p.id === S.P.id);
  const itens = (atualNaLista ? [] : [{ id: S.P.id, nome: S.P.nome, atualizado: S.P.atualizado, naoSalvo: true }]).concat(lista);
  const modoTxt = { db: 'Projetos salvos na sua conta, visíveis só para você.', local: 'Projetos salvos neste navegador.', mem: 'Armazenamento indisponível nesta visualização: use Exportar → Projeto BIM (.json) para guardar seu trabalho.' }[Store.mode];
  abrirModal(`<h2>Projetos</h2><p class="note">${modoTxt}</p>
    <div class="plist">${itens.map((p) => `
      <div class="pitem ${p.id === S.P.id ? 'cur' : ''}">
        <div><b>${esc(p.nome)}</b><small>${p.naoSalvo ? 'Aberto agora, ainda não salvo' : 'Alterado em ' + new Date(p.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${p.id === S.P.id ? ' · aberto' : ''}</small></div>
        <div class="row">${confirmId === p.id
          ? `<span class="note">Excluir definitivamente?</span><button class="btn danger" data-act="del-ok" data-id="${p.id}">Excluir</button><button class="btn" data-act="projetos">Cancelar</button>`
          : `${p.id !== S.P.id ? `<button class="btn" data-act="abrir" data-id="${p.id}">Abrir</button>` : ''}<button class="btn" data-act="dup" data-id="${p.id}">Duplicar</button>${!p.naoSalvo ? `<button class="btn ghost danger" data-act="del" data-id="${p.id}">Excluir</button>` : ''}`}</div>
      </div>`).join('')}</div>
    <div class="row"><button class="btn pri" data-act="novo">Novo projeto em branco</button><button class="btn" data-act="novo-ex">Novo a partir do exemplo</button>
      <label class="btn" for="impFile">Importar .json</label><input type="file" id="impFile" accept=".json,application/json" hidden>
      <button class="btn ghost" data-act="fechar">Fechar</button></div>`);
}
async function acaoProjeto(act, id) {
  if (act === 'abrir') { const p = await Store.load(id); if (p) { abrirProjeto(p); fecharModal(); Store.ultimo = p.id; } else toast('Não foi possível abrir o projeto.'); }
  if (act === 'dup') {
    let p = id === S.P.id ? JSON.parse(snapshot()) : await Store.load(id);
    if (!p) return;
    p.id = E.uid('p'); p.nome = p.nome + ' (cópia)'; p.criado = p.atualizado = Date.now();
    abrirProjeto(p); scheduleSave(); fecharModal(); toast('Cópia criada e aberta.');
  }
  if (act === 'del') modalProjetos(id);
  if (act === 'del-ok') {
    await Store.remove(id).catch(() => toast('Não foi possível excluir.'));
    if (id === S.P.id) { const outro = Store.list()[0]; if (outro) { const p = await Store.load(outro.id); if (p) abrirProjeto(p); } else { abrirProjeto(E.novoProjeto('Novo projeto')); } }
    modalProjetos();
  }
  if (act === 'novo') { const p = E.novoProjeto('Novo projeto'); abrirProjeto(p); scheduleSave(); fecharModal(); setView('planta'); setTool('amb'); toast('Desenhe o primeiro ambiente arrastando na prancha.'); }
  if (act === 'novo-ex') { const p = E.exemplo(); abrirProjeto(p); scheduleSave(); fecharModal(); }
}
function importarArquivo(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const p = JSON.parse(fr.result);
      if (!p || !Array.isArray(p.amb) || !Array.isArray(p.dev)) throw new Error('formato');
      p.id = E.uid('p'); p.atualizado = Date.now();
      abrirProjeto(p); scheduleSave(); fecharModal(); toast('Projeto importado.');
    } catch (e) { toast('Arquivo inválido: use um .json exportado por este ambiente.'); }
  };
  fr.readAsText(file);
}

/* ---------- eventos globais ---------- */
function bindGlobal() {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setView(b.dataset.v); });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== S.view) setView(v, false); });
  $('#projNome').addEventListener('change', (e) => { const v = e.target.value.trim() || 'Projeto sem nome'; mutate((P) => { P.nome = v; }); });
  $('#btnUndo').onclick = desfazer; $('#btnRedo').onclick = refazer;
  $('#btnProjetos').onclick = () => modalProjetos();
  $('#btnExport').onclick = (e) => { e.stopPropagation(); if ($('#menuExp')) fecharMenus(); else menuExportar(e.currentTarget); };
  document.addEventListener('click', (e) => {
    const ex = e.target.closest('[data-exp]'); if (ex) { fecharMenus(); exportar(ex.dataset.exp); return; }
    if (!e.target.closest('.menu')) fecharMenus();
    const a = e.target.closest('[data-act]'); if (a) acaoGlobal(a.dataset.act, a, e);
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  $('#modal').addEventListener('change', (e) => { if (e.target.id === 'impFile' && e.target.files[0]) importarArquivo(e.target.files[0]); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (S.view === 'planta') { sizePlan(); renderPlan(); } if (S.view === 'vista-3d') resize3d(); });
}
function acaoGlobal(act, el, ev) {
  const id = el.dataset.id;
  switch (act) {
    case 'fechar': fecharModal(); break;
    case 'projetos': modalProjetos(); break;
    case 'abrir': case 'dup': case 'del': case 'del-ok': case 'novo': case 'novo-ex': acaoProjeto(act, id); break;
    case 'copiar-dump': copiarTexto($('#dumpTxt').value, $('#dumpTxt')); break;
    case 'ir': irPara(el.dataset.tipo, id); break;
    case 'hicirc': S.hiCirc = S.hiCirc === id ? null : id; renderView(); break;
    case 'circ-planta': S.hiCirc = id; setView('planta'); break;
    case 'completar-todos': mutate((P) => { let n = 0; for (const a of P.amb) n += E.completarPontos(P, a.id); toast(n ? n + ' pontos inseridos.' : 'Todos os ambientes já atendem ao mínimo.'); }); break;
    case 'baixar-csv': exportar('csv'); break;
    case 'baixar-quadro': exportar('quadro'); break;
    case 'baixar-rel': exportar('html'); break;
    case 'baixar-unif': exportar('unifilar'); break;
    case 'copiar-memo': copiarTexto($('#memoTxt') ? $('#memoTxt').innerText : '', null); break;
    default: if (typeof acaoPlanta === 'function') acaoPlanta(act, el, ev);
  }
}
function irPara(tipo, id) {
  if (tipo === 'aba') { setView(id); return; }
  if (tipo === 'circ') { S.hiCirc = id; S.sel = null; setView('planta'); return; }
  if (tipo === 'edge') { S.sel = { t: 'edge', id }; setView('planta'); return; }
  if (tipo === 'amb' || tipo === 'dev') {
    S.sel = { t: tipo, id }; S.inspOpen = true; setView('planta');
    requestAnimationFrame(() => centrarEm(tipo, id));
  }
}
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) refazer(); else desfazer(); return; }
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); refazer(); return; }
  if (e.key === 'Escape') { if (!$('#modal').hidden) { fecharModal(); return; } fecharMenus(); }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.view === 'planta' && typeof teclaPlanta === 'function') teclaPlanta(e);
}

async function boot() {
  S.P = E.exemplo();
  recompute();
  bindGlobal(); bindPlan(); bind3d();
  const h = location.hash.slice(1);
  setView(VIEWS.some(([id]) => id === h) ? h : 'planta', false);
  renderAll();
  requestAnimationFrame(() => { sizePlan(); fitPlan(); });
  await Store.init();
  if (Store.mode === 'mem') S.saveState = 'mem';
  if (S.pristine && Store.ultimo && Store.idx[Store.ultimo]) {
    try { const p = await Store.load(Store.ultimo); if (p && S.pristine) abrirProjeto(p); } catch (e) { console.warn(e); }
  } else if (S.pristine && Store.list().length) {
    try { const p = await Store.load(Store.list()[0].id); if (p && S.pristine) abrirProjeto(p); } catch (e) { console.warn(e); }
  }
  renderSaveChip();
}

/* ===================== planta: editor BIM 2D ===================== */
const IC = {
  sel: '<path d="M5 3l11 6.2-4.7 1.3 2.6 5-2 1-2.6-5L5 15z" fill="currentColor"/>',
  amb: '<rect x="3" y="4" width="14" height="12" fill="none" stroke="currentColor" stroke-width="2"/><rect x="1.5" y="2.5" width="3" height="3" fill="currentColor"/><rect x="15.5" y="14.5" width="3" height="3" fill="currentColor"/>',
  porta: '<path d="M3 17h14M5 17V5M5 5a12 12 0 0 1 12 12" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  luz: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="10" y="13" font-size="8" text-anchor="middle" fill="currentColor" font-family="sans-serif">a</text>',
  arandela: '<path d="M3 5h14M5 5a5 5 0 0 0 10 0" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  int1: '<path d="M3 4h14M10 4v6" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="12" r="3" fill="currentColor"/>',
  int2: '<path d="M3 4h14M10 4v6M6 15l8-6" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="12" r="3" fill="currentColor"/>',
  int3: '<path d="M3 4h14M10 4v6M5 14l8-6M7 16l8-6" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="12" r="2.6" fill="currentColor"/>',
  tug: '<path d="M2 4h16" stroke="currentColor" stroke-width="1.8"/><path d="M4 4h12l-6 11z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  tue: '<path d="M2 4h16" stroke="currentColor" stroke-width="1.8"/><path d="M4 4h12l-6 11z" fill="currentColor"/>',
  qdc: '<rect x="3" y="6" width="14" height="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 6h14v8z" fill="currentColor"/>',
  med: '<rect x="4" y="4" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="10" y="13.5" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" font-family="sans-serif">M</text>',
  eletr: '<path d="M3 16L9 9l4 3 4-8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="3" cy="16" r="2" fill="currentColor"/><circle cx="17" cy="4" r="2" fill="currentColor"/>'
};
const TOOLS = [
  { id: 'sel', k: 'V', n: 'Selecionar e mover (V)' }, { id: 'amb', k: 'R', n: 'Ambiente: arraste um retângulo (R)' }, { id: 'porta', k: 'D', n: 'Porta: clique sobre a parede (D)' }, '-',
  { id: 'luz', k: 'L', n: 'Ponto de luz no teto (L)' }, { id: 'arandela', k: 'A', n: 'Arandela (A)' },
  { id: 'int1', k: 'S', n: 'Interruptor simples (S)' }, { id: 'int2', k: 'P', n: 'Interruptor paralelo (P)' }, { id: 'int3', k: 'I', n: 'Interruptor intermediário (I)' },
  { id: 'tug', k: 'T', n: 'Tomada de uso geral (T)' }, { id: 'tue', k: 'E', n: 'Ponto de uso específico (E)' }, '-',
  { id: 'qdc', k: 'Q', n: 'Quadro de distribuição (Q)' }, { id: 'med', k: 'M', n: 'Padrão de entrada / medição (M)' }, { id: 'eletr', k: 'C', n: 'Eletroduto manual: clique em dois pontos (C)' }
];
const HINTS = {
  sel: 'Arraste para mover · alças redimensionam · Del exclui · arraste o fundo para navegar',
  amb: 'Arraste na prancha para desenhar o ambiente (encaixa em 5 cm e nas paredes vizinhas)',
  porta: 'Clique sobre a parede onde fica a porta',
  luz: 'Clique dentro do ambiente — a letra de comando liga o ponto ao interruptor',
  arandela: 'Clique junto à parede', int1: 'Clique junto à parede, perto da porta', int2: 'Clique junto à parede', int3: 'Clique junto à parede',
  tug: 'Clique junto à parede — escolha a altura acima', tue: 'Escolha o equipamento e clique junto à parede',
  qdc: 'Clique numa parede de local seco e de fácil acesso', med: 'Posicione no limite do terreno com a via pública (GED-13 6.14)',
  eletr: 'Clique no primeiro ponto e depois no seguinte; Esc encerra'
};

function renderRail() {
  $('#rail').innerHTML = TOOLS.map((t) => t === '-' ? '<hr>' :
    `<button class="tool" data-tool="${t.id}" title="${esc(t.n)}" aria-label="${esc(t.n)}" aria-pressed="${S.tool === t.id}"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">${IC[t.id]}</svg><kbd>${t.k}</kbd></button>`).join('');
}
function renderHud() {
  const L = S.layers;
  const lay = [['eletr', 'Eletrodutos'], ['rotulos', 'Rótulos'], ['cores', 'Cores por circuito'], ['alertas', 'Alertas'], ['grade', 'Grade']];
  let opts = '';
  if (S.tool === 'tug') opts = `<div class="seg">${[[0.3, 'Baixa 0,30'], [1.1, 'Média 1,10'], [2.0, 'Alta 2,00']].map(([h, n]) => `<button data-tugh="${h}" aria-pressed="${S.opt.tugH === h}">${n}</button>`).join('')}</div>`;
  if (S.tool === 'tue') opts = `<div class="seg"><select id="optTue" aria-label="Equipamento">${Object.entries(E.TUE).map(([k, v]) => `<option value="${k}"${S.opt.tue === k ? ' selected' : ''}>${esc(v.n)} — ${ni(v.w)} W · ${v.v} V</option>`).join('')}</select></div>`;
  $('#hudTop').innerHTML = `<div class="seg" role="group" aria-label="Camadas">${lay.map(([k, n]) => `<button data-layer="${k}" aria-pressed="${L[k]}">${n}</button>`).join('')}</div>${opts}<span class="hint">${esc(HINTS[S.tool] || '')}${S.tool === 'eletr' && S.eletrA ? ' — origem escolhida' : ''}</span>`;
}
function setTool(t) {
  S.tool = t; S.eletrA = null; S.ghost = null;
  renderRail(); renderHud(); renderPlan();
  const svg = $('#plan'); if (svg) svg.style.cursor = t === 'sel' ? 'default' : 'crosshair';
}

/* ---------- geometria da vista ---------- */
function sizePlan() {
  const b = $('#board'); if (!b) return;
  S.bw = Math.max(50, b.clientWidth); S.bh = Math.max(50, b.clientHeight);
  $('#plan').setAttribute('viewBox', `0 0 ${S.bw} ${S.bh}`);
}
function bboxModelo(P) {
  const xs = [], ys = [];
  for (const a of P.amb) { xs.push(a.x, a.x + a.w); ys.push(a.y, a.y + a.h); }
  for (const d of P.dev) { xs.push(d.x); ys.push(d.y); }
  if (!xs.length) return { x: 0, y: 0, w: 12, h: 9 };
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(1, Math.max(...xs) - x0), h: Math.max(1, Math.max(...ys) - y0) };
}
function fitPlan() {
  sizePlan();
  const b = bboxModelo(S.P), m = 1.2;
  S.z = Math.max(8, Math.min(300, Math.min(S.bw / (b.w + 2 * m), (S.bh - 40) / (b.h + 2 * m))));
  S.px = (S.bw - b.w * S.z) / 2 - b.x * S.z;
  S.py = (S.bh - b.h * S.z) / 2 - b.y * S.z + 14;
  renderPlan();
}
function zoomAt(f, cx, cy) {
  const z2 = Math.max(6, Math.min(420, S.z * f));
  const wx = (cx - S.px) / S.z, wy = (cy - S.py) / S.z;
  S.z = z2; S.px = cx - wx * z2; S.py = cy - wy * z2;
  renderPlan();
}
function centrarEm(tipo, id) {
  sizePlan();
  let x, y;
  if (tipo === 'amb') { const a = ambById(id); if (!a) return; x = a.x + a.w / 2; y = a.y + a.h / 2; }
  else { const d = devById(id); if (!d) return; x = d.x; y = d.y; }
  S.z = Math.max(S.z, 80);
  S.px = S.bw / 2 - x * S.z; S.py = S.bh / 2 - y * S.z;
  renderPlan();
}
const toW = (e) => { const r = $('#plan').getBoundingClientRect(); return { x: (e.clientX - r.left - S.px) / S.z, y: (e.clientY - r.top - S.py) / S.z }; };
const snapV = (v, st = 0.05) => Math.round(v / st) * st;
function snapEixo(v, eixo, excl) {
  const tol = 10 / S.z;
  let best = null, bd = tol;
  for (const a of S.P.amb) {
    if (a.id === excl) continue;
    for (const c of eixo === 'x' ? [a.x, a.x + a.w] : [a.y, a.y + a.h]) { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } }
  }
  return best != null ? best : +snapV(v).toFixed(2);
}

/* ---------- posicionamento ---------- */
function posicionar(kind, w) {
  const K = E.KINDS[kind];
  const sx = +snapV(w.x).toFixed(2), sy = +snapV(w.y).toFixed(2);
  const tol = 12 / S.z;
  if (K.mount === 'teto') {
    const a = E.ambienteEm(S.P, w.x, w.y, 0);
    let x = sx, y = sy, guia = null;
    if (a) {
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      if (Math.abs(w.x - cx) < tol) { x = +cx.toFixed(3); guia = { amb: a.id, gx: x }; }
      if (Math.abs(w.y - cy) < tol) { y = +cy.toFixed(3); guia = Object.assign(guia || { amb: a.id }, { gy: y }); }
    }
    return { x, y, amb: a ? a.id : null, nrm: null, guia };
  }
  let a = E.ambienteEm(S.P, w.x, w.y, 0);
  if (!a) {
    let bd = 0.5;
    for (const r of S.P.amb) {
      const dx = Math.max(r.x - w.x, 0, w.x - (r.x + r.w)), dy = Math.max(r.y - w.y, 0, w.y - (r.y + r.h));
      const d = Math.hypot(dx, dy); if (d < bd) { bd = d; a = r; }
    }
    if (a && kind === 'med') a = null;
  }
  if (!a) return { x: sx, y: sy, amb: null, nrm: null };
  const b = E.bordaProxima(a, w.x, w.y);
  if (kind === 'med' && b.d > 0.4) return { x: sx, y: sy, amb: null, nrm: null };
  let x = b.nx === 0 ? +Math.min(Math.max(snapV(b.x), a.x), a.x + a.w).toFixed(2) : +b.x.toFixed(3);
  let y = b.ny === 0 ? +Math.min(Math.max(snapV(b.y), a.y), a.y + a.h).toFixed(2) : +b.y.toFixed(3);
  let guia = null;
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  if (b.nx === 0 && Math.abs(w.x - cx) < tol) { x = +cx.toFixed(3); guia = { amb: a.id, gx: x }; }
  if (b.ny === 0 && Math.abs(w.y - cy) < tol) { y = +cy.toFixed(3); guia = { amb: a.id, gy: y }; }
  return { x, y, amb: a.id, nrm: [b.nx, b.ny], guia };
}
function letraDoAmbiente(ambId) {
  if (!ambId || !S.R) return null;
  const l = S.P.dev.find((d) => (d.k === 'luz' || d.k === 'arandela') && d.cmd && S.R.dev[d.id] && S.R.dev[d.id].amb === ambId);
  return l ? l.cmd : null;
}
function proximaLetra() {
  const usadas = new Set(S.P.dev.filter((d) => d.cmd).map((d) => d.cmd));
  for (const l of 'abcdefghijklmnopqrstuvwxyz') if (!usadas.has(l)) return l;
  return 'z';
}
function novoDev(kind, pos) {
  const d = { id: E.uid('d'), k: kind, x: pos.x, y: pos.y };
  if (pos.amb && kind !== 'porta' && kind !== 'med') d.amb = pos.amb;
  if (kind === 'luz' || kind === 'arandela') d.cmd = letraDoAmbiente(pos.amb) || proximaLetra();
  if (kind.startsWith('int')) d.cmd = letraDoAmbiente(pos.amb) || '';
  if (kind === 'tug') d.h = S.opt.tugH;
  if (kind === 'tue') d.tipo = S.opt.tue;
  if (kind === 'porta') d.w = 0.8;
  return d;
}

/* ---------- desenho ---------- */
function classeAmb(tipo) {
  const t = E.tipoAmb(tipo);
  if (t.externa) return 'r-externo';
  if (t.w600) return 'r-molhado';
  if (tipo === 'circulacao' || tipo === 'despensa' || tipo === 'garagem') return 'r-circ';
  return 'r-seco';
}
function symDev(d, rd, o) {
  o = o || {};
  const col = !o.mono && S.layers.cores && rd && rd.circ ? corCirc(rd.circ) : null;
  const st = col ? ` style="stroke:${col}"` : '';
  const stf = col ? ` style="fill:${col}"` : '';
  const n = (rd && rd.nrm) || o.nrm || [0, 1];
  const ang = Math.atan2(n[1], n[0]) * 180 / Math.PI - 90;
  const sw = 'stroke-width="0.025"';
  const rot = (inner) => `<g transform="translate(${d.x} ${d.y}) rotate(${ang.toFixed(1)})">${inner}</g>`;
  const lblPos = (dist) => ({ x: d.x + n[0] * dist, y: d.y + n[1] * dist });
  const rot_ = o.rotulos != null ? o.rotulos : S.layers.rotulos;
  const t = (p, txt, size, cls) => `<text x="${p.x.toFixed(3)}" y="${p.y.toFixed(3)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" class="${cls || 'slbl'}">${esc(txt)}</text>`;
  const cid = rd && rd.circ ? rd.circ.slice(1) : '';
  let g = '';
  switch (d.k) {
    case 'luz':
      g += `<circle cx="${d.x}" cy="${d.y}" r="0.17" class="sym" ${sw}${st}/>`;
      g += t({ x: d.x, y: d.y }, d.cmd || '', 0.16, 'slbl-in');
      if (rot_) g += t({ x: d.x + 0.04, y: d.y + 0.3 }, (cid ? cid + ' · ' : '') + (rd ? ni(rd.va) : ''), 0.11);
      break;
    case 'arandela':
      g += rot(`<path d="M-0.15 0 A0.15 0.15 0 0 0 0.15 0 Z" class="sym" ${sw}${st}/>`);
      if (rot_) g += t(lblPos(0.36), (d.cmd || '') + (cid ? ' ' + cid : ''), 0.11);
      break;
    case 'int1': case 'int2': case 'int3': {
      let inner = `<line x1="0" y1="0" x2="0" y2="0.1" class="sym" ${sw}${st}/><circle cx="0" cy="0.13" r="0.055" class="symf"${stf}/>`;
      if (d.k !== 'int1') inner += `<line x1="-0.1" y1="0.22" x2="0.1" y2="0.06" class="sym" ${sw}${st}/>`;
      if (d.k === 'int3') inner += `<line x1="-0.13" y1="0.17" x2="0.07" y2="0.01" class="sym" ${sw}${st}/>`;
      g += rot(inner);
      if (rot_) g += t(lblPos(0.33), d.cmd || '?', 0.13);
      break;
    }
    case 'tug': case 'tue': {
      const h = rd ? rd.h : (d.h || 0.3);
      let inner = `<polygon points="-0.13,0 0.13,0 0,0.21" class="sym" ${sw}${st}/>`;
      if (d.k === 'tue' || h > 1.5) inner += `<polygon points="-0.13,0 0.13,0 0,0.21" class="symf"${stf}/>`;
      else if (h > 0.5) inner += `<polygon points="-0.13,0 0,0 0,0.21" class="symf"${stf}/>`;
      g += rot(inner);
      if (rot_) {
        const lab = d.k === 'tue' ? (E.TUE[d.tipo] || E.TUE.outro).sig + (cid ? ' ' + cid : '') : (cid || '') + (rd && rd.va > 100 ? ' · ' + rd.va : '');
        g += t(lblPos(0.36), lab, 0.11);
      }
      break;
    }
    case 'qdc':
      g += rot(`<rect x="-0.32" y="0" width="0.64" height="0.18" class="sym" ${sw}/><path d="M-0.32 0 L0.32 0 L0.32 0.18 Z" class="symf"/>`);
      if (!o.legenda) g += t(lblPos(0.4), 'QDC', 0.14, 'slbl-b');
      break;
    case 'med':
      g += rot(`<rect x="-0.22" y="0" width="0.44" height="0.3" class="sym" ${sw}/>`);
      g += t(lblPos(0.15), 'M', 0.15, 'slbl-in');
      if (!o.legenda) g += t(lblPos(0.5), 'MEDIÇÃO', 0.12, 'slbl-b');
      break;
  }
  return g;
}
function portaSVG(d) {
  const w = d.w || 0.8;
  let a = null, n = null;
  for (const r of S.P.amb) { const nn = E.normalNaBorda(r, d); if (nn) { a = r; n = nn; break; } }
  if (!n) n = [0, 1];
  let s = '';
  if (n[0] === 0) {
    const sg = n[1];
    const hx = d.x - w / 2, hy = d.y;
    s += `<line x1="${hx}" y1="${hy}" x2="${d.x + w / 2}" y2="${hy}" class="door-gap" stroke-width="0.17"/>`;
    s += `<path d="M${hx} ${hy} L${hx} ${hy + sg * w} A${w} ${w} 0 0 ${sg > 0 ? 0 : 1} ${d.x + w / 2} ${hy}" class="door" stroke-width="0.02"/>`;
  } else {
    const sg = n[0];
    const hx = d.x, hy = d.y - w / 2;
    s += `<line x1="${hx}" y1="${hy}" x2="${hx}" y2="${d.y + w / 2}" class="door-gap" stroke-width="0.17"/>`;
    s += `<path d="M${hx} ${hy} L${hx + sg * w} ${hy} A${w} ${w} 0 0 ${sg > 0 ? 1 : 0} ${hx} ${d.y + w / 2}" class="door" stroke-width="0.02"/>`;
  }
  void a;
  return s;
}
function planContent(o) {
  o = o || {};
  const P = S.P, R = S.R;
  const L = o.static ? { eletr: true, rotulos: true, cores: true, alertas: false } : S.layers;
  let s = '';
  // ambientes
  for (const a of P.amb) s += `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" class="room ${classeAmb(a.tipo)}" data-sel="amb:${a.id}"/>`;
  // eletrodutos (sob as paredes não; sobre o piso)
  if (L.eletr && R) {
    for (const e of R.edges) {
      const A = devById(e.a), B = devById(e.b); if (!A || !B) continue;
      const hi = S.hiCirc && e.circs.has(S.hiCirc);
      const isSel = !o.static && S.sel && S.sel.t === 'edge' && S.sel.id === e.id;
      const vazio = !e.circs.size && !e.ret.length;
      const style = hi ? ` style="stroke:${corCirc(S.hiCirc)}"` : '';
      s += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="edge${e.manual ? ' man' : ''}${isSel ? ' sel' : ''}${vazio ? ' vazio' : ''}" stroke-width="${hi || isSel ? 3 : 1.4}" vector-effect="non-scaling-stroke"${style}/>`;
      if (!o.static) s += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="hit" stroke-width="12" vector-effect="non-scaling-stroke" data-sel="edge:${e.id}"/>`;
      if (L.rotulos && e.circs.size >= 2 && (o.static || S.z > 45)) {
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        s += `<text x="${mx}" y="${my - 0.07}" font-size="0.1" text-anchor="middle" class="elbl">${e.circs.size}c${e.k > 1 ? '×' + e.k : ''}</text>`;
      }
    }
    // alimentador
    const med = P.dev.find((d) => d.k === 'med'), qd = P.dev.find((d) => d.k === 'qdc');
    if (med && qd) {
      s += `<polyline points="${med.x},${med.y} ${med.x},${qd.y} ${qd.x},${qd.y}" class="feeder" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
      if (L.rotulos) s += `<text x="${med.x + 0.12}" y="${(med.y + qd.y) / 2}" font-size="0.12" class="elbl">Alimentador ${R.entrada.fases + 1}#${sec(R.alim.S)} + PE ${sec(R.alim.pe)} mm²</text>`;
    }
  }
  // paredes
  for (const a of P.amb) s += `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" class="wall" stroke-width="0.12" pointer-events="none"/>`;
  for (const d of P.dev.filter((x) => x.k === 'porta')) s += `<g data-sel="dev:${d.id}">${portaSVG(d)}<circle cx="${d.x}" cy="${d.y}" r="0.2" class="hit"/></g>`;
  // rótulos dos ambientes
  for (const a of P.amb) {
    const ra = R && R.amb[a.id];
    s += `<text x="${a.x + 0.16}" y="${a.y + 0.34}" font-size="0.22" class="rname" pointer-events="none">${esc(a.nome)}</text>`;
    if (ra) s += `<text x="${a.x + 0.16}" y="${a.y + 0.56}" font-size="0.14" class="rarea" pointer-events="none">${nf(ra.area, 2)} m² · PD ${nf(ra.pd, 2)}</text>`;
  }
  // dispositivos
  for (const d of P.dev) {
    if (d.k === 'porta') continue;
    const rd = R && R.dev[d.id];
    const isSel = !o.static && S.sel && S.sel.t === 'dev' && S.sel.id === d.id;
    const dim = !o.static && S.hiCirc && rd && rd.circ !== S.hiCirc && d.k !== 'qdc';
    s += `<g data-sel="dev:${d.id}"${dim ? ' opacity="0.28"' : ''}>${symDev(d, rd, { rotulos: L.rotulos, mono: o.mono })}<circle cx="${d.x}" cy="${d.y}" r="0.22" class="hit"/></g>`;
    if (isSel) s += `<circle cx="${d.x}" cy="${d.y}" r="0.3" class="selring" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    if (!o.static && S.eletrA === d.id) s += `<circle cx="${d.x}" cy="${d.y}" r="0.34" class="selring" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
  }
  return s;
}
function renderPlan() {
  const svg = $('#plan');
  if (!svg || S.view !== 'planta' || !S.R) return;
  const z = S.z, W = S.bw || 800, H = S.bh || 600;
  let s = '';
  if (S.layers.grade) {
    const x0 = -S.px / z, y0 = -S.py / z, x1 = (W - S.px) / z, y1 = (H - S.py) / z;
    const st = z > 40 ? 0.5 : z > 16 ? 1 : 5;
    let gmin = '', gmaj = '';
    for (let x = Math.floor(x0 / st) * st; x <= x1; x += st) { const X = (S.px + x * z).toFixed(1); const maj = Math.abs(x / (st * 2) - Math.round(x / (st * 2))) < 1e-6; (maj ? (gmaj += `M${X} 0V${H}`) : (gmin += `M${X} 0V${H}`)); }
    for (let y = Math.floor(y0 / st) * st; y <= y1; y += st) { const Y = (S.py + y * z).toFixed(1); const maj = Math.abs(y / (st * 2) - Math.round(y / (st * 2))) < 1e-6; (maj ? (gmaj += `M0 ${Y}H${W}`) : (gmin += `M0 ${Y}H${W}`)); }
    s += `<path d="${gmin}" class="gmin" stroke-width="1"/><path d="${gmaj}" class="gmaj" stroke-width="1"/>`;
  }
  s += `<g transform="translate(${S.px.toFixed(2)} ${S.py.toFixed(2)}) scale(${z})">`;
  s += planContent();
  // seleção de ambiente
  if (S.sel && S.sel.t === 'amb') {
    const a = ambById(S.sel.id);
    if (a) {
      s += `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" class="selbox" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      const off = 0.5, tk = 0.08;
      s += `<path d="M${a.x} ${a.y - off}H${a.x + a.w}M${a.x} ${a.y - off - tk}v${2 * tk}M${a.x + a.w} ${a.y - off - tk}v${2 * tk}" class="dim" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      s += `<text x="${a.x + a.w / 2}" y="${a.y - off - 0.08}" font-size="${Math.max(0.14, 12 / z)}" text-anchor="middle" class="dimt">${nf(a.w, 2)}</text>`;
      s += `<path d="M${a.x - off} ${a.y}V${a.y + a.h}M${a.x - off - tk} ${a.y}h${2 * tk}M${a.x - off - tk} ${a.y + a.h}h${2 * tk}" class="dim" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      s += `<text x="${a.x - off - 0.08}" y="${a.y + a.h / 2}" font-size="${Math.max(0.14, 12 / z)}" text-anchor="middle" transform="rotate(-90 ${a.x - off - 0.08} ${a.y + a.h / 2})" class="dimt">${nf(a.h, 2)}</text>`;
      const hs = 9 / z;
      for (const [h, hx, hy] of [['nw', a.x, a.y], ['n', a.x + a.w / 2, a.y], ['ne', a.x + a.w, a.y], ['e', a.x + a.w, a.y + a.h / 2], ['se', a.x + a.w, a.y + a.h], ['s', a.x + a.w / 2, a.y + a.h], ['sw', a.x, a.y + a.h], ['w', a.x, a.y + a.h / 2]]) {
        s += `<rect x="${hx - hs / 2}" y="${hy - hs / 2}" width="${hs}" height="${hs}" class="handle" stroke-width="1.5" vector-effect="non-scaling-stroke" data-h="${h}" style="cursor:${h}-resize"/>`;
      }
    }
  }
  // alertas
  if (S.layers.alertas) {
    const ms = 13 / z;
    const marc = new Set();
    for (const i of S.R.issues) {
      if (i.sev === 'info' || !i.alvo) continue;
      let p = null;
      if (i.alvo.tipo === 'dev') { const d = devById(i.alvo.id); if (d) p = { x: d.x + 0.2, y: d.y - 0.28 }; }
      if (i.alvo.tipo === 'amb') { const a = ambById(i.alvo.id); if (a) p = { x: a.x + a.w - 0.3, y: a.y + 0.3 }; }
      if (!p) continue;
      const k = i.alvo.id; if (marc.has(k)) continue; marc.add(k);
      s += `<g transform="translate(${p.x} ${p.y}) scale(${ms})" class="${i.sev === 'erro' ? 'mark-e' : 'mark'}" data-ir="${i.alvo.tipo}:${i.alvo.id}"><title>${esc(i.msg)}</title><path d="M0 -0.55 L0.52 0.38 L-0.52 0.38 Z" stroke-width="0.06" stroke-linejoin="round"/><text y="0.24" font-size="0.62" text-anchor="middle" class="markt">!</text></g>`;
    }
  }
  // linhas-guia de centro
  if (S.guia && ((S.drag && S.drag.mode === 'move') || S.ghost)) {
    const a = ambById(S.guia.amb);
    if (a) {
      if (S.guia.gx != null) s += `<line x1="${S.guia.gx}" y1="${a.y}" x2="${S.guia.gx}" y2="${a.y + a.h}" class="guide" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
      if (S.guia.gy != null) s += `<line x1="${a.x}" y1="${S.guia.gy}" x2="${a.x + a.w}" y2="${S.guia.gy}" class="guide" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
      const lx = S.guia.gx != null ? S.guia.gx : a.x + a.w / 2, ly = S.guia.gy != null ? S.guia.gy : a.y + a.h / 2;
      s += `<text x="${lx + 6 / z}" y="${ly - 6 / z}" font-size="${11 / z}" class="dimt">${S.guia.gx != null && S.guia.gy != null ? 'centro do ambiente' : 'eixo central'}</text>`;
    }
  }
  // fantasma e prévias
  const dr = S.drag;
  if (dr && dr.mode === 'room' && dr.b) {
    const x = Math.min(dr.a.x, dr.b.x), y = Math.min(dr.a.y, dr.b.y), w = Math.abs(dr.b.x - dr.a.x), h = Math.abs(dr.b.y - dr.a.y);
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="prev" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    s += `<text x="${x + w / 2}" y="${y + h / 2}" font-size="${14 / z}" text-anchor="middle" class="dimt">${nf(w, 2)} × ${nf(h, 2)} m · ${nf(w * h, 2)} m²</text>`;
  }
  if (S.ghost && S.tool !== 'sel' && S.tool !== 'amb' && S.tool !== 'eletr') {
    const g = S.ghost;
    const d = novoDev(S.tool, g);
    s += `<g class="ghost" pointer-events="none">${S.tool === 'porta' ? portaSVG(d) : symDev(d, { nrm: g.nrm, h: d.h != null ? d.h : (E.KINDS[S.tool].h || 1.1), va: 0 }, { rotulos: false, nrm: g.nrm })}</g>`;
  }
  if (S.tool === 'eletr' && S.eletrA && S.cur) {
    const A = devById(S.eletrA);
    if (A) s += `<line x1="${A.x}" y1="${A.y}" x2="${S.cur.x}" y2="${S.cur.y}" class="prev" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  }
  s += '</g>';
  svg.innerHTML = s;
  $('#zVal').textContent = Math.round(S.z / 60 * 100) + '%';
}
let rafPend = false;
function renderPlanSoon() { if (rafPend) return; rafPend = true; requestAnimationFrame(() => { rafPend = false; renderPlan(); }); }

/* ---------- interação ---------- */
const ptrs = new Map();
let spaceDown = false;
function hosted(a) { return S.P.dev.filter((d) => d.k !== 'porta' && S.R.dev[d.id] && S.R.dev[d.id].amb === a.id).map((d) => ({ id: d.id, x: d.x, y: d.y, nrm: S.R.dev[d.id].nrm })); }
function bindPlan() {
  const svg = $('#plan');
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('pointerleave', () => { if (!S.drag) { S.ghost = null; S.guia = null; renderPlanSoon(); } });
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('dblclick', () => { if (S.sel) { S.inspOpen = true; renderInsp(); } });
  $('#zIn').onclick = () => zoomAt(1.25, S.bw / 2, S.bh / 2);
  $('#zOut').onclick = () => zoomAt(0.8, S.bw / 2, S.bh / 2);
  $('#zFit').onclick = fitPlan;
  $('#zVal').onclick = () => zoomAt(60 / S.z, S.bw / 2, S.bh / 2);
  $('#rail').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#hudTop').addEventListener('click', (e) => {
    const l = e.target.closest('[data-layer]'); if (l) { S.layers[l.dataset.layer] = !S.layers[l.dataset.layer]; renderHud(); renderPlan(); return; }
    const h = e.target.closest('[data-tugh]'); if (h) { S.opt.tugH = +h.dataset.tugh; renderHud(); }
  });
  $('#hudTop').addEventListener('change', (e) => { if (e.target.id === 'optTue') S.opt.tue = e.target.value; });
  $('#insp').addEventListener('change', onInspChange);
  $('#btnInsp').onclick = () => { S.inspOpen = !S.inspOpen; renderInsp(); };
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
}
function onDown(e) {
  const svg = $('#plan');
  try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = svg.getBoundingClientRect();
  if (ptrs.size === 2) {
    const [p1, p2] = [...ptrs.values()];
    if (S.drag && S.drag.prev && S.drag.moved) { S.P = JSON.parse(S.drag.prev); recompute(); }
    S.drag = { mode: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), z0: S.z, cx: (p1.x + p2.x) / 2 - r.left, cy: (p1.y + p2.y) / 2 - r.top, px: S.px, py: S.py };
    return;
  }
  const w = toW(e);
  if (e.button === 1 || e.button === 2 || spaceDown) { S.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: S.px, py: S.py }; return; }
  const mk = e.target.closest('[data-ir]');
  if (mk && S.tool === 'sel') { const [t, id] = mk.dataset.ir.split(':'); S.sel = { t, id }; renderPlan(); renderInsp(); return; }
  const hnd = e.target.closest('[data-h]');
  const tgt = e.target.closest('[data-sel]');
  const [tt, tid] = tgt ? tgt.dataset.sel.split(':') : [null, null];
  const tool = S.tool;
  if (tool === 'sel') {
    if (hnd && S.sel && S.sel.t === 'amb') {
      const a = ambById(S.sel.id);
      S.drag = { mode: 'resize', h: hnd.dataset.h, id: a.id, prev: snapshot(), orig: { x: a.x, y: a.y, w: a.w, h: a.h }, hosted: hosted(a), moved: false };
      return;
    }
    if (tt === 'dev') {
      const d = devById(tid);
      S.sel = { t: 'dev', id: tid };
      S.drag = { mode: 'move', id: tid, prev: snapshot(), off: { x: w.x - d.x, y: w.y - d.y }, sx: e.clientX, sy: e.clientY, moved: false };
      renderPlan(); renderInsp(); return;
    }
    if (tt === 'edge') { S.sel = { t: 'edge', id: tid }; S.drag = null; renderPlan(); renderInsp(); return; }
    if (tt === 'amb') {
      const a = ambById(tid);
      S.sel = { t: 'amb', id: tid };
      S.drag = { mode: 'moveRoom', id: tid, prev: snapshot(), start: w, orig: { x: a.x, y: a.y }, hosted: hosted(a), doors: S.P.dev.filter((d) => d.k === 'porta' && E.normalNaBorda(a, d)).map((d) => ({ id: d.id, x: d.x, y: d.y })), sx: e.clientX, sy: e.clientY, moved: false };
      renderPlan(); renderInsp(); return;
    }
    S.sel = null; S.hiCirc = null;
    S.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: S.px, py: S.py };
    renderPlan(); renderInsp(); return;
  }
  if (e.button !== 0) return;
  if (tool === 'amb') { S.drag = { mode: 'room', a: { x: snapEixo(w.x, 'x'), y: snapEixo(w.y, 'y') } }; return; }
  if (tool === 'eletr') {
    if (tt === 'dev') {
      const d = devById(tid);
      if (d.k === 'porta' || d.k === 'med') { toast('Eletrodutos ligam pontos elétricos e o QDC.'); return; }
      if (!S.eletrA) { S.eletrA = tid; renderHud(); renderPlan(); return; }
      if (S.eletrA !== tid) {
        const a = S.eletrA;
        const existe = S.P.eletr.some((x) => (x.a === a && x.b === tid) || (x.a === tid && x.b === a));
        if (!existe) mutate((P) => { P.eletr.push({ id: E.uid('e'), a, b: tid }); });
        S.eletrA = tid; renderHud(); renderPlan();
      }
    } else { S.eletrA = null; renderHud(); renderPlan(); }
    return;
  }
  // posicionamento de elementos
  const pos = posicionar(tool, w);
  if (tool === 'porta' && !pos.nrm) { toast('Clique sobre uma parede de ambiente.'); return; }
  if (tool === 'qdc' && S.P.dev.some((d) => d.k === 'qdc')) { toast('O projeto já tem um QDC: mova o existente ou exclua-o primeiro.'); return; }
  if (tool === 'med' && S.P.dev.some((d) => d.k === 'med')) { toast('O projeto já tem padrão de entrada.'); return; }
  const nd = novoDev(tool, pos);
  mutate((P) => { P.dev.push(nd); });
  S.sel = { t: 'dev', id: nd.id };
  renderInsp();
}
function onMove(e) {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const w = toW(e);
  S.cur = w;
  const cp = $('#cursorPos'); if (cp) cp.textContent = `x ${nf(w.x, 2)} · y ${nf(w.y, 2)} m`;
  const dr = S.drag;
  if (!dr) {
    if (S.tool !== 'sel' && S.tool !== 'amb' && S.tool !== 'eletr') { S.ghost = posicionar(S.tool, w); S.guia = S.ghost.guia || null; renderPlanSoon(); }
    else if (S.tool === 'eletr' && S.eletrA) renderPlanSoon();
    return;
  }
  if (dr.mode === 'pinch') {
    if (ptrs.size < 2) return;
    const [p1, p2] = [...ptrs.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const z2 = Math.max(6, Math.min(420, dr.z0 * d / dr.d0));
    const r = $('#plan').getBoundingClientRect();
    const cx = (p1.x + p2.x) / 2 - r.left, cy = (p1.y + p2.y) / 2 - r.top;
    const wx = (dr.cx - dr.px) / dr.z0, wy = (dr.cy - dr.py) / dr.z0;
    S.z = z2; S.px = cx - wx * z2; S.py = cy - wy * z2;
    renderPlanSoon(); return;
  }
  if (dr.mode === 'pan') { S.px = dr.px + e.clientX - dr.sx; S.py = dr.py + e.clientY - dr.sy; renderPlanSoon(); return; }
  if (dr.mode === 'move') {
    if (!dr.moved && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 4) return;
    dr.moved = true;
    const d = devById(dr.id); if (!d) return;
    const pos = posicionar(d.k, { x: w.x - dr.off.x, y: w.y - dr.off.y });
    d.x = pos.x; d.y = pos.y; S.guia = pos.guia || null;
    if (d.k !== 'porta' && d.k !== 'med') { if (pos.amb) d.amb = pos.amb; else delete d.amb; }
    recompute(); renderPlanSoon(); return;
  }
  if (dr.mode === 'moveRoom') {
    if (!dr.moved && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 4) return;
    dr.moved = true;
    const a = ambById(dr.id);
    let nx = dr.orig.x + (w.x - dr.start.x), ny = dr.orig.y + (w.y - dr.start.y);
    const sx1 = snapEixo(nx, 'x', a.id), sx2 = snapEixo(nx + a.w, 'x', a.id) - a.w;
    nx = Math.abs(sx2 - nx) < Math.abs(sx1 - nx) ? sx2 : sx1;
    const sy1 = snapEixo(ny, 'y', a.id), sy2 = snapEixo(ny + a.h, 'y', a.id) - a.h;
    ny = Math.abs(sy2 - ny) < Math.abs(sy1 - ny) ? sy2 : sy1;
    const dx = nx - dr.orig.x, dy = ny - dr.orig.y;
    a.x = +nx.toFixed(3); a.y = +ny.toFixed(3);
    for (const h of dr.hosted) { const d = devById(h.id); if (d) { d.x = +(h.x + dx).toFixed(3); d.y = +(h.y + dy).toFixed(3); } }
    for (const h of dr.doors) { const d = devById(h.id); if (d) { d.x = +(h.x + dx).toFixed(3); d.y = +(h.y + dy).toFixed(3); } }
    recompute(); renderPlanSoon(); return;
  }
  if (dr.mode === 'resize') {
    dr.moved = true;
    const a = ambById(dr.id), o = dr.orig;
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    const hh = dr.h;
    if (hh.includes('w')) x0 = Math.min(snapEixo(w.x, 'x', a.id), x1 - 0.5);
    if (hh.includes('e')) x1 = Math.max(snapEixo(w.x, 'x', a.id), x0 + 0.5);
    if (hh.includes('n')) y0 = Math.min(snapEixo(w.y, 'y', a.id), y1 - 0.5);
    if (hh.includes('s')) y1 = Math.max(snapEixo(w.y, 'y', a.id), y0 + 0.5);
    a.x = +x0.toFixed(3); a.y = +y0.toFixed(3); a.w = +(x1 - x0).toFixed(3); a.h = +(y1 - y0).toFixed(3);
    for (const h of dr.hosted) {
      const d = devById(h.id); if (!d) continue;
      let x = h.x, y = h.y;
      const n = h.nrm;
      if (n && n[1] === 1) y = y0; else if (n && n[1] === -1) y = y1;
      if (n && n[0] === 1) x = x0; else if (n && n[0] === -1) x = x1;
      x = Math.min(Math.max(x, x0), x1); y = Math.min(Math.max(y, y0), y1);
      d.x = +x.toFixed(3); d.y = +y.toFixed(3);
    }
    recompute(); renderPlanSoon(); return;
  }
  if (dr.mode === 'room') { dr.b = { x: snapEixo(w.x, 'x'), y: snapEixo(w.y, 'y') }; renderPlanSoon(); }
}
function onUp(e) {
  ptrs.delete(e.pointerId);
  const dr = S.drag;
  S.guia = null;
  if (!dr) return;
  if (dr.mode === 'pinch') { if (ptrs.size === 0) S.drag = null; return; }
  S.drag = null;
  if ((dr.mode === 'move' || dr.mode === 'moveRoom' || dr.mode === 'resize') && dr.moved) { pushUndo(dr.prev); changed(); return; }
  if (dr.mode === 'room' && dr.b) {
    const x = Math.min(dr.a.x, dr.b.x), y = Math.min(dr.a.y, dr.b.y), w = Math.abs(dr.b.x - dr.a.x), h = Math.abs(dr.b.y - dr.a.y);
    if (w < 0.5 || h < 0.5) { renderPlan(); toast('Arraste um retângulo de pelo menos 0,50 × 0,50 m.'); return; }
    const a = { id: E.uid('a'), nome: 'Ambiente ' + (S.P.amb.length + 1), tipo: 'sala', x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3) };
    mutate((P) => { P.amb.push(a); });
    S.sel = { t: 'amb', id: a.id }; S.inspOpen = true;
    renderPlan(); renderInsp();
    setTimeout(() => { const f = $('#f-amb-nome'); if (f) { f.focus(); f.select(); } }, 30);
    return;
  }
  renderPlan();
}
function teclaPlanta(e) {
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { if (S.eletrA) { S.eletrA = null; renderHud(); renderPlan(); } else if (S.tool !== 'sel') setTool('sel'); else { S.sel = null; S.hiCirc = null; renderPlan(); renderInsp(); } return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); excluirSel(); return; }
  if (e.key.startsWith('Arrow') && S.sel) {
    e.preventDefault();
    const st = e.shiftKey ? 0.5 : 0.05;
    const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
    if (S.sel.t === 'dev') mutate((P) => { const d = P.dev.find((x) => x.id === S.sel.id); if (d) { d.x = +(d.x + dx).toFixed(3); d.y = +(d.y + dy).toFixed(3); } });
    if (S.sel.t === 'amb') { const a = ambById(S.sel.id); const hs = hosted(a); mutate((P) => { const r = P.amb.find((x) => x.id === a.id); r.x = +(r.x + dx).toFixed(3); r.y = +(r.y + dy).toFixed(3); for (const h of hs) { const d = P.dev.find((x) => x.id === h.id); d.x = +(d.x + dx).toFixed(3); d.y = +(d.y + dy).toFixed(3); } }); }
    return;
  }
  if (k === 'f') { fitPlan(); return; }
  const t = TOOLS.find((x) => x !== '-' && x.k.toLowerCase() === k);
  if (t) setTool(t.id);
}
function excluirSel() {
  const s = S.sel; if (!s) return;
  if (s.t === 'dev') mutate((P) => { P.dev = P.dev.filter((d) => d.id !== s.id); P.eletr = P.eletr.filter((x) => x.a !== s.id && x.b !== s.id); });
  if (s.t === 'amb') {
    const a = ambById(s.id); const ids = new Set(hosted(a).map((h) => h.id));
    mutate((P) => { P.amb = P.amb.filter((x) => x.id !== s.id); P.dev = P.dev.filter((d) => !ids.has(d.id)); P.eletr = P.eletr.filter((x) => !ids.has(x.a) && !ids.has(x.b)); });
    toast('Ambiente e seus pontos excluídos (Ctrl+Z desfaz).');
  }
  if (s.t === 'edge') {
    const e = S.R.edges.find((x) => x.id === s.id);
    if (e && e.manual) mutate((P) => { P.eletr = P.eletr.filter((x) => x.id !== s.id); });
    else { toast('Trecho automático: para removê-lo, desligue o roteamento automático em Critérios.'); return; }
  }
  S.sel = null; renderInsp();
}

/* ---------- inspetor ---------- */
const fIn = (f, v, type, extra) => `<input id="f-${f.replace('.', '-')}" data-f="${f}" type="${type || 'text'}" value="${esc(v == null ? '' : v)}" ${extra || ''}>`;
const fSel = (f, v, opts) => `<select id="f-${f.replace('.', '-')}" data-f="${f}">${opts.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
const fChk = (f, v) => `<input id="f-${f.replace('.', '-')}" data-f="${f}" type="checkbox"${v ? ' checked' : ''}>`;
const lab = (f, t) => `<label for="f-${f.replace('.', '-')}">${t}</label>`;
function renderInsp() {
  const el = $('#insp'); if (!el || S.view !== 'planta') return;
  el.className = 'insp' + (S.inspOpen ? '' : ' closed');
  const s = S.sel;
  let h = `<div class="row mob-only" style="justify-content:flex-end"><button class="btn" data-act="insp-fechar">Fechar</button></div>`;
  if (s && s.t === 'amb') h += inspAmb(ambById(s.id));
  else if (s && s.t === 'dev') h += inspDev(devById(s.id));
  else if (s && s.t === 'edge') h += inspEdge(S.R.edges.find((e) => e.id === s.id));
  else h += inspProjeto();
  const st = el.scrollTop;
  el.innerHTML = h;
  el.scrollTop = st;
}
function inspAmb(a) {
  if (!a) return '';
  const ra = S.R.amb[a.id];
  const okL = ra.tipo.semLuzMin || ra.nLuz > 0, okT = ra.nTug >= ra.tugMin;
  return `<div><h2>${esc(a.nome)}</h2><div class="ifc">IfcSpace · ${esc(a.id)}</div></div>
  <div><h3>Ambiente</h3><div class="form">
    ${lab('amb.nome', 'Nome')}${fIn('amb.nome', a.nome)}
    ${lab('amb.tipo', 'Uso')}${fSel('amb.tipo', a.tipo, Object.entries(E.TIPOS_AMB).map(([k, v]) => [k, v.n]))}
    ${lab('amb.pd', 'Pé-direito (m)')}${fIn('amb.pd', a.pd || '', 'number', `step="0.05" min="2" placeholder="${nf(S.P.par.pd, 2)}"`)}
    ${lab('amb.x', 'X (m)')}${fIn('amb.x', a.x, 'number', 'step="0.05"')}
    ${lab('amb.y', 'Y (m)')}${fIn('amb.y', a.y, 'number', 'step="0.05"')}
    ${lab('amb.w', 'Largura (m)')}${fIn('amb.w', a.w, 'number', 'step="0.05" min="0.5"')}
    ${lab('amb.h', 'Profundidade (m)')}${fIn('amb.h', a.h, 'number', 'step="0.05" min="0.5"')}
  </div></div>
  <div><h3>Previsão NBR 5410 (9.5.2)</h3><dl class="kv">
    <dt>Área</dt><dd>${nf(ra.area, 2)} m²</dd><dt>Perímetro</dt><dd>${nf(ra.per, 2)} m</dd>
    <dt>Iluminação mínima</dt><dd>${ni(ra.ilumMin)} VA</dd><dt>Iluminação prevista</dt><dd>${ni(ra.ilumVA)} VA</dd>
    <dt>Tomadas mínimas</dt><dd>${ra.tugMin}</dd><dt>Tomadas previstas</dt><dd>${ra.nTug} · ${ni(ra.tugVA)} VA</dd>
    <dt>Uso específico</dt><dd>${ra.nTue} · ${ni(ra.tueW)} W</dd>
  </dl><p class="note" style="margin-top:6px">${esc(E.regraTug(a.tipo))}.${E.tipoAmb(a.tipo).dr ? ' Circuitos deste local recebem DR 30 mA.' : ''}</p>
  <div class="row" style="margin-top:8px"><span class="pill ${okL ? 'ok' : 'crit'}">${okL ? 'Luz ok' : 'Falta ponto de luz'}</span><span class="pill ${okT ? 'ok' : 'crit'}">${okT ? 'Tomadas ok' : 'Faltam ' + (ra.tugMin - ra.nTug) + ' tomadas'}</span></div></div>
  <div><h3>Posicionar luzes do teto</h3>
    <div class="row"><button class="btn" data-act="luz-centro" data-id="${a.id}">Luz no centro</button></div>
    <div class="row" style="margin-top:8px;align-items:center"><input class="mini" id="g-cols" type="number" min="1" max="10" value="${a.w >= a.h ? 2 : 1}" aria-label="Colunas de luzes"><span>×</span><input class="mini" id="g-rows" type="number" min="1" max="10" value="${a.w >= a.h ? 1 : 2}" aria-label="Linhas de luzes"><button class="btn" data-act="luz-grade" data-id="${a.id}">Distribuir em grade</button></div>
    <p class="note" style="margin-top:6px">Troca as luzes do teto deste ambiente por pontos igualmente espaçados, com a mesma letra de comando. Ctrl+Z desfaz.</p></div>
  <div class="row"><button class="btn pri" data-act="completar" data-id="${a.id}">Completar pontos mínimos</button><button class="btn" data-act="dup-amb" data-id="${a.id}">Duplicar</button><button class="btn danger" data-act="excluir">Excluir</button></div>`;
}
function inspDev(d) {
  if (!d) return '';
  const K = E.KINDS[d.k], rd = S.R.dev[d.id] || {};
  const c = rd.circ ? circById(rd.circ) : null;
  const a = rd.amb ? ambById(rd.amb) : null;
  let f = '';
  if (d.k.startsWith('int')) f += lab('dev.k', 'Tipo') + fSel('dev.k', d.k, [['int1', 'Simples'], ['int2', 'Paralelo (three-way)'], ['int3', 'Intermediário (four-way)']]);
  if (d.k === 'tue') {
    const pr = E.TUE[d.tipo] || E.TUE.outro;
    f += lab('dev.tipo', 'Equipamento') + fSel('dev.tipo', d.tipo, Object.entries(E.TUE).map(([k, v]) => [k, v.n]));
    f += lab('dev.rotulo', 'Descrição') + fIn('dev.rotulo', d.rotulo || '', 'text', `placeholder="${esc(pr.n)}"`);
    f += lab('dev.w', 'Potência (W)') + fIn('dev.w', d.w || '', 'number', `step="50" min="0" placeholder="${pr.w}"`);
    f += lab('dev.v', 'Tensão (V)') + fSel('dev.v', d.v || pr.v, [[S.P.par.vfn, S.P.par.vfn + ' V (fase-neutro)'], [S.P.par.vff, S.P.par.vff + ' V (fase-fase)']]);
    f += lab('dev.fp', 'Fator de potência') + fIn('dev.fp', d.fp || '', 'number', `step="0.01" min="0.5" max="1" placeholder="${pr.fp}"`);
  }
  if (d.k === 'luz' || d.k === 'arandela' || d.k.startsWith('int')) f += lab('dev.cmd', 'Letra de comando') + fIn('dev.cmd', d.cmd || '', 'text', 'maxlength="3" autocomplete="off"');
  if (d.k === 'luz' || d.k === 'arandela' || d.k === 'tug') f += lab('dev.va', 'Potência (VA)') + fIn('dev.va', d.va || '', 'number', `step="10" min="0" placeholder="${ni(rd.va)} (NBR)"`);
  if (d.k === 'tug') f += lab('dev.hp', 'Altura') + fSel('dev.h', d.h != null ? d.h : 0.3, [[0.3, 'Baixa — 0,30 m'], [1.1, 'Média — 1,10 m'], [2, 'Alta — 2,00 m']].concat([[0.3, 0.3], [1.1, 1.1], [2, 2]].some(([v]) => v === +d.h) || d.h == null ? [] : [[d.h, nf(d.h, 2) + ' m']]));
  if (!['luz', 'tug', 'porta', 'med'].includes(d.k)) f += lab('dev.h', 'Altura (m)') + fIn('dev.h', d.h != null ? d.h : '', 'number', `step="0.05" min="0" placeholder="${nf(rd.h, 2)}"`);
  if (d.k === 'tug') f += lab('dev.externo', 'Alimenta equipamento externo') + fChk('dev.externo', d.externo);
  if (['luz', 'arandela', 'tug', 'tue'].includes(d.k)) f += lab('dev.grupo', 'Circuito manual') + fIn('dev.grupo', d.grupo || '', 'text', 'placeholder="automático" maxlength="12"');
  if (d.k === 'porta') f += lab('dev.w', 'Largura (m)') + fIn('dev.w', d.w || 0.8, 'number', 'step="0.05" min="0.6"');
  if (a && d.k !== 'med') {
    f += lab('rel.x', 'Distância da parede esquerda (m)') + fIn('rel.x', +(d.x - a.x).toFixed(2), 'number', `step="0.05" min="0" max="${a.w}"`);
    f += lab('rel.y', 'Distância da parede de cima (m)') + fIn('rel.y', +(d.y - a.y).toFixed(2), 'number', `step="0.05" min="0" max="${a.h}"`);
  }
  f += lab('dev.x', 'X na planta (m)') + fIn('dev.x', d.x, 'number', 'step="0.05"') + lab('dev.y', 'Y na planta (m)') + fIn('dev.y', d.y, 'number', 'step="0.05"');
  let calc = '';
  if (c) {
    calc = `<div><h3>Circuito</h3><dl class="kv"><dt>Circuito</dt><dd><span class="cnum"><i style="background:${corCirc(c.id)}"></i>${c.id}</span></dd>
      <dt>Descrição</dt><dd style="font-family:var(--f-body);text-align:right">${esc(c.desc)}</dd>
      <dt>Potência do ponto</dt><dd>${ni(rd.va)} VA</dd><dt>Tensão · fase</dt><dd>${c.v} V · ${c.fase}</dd>
      <dt>Seção · PE</dt><dd>${sec(c.secao)} · ${sec(c.pe)} mm²</dd><dt>Disjuntor</dt><dd>${c.polos}P ${c.disj} A</dd>
      <dt>DR</dt><dd>${c.dr ? c.drIn + ' A · 30 mA' : 'não exigido'}</dd><dt>Queda do circuito</dt><dd>${nf(c.dv, 2)} %</dd>
      ${rd.path ? `<dt>Distância ao QDC</dt><dd>${nf(S.R.distQD[d.id] + (rd.drop || 0) + (S.R.qd ? S.R.dev[S.R.qd].drop : 0), 1)} m</dd>` : ''}
    </dl><div class="row" style="margin-top:8px"><button class="btn" data-act="hicirc" data-id="${c.id}">${S.hiCirc === c.id ? 'Mostrar todos' : 'Destacar ' + c.id}</button></div></div>`;
  } else if (d.k === 'qdc') {
    calc = `<div><h3>Quadro</h3><dl class="kv"><dt>Circuitos</dt><dd>${S.R.circ.length}</dd><dt>Módulos + reserva</dt><dd>${S.R.quadro.modulos} + ${S.R.quadro.reserva}</dd><dt>Tamanho</dt><dd>${S.R.quadro.tamanho} módulos</dd><dt>Disjuntor geral</dt><dd>${S.R.entrada.fases}P ${S.R.alim.inQD} A</dd></dl></div>`;
  } else if (d.k === 'med') {
    calc = `<div><h3>Entrada</h3><dl class="kv"><dt>Categoria</dt><dd>${S.R.entrada.cat.c}</dd><dt>Disjuntor</dt><dd>${S.R.entrada.fases}P ${S.R.alim.inPadrao} A</dd><dt>Alimentador</dt><dd>${sec(S.R.alim.S)} mm² · ${nf(S.R.alim.L, 1)} m</dd></dl><p class="note" style="margin-top:6px">GED-13: medição no limite do terreno com a via pública, face superior da caixa entre 1,40 e 1,60 m.</p></div>`;
  }
  return `<div><h2>${esc(K.n)}</h2><div class="ifc">${esc(K.ifc)}${a ? ' · ' + esc(a.nome) : ''}</div></div>
    <div><h3>Propriedades</h3><div class="form">${f}</div></div>${calc}
    <div class="row">${a && d.k !== 'med' ? `<button class="btn" data-act="centralizar">${d.k === 'luz' ? 'Centralizar no ambiente' : 'Centralizar na parede'}</button>` : ''}<button class="btn" data-act="dup-dev">Duplicar</button><button class="btn danger" data-act="excluir">Excluir</button></div>`;
}
function inspEdge(e) {
  if (!e) return '';
  const pct = e.el ? e.area / (Math.PI * e.el.di * e.el.di / 4) * 100 : 0;
  return `<div><h2>Eletroduto ${e.manual ? 'manual' : 'automático'}</h2><div class="ifc">IfcCableCarrierSegment.CONDUITSEGMENT</div></div>
  <dl class="kv"><dt>Comprimento (laje)</dt><dd>${nf(e.L, 2)} m</dd><dt>Diâmetro</dt><dd>DN ${e.el.dn} (${e.el.pol})${e.k > 1 ? ' × ' + e.k : ''}</dd>
  <dt>Condutores por eletroduto</dt><dd>${e.nCond}</dd><dt>Ocupação</dt><dd>${nf(pct, 0)} %</dd><dt>Circuitos agrupados</dt><dd>${e.grp}</dd></dl>
  <div class="row">${[...e.circs].map((c) => `<button class="btn" data-act="hicirc" data-id="${c}"><span class="cnum"><i style="background:${corCirc(c)}"></i>${c}</span></button>`).join('')}</div>
  <p class="note">Limites de ocupação da NBR 5410 6.2.11.1.6: 53 % (1 condutor), 31 % (2), 40 % (3 ou mais).</p>
  <div class="row">${e.manual ? '<button class="btn danger" data-act="excluir">Excluir trecho</button>' : `<button class="btn" data-act="fixar-edge" data-id="${e.id}">Fixar como manual</button>`}</div>`;
}
function inspProjeto() {
  const P = S.P, p = P.par, m = P.meta;
  const leg = S.R.circ.map((c) => `<button data-act="hicirc" data-id="${c.id}" aria-pressed="${S.hiCirc === c.id}"><span class="sw" style="background:${corCirc(c.id)}"></span><span class="cid">${c.id}</span><span class="cds">${esc(c.desc)}</span><span class="cva">${ni(c.va)}</span></button>`).join('');
  return `<div><h2>${esc(P.nome)}</h2><div class="ifc">IfcProject · modelo único: ${P.amb.length} ambientes, ${P.dev.length} elementos</div></div>
  <div><h3>Circuitos</h3><div class="legend">${leg || '<p class="note">Insira pontos para gerar circuitos.</p>'}</div></div>
  <div class="row"><button class="btn pri" data-act="completar-todos">Completar pontos mínimos</button><button class="btn" data-act="fixar-rotas">Fixar rotas</button></div>
  <div><h3>Dados do projeto</h3><div class="form">
    ${lab('meta.cliente', 'Cliente')}${fIn('meta.cliente', m.cliente)}
    ${lab('meta.endereco', 'Endereço da obra')}${fIn('meta.endereco', m.endereco)}
    ${lab('meta.municipio', 'Município')}${fIn('meta.municipio', m.municipio)}
    ${lab('meta.responsavel', 'Responsável técnico')}${fIn('meta.responsavel', m.responsavel)}
    ${lab('meta.registro', 'CREA')}${fIn('meta.registro', m.registro)}
    ${lab('meta.art', 'ART nº')}${fIn('meta.art', m.art)}
  </div></div>
  <div><h3>Critérios de cálculo</h3><div class="form">
    ${lab('par.fases', 'Atendimento')}${fSel('par.fases', p.fases, [['auto', 'Automático (GED-13)'], [1, 'Monofásico'], [2, 'Bifásico'], [3, 'Trifásico']])}
    ${lab('par.esquema', 'Esquema de aterramento')}${fSel('par.esquema', p.esquema, [['TN-S', 'TN-S'], ['TN-C-S', 'TN-C-S']])}
    ${lab('par.metodo', 'Método de instalação')}${fSel('par.metodo', p.metodo, Object.entries(E.METODOS).filter(([k]) => k !== 'D').map(([k, v]) => [k, v]))}
    ${lab('par.tAmb', 'Temperatura ambiente (°C)')}${fIn('par.tAmb', p.tAmb, 'number', 'step="5" min="10" max="50"')}
    ${lab('par.maxCircEletr', 'Máx. circuitos por eletroduto')}${fIn('par.maxCircEletr', p.maxCircEletr, 'number', 'step="1" min="1" max="12"')}
    ${lab('par.limIlum', 'Limite circuito iluminação (VA)')}${fIn('par.limIlum', p.limIlum, 'number', 'step="10" min="200"')}
    ${lab('par.limTug', 'Limite circuito TUG (VA)')}${fIn('par.limTug', p.limTug, 'number', 'step="10" min="200"')}
    ${lab('par.limCoz', 'Limite TUG cozinha/serviço (VA)')}${fIn('par.limCoz', p.limCoz, 'number', 'step="10" min="200"')}
    ${lab('par.dvTerm', 'Queda máx. terminal (%)')}${fIn('par.dvTerm', p.dvTerm, 'number', 'step="0.5" min="1" max="5"')}
    ${lab('par.dvAlim', 'Queda alvo alimentador (%)')}${fIn('par.dvAlim', p.dvAlim, 'number', 'step="0.25" min="0.25" max="4"')}
    ${lab('par.rho', 'ρ cobre (Ω·mm²/m)')}${fIn('par.rho', p.rho, 'number', 'step="0.0001" min="0.015"')}
    ${lab('par.pd', 'Pé-direito padrão (m)')}${fIn('par.pd', p.pd, 'number', 'step="0.05" min="2.2"')}
    ${lab('par.alimComp', 'Alimentador (m)')}${fIn('par.alimComp', p.alimComp || '', 'number', `step="0.5" min="1" placeholder="auto ${nf(S.R.alim.L, 1)}"`)}
    ${lab('par.sobra', 'Sobra de cabos (%)')}${fIn('par.sobra', p.sobra, 'number', 'step="1" min="0" max="40"')}
    ${lab('par.curva', 'Curva dos disjuntores')}${fSel('par.curva', p.curva, [['B', 'B'], ['C', 'C']])}
    ${lab('par.drTodos', 'DR em todos os circuitos')}${fChk('par.drTodos', p.drTodos)}
    ${lab('par.dpsQd', 'DPS também no QDC')}${fChk('par.dpsQd', p.dpsQd)}
    ${lab('par.autoRota', 'Roteamento automático')}${fChk('par.autoRota', p.autoRota)}
  </div><p class="note" style="margin-top:8px">Sistema CPFL Paulista 127/220 V. O roteamento automático liga os pontos ao QDC por uma árvore que equilibra comprimento total e distância ao quadro; eletrodutos manuais têm prioridade.</p></div>`;
}
function onInspChange(e) {
  const t = e.target, f = t.dataset.f; if (!f) return;
  const [scope, key] = f.split('.');
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (t.type === 'number') v = t.value === '' ? null : +t.value;
  else v = t.value;
  if (t.tagName === 'SELECT' && /^-?\d+(\.\d+)?$/.test(v) && key !== 'tipo') v = +v;
  mutate((P) => {
    if (scope === 'amb') {
      const a = P.amb.find((x) => x.id === S.sel.id); if (!a) return;
      if (key === 'x' || key === 'y') {
        if (v == null) return;
        const d0 = v - a[key];
        for (const h of hosted(a)) { const d = P.dev.find((x) => x.id === h.id); d[key] = +(d[key] + d0).toFixed(3); }
        a[key] = v;
      } else if (key === 'w' || key === 'h') {
        if (!(v >= 0.5)) return;
        const lim = key === 'w' ? a.x + a.w : a.y + a.h, novo = key === 'w' ? a.x + v : a.y + v;
        for (const h of hosted(a)) { const d = P.dev.find((x) => x.id === h.id); const c = key === 'w' ? 'x' : 'y'; if (Math.abs(d[c] - lim) < 0.03) d[c] = novo; else d[c] = Math.min(d[c], novo); }
        a[key] = v;
      } else if (key === 'pd') { if (v) a.pd = v; else delete a.pd; }
      else if (key === 'nome') a.nome = v || 'Ambiente';
      else a[key] = v;
    } else if (scope === 'dev') {
      const d = P.dev.find((x) => x.id === S.sel.id); if (!d) return;
      if (key === 'tipo') { d.tipo = v; delete d.w; delete d.v; delete d.fp; delete d.h; }
      else if (v === null || v === '' || v === false) delete d[key];
      else d[key] = typeof v === 'string' && key !== 'k' && key !== 'rotulo' ? v.trim() : v;
    } else if (scope === 'rel') {
      const d = P.dev.find((x) => x.id === S.sel.id); if (!d || v == null) return;
      const a = P.amb.find((x) => x.id === S.R.dev[d.id].amb); if (!a) return;
      const lim = key === 'x' ? a.w : a.h;
      d[key] = +((key === 'x' ? a.x : a.y) + Math.min(Math.max(v, 0), lim)).toFixed(3);
    } else if (scope === 'par') P.par[key] = v;
    else if (scope === 'meta') P.meta[key] = v;
  });
}
function acaoPlanta(act, el) {
  const id = el.dataset.id;
  if (act === 'insp-fechar') { S.inspOpen = false; renderInsp(); }
  if (act === 'luz-centro' || act === 'luz-grade') {
    const a = ambById(id); if (!a) return;
    const lim = (sel) => Math.max(1, Math.min(10, Math.round(+(($(sel) || {}).value) || 1)));
    const c = act === 'luz-grade' ? lim('#g-cols') : 1, r = act === 'luz-grade' ? lim('#g-rows') : 1;
    const antes = S.P.dev.filter((d) => d.k === 'luz' && S.R.dev[d.id] && S.R.dev[d.id].amb === a.id);
    const letra = (antes.find((d) => d.cmd) || {}).cmd || letraDoAmbiente(a.id) || proximaLetra();
    const grupo = (antes.find((d) => d.grupo) || {}).grupo;
    const ids = new Set(antes.map((d) => d.id));
    mutate((P) => {
      P.dev = P.dev.filter((d) => !ids.has(d.id));
      P.eletr = P.eletr.filter((e) => !ids.has(e.a) && !ids.has(e.b));
      for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) {
        const d = { id: E.uid('d'), k: 'luz', x: +(a.x + a.w * (i + 0.5) / c).toFixed(3), y: +(a.y + a.h * (j + 0.5) / r).toFixed(3), amb: a.id, cmd: letra };
        if (grupo) d.grupo = grupo;
        P.dev.push(d);
      }
    });
    toast(c * r === 1 ? 'Ponto de luz no centro do ambiente.' : `${c * r} pontos de luz distribuídos (${c} × ${r}).`);
  }
  if (act === 'centralizar') {
    const d = devById(S.sel.id), rd = S.R.dev[d.id], a = rd && ambById(rd.amb); if (!a) return;
    const cx = +(a.x + a.w / 2).toFixed(3), cy = +(a.y + a.h / 2).toFixed(3);
    mutate((P) => {
      const x = P.dev.find((q) => q.id === d.id);
      if (d.k === 'luz' || !rd.nrm) { x.x = cx; x.y = cy; }
      else if (rd.nrm[0] === 0) x.x = cx; else x.y = cy;
    });
    toast(d.k === 'luz' ? 'Ponto no centro do ambiente.' : 'Ponto no meio da parede.');
  }
  if (act === 'excluir') excluirSel();
  if (act === 'completar') mutate((P) => { const n = E.completarPontos(P, id); toast(n ? n + ' pontos inseridos.' : 'O ambiente já atende ao mínimo.'); });
  if (act === 'dup-amb') {
    const a = ambById(id); const hs = hosted(a);
    const na = Object.assign({}, a, { id: E.uid('a'), nome: a.nome + ' (cópia)', x: +(a.x + a.w).toFixed(3) });
    mutate((P) => { P.amb.push(na); for (const h of hs) { const d = P.dev.find((x) => x.id === h.id); P.dev.push(Object.assign({}, d, { id: E.uid('d'), x: +(d.x + a.w).toFixed(3), amb: na.id })); } });
    S.sel = { t: 'amb', id: na.id }; renderAll();
  }
  if (act === 'dup-dev') {
    const d = devById(S.sel.id);
    if (d.k === 'qdc' || d.k === 'med') { toast('O projeto admite um único elemento deste tipo.'); return; }
    const nd = Object.assign({}, d, { id: E.uid('d'), x: +(d.x + 0.5).toFixed(3) });
    mutate((P) => { P.dev.push(nd); }); S.sel = { t: 'dev', id: nd.id }; renderAll();
  }
  if (act === 'fixar-edge') { const e = S.R.edges.find((x) => x.id === id); if (e) mutate((P) => { P.eletr.push({ id: E.uid('e'), a: e.a, b: e.b }); }); S.sel = null; renderInsp(); }
  if (act === 'fixar-rotas') mutate((P) => { for (const e of S.R.edges) if (!e.manual) P.eletr.push({ id: E.uid('e'), a: e.a, b: e.b }); toast('Rotas automáticas convertidas em eletrodutos manuais.'); });
}

/* ---------- planta estática (exportação e relatório) ---------- */
const CORES_LUZ = {
  '--sheet': '#FFFFFF', '--ink': '#16212A', '--ink-2': '#4D5E69', '--ink-3': '#82939D', '--rule': '#CBD5D4', '--wall': '#26313A',
  '--t-seco': '#FFFFFF', '--t-molhado': '#EAF3FB', '--t-externo': '#EEF5EA', '--t-circ': '#F5F6F2', '--accent': '#1C6CB4', '--sinal': '#F2B705'
};
const PLAN_CSS = `.room{stroke:none}.r-seco{fill:var(--t-seco)}.r-molhado{fill:var(--t-molhado)}.r-externo{fill:var(--t-externo)}.r-circ{fill:var(--t-circ)}
.wall{fill:none;stroke:var(--wall);stroke-linejoin:miter}.door-gap{stroke:var(--sheet)}.door{fill:none;stroke:var(--ink-2)}
.rname{fill:var(--ink);font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-weight:600}.rarea{fill:var(--ink-3);font-family:'IBM Plex Mono',monospace}
.edge{stroke:var(--ink-3)}.edge.man{stroke:var(--ink-2)}.edge.vazio{stroke-dasharray:3 3}.edge.sel{stroke:var(--accent)}.feeder{stroke:var(--ink-2);stroke-dasharray:6 4;fill:none}
.elbl{fill:var(--ink-3);font-family:'IBM Plex Mono',monospace}.sym{fill:var(--sheet);stroke:var(--ink)}.symf{fill:var(--ink)}
.slbl{fill:var(--ink-2);font-family:'IBM Plex Mono',monospace}.slbl-in{fill:var(--ink);font-family:'IBM Plex Mono',monospace;font-weight:500}.slbl-b{fill:var(--ink);font-family:'Barlow Condensed',sans-serif;font-weight:700}
.hit{fill:transparent;stroke:transparent}`;

function planSVGStatic(standalone) {
  const P = S.P, R = S.R;
  const b = bboxModelo(P);
  const m = 1.0, colW = 7.2;
  const legenda = [['luz', 'Ponto de luz no teto (letra = comando)'], ['arandela', 'Arandela'], ['int1', 'Interruptor simples'], ['int2', 'Interruptor paralelo'], ['tug', 'Tomada baixa (0,30 m)'], ['tugm', 'Tomada média (1,10 m)'], ['tuga', 'Tomada alta (2,00 m)'], ['tue', 'Ponto de uso específico'], ['qdc', 'Quadro de distribuição'], ['med', 'Medição (padrão de entrada)']];
  const linhasCirc = R.circ.length;
  const hPainel = 0.7 + legenda.length * 0.42 + 0.8 + linhasCirc * 0.34 + 0.5 + 3.4;
  const W = b.w + 2 * m + colW, H = Math.max(b.h + 2 * m + 1.0, hPainel + 0.6);
  const ox = b.x - m, oy = b.y - m;
  const vars = Object.entries(CORES_LUZ).map(([k, v]) => `${k}:${v}`).join(';');
  const savedLayers = S.layers, savedHi = S.hiCirc, savedSel = S.sel;
  S.layers = { eletr: true, rotulos: true, cores: true, alertas: false, grade: false }; S.hiCirc = null; S.sel = null;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oy} ${W} ${H}" width="${Math.round(W * 60)}" height="${Math.round(H * 60)}" style="${vars};background:#FFFFFF" font-family="Barlow, sans-serif"><style>${PLAN_CSS}</style>`;
  s += `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="#FFFFFF"/>`;
  s += `<rect x="${ox + 0.2}" y="${oy + 0.2}" width="${W - 0.4}" height="${H - 0.4}" fill="none" stroke="#16212A" stroke-width="0.03"/>`;
  s += planContent({ static: true });
  // escala gráfica
  const ex = b.x, ey = b.y + b.h + 0.75;
  for (let i = 0; i < 5; i++) s += `<rect x="${ex + i}" y="${ey}" width="1" height="0.1" fill="${i % 2 ? '#FFFFFF' : '#16212A'}" stroke="#16212A" stroke-width="0.01"/>`;
  s += `<text x="${ex}" y="${ey + 0.32}" font-size="0.16" fill="#16212A">0</text><text x="${ex + 5}" y="${ey + 0.32}" font-size="0.16" fill="#16212A" text-anchor="middle">5 m</text>`;
  // painel lateral
  const px0 = b.x + b.w + m + 0.3; let py = oy + 0.7;
  s += `<line x1="${px0 - 0.3}" y1="${oy + 0.2}" x2="${px0 - 0.3}" y2="${oy + H - 0.2}" stroke="#16212A" stroke-width="0.02"/>`;
  s += `<text x="${px0}" y="${py}" font-size="0.26" font-weight="700" fill="#16212A" font-family="Barlow Condensed, sans-serif">LEGENDA</text>`; py += 0.45;
  for (const [k, n] of legenda) {
    const kind = k.startsWith('tug') ? 'tug' : k;
    const d = { id: 'lg', k: kind, x: px0 + 0.3, y: py - 0.12, cmd: 'a', tipo: 'outro', h: k === 'tugm' ? 1.1 : k === 'tuga' ? 2 : 0.3 };
    s += symDev(d, { nrm: [0, 1], h: d.h, va: 0 }, { rotulos: false, mono: true, legenda: true });
    s += `<text x="${px0 + 0.75}" y="${py}" font-size="0.17" fill="#16212A">${esc(n)}</text>`; py += 0.42;
  }
  py += 0.35;
  s += `<text x="${px0}" y="${py}" font-size="0.26" font-weight="700" fill="#16212A" font-family="Barlow Condensed, sans-serif">CIRCUITOS</text>`; py += 0.4;
  for (const c of R.circ) {
    s += `<rect x="${px0}" y="${py - 0.17}" width="0.2" height="0.2" fill="${corCirc(c.id)}"/>`;
    const txt = `${c.id} ${c.desc}`.slice(0, 46);
    s += `<text x="${px0 + 0.32}" y="${py}" font-size="0.15" fill="#16212A">${esc(txt)}</text><text x="${px0 + colW - 0.6}" y="${py}" font-size="0.14" text-anchor="end" fill="#4D5E69" font-family="IBM Plex Mono, monospace">${sec(c.secao)}mm² ${c.disj}A${c.dr ? ' DR' : ''}</text>`;
    py += 0.34;
  }
  // carimbo
  const cy0 = oy + H - 0.2 - 3.4, cx0 = px0 - 0.3, cw = colW - 0.2;
  const L_ = (y) => `<line x1="${cx0}" y1="${y}" x2="${cx0 + cw}" y2="${y}" stroke="#16212A" stroke-width="0.02"/>`;
  s += `<rect x="${cx0}" y="${cy0}" width="${cw}" height="3.4" fill="#FFFFFF" stroke="#16212A" stroke-width="0.03"/>`;
  const tl = (x, y, t, sz, w, fill) => `<text x="${x}" y="${y}" font-size="${sz}" ${w ? `font-weight="${w}"` : ''} fill="${fill || '#16212A'}">${esc(t)}</text>`;
  s += tl(cx0 + 0.2, cy0 + 0.42, (P.nome || '').slice(0, 44), 0.26, 700);
  s += tl(cx0 + 0.2, cy0 + 0.75, 'Planta baixa — instalações elétricas de baixa tensão', 0.16);
  s += L_(cy0 + 0.95);
  s += tl(cx0 + 0.2, cy0 + 1.25, 'Cliente: ' + (P.meta.cliente || '—'), 0.15);
  s += tl(cx0 + 0.2, cy0 + 1.52, 'Obra: ' + [P.meta.endereco, P.meta.municipio].filter(Boolean).join(' — '), 0.15);
  s += L_(cy0 + 1.7);
  s += tl(cx0 + 0.2, cy0 + 2.0, 'Resp. técnico: ' + (P.meta.responsavel || '—') + (P.meta.registro ? ' · CREA ' + P.meta.registro : ''), 0.15);
  s += tl(cx0 + 0.2, cy0 + 2.27, 'ART: ' + (P.meta.art || '—') + ' · Data: ' + new Date().toLocaleDateString('pt-BR'), 0.15);
  s += L_(cy0 + 2.45);
  s += tl(cx0 + 0.2, cy0 + 2.75, 'NBR 5410:2004 · NBR 5419:2026 · NR-10 · CPFL GED-13', 0.14, 500, '#4D5E69');
  s += tl(cx0 + 0.2, cy0 + 3.05, `Categoria ${R.entrada.cat.c} · ${R.circ.length} circuitos · Escala gráfica · Cotas em metros`, 0.14, 500, '#4D5E69');
  s += '</svg>';
  S.layers = savedLayers; S.hiCirc = savedHi; S.sel = savedSel;
  return standalone ? '<?xml version="1.0" encoding="UTF-8"?>\n' + s : s;
}

/* ===================== vista 3D (mesmo modelo) ===================== */
const V3 = { ok: null, r: null, scene: null, cam: null, grp: null, tgt: null, th: -2.2, ph: 0.92, dist: 18, paredes: 'meia', eletr: true, pick: [], drag: null, ptrs: new Map(), lastKey: null, modo: 'orbita', eu: { x: 0, z: 0 }, yaw: 0, pitch: 0, colisao: true, mv: new Set(), raf: null, last: null, rapido: false, walls: [], ambEu: null, abertas: new Set(), portaAng: {}, doorObjs: {}, doorSegs: [], rafPorta: null };
const cssVar = (n) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || '#888888';

function init3d() {
  if (V3.ok !== null) return V3.ok;
  const T = window.THREE;
  if (!T) { V3.ok = false; return false; }
  try {
    V3.r = new T.WebGLRenderer({ antialias: true });
    V3.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  } catch (e) { V3.ok = false; return false; }
  V3.scene = new T.Scene();
  V3.cam = new T.PerspectiveCamera(42, 1, 0.1, 600);
  V3.tgt = new T.Vector3(5, 1, 4);
  V3.scene.add(new T.HemisphereLight(0xffffff, 0x556070, 0.95));
  const dl = new T.DirectionalLight(0xffffff, 0.55); dl.position.set(12, 22, 6); V3.scene.add(dl);
  V3.ok = true;
  return true;
}
function resize3d() {
  if (!V3.ok) return;
  const c = $('#c3'); const w = Math.max(50, c.clientWidth), h = Math.max(50, c.clientHeight);
  V3.r.setSize(w, h, false); V3.cam.aspect = w / h; V3.cam.updateProjectionMatrix(); frame3d();
}
function enquadrar3d() {
  const b = bboxModelo(S.P);
  V3.tgt.set(b.x + b.w / 2, 0.8, b.y + b.h / 2);
  V3.dist = Math.max(8, Math.hypot(b.w, b.h) * 1.35);
}
function wallSegs(P) {
  const lines = new Map();
  const push = (k, it) => { if (!lines.has(k)) lines.set(k, []); lines.get(k).push(it); };
  for (const a of P.amb) {
    const pd = a.pd || P.par.pd;
    push('h:' + a.y.toFixed(2), { a: a.x, b: a.x + a.w, pd }); push('h:' + (a.y + a.h).toFixed(2), { a: a.x, b: a.x + a.w, pd });
    push('v:' + a.x.toFixed(2), { a: a.y, b: a.y + a.h, pd }); push('v:' + (a.x + a.w).toFixed(2), { a: a.y, b: a.y + a.h, pd });
  }
  const portas = P.dev.filter((d) => d.k === 'porta');
  const out = [];
  for (const [k, arr] of lines) {
    const [o, cs] = k.split(':'); const c = +cs;
    arr.sort((p, q) => p.a - q.a);
    const merged = [];
    for (const it of arr) { const l = merged[merged.length - 1]; if (l && it.a <= l.b + 0.001) { l.b = Math.max(l.b, it.b); l.pd = Math.max(l.pd, it.pd); } else merged.push({ ...it }); }
    const cuts = portas.filter((d) => Math.abs((o === 'h' ? d.y : d.x) - c) < 0.03).map((d) => { const m = o === 'h' ? d.x : d.y, w = d.w || 0.8; return [m - w / 2, m + w / 2]; }).sort((p, q) => p[0] - q[0]);
    for (const seg of merged) {
      let cur = seg.a;
      for (const [ca, cb] of cuts) {
        if (cb <= seg.a || ca >= seg.b) continue;
        if (ca > cur) out.push({ o, c, a: cur, b: ca, pd: seg.pd, ini: cur === seg.a, fim: false });
        out.push({ o, c, a: Math.max(ca, seg.a), b: Math.min(cb, seg.b), pd: seg.pd, verga: true });
        cur = Math.min(cb, seg.b);
      }
      if (cur < seg.b) out.push({ o, c, a: cur, b: seg.b, pd: seg.pd, ini: cur === seg.a, fim: true });
    }
  }
  return out;
}
function build3d() {
  const T = THREE, P = S.P, R = S.R;
  if (V3.grp) {
    V3.scene.remove(V3.grp);
    V3.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
  }
  const g = new T.Group(); V3.grp = g; V3.pick = [];
  V3.scene.background = new T.Color(cssVar('--paper'));
  const key = P.id; if (V3.lastKey !== key) { enquadrar3d(); V3.lastKey = key; }
  const mat = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(c), roughness: 0.85, metalness: 0.02 }, o || {}));
  const b = bboxModelo(P);
  const grid = new T.GridHelper(Math.ceil(Math.max(b.w, b.h) + 8), Math.ceil(Math.max(b.w, b.h) + 8), new T.Color(cssVar('--grid-major')), new T.Color(cssVar('--grid')));
  grid.position.set(b.x + b.w / 2, -0.07, b.y + b.h / 2); g.add(grid);
  // pisos
  const tint = { 'r-seco': cssVar('--t-seco'), 'r-molhado': cssVar('--t-molhado'), 'r-externo': cssVar('--t-externo'), 'r-circ': cssVar('--t-circ') };
  for (const a of P.amb) {
    const sel = S.sel && S.sel.t === 'amb' && S.sel.id === a.id;
    const m = new T.Mesh(new T.BoxGeometry(a.w, 0.06, a.h), mat(sel ? cssVar('--accent-soft') : tint[classeAmb(a.tipo)]));
    m.position.set(a.x + a.w / 2, -0.03, a.y + a.h / 2); m.userData.sel = { t: 'amb', id: a.id }; g.add(m); V3.pick.push(m);
  }
  // paredes
  V3.walls = wallSegs(P).filter((w) => !w.verga);
  const PW = paredesEfetivas();
  if (PW !== 'oculta') {
    const wm = mat(cssVar('--rule')), em = new T.LineBasicMaterial({ color: new T.Color(cssVar('--ink-3')) });
    const t = 0.12;
    for (const s of wallSegs(P)) {
      const H = PW === 'meia' ? Math.min(1.2, s.pd) : s.pd;
      let y0 = 0, hh = H;
      if (s.verga) { if (PW === 'meia' || s.pd <= 2.1) continue; y0 = 2.1; hh = s.pd - 2.1; }
      const ext0 = s.ini ? t / 2 : 0, ext1 = s.fim ? t / 2 : 0;
      const L = s.b - s.a + ext0 + ext1; if (L < 0.01) continue;
      const geo = s.o === 'h' ? new T.BoxGeometry(L, hh, t) : new T.BoxGeometry(t, hh, L);
      const m = new T.Mesh(geo, wm);
      const mid = (s.a - ext0 + s.b + ext1) / 2;
      if (s.o === 'h') m.position.set(mid, y0 + hh / 2, s.c); else m.position.set(s.c, y0 + hh / 2, mid);
      g.add(m);
      const ed = new T.LineSegments(new T.EdgesGeometry(geo), em); ed.position.copy(m.position); g.add(ed);
    }
  }
  // portas: folha articulada na dobradiça, abre e fecha no 3D
  V3.doorObjs = {}; V3.doorSegs = [];
  for (const d of P.dev.filter((x) => x.k === 'porta')) {
    let n = null;
    for (const r of P.amb) { n = E.normalNaBorda(r, d); if (n) break; }
    if (!n) n = [0, 1];
    const w = d.w || 0.8, alto = PW === 'meia' ? 1.2 : 2.1;
    const horiz = n[0] === 0;
    V3.doorSegs.push(horiz ? { id: d.id, o: 'h', c: d.y, a: d.x - w / 2, b: d.x + w / 2 } : { id: d.id, o: 'v', c: d.x, a: d.y - w / 2, b: d.y + w / 2 });
    if (PW === 'oculta') continue;
    const piv = new T.Group();
    piv.position.set(horiz ? d.x - w / 2 : d.x, 0, horiz ? d.y : d.y - w / 2);
    const sel = S.sel && S.sel.t === 'porta' && S.sel.id === d.id;
    const folha = new T.Mesh(horiz ? new T.BoxGeometry(w - 0.02, alto, 0.04) : new T.BoxGeometry(0.04, alto, w - 0.02), mat('#B98B5A', sel ? { emissive: new T.Color(cssVar('--accent')), emissiveIntensity: 0.6 } : {}));
    folha.position.set(horiz ? w / 2 : 0, alto / 2, horiz ? 0 : w / 2);
    folha.userData.sel = { t: 'porta', id: d.id };
    piv.add(folha); V3.pick.push(folha);
    const abre = horiz ? -Math.PI / 2 * n[1] : Math.PI / 2 * n[0];
    const ang = V3.portaAng[d.id] != null ? V3.portaAng[d.id] : (V3.abertas.has(d.id) ? 1 : 0);
    V3.portaAng[d.id] = ang;
    piv.rotation.y = abre * ang;
    V3.doorObjs[d.id] = { piv, abre };
    g.add(piv);
  }
  // dispositivos
  const branco = cssVar('--sheet');
  for (const d of P.dev) {
    if (d.k === 'porta') continue;
    const rd = R.dev[d.id]; if (!rd) continue;
    const sel = S.sel && S.sel.t === 'dev' && S.sel.id === d.id;
    const cc = rd.circ && S.layers.cores ? corCirc(rd.circ) : '#9AA4AA';
    const dim = S.hiCirc && rd.circ !== S.hiCirc && d.k !== 'qdc';
    const n = rd.nrm || [0, 0];
    const off = 0.07;
    let m = null;
    const opts = sel ? { emissive: new T.Color(cssVar('--accent')), emissiveIntensity: 0.9 } : {};
    if (dim) Object.assign(opts, { transparent: true, opacity: 0.25 });
    if (d.k === 'luz') {
      m = new T.Mesh(new T.CylinderGeometry(0.15, 0.15, 0.04, 20), mat('#FFE9A8', Object.assign({ emissive: new T.Color(sel ? cssVar('--accent') : '#FFD970'), emissiveIntensity: 0.7 }, dim ? { transparent: true, opacity: 0.25 } : {})));
      m.position.set(d.x, rd.pd - 0.03, d.y);
    } else if (d.k === 'arandela') {
      m = new T.Mesh(new T.SphereGeometry(0.11, 14, 8), mat('#FFE9A8', Object.assign({ emissive: new T.Color('#FFD970'), emissiveIntensity: 0.6 }, opts)));
      m.position.set(d.x + n[0] * off, rd.h, d.y + n[1] * off);
    } else {
      const dims = { int1: [0.08, 0.12, 0.03], int2: [0.08, 0.12, 0.03], int3: [0.08, 0.12, 0.03], tug: [0.1, 0.1, 0.03], tue: [0.3, 0.22, 0.12], qdc: [0.45, 0.6, 0.1], med: [0.35, 0.5, 0.2] }[d.k] || [0.1, 0.1, 0.05];
      const color = d.k === 'qdc' || d.k === 'med' ? cssVar('--ink-2') : d.k === 'tue' ? cc : d.k === 'tug' || d.k.startsWith('int') ? (S.layers.cores && rd.circ ? cc : branco) : branco;
      const across = n[0] !== 0;
      m = new T.Mesh(across ? new T.BoxGeometry(dims[2], dims[1], dims[0]) : new T.BoxGeometry(dims[0], dims[1], dims[2]), mat(color, opts));
      m.position.set(d.x + n[0] * (off + dims[2] / 2 - 0.02), d.k === 'med' ? 1.5 : rd.h, d.y + n[1] * (off + dims[2] / 2 - 0.02));
      if (d.k === 'med') { const post = new T.Mesh(new T.BoxGeometry(0.16, 2.2, 0.16), mat('#A7ADB0')); post.position.set(d.x, 1.1, d.y); g.add(post); }
    }
    m.userData.sel = { t: 'dev', id: d.id };
    g.add(m); V3.pick.push(m);
  }
  // eletrodutos: tubos fechados, curvas arredondadas nas junções, descidas alinhadas aos pontos
  if (V3.eletr) {
    const base = mat(cssVar('--ink-3')), manual = mat(cssVar('--ink-2'));
    const hiMat = S.hiCirc ? mat(corCirc(S.hiCirc), { emissive: new T.Color(corCirc(S.hiCirc)), emissiveIntensity: 0.35 }) : null;
    const R0 = 0.014, R1 = 0.024;
    const tubo = (p1, p2, r, mm) => {
      const dv = new T.Vector3().subVectors(p2, p1); const L = dv.length(); if (L < 0.005) return;
      const mesh = new T.Mesh(new T.CylinderGeometry(r, r, L, 10, 1, false), mm);
      mesh.position.copy(p1).addScaledVector(dv, 0.5);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dv.clone().normalize());
      g.add(mesh);
    };
    const juntas = new Map();
    const junta = (p, r, mm) => { const k = p.x.toFixed(2) + '|' + p.y.toFixed(2) + '|' + p.z.toFixed(2); const o = juntas.get(k); if (!o || r > o.r) juntas.set(k, { p, r, mm }); };
    // ponto de conexão de cada elemento na laje (pontos de parede ficam colados à parede, no eixo da descida)
    const noLaje = (id) => {
      const d = devById(id), rd = R.dev[id];
      const n = (rd && rd.nrm) || [0, 0], off = d.k === 'luz' ? 0 : 0.05;
      return new T.Vector3(d.x + n[0] * off, (rd ? rd.pd : P.par.pd) - 0.06, d.y + n[1] * off);
    };
    for (const e of R.edges) {
      const A = devById(e.a), B = devById(e.b); if (!A || !B) continue;
      if (!e.circs.size && !e.ret.length) continue;
      const hi = S.hiCirc && e.circs.has(S.hiCirc);
      const mm = hi ? hiMat : e.manual ? manual : base, r = hi ? R1 : R0;
      const pa = noLaje(e.a), pb = noLaje(e.b);
      tubo(pa, pb, r, mm); junta(pa, r, mm); junta(pb, r, mm);
    }
    for (const d of P.dev) {
      const rd = R.dev[d.id]; if (!rd || rd.drop <= 0 || d.k === 'porta' || d.k === 'med' || d.k === 'luz') continue;
      const hi = S.hiCirc && rd.circ === S.hiCirc;
      const mm = hi ? hiMat : base, r = hi ? R1 : R0;
      const top = noLaje(d.id), bot = new T.Vector3(top.x, rd.h, top.z);
      tubo(top, bot, r, mm); junta(top, r, mm);
    }
    for (const { p, r, mm } of juntas.values()) { const sph = new T.Mesh(new T.SphereGeometry(r * 1.15, 10, 8), mm); sph.position.copy(p); g.add(sph); }
    const med = P.dev.find((d) => d.k === 'med'), qd = P.dev.find((d) => d.k === 'qdc');
    if (med && qd) {
      const fm = mat(cssVar('--ink-2')), rq = R.dev[qd.id], nq = (rq && rq.nrm) || [0, 0];
      const qx = qd.x + nq[0] * 0.05, qz = qd.y + nq[1] * 0.05;
      const pts = [new T.Vector3(med.x, 0.03, med.y), new T.Vector3(med.x, 0.03, qz), new T.Vector3(qx, 0.03, qz), new T.Vector3(qx, rq ? rq.h : 1.5, qz)];
      for (let k = 0; k < 3; k++) tubo(pts[k], pts[k + 1], 0.03, fm);
      for (const pt of pts.slice(1, 3)) { const sph = new T.Mesh(new T.SphereGeometry(0.034, 10, 8), fm); sph.position.copy(pt); g.add(sph); }
    }
  }
  V3.scene.add(g);
}
/* ---------- câmera: órbita (3ª pessoa) e caminhada (1ª pessoa) ---------- */
const OLHO = 1.6, RAIO_CORPO = 0.22;
function paredesEfetivas() { return V3.modo === 'pessoa' ? 'cheia' : V3.paredes; }
function alternarPorta(id) {
  if (V3.abertas.has(id)) V3.abertas.delete(id); else V3.abertas.add(id);
  animarPortas(); render3dInsp();
}
function todasPortas(abrir) {
  for (const d of S.P.dev.filter((x) => x.k === 'porta')) { if (abrir) V3.abertas.add(d.id); else V3.abertas.delete(d.id); }
  animarPortas(); render3dInsp();
}
function animarPortas() {
  if (V3.rafPorta) return;
  let last = null;
  const passo = (ts) => {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
    let ativo = false;
    for (const id of Object.keys(V3.doorObjs || {})) {
      const alvo = V3.abertas.has(id) ? 1 : 0, cur = V3.portaAng[id] || 0;
      if (Math.abs(alvo - cur) > 0.001) {
        const nv = cur + Math.sign(alvo - cur) * Math.min(Math.abs(alvo - cur), dt * 2.5);
        V3.portaAng[id] = nv; const o = V3.doorObjs[id]; o.piv.rotation.y = o.abre * nv; ativo = true;
      }
    }
    frame3d();
    V3.rafPorta = ativo ? requestAnimationFrame(passo) : null;
  };
  V3.rafPorta = requestAnimationFrame(passo);
}
function nomePorta(d) {
  const nomes = S.P.amb.filter((r) => E.normalNaBorda(r, d)).map((r) => r.nome);
  return nomes.length ? nomes.join(' / ') : 'Porta externa';
}
function bloqueado(x, z) {
  if (!V3.colisao || V3.modo !== 'pessoa') return false;
  const fechadas = (V3.doorSegs || []).filter((d) => (V3.portaAng[d.id] || 0) < 0.5);
  for (const s of (V3.walls || []).concat(fechadas)) {
    if (s.o === 'h') { if (Math.abs(z - s.c) < RAIO_CORPO && x > s.a - 0.06 && x < s.b + 0.06) return true; }
    else if (Math.abs(x - s.c) < RAIO_CORPO && z > s.a - 0.06 && z < s.b + 0.06) return true;
  }
  return false;
}
function mover3d(frente, lado) {
  // frente/lado em metros; direção conforme o modo
  let fx, fz;
  if (V3.modo === 'pessoa') { fx = Math.cos(V3.yaw); fz = Math.sin(V3.yaw); }
  else { fx = -Math.cos(V3.th); fz = -Math.sin(V3.th); }
  const lx = -fz, lz = fx;
  const dx = fx * frente + lx * lado, dz = fz * frente + lz * lado;
  if (V3.modo === 'pessoa') {
    const p = V3.eu;
    if (!bloqueado(p.x + dx, p.z)) p.x += dx;
    if (!bloqueado(p.x, p.z + dz)) p.z += dz;
  } else { V3.tgt.x += dx; V3.tgt.z += dz; }
}
function frame3d() {
  if (!V3.ok) return;
  if (V3.modo === 'pessoa') {
    const p = V3.eu, cp = Math.cos(V3.pitch);
    V3.cam.position.set(p.x, OLHO, p.z);
    V3.cam.lookAt(p.x + cp * Math.cos(V3.yaw), OLHO + Math.sin(V3.pitch), p.z + cp * Math.sin(V3.yaw));
  } else {
    const t = V3.tgt, r = V3.dist;
    V3.cam.position.set(t.x + r * Math.sin(V3.ph) * Math.cos(V3.th), t.y + r * Math.cos(V3.ph), t.z + r * Math.sin(V3.ph) * Math.sin(V3.th));
    V3.cam.lookAt(t);
  }
  V3.r.render(V3.scene, V3.cam);
}
function setModo3d(m, ambId) {
  V3.modo = m;
  V3.cam.fov = m === 'pessoa' ? 70 : 42; V3.cam.updateProjectionMatrix();
  if (m === 'pessoa') {
    let a = ambId ? ambById(ambId) : (S.sel && S.sel.t === 'amb' ? ambById(S.sel.id) : null);
    if (!a) a = [...S.P.amb].sort((p, q) => q.w * q.h - p.w * p.h)[0];
    if (a) { V3.eu = { x: a.x + a.w / 2, z: a.y + a.h / 2 }; V3.yaw = a.w >= a.h ? 0 : Math.PI / 2; }
    else V3.eu = { x: 0, z: 0 };
    V3.pitch = 0; V3.ambEu = a ? a.id : null;
  }
  build3d(); frame3d(); render3dInsp();
}
// laço de movimento enquanto uma tecla ou botão de direção está pressionado
function loop3d(ts) {
  if (!V3.mv.size || S.view !== 'vista-3d') { V3.raf = null; V3.last = null; return; }
  const dt = V3.last ? Math.min(0.05, (ts - V3.last) / 1000) : 0.016; V3.last = ts;
  const vel = (V3.modo === 'pessoa' ? 1.6 : Math.max(2, V3.dist * 0.35)) * (V3.rapido ? 2.2 : 1) * dt;
  let f = 0, l = 0;
  if (V3.mv.has('f')) f += 1; if (V3.mv.has('b')) f -= 1;
  if (V3.mv.has('l')) l -= 1; if (V3.mv.has('r')) l += 1;
  if (V3.mv.has('vl')) { if (V3.modo === 'pessoa') V3.yaw -= 1.6 * dt; else V3.th -= 1.4 * dt; }
  if (V3.mv.has('vr')) { if (V3.modo === 'pessoa') V3.yaw += 1.6 * dt; else V3.th += 1.4 * dt; }
  if (f || l) mover3d(f * vel, l * vel);
  frame3d();
  V3.raf = requestAnimationFrame(loop3d);
}
function startMv(k) { V3.mv.add(k); if (!V3.raf) V3.raf = requestAnimationFrame(loop3d); }
function stopMv(k) { if (k) V3.mv.delete(k); else V3.mv.clear(); }

function render3dView() {
  const c = $('#c3');
  if (!init3d()) {
    c.innerHTML = '<div class="panel" style="margin:16px">A vista 3D precisa de WebGL e da biblioteca 3D, que não carregaram nesta visualização. As demais vistas funcionam normalmente.</div>';
    render3dInsp(); return;
  }
  if (!c.contains(V3.r.domElement)) { c.innerHTML = ''; c.appendChild(V3.r.domElement); }
  if (!c.querySelector('.pad3')) {
    const pad = document.createElement('div');
    pad.className = 'pad3';
    pad.innerHTML = `<button data-mv="vl" aria-label="Virar à esquerda">⟲</button><button data-mv="f" aria-label="Andar para frente">▲</button><button data-mv="vr" aria-label="Virar à direita">⟳</button>
      <button data-mv="l" aria-label="Deslizar para a esquerda">◀</button><button data-mv="b" aria-label="Andar para trás">▼</button><button data-mv="r" aria-label="Deslizar para a direita">▶</button>`;
    c.appendChild(pad);
    const modo = document.createElement('div');
    modo.className = 'modo3 seg';
    c.appendChild(modo);
  }
  renderModoChip();
  render3dInsp();
  requestAnimationFrame(() => { resize3d(); build3d(); frame3d(); });
}
function telaCheia(on) {
  const c = $('#c3'); if (!c) return;
  V3.full = on == null ? !V3.full : on;
  c.classList.toggle('c3-full', V3.full);
  document.body.classList.toggle('sem-rolagem', V3.full);
  const de = document.documentElement;
  try {
    if (V3.full && de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().catch(() => {});
    if (!V3.full && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (e) { /* navegador sem tela cheia nativa (iPhone): fica a tela cheia da página */ }
  renderModoChip();
  requestAnimationFrame(() => { resize3d(); setTimeout(resize3d, 250); });
}
function renderModoChip() {
  const m = $('#c3 .modo3'); if (!m) return;
  m.innerHTML = `<button data-modo="orbita" aria-pressed="${V3.modo !== 'pessoa'}">3ª pessoa</button><button data-modo="pessoa" aria-pressed="${V3.modo === 'pessoa'}">1ª pessoa</button>${V3.modo !== 'pessoa' ? '<button data-centro="1" title="Voltar a casa inteira para o centro da tela">⌖ Centralizar</button>' : ''}<button data-tela="1" title="${V3.full ? 'Sair da tela cheia' : 'Ver em tela cheia'}">${V3.full ? '✕ Sair' : '⛶ Tela cheia'}</button>`;
}
function render3dInsp() {
  renderModoChip();
  const el = $('#insp3'); if (!el) return;
  const s = S.sel;
  let selTxt = '<p class="note">Clique num elemento para ver os dados dele.</p>';
  if (s && s.t === 'dev') {
    const d = devById(s.id), rd = S.R.dev[s.id] || {}; const K = d ? E.KINDS[d.k] : null; const c = rd.circ ? circById(rd.circ) : null;
    if (d) selTxt = `<div><b>${esc(K.n)}</b><div class="ifc">${esc(K.ifc)}</div></div><dl class="kv"><dt>Altura</dt><dd>${nf(rd.h, 2)} m</dd>${rd.va ? `<dt>Potência</dt><dd>${ni(rd.va)} VA</dd>` : ''}${c ? `<dt>Circuito</dt><dd>${c.id} · ${sec(c.secao)} mm² · ${c.disj} A</dd>` : ''}</dl><div class="row"><button class="btn" data-act="ir" data-tipo="dev" data-id="${d.id}">Editar na planta</button></div>`;
  } else if (s && s.t === 'amb') {
    const a = ambById(s.id), ra = S.R.amb[s.id];
    if (a) selTxt = `<div><b>${esc(a.nome)}</b><div class="ifc">IfcSpace</div></div><dl class="kv"><dt>Área</dt><dd>${nf(ra.area, 2)} m²</dd><dt>Pé-direito</dt><dd>${nf(ra.pd, 2)} m</dd><dt>Pontos</dt><dd>${ra.nLuz} luz · ${ra.nTug} TUG · ${ra.nTue} TUE</dd></dl><div class="row"><button class="btn" data-act="ir" data-tipo="amb" data-id="${a.id}">Editar na planta</button></div>`;
  }
  const pessoa = V3.modo === 'pessoa';
  const modoUI = pessoa
    ? `<div><h3>Caminhar (1ª pessoa)</h3><div class="form"><label for="f3-amb">Ir para</label><select id="f3-amb">${S.P.amb.map((a) => `<option value="${a.id}"${a.id === V3.ambEu ? ' selected' : ''}>${esc(a.nome)}</option>`).join('')}</select>
        <label for="f3-col">Paredes bloqueiam</label><input id="f3-col" type="checkbox"${V3.colisao ? ' checked' : ''}></div>
        <p class="note" style="margin-top:6px">Olhos a 1,60 m do piso. Arraste para olhar em volta. Ande com W A S D ou as setas (Shift corre), a roda do mouse ou os botões na tela. As portas deixam passar.</p></div>`
    : `<div><h3>Paredes</h3><div class="seg">${[['cheia', 'Inteiras'], ['meia', 'Cortadas a 1,20 m'], ['oculta', 'Ocultas']].map(([k, n]) => `<button data-p3="${k}" aria-pressed="${V3.paredes === k}">${n}</button>`).join('')}</div></div>
      <div><h3>Câmera</h3><div class="seg"><button data-cam="iso">Isométrica</button><button data-cam="topo">Topo</button><button data-cam="frente">Frente</button><button data-centro3="1">Centralizar</button></div><p class="note" style="margin-top:6px">Arraste para girar. Deslize pelo ambiente com W A S D ou as setas, Shift + arrastar, botão direito, dois dedos ou os botões na tela. Roda ou pinça aproxima.</p></div>`;
  el.innerHTML = `<div><h2>Vista 3D</h2><div class="ifc">gerada do mesmo modelo da planta</div></div>
    <div><h3>Modo</h3><div class="seg"><button data-modo="orbita" aria-pressed="${!pessoa}">3ª pessoa (órbita)</button><button data-modo="pessoa" aria-pressed="${pessoa}">1ª pessoa (caminhar)</button></div></div>
    ${modoUI}
    <div><h3>Portas</h3><div class="row"><button class="btn" data-portas="abrir">Abrir todas</button><button class="btn" data-portas="fechar">Fechar todas</button></div>
      <div class="legend" style="margin-top:8px">${S.P.dev.filter((d) => d.k === 'porta').map((d) => `<button data-porta="${d.id}" aria-pressed="${V3.abertas.has(d.id)}"><span class="sw" style="background:${V3.abertas.has(d.id) ? 'var(--ok)' : 'var(--ink-3)'}"></span><span class="cid">${V3.abertas.has(d.id) ? 'aberta' : 'fechada'}</span><span class="cds">${esc(nomePorta(d))}</span><span class="cva">${nf(d.w || 0.8, 2)} m</span></button>`).join('') || '<p class="note">Nenhuma porta no projeto.</p>'}</div>
      <p class="note" style="margin-top:6px">Toque numa porta na vista 3D para abrir ou fechar. Na 1ª pessoa, porta fechada bloqueia a passagem.</p></div>
    <div><h3>Exibir</h3><div class="seg"><button data-t3="eletr" aria-pressed="${V3.eletr}">Eletrodutos</button><button data-t3="cores" aria-pressed="${S.layers.cores}">Cores por circuito</button></div></div>
    <div><h3>Seleção</h3>${selTxt}</div>
    <div><h3>Destacar circuito</h3><div class="legend">${S.R.circ.map((c) => `<button data-act="hicirc3" data-id="${c.id}" aria-pressed="${S.hiCirc === c.id}"><span class="sw" style="background:${corCirc(c.id)}"></span><span class="cid">${c.id}</span><span class="cds">${esc(c.desc)}</span><span class="cva">${ni(c.va)}</span></button>`).join('')}</div></div>`;
}
function bind3d() {
  const c = $('#c3');
  c.addEventListener('pointerdown', (e) => {
    const mvb = e.target.closest('[data-mv]');
    if (mvb) { e.preventDefault(); try { mvb.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } startMv(mvb.dataset.mv); mvb.classList.add('on'); return; }
    if (e.target.closest('.pad3, .modo3')) return;
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    V3.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (V3.ptrs.size === 2) {
      const [a, b] = [...V3.ptrs.values()];
      V3.drag = { mode: 'two', d0: Math.hypot(a.x - b.x, a.y - b.y), r0: V3.dist, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    V3.drag = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'rot', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
  });
  c.addEventListener('pointermove', (e) => {
    if (!V3.drag || !V3.ok) return;
    if (V3.ptrs.has(e.pointerId)) V3.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dr = V3.drag;
    if (dr.mode === 'two') {
      if (V3.ptrs.size < 2) return;
      const [a, b] = [...V3.ptrs.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ddx = mx - dr.mx, ddy = my - dr.my; dr.mx = mx; dr.my = my;
      if (V3.modo === 'pessoa') mover3d(ddy * 0.012, -ddx * 0.012);
      else {
        V3.dist = Math.max(3, Math.min(150, dr.r0 * dr.d0 / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
        const k = V3.dist * 0.0016; mover3d(ddy * k, -ddx * k);
      }
      frame3d(); return;
    }
    const dx = e.clientX - dr.x, dy = e.clientY - dr.y; dr.x = e.clientX; dr.y = e.clientY;
    if (V3.modo === 'pessoa') {
      if (dr.mode === 'pan') mover3d(dy * 0.012, -dx * 0.012);
      else { V3.yaw += dx * 0.005; V3.pitch = Math.max(-1.2, Math.min(1.2, V3.pitch - dy * 0.005)); }
    } else if (dr.mode === 'rot') { V3.th += dx * 0.008; V3.ph = Math.max(0.06, Math.min(1.52, V3.ph - dy * 0.008)); }
    else { const k = V3.dist * 0.0016; mover3d(dy * k, -dx * k); }
    frame3d();
  });
  const up = (e) => {
    const mvb = e.target.closest && e.target.closest('[data-mv]');
    if (mvb) { stopMv(mvb.dataset.mv); mvb.classList.remove('on'); return; }
    V3.ptrs.delete(e.pointerId);
    const dr = V3.drag;
    if (dr && dr.mode !== 'two' && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 4 && V3.ok) pick3d(e);
    if (!V3.ptrs.size) V3.drag = null;
  };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('lostpointercapture', (e) => { const mvb = e.target.closest && e.target.closest('[data-mv]'); if (mvb) { stopMv(mvb.dataset.mv); mvb.classList.remove('on'); } });
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (V3.modo === 'pessoa') mover3d(-e.deltaY * 0.004, 0);
    else V3.dist = Math.max(3, Math.min(150, V3.dist * Math.exp(e.deltaY * 0.0012)));
    frame3d();
  }, { passive: false });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('click', (e) => { const m = e.target.closest('[data-modo]'); if (m) setModo3d(m.dataset.modo); if (e.target.closest('[data-centro]')) { enquadrar3d(); frame3d(); } if (e.target.closest('[data-tela]')) telaCheia(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && V3.full) telaCheia(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && V3.full) telaCheia(false); });
  const TECLAS = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', q: 'vl', e: 'vr' };
  document.addEventListener('keydown', (e) => {
    if (S.view !== 'vista-3d' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    V3.rapido = e.shiftKey;
    const k = TECLAS[e.key.toLowerCase()]; if (!k) return;
    e.preventDefault(); startMv(k);
  });
  document.addEventListener('keyup', (e) => { V3.rapido = e.shiftKey; const k = TECLAS[(e.key || '').toLowerCase()]; if (k) stopMv(k); });
  window.addEventListener('blur', () => stopMv());
  $('#insp3').addEventListener('change', (e) => {
    if (e.target.id === 'f3-amb') setModo3d('pessoa', e.target.value);
    if (e.target.id === 'f3-col') { V3.colisao = e.target.checked; }
  });
  $('#insp3').addEventListener('click', (e) => {
    const md = e.target.closest('[data-modo]'); if (md) { setModo3d(md.dataset.modo); return; }
    const pt = e.target.closest('[data-porta]'); if (pt) { alternarPorta(pt.dataset.porta); return; }
    const pa = e.target.closest('[data-portas]'); if (pa) { todasPortas(pa.dataset.portas === 'abrir'); return; }
    const p = e.target.closest('[data-p3]'); if (p) { V3.paredes = p.dataset.p3; build3d(); frame3d(); render3dInsp(); return; }
    const t = e.target.closest('[data-t3]'); if (t) { if (t.dataset.t3 === 'eletr') V3.eletr = !V3.eletr; else S.layers.cores = !S.layers.cores; build3d(); frame3d(); render3dInsp(); return; }
    if (e.target.closest('[data-centro3]')) { enquadrar3d(); frame3d(); return; }
    const cm = e.target.closest('[data-cam]'); if (cm) { enquadrar3d(); const v = cm.dataset.cam; if (v === 'topo') { V3.ph = 0.06; V3.th = -Math.PI / 2; } else if (v === 'frente') { V3.ph = 1.32; V3.th = Math.PI / 2; } else { V3.ph = 0.92; V3.th = -2.2; } frame3d(); return; }
    const h = e.target.closest('[data-act="hicirc3"]'); if (h) { S.hiCirc = S.hiCirc === h.dataset.id ? null : h.dataset.id; build3d(); frame3d(); render3dInsp(); }
  });
}
function pick3d(e) {
  const T = THREE, c = $('#c3'), r = c.getBoundingClientRect();
  const v = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const rc = new T.Raycaster(); rc.setFromCamera(v, V3.cam);
  const hit = rc.intersectObjects(V3.pick, false)[0];
  if (hit && hit.object.userData.sel.t === 'porta') { alternarPorta(hit.object.userData.sel.id); return; }
  S.sel = hit ? hit.object.userData.sel : null;
  build3d(); frame3d(); render3dInsp();
}

/* ===================== folhas: tabelas, diagramas e relatório ===================== */
const cab = (ref, titulo, lead) => `<div><div class="ref">${ref}</div><h1>${titulo}</h1>${lead ? `<p class="lead" style="margin-top:6px">${lead}</p>` : ''}</div>`;
const nomeAmb = (id) => { const a = ambById(id); return a ? a.nome : '—'; };
const fasesTxt = (n) => ({ 1: 'monofásico (fase + neutro)', 2: 'bifásico (2 fases + neutro)', 3: 'trifásico (3 fases + neutro)' }[n]);

/* ---------- previsão de cargas ---------- */
function tabCargas(inter) {
  const R = S.R;
  let tI = 0, tT = 0, tE = 0, nL = 0, nT = 0, nE = 0;
  const rows = S.P.amb.map((a) => {
    const r = R.amb[a.id];
    tI += r.ilumVA; tT += r.tugVA; tE += r.tueW; nL += r.nLuz; nT += r.nTug; nE += r.nTue;
    const okL = r.tipo.semLuzMin || r.nLuz > 0, okT = r.nTug >= r.tugMin, okV = r.nLuz === 0 || r.ilumVA >= r.ilumMin;
    const st = okL && okT && okV ? '<span class="pill ok">Atende</span>' : `<span class="pill crit">${!okL ? 'Sem luz' : !okT ? 'Faltam ' + (r.tugMin - r.nTug) + ' TUG' : 'Iluminação baixa'}</span>`;
    return `<tr${inter ? ` class="click" data-act="ir" data-tipo="amb" data-id="${a.id}"` : ''}><td>${esc(a.nome)}</td><td>${esc(r.tipo.n)}</td><td class="n">${nf(r.area, 2)}</td><td class="n">${nf(r.per, 2)}</td><td class="n">${ni(r.ilumMin)}</td><td class="n">${r.nLuz} · ${ni(r.ilumVA)}</td><td class="n">${r.tugMin}</td><td class="n">${r.nTug}</td><td class="n">${ni(r.tugVA)}</td><td class="n">${r.nTue ? ni(r.tueW) : '—'}</td><td>${st}</td></tr>`;
  }).join('');
  return { html: `<div class="tw"><table><thead><tr><th>Ambiente</th><th>Uso</th><th class="n">Área m²</th><th class="n">Perím. m</th><th class="n">Ilum. mín. VA</th><th class="n">Pontos · VA</th><th class="n">TUG mín.</th><th class="n">TUG prev.</th><th class="n">TUG VA</th><th class="n">TUE W</th><th>Situação</th></tr></thead><tbody>${rows || '<tr><td colspan="11">Desenhe ambientes na planta.</td></tr>'}</tbody><tfoot><tr><td colspan="5">Total</td><td class="n">${nL} · ${ni(tI)}</td><td></td><td class="n">${nT}</td><td class="n">${ni(tT)}</td><td class="n">${ni(tE)}</td><td></td></tr></tfoot></table></div>`, tI, tT, tE, nL, nT, nE };
}
function tabTue(inter) {
  const tues = S.P.dev.filter((d) => d.k === 'tue');
  if (!tues.length) return '<p class="note">Nenhum ponto de uso específico no modelo.</p>';
  return `<div class="tw"><table><thead><tr><th>Equipamento</th><th>Ambiente</th><th class="n">Potência W</th><th class="n">Tensão V</th><th class="n">FP</th><th class="n">VA</th><th class="n">Ib A</th><th>Circuito</th></tr></thead><tbody>${tues.map((d) => {
    const rd = S.R.dev[d.id], pr = E.TUE[d.tipo] || E.TUE.outro;
    return `<tr${inter ? ` class="click" data-act="ir" data-tipo="dev" data-id="${d.id}"` : ''}><td>${esc(d.rotulo || pr.n)}</td><td>${esc(nomeAmb(rd.amb))}</td><td class="n">${ni(rd.w)}</td><td class="n">${rd.v}</td><td class="n">${nf(rd.fp, 2)}</td><td class="n">${ni(rd.va)}</td><td class="n">${nf(rd.va / rd.v, 1)}</td><td>${rd.circ ? `<span class="cnum"><i style="background:${corCirc(rd.circ)}"></i>${rd.circ}</span>` : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function sheetCargas() {
  const t = tabCargas(true);
  return `<div class="doc">${cab('ABNT NBR 5410:2004 · 9.5.2', 'Previsão de cargas', 'Mínimos de iluminação e de tomadas calculados a partir da geometria de cada ambiente do modelo. Clique numa linha para localizar o ambiente na planta.')}
    <div class="kpis"><div class="kpi"><b>${ni(t.tI)} VA</b><span>iluminação · ${t.nL} pontos</span></div><div class="kpi"><b>${ni(t.tT)} VA</b><span>tomadas de uso geral · ${t.nT} pontos</span></div><div class="kpi"><b>${ni(t.tE)} W</b><span>uso específico · ${t.nE} pontos</span></div><div class="kpi"><b>${nf(S.R.entrada.C, 2)} kW</b><span>carga instalada (GED-13)</span></div></div>
    ${t.html}
    <div class="row"><button class="btn pri" data-act="completar-todos">Completar pontos mínimos em todos os ambientes</button></div>
    <div><h2>Pontos de uso específico</h2>${tabTue(true)}</div>
    <div class="grid2">
      <div class="panel"><h2>Iluminação (9.5.2.1)</h2><p>Pelo menos um ponto de luz no teto por cômodo, comandado por interruptor. Carga mínima: 100 VA até 6 m²; acima disso, 100 VA para os primeiros 6 m² mais 60 VA a cada 4 m² inteiros. O ambiente distribui essa carga entre seus pontos quando a potência do ponto não é informada.</p></div>
      <div class="panel"><h2>Tomadas (9.5.2.2)</h2><p>Banheiro: 1 junto ao lavatório. Cozinha, copa e área de serviço: 1 a cada 3,5 m de perímetro. Sala e dormitório: 1 a cada 5 m. Varanda: 1. Demais: 1 até 6 m², acima 1 a cada 5 m. Em locais molhados atribuem-se 600 VA às ${S.R.kAte} primeiras tomadas de cada ambiente${S.R.kAte === 2 ? ' (o conjunto passa de 6 tomadas)' : ''} e 100 VA às demais; nos outros cômodos, 100 VA por tomada.</p></div>
    </div></div>`;
}

/* ---------- quadro de cargas ---------- */
function tabQuadro(inter) {
  const R = S.R;
  const fas = ['A', 'B', 'C'].slice(0, R.entrada.fases);
  const rows = R.circ.map((c) => `<tr class="${S.hiCirc === c.id ? 'hi ' : ''}${inter ? 'click' : ''}"${inter ? ` data-act="circ-planta" data-id="${c.id}" title="Ver ${c.id} na planta"` : ''}>
    <td><span class="cnum"><i style="background:${corCirc(c.id)}"></i>${c.id}</span></td><td style="min-width:220px">${esc(c.desc)}${c.manual ? ' <span class="pill info">manual</span>' : ''}</td>
    <td class="n">${c.v}</td><td class="n">${c.fase || '—'}</td><td class="n">${c.devs.length}</td><td class="n">${ni(c.va)}</td><td class="n">${nf(c.ib, 1)}</td>
    <td class="n">${c.nGrupo}</td><td class="n">${nf(c.fca, 2)}</td><td class="n">${sec(c.secao)}</td><td class="n">${sec(c.pe)}</td><td class="n">${nf(c.iz, 1)}</td>
    <td class="n">${c.polos}P ${c.disj}</td><td>${c.dr ? `<span class="pill dr" title="${esc(c.drMotivo)}">${c.drIn} A 30 mA</span>` : '—'}</td>
    <td class="n" style="color:${c.dv > R.dvTermLim ? 'var(--crit)' : 'inherit'}">${nf(c.dv, 2)}</td><td class="n">${nf(c.comp, 1)}</td></tr>`).join('');
  const porFase = fas.map((f) => `${f}: ${ni(R.entrada.cargaFase[f])} VA`).join(' · ');
  return `<div class="tw"><table><thead><tr><th>Circ.</th><th>Descrição</th><th class="n">V</th><th class="n">Fase</th><th class="n">Pontos</th><th class="n">VA</th><th class="n">Ib A</th><th class="n">Agrup.</th><th class="n">FCA</th><th class="n">Seção mm²</th><th class="n">PE mm²</th><th class="n">Iz' A</th><th class="n">Disjuntor A</th><th>DR</th><th class="n">ΔV %</th><th class="n">Cabo m</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="16">Nenhum circuito: insira pontos na planta.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5">Total instalado</td><td class="n">${ni(R.circ.reduce((s, c) => s + c.va, 0))}</td><td colspan="10">${porFase}</td></tr></tfoot></table></div>`;
}
function sheetQuadro() {
  const R = S.R, p = S.P.par, al = R.alim;
  return `<div class="doc">${cab('ABNT NBR 5410:2004 · 6.2.5, 6.2.6, 6.2.7, 5.3.4', 'Quadro de cargas', 'Divisão automática de circuitos, dimensionamento dos condutores por capacidade de condução e queda de tensão, e coordenação com a proteção (Ib ≤ In ≤ Iz). Clique num circuito para destacá-lo na planta.')}
    <div class="kpis"><div class="kpi"><b>${R.circ.length}</b><span>circuitos terminais</span></div><div class="kpi"><b>${nf(R.entrada.D, 2)} kVA</b><span>demanda (GED-13)</span></div><div class="kpi"><b>${R.entrada.fases}P ${al.inQD} A</b><span>disjuntor geral do QDC</span></div><div class="kpi"><b>${R.quadro.tamanho}</b><span>módulos DIN (${R.quadro.modulos} usados + ${R.quadro.reserva} reserva)</span></div><div class="kpi"><b>${nf(R.dvTermLim, 2)} %</b><span>queda máxima admitida no circuito terminal</span></div></div>
    ${tabQuadro(true)}
    <div class="row"><button class="btn" data-act="baixar-quadro">Baixar quadro de cargas (.csv)</button></div>
    <div class="grid2">
      <div class="panel"><h2>Alimentador medição → QDC</h2><dl class="kv"><dt>Comprimento</dt><dd>${nf(al.L, 1)} m</dd><dt>Corrente de demanda</dt><dd>${nf(al.Ib, 1)} A</dd><dt>Proteção no padrão</dt><dd>${al.fases}P ${al.inPadrao} A</dd><dt>Fases + neutro + PE</dt><dd>${al.fases} × ${sec(al.S)} + ${sec(al.neutro)} + ${sec(al.pe)} mm²</dd><dt>Iz corrigida</dt><dd>${nf(al.iz, 1)} A</dd><dt>Queda de tensão</dt><dd>${nf(al.dv, 2)} %</dd></dl><p class="note" style="margin-top:8px">A GED-13 exige que o alimentador até o quadro tenha no mínimo a seção do ramal de entrada da categoria.</p></div>
      <div class="panel"><h2>Critérios aplicados</h2><dl class="kv"><dt>Método de instalação</dt><dd>${p.metodo}</dd><dt>Temperatura ambiente · FCT</dt><dd>${p.tAmb} °C · ${nf(E.fct(p.tAmb), 2)}</dd><dt>Circuitos por eletroduto (máx.)</dt><dd>${p.maxCircEletr}</dd><dt>ρ do cobre</dt><dd>${String(p.rho).replace('.', ',')} Ω·mm²/m</dd><dt>Queda: terminal · total</dt><dd>${nf(p.dvTerm, 1)} % · ${nf(p.dvTotal, 1)} %</dd><dt>Seção mínima</dt><dd>1,5 (ilum.) · 2,5 (força) mm²</dd></dl>
      <p class="note" style="margin-top:8px">O agrupamento de cada circuito vem do trecho de eletroduto mais carregado do seu percurso no modelo (Tabela 42). A queda de tensão soma, trecho a trecho, a corrente que passa em cada segmento até o ponto mais desfavorável, incluindo as descidas da laje.</p></div>
    </div></div>`;
}

/* ---------- unifilar ---------- */
function unifilarSVG(standalone) {
  const R = S.R, P = S.P, al = R.alim, en = R.entrada;
  const n = R.circ.length, W0 = 92, x0 = 280, busY = 330;
  const W = Math.max(760, x0 + Math.max(1, n) * W0 + 40), H = 760;
  const ink = 'var(--ink)', ink2 = 'var(--ink-2)';
  const ln = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${ink}" stroke-width="${w || 1.5}"/>`;
  const tx = (x, y, t, o) => `<text x="${x}" y="${y}" font-size="${(o && o.s) || 12}" ${o && o.a ? `text-anchor="${o.a}"` : ''} ${o && o.b ? 'font-weight="700"' : ''} style="fill:${(o && o.c) || ink}" ${o && o.f ? `font-family="${o.f}"` : ''} ${o && o.t ? `transform="${o.t}"` : ''}>${esc(t)}</text>`;
  const disj = (cx, y) => ln(cx, y, cx, y + 10) + ln(cx - 4, y + 6, cx + 4, y + 14, 1.5) + ln(cx + 4, y + 6, cx - 4, y + 14, 1.5) + ln(cx, y + 30, cx - 11, y + 12, 1.6) + ln(cx, y + 30, cx, y + 40);
  const terra = (cx, y) => ln(cx, y, cx, y + 8) + ln(cx - 9, y + 8, cx + 9, y + 8, 1.8) + ln(cx - 6, y + 12, cx + 6, y + 12, 1.6) + ln(cx - 3, y + 16, cx + 3, y + 16, 1.4);
  const caixa = (x, y, w, h, t1, t2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" style="fill:var(--sheet);stroke:${ink}" stroke-width="1.4"/>` + tx(x + w / 2, y + (t2 ? h / 2 - 2 : h / 2 + 4), t1, { a: 'middle', s: 10.5, b: 1 }) + (t2 ? tx(x + w / 2, y + h / 2 + 11, t2, { a: 'middle', s: 9.5, c: ink2 }) : '');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Barlow, 'Arial Narrow', sans-serif"${standalone ? ` style="${Object.entries(CORES_LUZ).map(([k, v]) => k + ':' + v).join(';')};background:#FFFFFF"` : ''}>`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" style="fill:var(--sheet)"/>`;
  const X = 70;
  s += tx(24, 26, `REDE CPFL ${P.par.vfn}/${P.par.vff} V · 60 Hz · ${fasesTxt(en.fases)}`, { s: 13, b: 1 });
  s += ln(X, 36, X, 70);
  s += `<circle cx="${X}" cy="88" r="18" style="fill:var(--sheet);stroke:${ink}" stroke-width="1.5"/>` + tx(X, 92, 'kWh', { a: 'middle', s: 11, b: 1 });
  s += tx(X + 28, 92, 'Medição CPFL', { s: 11.5, c: ink2 });
  s += ln(X, 106, X, 126) + disj(X, 126);
  s += tx(X + 20, 148, `Disjuntor geral do padrão ${en.fases}P ${al.inPadrao} A`, { s: 11.5 }) + tx(X + 20, 162, `Icn ≥ ${E.GED.icnKA} kA · categoria ${en.cat.c} (GED-13)`, { s: 10.5, c: ink2 });
  s += ln(X, 166, X, 248);
  s += ln(X, 184, X + 120, 184) + caixa(X + 120, 172, 44, 26, 'DPS', '') + ln(X + 164, 185, X + 182, 185) + terra(X + 182, 185);
  s += tx(X + 120, 214, `classe II · ${E.GED.dps.uc} V · ${E.GED.dps.imaxKA} kA × ${en.fases}`, { s: 10, c: ink2 });
  s += ln(X, 196, X - 34, 196) + terra(X - 34, 196) + tx(X - 52, 236, 'haste', { s: 10, c: ink2 });
  s += tx(X + 10, 236, `Alimentador ${en.fases}#${sec(al.S)} + N ${sec(al.neutro)} + PE ${sec(al.pe)} mm² · ${nf(al.L, 1)} m · ΔV ${nf(al.dv, 2)} %`, { s: 11 });
  s += `<rect x="30" y="256" width="${W - 50}" height="${H - 276}" rx="4" style="fill:none;stroke:${ink2}" stroke-width="1" stroke-dasharray="6 4"/>`;
  s += tx(X + 16, 274, `QDC — ${R.quadro.tamanho} módulos · esquema ${P.par.esquema}`, { s: 12, b: 1 });
  s += ln(X, 248, X, 282) + disj(X, 282) + tx(X + 20, 306, `Geral QDC ${en.fases}P ${al.inQD} A`, { s: 11 });
  const xEnd = n ? x0 + (n - 1) * W0 + 26 : x0 + 30;
  s += ln(X, 322, X, busY) + `<line x1="${X - 6}" y1="${busY}" x2="${xEnd}" y2="${busY}" style="stroke:${ink}" stroke-width="4"/>`;
  s += tx(xEnd, busY - 8, 'Barramento de fases', { s: 10, c: ink2, a: 'end' });
  if (P.par.dpsQd) { const dx = 170; s += ln(dx, busY, dx, busY + 26) + caixa(dx - 22, busY + 26, 44, 26, 'DPS', '') + ln(dx, busY + 52, dx, busY + 62) + terra(dx, busY + 62) + tx(dx, busY + 104, `${en.fases + 1} × 175 V`, { s: 10, c: ink2, a: 'middle' }); }
  R.circ.forEach((c, i) => {
    const cx = x0 + i * W0;
    let y = busY;
    s += ln(cx, y, cx, y + 16); y += 16;
    if (c.dr) { s += caixa(cx - 24, y, 48, 34, `IDR ${c.drIn} A`, '30 mA'); y += 34; s += ln(cx, y, cx, y + 12); y += 12; }
    else { s += ln(cx, y, cx, y + 46); y += 46; }
    s += disj(cx, y); y += 40;
    s += tx(cx + 14, y - 22, `${c.disj} A`, { s: 11, b: 1 }) + tx(cx + 14, y - 10, `${c.polos}P ${P.par.curva}`, { s: 9.5, c: ink2 });
    s += ln(cx, y, cx, y + 24) + `<path d="M${cx - 5} ${y + 18} L${cx} ${y + 26} L${cx + 5} ${y + 18}" style="fill:none;stroke:${ink}" stroke-width="1.4"/>`;
    y += 34;
    s += `<rect x="${cx - 6}" y="${y}" width="12" height="12" rx="2" style="fill:${corCirc(c.id)}"/>`;
    y += 20;
    const tr = (dx) => `rotate(90 ${cx + dx} ${y})`;
    s += tx(cx + 8, y, `${c.id} · ${c.polos === 2 ? '2#' : '#'}${sec(c.secao)}${c.v === P.par.vfn ? ' + N' : ''} + PE ${sec(c.pe)} mm²`, { s: 11.5, b: 1, t: tr(8) });
    s += tx(cx - 6, y, c.desc.length > 44 ? c.desc.slice(0, 43) + '…' : c.desc, { s: 10.5, t: tr(-6) });
    s += tx(cx - 20, y, `${ni(c.va)} VA · ${nf(c.ib, 1)} A · ${c.v} V · ${c.fase}`, { s: 10, c: ink2, t: tr(-20) });
  });
  s += tx(W - 20, H - 30, 'Proteção: disjuntores termomagnéticos (NBR NM 60898) · IDR 30 mA conforme NBR 5410 5.1.3.2.2', { s: 10, c: ink2, a: 'end' });
  s += '</svg>';
  return standalone ? '<?xml version="1.0" encoding="UTF-8"?>\n' + s : s;
}
function sheetUnifilar() {
  return `<div class="doc">${cab('ABNT NBR 5410:2004 · NR-10 10.3', 'Diagrama unifilar', 'Gerado do modelo: entrada CPFL, proteção do padrão, alimentador, quadro e circuitos terminais com seção, proteção e DR. Atualiza a cada alteração da planta.')}
    <div class="svgwrap">${unifilarSVG(false)}</div>
    <div class="row"><button class="btn" data-act="baixar-unif">Baixar unifilar (.svg)</button></div></div>`;
}

/* ---------- entrada CPFL ---------- */
function tabDemanda() {
  const en = S.R.entrada, d = en.dem;
  const linhas = [
    ['a', 'Iluminação e tomadas de uso geral', en.ilumTugW / 1000, en.fdA],
    ['b', 'Chuveiros, torneiras, aquecedores de passagem', null, null],
    ['c', 'Aquecedor de acumulação (boiler)', null, null],
    ['d', 'Secadora, forno, lava-louças, micro-ondas', null, null],
    ['e', 'Fogões e cooktops elétricos', null, null],
    ['f', 'Ar-condicionado', null, null],
    ['g', 'Motores', null, null],
    ['h', 'Outros equipamentos ≥ 1 kW', null, null],
    ['i', 'Hidromassagem', null, null]
  ];
  const nota = { b: `${en.nB} aparelhos · Tabela 4`, d: `${en.nD} aparelhos · Tabela 6`, f: `${en.nF} aparelhos · Tabela 8`, a: 'Tabela 3' };
  return `<div class="tw"><table><thead><tr><th>Parcela</th><th>Cargas</th><th>Fator de demanda</th><th class="n">Demanda kVA</th></tr></thead><tbody>${linhas.filter(([k]) => k === 'a' || d[k] > 0).map(([k, n, base, fd]) => `<tr><td class="n" style="text-align:left">${k}</td><td>${n}${base != null ? ` — ${nf(base, 2)} kW` : ''}</td><td>${fd != null ? nf(fd, 2) + ' · ' : ''}${nota[k] || 'FD 1,00 (adotado)'}</td><td class="n">${nf(d[k], 2)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">D = a + b + c + d + e + f + g + h + i</td><td class="n">${nf(en.D, 2)}</td></tr></tfoot></table></div>`;
}
function sheetEntrada() {
  const R = S.R, en = R.entrada, al = R.alim, G = E.GED;
  const motivo = en.porDemanda ? `Carga instalada de ${nf(en.C, 2)} kW (acima de 25 kW): categoria definida pela demanda calculada de ${nf(en.D, 2)} kVA.` : `Carga instalada de ${nf(en.C, 2)} kW (até 25 kW): categoria definida pela carga instalada.`;
  const maxF = Math.max(1, ...['A', 'B', 'C'].map((f) => en.cargaFase[f]));
  const barras = ['A', 'B', 'C'].slice(0, en.fases).map((f) => `<div style="display:grid;grid-template-columns:24px minmax(0,1fr) 90px;gap:8px;align-items:center"><b class="ref" style="font-size:13px;color:var(--ink)">${f}</b><div style="height:12px;background:var(--sheet-2);border:1px solid var(--rule);border-radius:3px;overflow:hidden"><div style="height:100%;width:${(en.cargaFase[f] / maxF * 100).toFixed(1)}%;background:var(--accent)"></div></div><span class="ref" style="text-align:right;color:var(--ink-2)">${ni(en.cargaFase[f])} VA</span></div>`).join('');
  const tab1 = `<div class="tw"><table><thead><tr><th>Categoria</th><th>Atendimento</th><th>Faixa</th><th class="n">Disjuntor A</th></tr></thead><tbody>${G.cat.map((k) => `<tr class="${k.c === en.cat.c ? 'hi' : ''}"><td><b>${k.c}</b></td><td>${{ 1: 'Monofásico', 2: 'Bifásico', 3: 'Trifásico' }[k.fases]}</td><td>${k.cMax != null ? 'C ≤ ' + nf(k.cMax, 0) + ' kW' : 'D ≤ ' + nf(k.dMax, k.est ? 1 : 0) + ' kVA' + (k.est ? ' (estimado)' : '')}</td><td class="n">${k.disj}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="doc">${cab('CPFL GED-13 · Fornecimento em Tensão Secundária · Tabela 1A (127/220 V)', 'Entrada de energia CPFL', 'Carga instalada, demanda, categoria de atendimento e especificação do padrão de entrada, calculados do modelo.')}
    <div class="panel"><div class="cat"><div class="code">${en.cat.c}<small>categoria</small></div><div style="display:grid;gap:6px;min-width:0;flex:1"><b style="font-size:16px">Atendimento ${fasesTxt(en.fases)}, ${S.P.par.vfn}/${S.P.par.vff} V</b><p>${motivo}</p>${en.notas.map((n) => `<p class="note">${esc(n)}</p>`).join('')}</div></div></div>
    <div class="grid2">
      <div><h2>Demanda</h2>${tabDemanda()}<p class="note" style="margin-top:8px">A GED-13 aplica o cálculo de demanda para carga instalada acima de 25 kW. Abaixo disso o valor é informativo e serve para dimensionar o alimentador.</p>${en.ajustes.length ? `<p class="note" style="margin-top:6px">Potências mínimas consideradas na carga instalada: ${en.ajustes.map(esc).join('; ')}.</p>` : ''}</div>
      <div><h2>Tabela 1A — referência</h2>${tab1}</div>
    </div>
    <div class="grid2">
      <div class="panel"><h2>Padrão de entrada</h2><dl class="kv">
        <dt>Disjuntor termomagnético geral</dt><dd>${en.fases}P ${al.inPadrao} A · Icn ≥ ${G.icnKA} kA · 250 V</dd>
        <dt>DPS (após a medição, no compartimento do disjuntor)</dt><dd>classe ${G.dps.classe} · ${G.dps.uc} V · ${en.fases} un.</dd>
        <dt>Corrente nominal / máxima do DPS</dt><dd>≥ ${G.dps.inKA} kA / ≥ ${G.dps.imaxKA} kA</dd>
        <dt>Nível de proteção Up</dt><dd>≤ ${nf(G.dps.upKV, 1)} kV</dd>
        <dt>Condutor do DPS</dt><dd>≥ ${G.dps.condMin} mm² Cu · ≤ ${nf(G.dps.compMax * 1000, 0)} mm</dd>
        <dt>Poste particular</dt><dd>7,5 m · engaste 1,35 m</dd>
        <dt>Caixa de medição</dt><dd>face superior 1,40–1,60 m</dd>
      </dl><p class="note" style="margin-top:8px">Medição no limite do terreno com a via pública, com leitura voltada para a calçada quando houver muro ou gradil. Ramal de entrada em cobre isolado 750 V, sem emendas, neutro azul-claro, sobra mínima de 500 mm na caixa. Aterramento com haste a até 700 mm da base do poste; o neutro é aterrado sem ser seccionado.</p></div>
      <div class="panel"><h2>Equilíbrio de fases</h2><div style="display:grid;gap:8px">${barras}</div><p class="note" style="margin-top:10px">Desequilíbrio ${nf(en.desequilibrio, 0)} %. Os circuitos de ${S.P.par.vff} V ocupam duas fases; a distribuição é feita do maior para o menor circuito.</p>
        <h2 style="margin-top:16px">Alimentador</h2><dl class="kv"><dt>Comprimento</dt><dd>${nf(al.L, 1)} m</dd><dt>Seção (fases · neutro · PE)</dt><dd>${sec(al.S)} · ${sec(al.neutro)} · ${sec(al.pe)} mm²</dd><dt>Queda de tensão</dt><dd>${nf(al.dv, 2)} %</dd></dl></div>
    </div>
    <div class="warnbox">Disjuntores e faixas conferidos na GED-13 v2.24. A CPFL revisa a norma periodicamente: confirme a Tabela 1A da revisão vigente antes do pedido de ligação. Documento de responsabilidade técnica é exigido, entre outros casos, para demanda acima de 38 kVA (127/220 V).</div></div>`;
}

/* ---------- SPDA ---------- */
function sheetSpda() {
  const sp = S.R.spda, s = S.P.spda;
  const opt = (k, v, ops) => `<select id="sp-${k}" data-sp="${k}">${ops.map(([val, lab]) => `<option value="${val}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  const num = (k, v, ph, step) => `<input id="sp-${k}" data-sp="${k}" type="number" step="${step || 'any'}" value="${v == null ? '' : v}" placeholder="${ph || ''}">`;
  const f = (lab, ctrl) => `<label class="field">${lab}${ctrl}</label>`;
  const campos = `<div class="fields">
    ${f('NG — descargas/km²/ano (tabela da NBR 5419-2:2026)', num('ng', s.ng, 'informe o valor do município', '0.1'))}
    ${f('Comprimento L (m)', num('L', s.L, nf(sp.L, 2), '0.1'))}${f('Largura W (m)', num('W', s.W, nf(sp.W, 2), '0.1'))}${f('Altura H (m)', num('h', s.h, '', '0.1'))}
    ${f('Localização (CD)', opt('cd', s.cd, [[0.25, 'Cercada por objetos mais altos'], [0.5, 'Objetos de mesma altura ou menores'], [1, 'Isolada'], [2, 'Isolada no topo de colina']]))}
    ${f('Ambiente da linha (CE)', opt('ce', s.ce, [[1, 'Rural'], [0.5, 'Suburbano'], [0.1, 'Urbano'], [0.01, 'Urbano com edifícios > 20 m']]))}
    ${f('Linha de energia', opt('ci', s.ci, [[1, 'Aérea'], [0.5, 'Enterrada']]))}${f('Comprimento da linha (m)', num('ll', s.ll, '1000', '10'))}
    ${f('Piso (rt)', opt('rt', s.rt, [[0.01, 'Terra, concreto'], [0.001, 'Mármore, cerâmica'], [0.0001, 'Brita, carpete'], [0.00001, 'Asfalto, madeira']]))}
    ${f('Proteção contra toque/passo (PTA)', opt('pta', s.pta, [[1, 'Nenhuma'], [0.1, 'Avisos de alerta'], [0.01, 'Isolação ou equipotencialização do solo']]))}
    ${f('Risco de incêndio (rf)', opt('rf', s.rf, [[0.1, 'Alto'], [0.01, 'Ordinário'], [0.001, 'Baixo']]))}
    ${f('Providências contra incêndio (rp)', opt('rp', s.rp, [[1, 'Nenhuma'], [0.5, 'Extintores, alarme manual'], [0.2, 'Sistemas automáticos']]))}
    ${f('Perigo especial (hz)', opt('hz', s.hz, [[1, 'Nenhum'], [2, 'Baixo nível de pânico'], [5, 'Pânico médio / evacuação difícil'], [10, 'Alto nível de pânico']]))}
    ${f('Tipo de estrutura (LF)', opt('lf', s.lf, [[0.01, 'Residência e demais'], [0.02, 'Comercial, industrial'], [0.05, 'Igreja, museu, entretenimento'], [0.1, 'Hospital, hotel, escola']]))}
    ${f('SPDA projetado', opt('classe', s.classe, [['nenhum', 'Nenhum'], ['IV', 'Classe IV'], ['III', 'Classe III'], ['II', 'Classe II'], ['I', 'Classe I']]))}
    ${f('DPS coordenados', opt('dps', s.dps, [['nenhum', 'Nenhum'], ['III-IV', 'NP III–IV'], ['II', 'NP II'], ['I', 'NP I']]))}
  </div>`;
  let res = '';
  if (sp.semNg) res = `<div class="panel"><h2>Área de exposição</h2><dl class="kv"><dt>AD (área equivalente de exposição)</dt><dd>${nf(sp.AD, 0)} m²</dd></dl><p class="note" style="margin-top:8px">Informe NG para calcular o número de eventos perigosos e o risco R1.</p></div>`;
  else {
    const lo = -9, hi = -3, Wd = 640;
    const px = (v) => ((Math.log10(Math.max(v, 1e-12)) - lo) / (hi - lo)) * (Wd - 40) + 20;
    const ticks = []; for (let e = lo; e <= hi; e++) ticks.push(`<line x1="${px(10 ** e)}" y1="30" x2="${px(10 ** e)}" y2="38" style="stroke:var(--ink-3)"/><text x="${px(10 ** e)}" y="52" font-size="11" text-anchor="middle" style="fill:var(--ink-2)" font-family="IBM Plex Mono, monospace">1e${e}</text>`);
    const ok = !sp.necessario;
    res = `<div class="grid2"><div class="panel"><h2>Componentes de risco R1</h2><dl class="kv">
      <dt>AD — área de exposição</dt><dd>${nf(sp.AD, 0)} m²</dd><dt>ND — descargas na estrutura/ano</dt><dd>${sci(sp.ND)}</dd><dt>NL — descargas na linha/ano</dt><dd>${sci(sp.NL)}</dd>
      <dt>RA (toque e passo)</dt><dd>${sci(sp.RA)}</dd><dt>RB (danos físicos)</dt><dd>${sci(sp.RB)}</dd><dt>RU (toque, via linha)</dt><dd>${sci(sp.RU)}</dd><dt>RV (danos físicos, via linha)</dt><dd>${sci(sp.RV)}</dd>
      <dt><b>R1 = RA + RB + RU + RV</b></dt><dd><b>${sci(sp.R1)}</b></dd><dt>Tolerável RT</dt><dd>1,00×10⁻⁵</dd></dl></div>
      <div class="panel"><h2>Resultado</h2><p><span class="pill ${ok ? 'ok' : 'crit'}">${ok ? 'R1 dentro do tolerável' : 'R1 acima do tolerável'}</span></p>
      <svg viewBox="0 0 ${Wd} 64" width="100%" style="max-width:${Wd}px;display:block;margin-top:10px" role="img" aria-label="Escala logarítmica de risco"><rect x="20" y="22" width="${Wd - 40}" height="8" rx="2" style="fill:var(--sheet-2);stroke:var(--rule)"/><rect x="${px(1e-5)}" y="22" width="${Wd - 20 - px(1e-5)}" height="8" style="fill:var(--crit-soft)"/>${ticks.join('')}<line x1="${px(1e-5)}" y1="12" x2="${px(1e-5)}" y2="38" style="stroke:var(--crit)" stroke-width="2"/><text x="${px(1e-5) + 4}" y="14" font-size="11" style="fill:var(--crit)">RT</text><circle cx="${px(sp.R1)}" cy="26" r="7" style="fill:${ok ? 'var(--ok)' : 'var(--crit)'};stroke:var(--sheet)" stroke-width="2"/><text x="${px(sp.R1)}" y="10" font-size="11" text-anchor="middle" style="fill:var(--ink)" font-family="IBM Plex Mono, monospace">R1</text></svg>
      <p style="margin-top:10px">${sp.rec ? (sp.rec.classe === 'nenhum' ? `Sem SPDA externo, com DPS NP ${sp.rec.dps}, o risco fica dentro do tolerável.` : `Menor combinação que atende: SPDA classe ${sp.rec.classe} com DPS NP ${sp.rec.dps}.`) : 'Nenhuma combinação simples atende: reveja as medidas de proteção.'}</p>
      <p class="note" style="margin-top:8px">Mantenha a equipotencialização no BEP e o DPS na entrada da linha em qualquer caso (NBR 5410 6.4.2 e 6.3.5).</p></div></div>`;
  }
  let geo = '';
  if (sp.geo) {
    const g = sp.geo;
    geo = `<div class="panel"><h2>SPDA classe ${esc(s.classe)} — parâmetros de projeto (NBR 5419-3)</h2><dl class="kv"><dt>Raio da esfera rolante</dt><dd>${g.raio} m</dd><dt>Malha de captação</dt><dd>${g.malha} × ${g.malha} m</dd><dt>Espaçamento entre descidas</dt><dd>${g.espDesc} m</dd><dt>Número de descidas</dt><dd>${g.nDesc}</dd><dt>Condutor de captação (estimado)</dt><dd>${ni(g.captacao)} m</dd><dt>Descidas</dt><dd>${ni(g.descidas)} m</dd><dt>Anel de aterramento</dt><dd>${ni(g.anel)} m</dd></dl><p class="note" style="margin-top:8px">Com SPDA, a NBR 5419-4 pede DPS classe I na entrada da linha, coordenado com o classe II do quadro. Quantitativos entram na lista de materiais.</p></div>`;
  }
  return `<div class="doc">${cab('ABNT NBR 5419:2026 · partes 2, 3 e 4', 'Proteção contra descargas atmosféricas', 'Pré-avaliação do risco de perda de vida humana (R1) pelo método de componentes de risco, com a geometria tirada do modelo.')}
    <div class="warnbox">A edição 2026 da NBR 5419 (publicada em 10/03/2026) traz NG tabelado por município e passa a exigir também a frequência de dano F. Este cálculo é preliminar: a análise formal deve seguir a NBR 5419-2:2026 completa. Projetos protocolados até 180 dias após a publicação podem seguir a edição 2015.</div>
    <div class="panel">${campos}</div>${res}${geo}</div>`;
}

/* ---------- NR-10 ---------- */
function evidenciaNR10(id) {
  const R = S.R, P = S.P;
  switch (id) {
    case '10.3.1': return `${R.circ.length} disjuntores com seccionamento individual; geral do QDC ${R.entrada.fases}P ${R.alim.inQD} A e do padrão ${R.alim.inPadrao} A, ambos bloqueáveis.`;
    case '10.3.2': return `Disjuntor geral ${R.entrada.fases}P de ação simultânea no QDC e no padrão de entrada.`;
    case '10.3.4': return `Esquema ${P.par.esquema}: neutro aterrado no padrão; condutor PE em todos os circuitos; massas ligadas ao BEP.`;
    case '10.3.9': return 'Memorial gerado abaixo a partir do modelo.';
    default: return '';
  }
}
function memorialNR10() {
  const R = S.R, P = S.P;
  const drs = R.circ.filter((c) => c.dr);
  return `<div class="memo" id="memoTxt">
    <h4>a) Proteção contra choques elétricos e outros riscos</h4><p>Proteção básica por isolação dos condutores (cabos 450/750 V) e invólucros (caixas, placas e quadro com fechamento). Proteção supletiva por seccionamento automático da alimentação no esquema ${P.par.esquema}, com condutor de proteção em todos os circuitos. Proteção adicional por dispositivo diferencial residual de 30 mA nos circuitos ${drs.map((c) => c.id).join(', ') || '— nenhum —'}. Proteção contra sobretensões por DPS classe II no padrão de entrada${P.par.dpsQd ? ' e no QDC' : ''}.</p>
    <h4>b) Posição dos dispositivos de manobra</h4><p>Disjuntores e interruptores diferenciais identificados com a indicação "L" (ligado, vermelho) e "D" (desligado, verde) conforme a posição da alavanca.</p>
    <h4>c) Identificação de circuitos e condutores</h4><p>Cada circuito recebe etiqueta indelével no QDC com número e descrição (C1 a C${R.circ.length}). Condutores: neutro azul-claro, proteção verde-amarelo, fases preto e vermelho, retornos cinza. O diagrama unifilar fica afixado na porta do quadro.</p>
    <h4>d) Restrições e advertências de acesso</h4><p>Placa "PERIGO — ELETRICIDADE" no QDC e no padrão de entrada. Intervenções apenas por profissional autorizado, com o circuito desenergizado, bloqueado e sinalizado.</p>
    <h4>e) Influências externas</h4><p>Pontos em áreas molhadas (${S.P.amb.filter((a) => E.tipoAmb(a.tipo).w600).map((a) => esc(a.nome)).join(', ') || '—'}) com proteção diferencial; tomadas do banheiro fora dos volumes 0, 1 e 2; QDC em local seco e acessível.</p>
    <h4>f) Princípio funcional das proteções</h4><p>Disjuntores termomagnéticos curva ${P.par.curva} protegem contra sobrecarga e curto-circuito, coordenados com os condutores (Ib ≤ In ≤ Iz). IDR desligam correntes de fuga acima de 30 mA. DPS desviam surtos para o terra.</p>
    <h4>g) Compatibilidade das proteções</h4><p>Disjuntor geral do QDC ${R.alim.inQD} A coordenado com o disjuntor do padrão ${R.alim.inPadrao} A (categoria ${R.entrada.cat.c}, GED-13); IDR com corrente nominal igual ou superior à do disjuntor associado.</p></div>`;
}
function sheetNr10() {
  const P = S.P;
  const itens = E.NR10.map((it) => {
    const ok = it.auto || P.nr10[E.nrKey(it.id)];
    return `<div class="check">${it.auto ? '<span class="pill ok">modelo</span>' : `<input type="checkbox" id="nr-${it.id}" data-nr="${it.id}"${P.nr10[E.nrKey(it.id)] ? ' checked' : ''} aria-label="Confirmar item ${it.id}">`}<span class="id">${it.id}</span><div><label for="nr-${it.id}">${esc(it.t)}</label>${it.auto ? `<div class="note">${esc(evidenciaNR10(it.id))}</div>` : ''}</div><span class="pill ${ok ? 'ok' : 'warn'}">${ok ? 'Atendido' : 'Pendente'}</span></div>`;
  }).join('');
  const etiquetas = S.R.circ.map((c) => `<div class="label-qd"><b>${c.id}</b> · ${c.disj} A${c.dr ? ' · DR' : ''}<br>${esc(c.desc)}</div>`).join('');
  return `<div class="doc">${cab('NR-10 · item 10.3 — Segurança em projetos', 'Segurança em instalações elétricas', 'Requisitos de projeto da NR-10 verificados no modelo, memorial descritivo de segurança e sinalização do quadro.')}
    <div class="warnbox">Vale hoje o texto da NR-10 de 2004. A nova redação (Portaria MTE nº 737/2026) entra em vigor em 01/06/2027 e integra o risco elétrico ao PGR, com estudo de energia incidente para arco elétrico e desenergização como medida prioritária.</div>
    <div class="panel">${itens}</div>
    <div class="panel"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Memorial descritivo (10.3.9)</h2><button class="btn" data-act="copiar-memo">Copiar texto</button></div><div style="margin-top:10px">${memorialNR10()}</div></div>
    <div class="panel"><h2>Sinalização e etiquetas do QDC</h2><div class="row" style="margin-bottom:12px"><div style="background:var(--sinal);color:var(--sinal-ink);border:2px solid var(--sinal-ink);border-radius:4px;padding:8px 14px;font:700 16px var(--f-display);letter-spacing:.06em">⚡ PERIGO — ELETRICIDADE</div></div><div class="labels">${etiquetas || '<p class="note">Sem circuitos.</p>'}</div></div></div>`;
}

/* ---------- materiais ---------- */
function tabMateriais() {
  const grupos = [];
  for (const b of S.R.bom) { let g = grupos.find((x) => x.n === b.grupo); if (!g) { g = { n: b.grupo, it: [] }; grupos.push(g); } g.it.push(b); }
  return `<div class="tw"><table><thead><tr><th>Item</th><th class="n">Qtd.</th><th>Un.</th></tr></thead><tbody>${grupos.map((g) => `<tr><td colspan="3" style="background:var(--sheet-2);font-family:var(--f-display);font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:12.5px">${esc(g.n)}</td></tr>` + g.it.map((b) => `<tr><td>${esc(b.item)}</td><td class="n">${ni(b.qtd)}</td><td>${esc(b.unid)}</td></tr>`).join('')).join('')}</tbody></table></div>`;
}
function sheetMateriais() {
  const bom = S.R.bom;
  const cabo = bom.filter((b) => b.grupo === 'Condutores').reduce((s, b) => s + b.qtd, 0);
  const ele = bom.filter((b) => b.grupo === 'Eletrodutos').reduce((s, b) => s + b.qtd, 0);
  return `<div class="doc">${cab('Quantitativos extraídos do modelo BIM', 'Lista de materiais', `Cabos e eletrodutos medidos pelo percurso real no modelo (laje + descidas), com ${S.P.par.sobra} % de sobra. Dispositivos, proteção e padrão de entrada conforme o quadro de cargas.`)}
    <div class="kpis"><div class="kpi"><b>${bom.length}</b><span>itens</span></div><div class="kpi"><b>${ni(cabo)} m</b><span>de cabos</span></div><div class="kpi"><b>${ni(ele)} m</b><span>de eletrodutos</span></div></div>
    <div class="row"><button class="btn pri" data-act="baixar-csv">Baixar lista (.csv)</button></div>
    ${tabMateriais()}
    <p class="note">Confira os quantitativos com o projeto executivo: o modelo considera rotas pela laje entre os pontos e uma caixa de passagem onde o eletroduto deriva.</p></div>`;
}

/* ---------- verificação ---------- */
function listaIssues(inter) {
  const is = S.R.issues;
  if (!is.length) return '<div class="panel"><span class="pill ok">Nenhuma pendência</span> <span class="note">O modelo atende a todas as regras verificadas.</span></div>';
  return `<div class="tw">${is.map((i) => `<div class="issue"><span class="pill ${i.sev}">${{ erro: 'Erro', aviso: 'Aviso', info: 'Info' }[i.sev]}</span><div>${esc(i.msg)}<span class="ref">${esc(i.ref)}</span></div>${inter && i.alvo ? `<button class="btn" data-act="ir" data-tipo="${i.alvo.tipo}" data-id="${esc(i.alvo.id)}">Localizar</button>` : '<span></span>'}</div>`).join('')}</div>`;
}
function sheetVerificacao() {
  const r = S.R.resumo;
  const nInfo = S.R.issues.length - r.nErro - r.nAviso;
  return `<div class="doc">${cab('Verificação de modelo e conformidade', 'Verificação', 'Regras da NBR 5410, NBR 5419, NR-10 e GED-13 conferidas sobre o modelo, mais detecção de conflitos (sobreposições, pontos fora de parede, tomadas próximas ao chuveiro, eletrodutos sem rota).')}
    <div class="kpis"><div class="kpi"><b style="color:var(--crit)">${r.nErro}</b><span>erros</span></div><div class="kpi"><b style="color:var(--warn)">${r.nAviso}</b><span>avisos</span></div><div class="kpi"><b>${nInfo}</b><span>informações</span></div></div>
    ${listaIssues(true)}</div>`;
}

/* ---------- relatório ---------- */
function relatorioBody(standalone) {
  const P = S.P, R = S.R, m = P.meta, en = R.entrada;
  return `${cab('Memorial técnico · ' + new Date().toLocaleDateString('pt-BR'), esc(P.nome), `${esc(m.cliente || 'Cliente não informado')} · ${esc([m.endereco, m.municipio].filter(Boolean).join(' — ') || 'endereço não informado')}`)}
    <div class="panel"><h2>1. Dados gerais</h2><dl class="kv"><dt>Responsável técnico</dt><dd>${esc(m.responsavel || '—')}${m.registro ? ' · CREA ' + esc(m.registro) : ''}</dd><dt>ART</dt><dd>${esc(m.art || '—')}</dd><dt>Concessionária</dt><dd>CPFL · ${P.par.vfn}/${P.par.vff} V · 60 Hz</dd><dt>Atendimento</dt><dd>Categoria ${en.cat.c} · ${fasesTxt(en.fases)}</dd><dt>Carga instalada · demanda</dt><dd>${nf(en.C, 2)} kW · ${nf(en.D, 2)} kVA</dd><dt>Esquema de aterramento</dt><dd>${P.par.esquema}</dd><dt>Circuitos</dt><dd>${R.circ.length}</dd></dl></div>
    <div class="panel"><h2>2. Normas aplicadas</h2><p>ABNT NBR 5410:2004 (versão corrigida 2008), vigente — revisão em andamento na ABNT. ABNT NBR 5419:2026, partes 1 a 4. NR-10 (texto vigente; nova redação pela Portaria MTE nº 737/2026 a partir de 01/06/2027). CPFL GED-13 — Fornecimento em Tensão Secundária de Distribuição.</p></div>
    <div><h2>3. Planta baixa elétrica</h2><div class="svgwrap" style="background:#fff">${planSVGStatic(false)}</div></div>
    <div><h2>4. Previsão de cargas</h2>${tabCargas(false).html}</div>
    <div><h2>5. Quadro de cargas</h2>${tabQuadro(false)}</div>
    <div><h2>6. Diagrama unifilar</h2><div class="svgwrap">${unifilarSVG(standalone)}</div></div>
    <div><h2>7. Entrada de energia (GED-13)</h2>${tabDemanda()}<p class="note" style="margin-top:8px">Disjuntor geral do padrão ${en.fases}P ${R.alim.inPadrao} A (Icn ≥ ${E.GED.icnKA} kA); DPS classe II 175 V, In ≥ 5 kA, Imáx ≥ 12 kA; alimentador ${en.fases}#${sec(R.alim.S)} + N ${sec(R.alim.neutro)} + PE ${sec(R.alim.pe)} mm², ${nf(R.alim.L, 1)} m, ΔV ${nf(R.alim.dv, 2)} %.</p></div>
    <div class="panel"><h2>8. SPDA (NBR 5419:2026)</h2><p>${R.spda.semNg ? 'NG do município não informado: avaliação de risco pendente.' : `R1 estimado ${sci(R.spda.R1)} (tolerável 1×10⁻⁵): ${R.spda.necessario ? 'medidas adicionais necessárias' + (R.spda.rec ? ` — SPDA classe ${R.spda.rec.classe} com DPS NP ${R.spda.rec.dps}` : '') : 'dentro do tolerável'}. Pré-avaliação; análise formal pela NBR 5419-2:2026.`}</p></div>
    <div class="panel"><h2>9. Memorial de segurança (NR-10 10.3.9)</h2>${memorialNR10().replace('id="memoTxt"', '')}</div>
    <div><h2>10. Lista de materiais</h2>${tabMateriais()}</div>
    <div><h2>11. Verificações</h2>${listaIssues(false)}</div>
    <div class="panel"><h2>12. Responsabilidade técnica</h2><p>Este memorial foi gerado a partir do modelo do projeto e deve ser revisado e assinado pelo profissional habilitado, com a respectiva ART, antes da execução e do pedido de ligação à CPFL.</p><p style="margin-top:28px">_____________________________________<br>${esc(m.responsavel || 'Responsável técnico')}${m.registro ? ' — CREA ' + esc(m.registro) : ''}</p></div>`;
}
function sheetRelatorio() {
  return `<div class="doc"><div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="baixar-rel">Baixar relatório (.html)</button></div>${relatorioBody(false)}</div>`;
}
function relatorioStandalone() {
  const vars = Object.entries(CORES_LUZ).map(([k, v]) => `${k}:${v}`).join(';');
  const css = `:root{${vars};--paper:#FFFFFF;--sheet-2:#F4F7F7;--accent-soft:#DBE8F4;--ok:#2B7A4B;--ok-soft:#DFEFE5;--warn:#9E6410;--warn-soft:#F8EBD3;--crit:#B3312A;--crit-soft:#F6DEDB;--f-display:'Barlow Condensed','Arial Narrow',sans-serif;--f-body:Barlow,system-ui,sans-serif;--f-mono:'IBM Plex Mono',monospace}
body{font-family:var(--f-body);color:var(--ink);background:#fff;margin:0;padding:24px;font-size:13px;line-height:1.45}.doc{max-width:1100px;margin:0 auto;display:grid;gap:20px}
h1{font-family:var(--f-display);font-size:28px;margin:0}h2{font-family:var(--f-display);font-size:18px;margin:0 0 8px}.ref{font:500 11px var(--f-mono);color:var(--ink-3)}.lead{color:var(--ink-2)}
.panel{border:1px solid var(--rule);border-radius:6px;padding:14px;break-inside:avoid}.tw{border:1px solid var(--rule);border-radius:6px;overflow:hidden}table{border-collapse:collapse;width:100%;font-size:12px}
th{font-family:var(--f-display);text-transform:uppercase;letter-spacing:.05em;font-size:11px;color:var(--ink-2);background:var(--sheet-2);text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule)}td{padding:5px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
td.n,th.n{text-align:right;font-family:var(--f-mono);white-space:nowrap}tfoot td{font-weight:600;background:var(--sheet-2)}.kv{display:grid;grid-template-columns:1fr auto;gap:3px 12px;margin:0}.kv dt{color:var(--ink-2)}.kv dd{margin:0;text-align:right;font-family:var(--f-mono)}
.pill{display:inline-block;font-size:11px;font-weight:600;border-radius:9px;padding:1px 7px}.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.warn,.pill.aviso{background:var(--warn-soft);color:var(--warn)}.pill.crit,.pill.erro{background:var(--crit-soft);color:var(--crit)}.pill.info,.pill.dr{background:var(--accent-soft);color:var(--ink)}
.cnum{font:600 12px var(--f-mono)}.cnum i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}.issue{display:grid;grid-template-columns:70px 1fr;gap:10px;padding:8px 10px;border-bottom:1px solid var(--rule)}.issue .ref{display:block}
.svgwrap{border:1px solid var(--rule);border-radius:6px;overflow:auto}.svgwrap svg{display:block;max-width:100%;height:auto}.memo{display:grid;gap:8px}.memo h4{margin:4px 0 0;font-family:var(--f-display)}.note{color:var(--ink-2);font-size:12px}p{margin:0}
@media print{body{padding:0}.panel,.tw,.svgwrap{break-inside:avoid}}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(S.P.nome)} — Memorial técnico</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap"><style>${css}</style></head><body><div class="doc">${relatorioBody(true)}</div></body></html>`;
}

const SHEETS = { cargas: sheetCargas, quadro: sheetQuadro, unifilar: sheetUnifilar, entrada: sheetEntrada, spda: sheetSpda, nr10: sheetNr10, materiais: sheetMateriais, verificacao: sheetVerificacao, relatorio: sheetRelatorio };

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.sp) {
    const k = t.dataset.sp;
    let v = t.value;
    if (t.type === 'number') v = v === '' ? null : +v;
    else if (!['classe', 'dps'].includes(k)) v = +v;
    mutate((P) => { P.spda[k] = v; });
  }
  if (t.dataset && t.dataset.nr) { const id = E.nrKey(t.dataset.nr); const on = t.checked; mutate((P) => { if (on) P.nr10[id] = true; else delete P.nr10[id]; }); }
});

boot();
})();

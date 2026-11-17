/* Planta Elétrica BIM — motor de cálculo
   Bases: ABNT NBR 5410:2004 (versão corrigida 2008), ABNT NBR 5419:2026,
   NR-10 (texto vigente; nova redação Portaria MTE 737/2026 vigora em 01/06/2027),
   CPFL GED-13 (Fornecimento em Tensão Secundária). */
(function (root) {
  'use strict';
  const E = {};
  const EPS = 1e-9;
  const uid = (p) => p + Math.random().toString(36).slice(2, 8) + (Date.now() % 46656).toString(36);
  E.uid = uid;

  /* ------------------------------------------------------------------ */
  /* Tabelas NBR 5410                                                     */
  /* ------------------------------------------------------------------ */
  E.SECOES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];
  // Capacidade de condução (A), cobre, isolação PVC 70 °C — Tabela 36: [2 condutores carregados, 3 carregados]
  E.IZ = {
    A1: { 1.5: [14.5, 13.5], 2.5: [19.5, 18], 4: [26, 24], 6: [34, 31], 10: [46, 42], 16: [61, 56], 25: [80, 73], 35: [99, 89], 50: [119, 108], 70: [151, 136], 95: [182, 164], 120: [210, 188] },
    B1: { 1.5: [17.5, 15.5], 2.5: [24, 21], 4: [32, 28], 6: [41, 36], 10: [57, 50], 16: [76, 68], 25: [101, 89], 35: [125, 110], 50: [151, 134], 70: [192, 171], 95: [232, 207], 120: [269, 239] },
    B2: { 1.5: [16.5, 15], 2.5: [23, 20], 4: [30, 27], 6: [38, 34], 10: [52, 46], 16: [69, 62], 25: [90, 80], 35: [111, 99], 50: [133, 118], 70: [168, 149], 95: [201, 179], 120: [232, 206] },
    D: { 1.5: [22, 18], 2.5: [29, 24], 4: [38, 31], 6: [47, 39], 10: [63, 52], 16: [81, 67], 25: [104, 86], 35: [125, 103], 50: [148, 122], 70: [183, 151], 95: [216, 179], 120: [246, 203] }
  };
  E.METODOS = {
    A1: 'A1 — condutores isolados em eletroduto embutido em parede termicamente isolante',
    B1: 'B1 — condutores isolados em eletroduto embutido em alvenaria/laje',
    B2: 'B2 — cabo multipolar em eletroduto embutido em alvenaria',
    D: 'D — cabos em eletroduto enterrado'
  };
  // Tabela 40 — fator de correção de temperatura, PVC
  E.FCT_AR = [[10, 1.22], [15, 1.17], [20, 1.12], [25, 1.06], [30, 1.0], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71]];
  E.FCT_SOLO = [[10, 1.10], [15, 1.05], [20, 1.0], [25, 0.95], [30, 0.89], [35, 0.84], [40, 0.77]];
  E.fct = function (t, solo) {
    const tab = solo ? E.FCT_SOLO : E.FCT_AR;
    for (const [tt, f] of tab) if (t <= tt + EPS) return f;
    return tab[tab.length - 1][1];
  };
  // Tabela 42 — agrupamento (feixe / embutidos / conduto fechado)
  E.FCA_TAB = [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5, 0.5, 0.5, 0.45, 0.45, 0.45, 0.45, 0.41, 0.41, 0.41, 0.41, 0.38];
  E.fca = (n) => (n <= 1 ? 1 : n >= 20 ? 0.38 : E.FCA_TAB[n - 1]);
  E.DISJ = [10, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125, 150, 200];
  E.DR = [25, 40, 63, 80, 100];
  // Diâmetro externo médio (mm) de cabos flexíveis 450/750 V — referência de catálogo
  E.DIAM = { 1.5: 3.0, 2.5: 3.6, 4: 4.2, 6: 4.8, 10: 6.1, 16: 7.3, 25: 9.0, 35: 10.3, 50: 12.3, 70: 14.0, 95: 16.1, 120: 17.9 };
  E.ELETRODUTOS = [
    { dn: 20, pol: '1/2"', di: 15.4 }, { dn: 25, pol: '3/4"', di: 19.0 }, { dn: 32, pol: '1"', di: 24.8 },
    { dn: 40, pol: '1 1/4"', di: 31.2 }, { dn: 50, pol: '1 1/2"', di: 39.6 }
  ];
  E.peSecao = (s) => (s <= 16 ? s : s <= 35 ? 16 : s / 2); // Tabela 58
  E.reservaQD = (n) => (n <= 6 ? 2 : n <= 12 ? 3 : n <= 30 ? 4 : Math.ceil(0.15 * n)); // Tabela 59

  /* ------------------------------------------------------------------ */
  /* Ambientes e elementos                                                */
  /* ------------------------------------------------------------------ */
  E.TIPOS_AMB = {
    sala: { n: 'Sala', tug: 'social' },
    dormitorio: { n: 'Dormitório', tug: 'social' },
    escritorio: { n: 'Escritório', tug: 'social' },
    cozinha: { n: 'Cozinha', tug: 'cozinha', w600: true, dr: true, exclusivo: true },
    copa: { n: 'Copa', tug: 'cozinha', w600: true, dr: true, exclusivo: true },
    area_servico: { n: 'Área de serviço', tug: 'cozinha', w600: true, dr: true, exclusivo: true },
    banheiro: { n: 'Banheiro', tug: 'banheiro', w600: true, dr: true, chuveiro: true },
    lavabo: { n: 'Lavabo', tug: 'banheiro', w600: true, dr: true },
    varanda: { n: 'Varanda', tug: 'varanda', dr: true, externa: true },
    garagem: { n: 'Garagem', tug: 'demais', dr: true },
    circulacao: { n: 'Circulação', tug: 'demais' },
    despensa: { n: 'Despensa', tug: 'demais' },
    externa: { n: 'Área externa', tug: 'nenhum', dr: true, externa: true, semLuzMin: true },
    outro: { n: 'Outro', tug: 'demais' }
  };
  E.tipoAmb = (t) => E.TIPOS_AMB[t] || E.TIPOS_AMB.outro;

  E.KINDS = {
    luz: { n: 'Ponto de luz no teto', cat: 'ilum', mount: 'teto', ifc: 'IfcLightFixture' },
    arandela: { n: 'Arandela (luz na parede)', cat: 'ilum', mount: 'parede', ifc: 'IfcLightFixture', h: 2.2 },
    int1: { n: 'Interruptor simples', cat: 'cmd', mount: 'parede', ifc: 'IfcSwitchingDevice.TOGGLESWITCH', h: 1.1 },
    int2: { n: 'Interruptor paralelo (three-way)', cat: 'cmd', mount: 'parede', ifc: 'IfcSwitchingDevice.TOGGLESWITCH', h: 1.1 },
    int3: { n: 'Interruptor intermediário (four-way)', cat: 'cmd', mount: 'parede', ifc: 'IfcSwitchingDevice.TOGGLESWITCH', h: 1.1 },
    tug: { n: 'Tomada de uso geral (TUG)', cat: 'tug', mount: 'parede', ifc: 'IfcOutlet.POWEROUTLET', h: 0.3 },
    tue: { n: 'Ponto de uso específico (TUE)', cat: 'tue', mount: 'parede', ifc: 'IfcOutlet.POWEROUTLET / IfcElectricAppliance', h: 1.1 },
    qdc: { n: 'Quadro de distribuição (QDC)', cat: 'qd', mount: 'parede', ifc: 'IfcElectricDistributionBoard.DISTRIBUTIONBOARD', h: 1.5 },
    med: { n: 'Padrão de entrada / medição', cat: 'med', mount: 'parede', ifc: 'IfcFlowMeter.ENERGYMETER', h: 1.5 },
    porta: { n: 'Porta', cat: 'arq', mount: 'parede', ifc: 'IfcDoor' }
  };

  // ged: grupo da fórmula de demanda da GED-13 (D = a + b + c + d + e + f + g + h + i)
  E.TUE = {
    chuveiro: { n: 'Chuveiro elétrico', sig: 'CH', w: 6500, v: 220, fp: 1, h: 2.2, ged: 'b', plug: false, minGED: 6500 },
    torneira: { n: 'Torneira elétrica', sig: 'TE', w: 5500, v: 220, fp: 1, h: 1.1, ged: 'b', plug: false, minGED: 3000 },
    aquecedor: { n: 'Aquecedor de passagem', sig: 'AQ', w: 5500, v: 220, fp: 1, h: 1.6, ged: 'b', plug: false },
    boiler: { n: 'Aquecedor de acumulação (boiler)', sig: 'BO', w: 2500, v: 220, fp: 1, h: 1.6, ged: 'c', plug: false },
    ar: { n: 'Ar-condicionado', sig: 'AC', w: 1400, v: 220, fp: 0.92, h: 2.2, ged: 'f', plug: false },
    microondas: { n: 'Forno de micro-ondas', sig: 'MO', w: 1500, v: 127, fp: 0.95, h: 1.6, ged: 'd', plug: true, minGED: 1500 },
    forno: { n: 'Forno elétrico', sig: 'FE', w: 2000, v: 220, fp: 1, h: 0.6, ged: 'd', plug: true, minGED: 1500 },
    lavalouca: { n: 'Lava-louças', sig: 'LL', w: 2000, v: 220, fp: 0.95, h: 0.3, ged: 'd', plug: true, minGED: 2000 },
    secadora: { n: 'Secadora de roupas', sig: 'SR', w: 2500, v: 220, fp: 0.95, h: 1.1, ged: 'd', plug: true, minGED: 2500 },
    lavaroupa: { n: 'Máquina de lavar roupas', sig: 'ML', w: 1000, v: 127, fp: 0.9, h: 1.1, ged: 'h', plug: true },
    cooktop: { n: 'Cooktop / fogão elétrico', sig: 'CK', w: 4400, v: 220, fp: 1, h: 0.9, ged: 'e', plug: false },
    bomba: { n: 'Motobomba', sig: 'MB', w: 750, v: 220, fp: 0.8, h: 0.6, ged: 'g', plug: false },
    portao: { n: 'Motor de portão', sig: 'MP', w: 400, v: 127, fp: 0.8, h: 0.6, ged: 'g', plug: true },
    hidro: { n: 'Hidromassagem', sig: 'HM', w: 4000, v: 220, fp: 0.9, h: 0.4, ged: 'i', plug: false },
    outro: { n: 'Outro equipamento', sig: 'EQ', w: 1500, v: 127, fp: 1, h: 1.1, ged: 'h', plug: true }
  };

  /* ------------------------------------------------------------------ */
  /* CPFL GED-13 — Tabela 1A (127/220 V) e fatores de demanda              */
  /* Limites de categoria confirmados; disjuntores conforme leitura da     */
  /* v2.24 — conferir sempre com a revisão vigente da GED-13.              */
  /* ------------------------------------------------------------------ */
  E.GED = {
    fonte: 'CPFL GED-13 — Fornecimento em Tensão Secundária de Distribuição (Tabela 1A, 127/220 V)',
    cat: [
      { c: 'A1', fases: 1, cMax: 6, disj: 32 },
      { c: 'A2', fases: 1, cMax: 12, disj: 63 },
      { c: 'B1', fases: 2, cMax: 18, disj: 63 },
      { c: 'B2', fases: 2, cMax: 25, disj: 80 },
      { c: 'C1', fases: 3, dMax: 23, disj: 63 },
      { c: 'C2', fases: 3, dMax: 30, disj: 80 },
      { c: 'C3', fases: 3, dMax: 38, disj: 100 },
      { c: 'C4', fases: 3, dMax: 47.6, disj: 125, ramal: 50, est: true },
      { c: 'C5', fases: 3, dMax: 57.1, disj: 150, ramal: 70, est: true },
      { c: 'C6', fases: 3, dMax: 76.2, disj: 200, ramal: 95, est: true }
    ],
    // Tabela 3 — iluminação e tomadas, residencial (carga em kW → FD)
    fd3: [[1, 0.86], [2, 0.75], [3, 0.66], [4, 0.59], [5, 0.52], [6, 0.45], [7, 0.4], [8, 0.35], [9, 0.31], [10, 0.27], [Infinity, 0.24]],
    // Tabela 4 — chuveiros, torneiras, aquecedores de passagem, ferros (nº de aparelhos → FD)
    fd4: [1, 1, 0.84, 0.76, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.49, 0.48, 0.46, 0.45, 0.44, 0.43, 0.42, 0.41, 0.4, 0.4, 0.39, 0.39, 0.39, 0.38, 0.38],
    dps: { classe: 'II', uc: 175, inKA: 5, imaxKA: 12, upKV: 1.5, condMin: 4, compMax: 0.5 },
    icnKA: 10,
    grupos: {
      a: 'Iluminação e tomadas de uso geral (Tabela 3)',
      b: 'Chuveiros, torneiras, aquecedores de passagem, ferros (Tabela 4)',
      c: 'Aquecedor central / de acumulação (Tabela 5)',
      d: 'Secadora, forno elétrico, lava-louças, micro-ondas (Tabela 6)',
      e: 'Fogões elétricos (Tabela 7)',
      f: 'Ar-condicionado (Tabela 8)',
      g: 'Motores (Tabela 10)',
      h: 'Outros equipamentos ≥ 1 kW',
      i: 'Hidromassagem (Tabela 12)'
    }
  };
  E.fd3 = (kw) => { for (const [lim, f] of E.GED.fd3) if (kw <= lim + EPS) return f; return 0.24; };
  E.fd4 = (n) => (n <= 0 ? 1 : n <= E.GED.fd4.length ? E.GED.fd4[n - 1] : 0.38);
  E.fd6 = (n) => (n <= 1 ? 1 : n <= 4 ? 0.7 : n <= 6 ? 0.6 : 0.5);
  E.fdAr = (n) => (n <= 10 ? 1 : n <= 20 ? 0.86 : 0.8);

  /* ------------------------------------------------------------------ */
  /* NBR 5410 9.5.2 — previsão de cargas                                   */
  /* ------------------------------------------------------------------ */
  E.ilumMin = (A) => (A <= 6 + EPS ? 100 : 100 + 60 * Math.floor((A - 6) / 4 + EPS));
  E.tugMin = function (tipo, A, per) {
    switch (E.tipoAmb(tipo).tug) {
      case 'banheiro': return 1;
      case 'cozinha': return Math.ceil(per / 3.5 - EPS);
      case 'varanda': return 1;
      case 'social': return Math.max(1, Math.ceil(per / 5 - EPS));
      case 'demais': return A <= 6 + EPS ? 1 : Math.ceil(per / 5 - EPS);
      default: return 0;
    }
  };
  E.regraTug = function (tipo) {
    switch (E.tipoAmb(tipo).tug) {
      case 'banheiro': return '1 ponto junto ao lavatório, fora dos volumes 0, 1 e 2';
      case 'cozinha': return '1 ponto a cada 3,5 m (ou fração) de perímetro';
      case 'varanda': return 'pelo menos 1 ponto';
      case 'social': return '1 ponto a cada 5 m (ou fração) de perímetro';
      case 'demais': return 'até 6 m²: 1 ponto; acima: 1 a cada 5 m de perímetro';
      default: return 'sem mínimo normativo';
    }
  };

  /* ------------------------------------------------------------------ */
  /* Projeto                                                              */
  /* ------------------------------------------------------------------ */
  E.novoProjeto = function (nome) {
    return {
      schema: 'planta-eletrica-bim/1', id: uid('p'), nome: nome || 'Novo projeto',
      criado: Date.now(), atualizado: Date.now(),
      meta: { cliente: '', endereco: '', municipio: 'Bauru/SP', responsavel: '', registro: '', art: '', obs: '' },
      par: {
        vfn: 127, vff: 220, fases: 'auto', esquema: 'TN-S', tAmb: 30, metodo: 'B1', rho: 0.0206,
        dvTerm: 4, dvTotal: 5, dvAlim: 1, limIlum: 1270, limTug: 1500, limCoz: 1900, maxCircEletr: 3,
        sobra: 10, pd: 2.8, alimComp: null, alimMetodo: 'B1', autoRota: true, porCircuito: true, drTodos: false, dpsQd: true,
        curva: 'C', primC: 0.3
      },
      amb: [], dev: [], eletr: [],
      spda: { ng: null, L: null, W: null, h: 4.5, cd: 0.5, ce: 0.1, ci: 1, ll: 1000, rt: 0.01, pta: 1, rp: 1, rf: 0.01, hz: 1, lt: 0.01, lf: 0.01, classe: 'nenhum', dps: 'II' },
      nr10: {}, precos: {}, orc: { ajuste: 0, mo: 0, bdi: 0 }
    };
  };

  E.migrar = function (P) {
    const base = E.novoProjeto(P.nome);
    P.meta = Object.assign({}, base.meta, P.meta || {});
    P.par = Object.assign({}, base.par, P.par || {});
    P.spda = Object.assign({}, base.spda, P.spda || {});
    P.amb = P.amb || []; P.dev = P.dev || []; P.eletr = P.eletr || []; P.paredes = P.paredes || []; P.nr10 = P.nr10 || {}; P.precos = P.precos || {}; P.orc = Object.assign({}, base.orc, P.orc || {});
    if (!P.id) P.id = base.id;
    return P;
  };

  /* ------------------------------------------------------------------ */
  /* Geometria                                                            */
  /* ------------------------------------------------------------------ */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  E.dist = dist;
  E.contem = (a, x, y, tol = 0.01) => x >= a.x - tol && x <= a.x + a.w + tol && y >= a.y - tol && y <= a.y + a.h + tol;
  E.ambienteEm = function (P, x, y, tol = 0.01) {
    let best = null, bA = Infinity;
    for (const a of P.amb) if (E.contem(a, x, y, tol)) { const A = a.w * a.h; if (A < bA) { bA = A; best = a; } }
    return best;
  };
  // borda mais próxima de um ponto dentro do ambiente; normal aponta para dentro
  E.bordaProxima = function (a, x, y) {
    const c = [
      { d: Math.abs(y - a.y), x: Math.min(Math.max(x, a.x), a.x + a.w), y: a.y, nx: 0, ny: 1, e: 0 },
      { d: Math.abs(a.x + a.w - x), x: a.x + a.w, y: Math.min(Math.max(y, a.y), a.y + a.h), nx: -1, ny: 0, e: 1 },
      { d: Math.abs(a.y + a.h - y), x: Math.min(Math.max(x, a.x), a.x + a.w), y: a.y + a.h, nx: 0, ny: -1, e: 2 },
      { d: Math.abs(x - a.x), x: a.x, y: Math.min(Math.max(y, a.y), a.y + a.h), nx: 1, ny: 0, e: 3 }
    ];
    c.sort((p, q) => p.d - q.d);
    return c[0];
  };
  E.normalNaBorda = function (a, d) {
    const tol = 0.03;
    if (!a) return null;
    if (Math.abs(d.y - a.y) < tol && d.x >= a.x - tol && d.x <= a.x + a.w + tol) return [0, 1];
    if (Math.abs(d.y - a.y - a.h) < tol && d.x >= a.x - tol && d.x <= a.x + a.w + tol) return [0, -1];
    if (Math.abs(d.x - a.x) < tol && d.y >= a.y - tol && d.y <= a.y + a.h + tol) return [1, 0];
    if (Math.abs(d.x - a.x - a.w) < tol && d.y >= a.y - tol && d.y <= a.y + a.h + tol) return [-1, 0];
    return null;
  };
  // paredes avulsas (divisórias), sempre retas na horizontal ou na vertical: { id, x1, y1, x2, y2 }
  E.paredeOrient = (w) => (Math.abs(w.y1 - w.y2) < 1e-6 ? 'h' : 'v');
  E.paredeNoPonto = function (P, d, tol) {
    tol = tol || 0.03;
    for (const w of P.paredes || []) {
      if (E.paredeOrient(w) === 'h') { const a = Math.min(w.x1, w.x2), b = Math.max(w.x1, w.x2); if (Math.abs(d.y - w.y1) < tol && d.x >= a - tol && d.x <= b + tol) return w; }
      else { const a = Math.min(w.y1, w.y2), b = Math.max(w.y1, w.y2); if (Math.abs(d.x - w.x1) < tol && d.y >= a - tol && d.y <= b + tol) return w; }
    }
    return null;
  };
  E.normalParedeLivre = function (P, d) {
    const w = E.paredeNoPonto(P, d); if (!w) return null;
    const l = d.ld === -1 ? -1 : 1;
    return E.paredeOrient(w) === 'h' ? [0, l] : [l, 0];
  };
  // parâmetro s ao longo do perímetro (sentido horário a partir do canto superior esquerdo)
  function perimPonto(a, s) {
    const P = 2 * (a.w + a.h);
    s = ((s % P) + P) % P;
    if (s <= a.w) return { x: a.x + s, y: a.y, e: 0, off: s, len: a.w };
    s -= a.w; if (s <= a.h) return { x: a.x + a.w, y: a.y + s, e: 1, off: s, len: a.h };
    s -= a.h; if (s <= a.w) return { x: a.x + a.w - s, y: a.y + a.h, e: 2, off: s, len: a.w };
    s -= a.w; return { x: a.x, y: a.y + a.h - s, e: 3, off: s, len: a.h };
  }
  E.perimPonto = perimPonto;

  /* ------------------------------------------------------------------ */
  /* Inserção automática dos pontos mínimos (NBR 5410 9.5.2)               */
  /* ------------------------------------------------------------------ */
  function proximaLetra(P) {
    const usadas = new Set(P.dev.filter((d) => d.cmd).map((d) => d.cmd));
    const abc = 'abcdefghijklmnopqrstuvwxyz';
    for (const l of abc) if (!usadas.has(l)) return l;
    for (const l1 of abc) for (const l2 of abc) if (!usadas.has(l1 + l2)) return l1 + l2;
    return 'z';
  }
  function portasDoAmbiente(P, a) {
    return P.dev.filter((d) => d.k === 'porta' && E.normalNaBorda(a, d));
  }
  function posValida(P, a, pt, extra) {
    const portas = portasDoAmbiente(P, a);
    for (const p of portas) { if (dist(p, pt) < (p.w || 0.8) / 2 + 0.2) return false; }
    if (pt.off < 0.3 || pt.len - pt.off < 0.3) return false;
    for (const d of P.dev.concat(extra || [])) {
      if (d.k === 'porta') continue;
      const dd = dist(d, pt);
      if (d.k === 'tue' && ['chuveiro', 'hidro', 'torneira'].includes(d.tipo) && dd < 0.8) return false;
      if (d.mount !== 'teto' && d.k !== 'luz' && dd < 0.35) return false;
    }
    return true;
  }
  // posição boa para interruptor: dentro do ambiente, longe dos cantos e sem outro ponto colado
  function candInt(P, a, c) {
    if (!E.contem(a, c.x, c.y, 0.001)) return false;
    const cantos = [[a.x, a.y], [a.x + a.w, a.y], [a.x, a.y + a.h], [a.x + a.w, a.y + a.h]];
    if (cantos.some(([x, y]) => Math.hypot(c.x - x, c.y - y) < 0.2)) return false;
    return !P.dev.some((d) => d.k !== 'porta' && d.k !== 'luz' && dist(d, c) < 0.25);
  }
  E.completarPontos = function (P, ambId) {
    const a = P.amb.find((x) => x.id === ambId);
    if (!a) return 0;
    const t = E.tipoAmb(a.tipo);
    const A = a.w * a.h, per = 2 * (a.w + a.h);
    const pd = a.pd || P.par.pd;
    let added = 0;
    const meus = P.dev.filter((d) => (d.amb === a.id) || (!d.amb && E.contem(a, d.x, d.y, -0.005)));
    // luzes
    const luzes = meus.filter((d) => d.k === 'luz' || d.k === 'arandela');
    let letra = (luzes.find((d) => d.cmd) || {}).cmd;
    if (!t.semLuzMin && luzes.length === 0) {
      const n = A <= 12 ? 1 : A <= 24 ? 2 : Math.ceil(A / 12);
      const cols = a.w >= a.h ? Math.ceil(Math.sqrt(n * a.w / a.h)) : Math.max(1, Math.round(Math.sqrt(n * a.w / a.h)));
      const rows = Math.ceil(n / cols);
      letra = letra || proximaLetra(P);
      let k = 0;
      for (let r = 0; r < rows && k < n; r++) for (let c = 0; c < cols && k < n; c++, k++) {
        P.dev.push({ id: uid('d'), k: 'luz', x: +(a.x + a.w * (c + 0.5) / cols).toFixed(2), y: +(a.y + a.h * (r + 0.5) / rows).toFixed(2), amb: a.id, cmd: letra });
        added++;
      }
    }
    // interruptor
    const temInt = meus.some((d) => d.k.startsWith('int'));
    if (!t.semLuzMin && !temInt && (luzes.length || added)) {
      letra = letra || (P.dev.find((d) => d.amb === a.id && d.cmd) || {}).cmd || proximaLetra(P);
      let pos = null;
      const portas = portasDoAmbiente(P, a);
      for (const p of portas) {
        const n = E.normalNaBorda(a, p);
        const half = (p.w || 0.8) / 2 + 0.15;
        const cands = n[0] === 0 ? [{ x: p.x + half, y: p.y }, { x: p.x - half, y: p.y }] : [{ x: p.x, y: p.y + half }, { x: p.x, y: p.y - half }];
        pos = cands.find((c) => candInt(P, a, c));
        if (pos) break;
      }
      if (!pos) pos = { x: a.x + 0.3, y: a.y + a.h };
      P.dev.push({ id: uid('d'), k: 'int1', x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), amb: a.id, cmd: letra });
      added++;
    }
    // tomadas
    const nMin = E.tugMin(a.tipo, A, per);
    const tugs = P.dev.filter((d) => d.k === 'tug' && (d.amb === a.id));
    const falta = nMin - tugs.length;
    if (falta > 0) {
      const h = t.tug === 'cozinha' || t.tug === 'banheiro' ? 1.1 : 0.3;
      const novos = [];
      for (let k = 0; k < falta; k++) {
        const alvo = per * (k + 0.5 + tugs.length * 0.37) / falta;
        let ok = null;
        for (let step = 0; step < per / 0.1 && !ok; step++) {
          for (const sgn of [1, -1]) {
            const pt = perimPonto(a, alvo + sgn * step * 0.1);
            if (posValida(P, a, pt, novos)) { ok = pt; break; }
          }
        }
        if (!ok) ok = perimPonto(a, alvo);
        const d = { id: uid('d'), k: 'tug', x: +ok.x.toFixed(2), y: +ok.y.toFixed(2), amb: a.id, h };
        novos.push(d);
      }
      for (const d of novos) P.dev.push(d);
      added += novos.length;
    }
    void pd;
    return added;
  };

  /* ------------------------------------------------------------------ */
  /* Projeto automático: NBR 5410 (mínimos), GED-13 (entrada) e a prática  */
  /* de obra do eletricista para pontos de uso específico, quadro e medição */
  /* ------------------------------------------------------------------ */
  E.AUTO_OPCOES = {
    chuveiro: { n: 'Chuveiro elétrico em cada banheiro', def: true },
    arDorm: { n: 'Ponto de ar-condicionado em cada dormitório', def: true },
    arSala: { n: 'Ponto de ar-condicionado na sala', def: false },
    microondas: { n: 'Micro-ondas na cozinha', def: true },
    geladeira: { n: 'Tomada da geladeira na cozinha (1,10 m)', def: true },
    lavaRoupa: { n: 'Máquina de lavar na área de serviço', def: true },
    torneira: { n: 'Torneira elétrica na cozinha', def: false },
    forno: { n: 'Forno elétrico na cozinha', def: false },
    externa: { n: 'Tomada externa com DR em varandas e áreas externas', def: true },
    portao: { n: 'Motor de portão na garagem', def: false },
    paralelo: { n: 'Interruptor paralelo em salas e corredores com duas portas', def: true }
  };
  function pontoParede(P, a, score, extra) {
    // varre o perímetro do ambiente a cada 10 cm e devolve o ponto válido de maior nota
    const per = 2 * (a.w + a.h);
    let best = null, bs = -Infinity;
    for (let s = 0; s < per; s += 0.1) {
      const pt = perimPonto(a, s);
      if (!posValida(P, a, pt, extra)) continue;
      const v = score(pt);
      if (v > bs) { bs = v; best = pt; }
    }
    return best;
  }
  function distPortas(P, a, pt) {
    const ps = portasDoAmbiente(P, a);
    return ps.length ? Math.min(...ps.map((p) => dist(p, pt))) : 3;
  }
  function distPontos(P, pt) {
    const ds = P.dev.filter((d) => d.k !== 'porta' && d.k !== 'luz').map((d) => dist(d, pt));
    return ds.length ? Math.min(...ds) : 5;
  }
  const meioParede = (pt) => 1 - Math.abs(pt.off - pt.len / 2) / Math.max(0.01, pt.len / 2);
  E.projetarAuto = function (P, op) {
    op = Object.assign({}, ...Object.entries(E.AUTO_OPCOES).map(([k, v]) => ({ [k]: v.def })), { substituir: true, frente: 'baixo' }, op || {});
    if (!P.amb.length) return { erro: 'Desenhe os ambientes da casa antes de projetar.' };
    if (op.substituir) { P.dev = P.dev.filter((d) => d.k === 'porta'); P.eletr = []; }
    const res = { tue: 0, luz: 0, int: 0, tug: 0, notas: [] };
    const put = (a, k, pt, extra) => { const d = Object.assign({ id: uid('d'), k, x: +pt.x.toFixed(3), y: +pt.y.toFixed(3), amb: a.id }, extra || {}); P.dev.push(d); return d; };
    const tem = (a, f) => P.dev.some((d) => d.amb === a.id && f(d));
    // 1. pontos de uso específico (antes das tomadas, para elas desviarem)
    for (const a of P.amb) {
      const t = a.tipo;
      const tue = (tipo, score) => {
        if (tem(a, (d) => d.k === 'tue' && d.tipo === tipo)) return;
        const pt = pontoParede(P, a, score); if (!pt) return;
        put(a, 'tue', pt, { tipo }); res.tue++;
      };
      const longePorta = (pt) => Math.min(distPortas(P, a, pt), 2.5) + 2 * meioParede(pt) + 0.4 * Math.min(pt.len, 4); // ar: meio da parede maior, longe da porta
      const espalhado = (pt) => Math.min(distPontos(P, pt), 2) + 0.3 * distPortas(P, a, pt);
      if (t === 'banheiro' && op.chuveiro) tue('chuveiro', (pt) => distPortas(P, a, pt) + 0.3 * meioParede(pt));
      if (t === 'dormitorio' && op.arDorm) tue('ar', longePorta);
      if (t === 'sala' && op.arSala && a.w * a.h >= 9) tue('ar', longePorta);
      if (t === 'cozinha') {
        if (op.microondas) tue('microondas', espalhado);
        if (op.torneira) tue('torneira', espalhado);
        if (op.forno) tue('forno', espalhado);
      }
      if (t === 'area_servico' && op.lavaRoupa) tue('lavaroupa', espalhado);
      if (t === 'garagem' && op.portao) tue('portao', (pt) => -distPortas(P, a, pt) * 0.2 + meioParede(pt));
    }
    // 2. luzes, interruptores e tomadas mínimas da NBR 5410
    for (const a of P.amb) E.completarPontos(P, a.id);
    // 3. ajustes de prática de obra
    for (const a of P.amb) {
      const t = E.tipoAmb(a.tipo);
      // geladeira: tomada dedicada a 1,10 m na cozinha, longe do fogão/portas
      if (a.tipo === 'cozinha' && op.geladeira) {
        const pt = pontoParede(P, a, (p) => Math.min(distPontos(P, p), 2) + 0.2 * distPortas(P, a, p));
        if (pt) { put(a, 'tug', pt, { h: 1.1, va: 600, rotulo: 'Geladeira' }); res.tug++; }
      }
      // tomadas externas recebem a marcação que exige DR
      if (t.externa && op.externa) for (const d of P.dev) if (d.amb === a.id && d.k === 'tug') d.externo = true;
      // paralelo em salas/corredores com duas ou mais portas
      const portas = portasDoAmbiente(P, a);
      if (op.paralelo && portas.length >= 2 && ['circulacao', 'sala'].includes(a.tipo)) {
        const ints = P.dev.filter((d) => d.amb === a.id && d.k.startsWith('int'));
        const letra = (P.dev.find((d) => d.amb === a.id && d.k === 'luz') || {}).cmd;
        if (ints.length === 1 && letra) {
          ints[0].k = 'int2';
          const ja = ints[0];
          const outra = portas.filter((p) => dist(p, ja) > 1).sort((p, q) => dist(q, ja) - dist(p, ja))[0];
          if (outra) {
            const n = E.normalNaBorda(a, outra), half = (outra.w || 0.8) / 2 + 0.15;
            const cands = n && n[0] === 0 ? [{ x: outra.x + half, y: outra.y }, { x: outra.x - half, y: outra.y }] : [{ x: outra.x, y: outra.y + half }, { x: outra.x, y: outra.y - half }];
            const c = cands.find((p) => candInt(P, a, p));
            if (c) { put(a, 'int2', c, { cmd: letra }); res.int++; }
          }
        }
      }
    }
    // 4. quadro: parede de local seco, de fácil acesso e perto do centro de cargas
    const cargas = P.dev.filter((d) => d.k !== 'porta');
    const cg = cargas.length ? { x: cargas.reduce((s, d) => s + d.x, 0) / cargas.length, y: cargas.reduce((s, d) => s + d.y, 0) / cargas.length } : { x: 0, y: 0 };
    const pesoAmb = { circulacao: 0, sala: 0.8, escritorio: 1.2, garagem: 1.5, outro: 1.5, despensa: 2.5, dormitorio: 3 };
    if (!P.dev.some((d) => d.k === 'qdc')) {
      let best = null, bs = Infinity;
      for (const a of P.amb) {
        if (pesoAmb[a.tipo] == null) continue;
        const pt = pontoParede(P, a, (p) => -dist(p, cg) + 0.3 * Math.min(distPortas(P, a, p), 1.5));
        if (!pt) continue;
        const v = dist(pt, cg) + pesoAmb[a.tipo];
        if (v < bs) { bs = v; best = { a, pt }; }
      }
      if (best) put(best.a, 'qdc', best.pt);
      else res.notas.push('Não achei parede de local seco para o quadro: insira-o manualmente.');
    }
    // 5. medição no limite do terreno, do lado da rua
    if (!P.dev.some((d) => d.k === 'med')) {
      const x0 = Math.min(...P.amb.map((a) => a.x)), y0 = Math.min(...P.amb.map((a) => a.y));
      const x1 = Math.max(...P.amb.map((a) => a.x + a.w)), y1 = Math.max(...P.amb.map((a) => a.y + a.h));
      const q = P.dev.find((d) => d.k === 'qdc') || { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      const m = 1.5;
      const pos = { baixo: { x: q.x, y: y1 + m }, cima: { x: q.x, y: y0 - m }, esquerda: { x: x0 - m, y: q.y }, direita: { x: x1 + m, y: q.y } }[op.frente] || { x: q.x, y: y1 + m };
      P.dev.push({ id: uid('d'), k: 'med', x: +pos.x.toFixed(2), y: +pos.y.toFixed(2) });
    }
    P.par.autoRota = true;
    for (const d of P.dev) { if (d.k === 'luz') res.luz++; if (d.k.startsWith('int')) res.int++; if (d.k === 'tug') res.tug++; }
    res.int = P.dev.filter((d) => d.k.startsWith('int')).length;
    res.tug = P.dev.filter((d) => d.k === 'tug').length;
    res.tue = P.dev.filter((d) => d.k === 'tue').length;
    if (!P.dev.some((d) => d.k === 'porta')) res.notas.push('Sem portas desenhadas: os interruptores ficaram num canto. Desenhe as portas e rode de novo para posicioná-los ao lado delas.');
    return res;
  };

  /* ------------------------------------------------------------------ */
  /* Derivação do modelo: tudo que é calculado vem daqui                   */
  /* ------------------------------------------------------------------ */
  E.derivar = function (P) {
    const par = P.par;
    const R = { amb: {}, dev: {}, circ: [], issues: [], edges: [], nodes: {}, bom: [], resumo: {} };
    const issue = (sev, ref, msg, alvo) => R.issues.push({ sev, ref, msg, alvo: alvo || null });
    const ambById = {};
    for (const a of P.amb) ambById[a.id] = a;

    // --- ambientes
    for (const a of P.amb) {
      const A = a.w * a.h, per = 2 * (a.w + a.h);
      const t = E.tipoAmb(a.tipo);
      R.amb[a.id] = {
        area: A, per, pd: a.pd || par.pd, tipo: t,
        ilumMin: t.semLuzMin ? 0 : E.ilumMin(A), tugMin: E.tugMin(a.tipo, A, per),
        nLuz: 0, nTug: 0, nTue: 0, ilumVA: 0, tugVA: 0, tueW: 0, nInt: 0
      };
    }

    // --- elementos: ambiente, altura, normal
    for (const d of P.dev) {
      const K = E.KINDS[d.k] || {};
      let a = d.amb && ambById[d.amb] ? ambById[d.amb] : E.ambienteEm(P, d.x, d.y);
      const pd = a ? (a.pd || par.pd) : par.pd;
      let h;
      if (d.k === 'luz') h = pd;
      else if (d.h != null && d.h !== '') h = +d.h;
      else if (d.k === 'tue') h = (E.TUE[d.tipo] || E.TUE.outro).h;
      else h = K.h != null ? K.h : 1.1;
      R.dev[d.id] = { amb: a ? a.id : null, pd, h: Math.min(h, pd), drop: Math.max(0, pd - Math.min(h, pd)), nrm: E.normalNaBorda(a, d) || E.normalParedeLivre(P, d), va: 0, w: 0, fp: 1, circ: null };
      if (a) {
        const ra = R.amb[a.id];
        if (d.k === 'luz' || d.k === 'arandela') ra.nLuz++;
        if (d.k === 'tug') ra.nTug++;
        if (d.k === 'tue') ra.nTue++;
        if (d.k.startsWith('int')) ra.nInt++;
      }
    }

    // --- potências (NBR 5410 9.5.2)
    let tugMolhadas = 0;
    for (const d of P.dev) if (d.k === 'tug') { const a = ambById[R.dev[d.id].amb]; if (a && E.tipoAmb(a.tipo).w600) tugMolhadas++; }
    const kAte = tugMolhadas > 6 ? 2 : 3;
    const contTugAmb = {};
    for (const d of P.dev) {
      const rd = R.dev[d.id];
      const a = ambById[rd.amb];
      if (d.k === 'luz' || d.k === 'arandela') {
        let va;
        if (d.va > 0) va = +d.va;
        else if (a) { const ra = R.amb[a.id]; va = Math.max(ra.ilumMin, 100) / Math.max(1, ra.nLuz); va = Math.ceil(va / 10) * 10; }
        else va = 100;
        rd.va = va; rd.w = va; rd.fp = 1;
      } else if (d.k === 'tug') {
        let va;
        if (d.va > 0) va = +d.va;
        else if (a && E.tipoAmb(a.tipo).w600) { contTugAmb[a.id] = (contTugAmb[a.id] || 0) + 1; va = contTugAmb[a.id] <= kAte ? 600 : 100; }
        else va = 100;
        rd.va = va; rd.w = va; rd.fp = 1;
      } else if (d.k === 'tue') {
        const pr = E.TUE[d.tipo] || E.TUE.outro;
        const w = d.w > 0 ? +d.w : pr.w;
        const fp = d.fp > 0 ? +d.fp : pr.fp;
        rd.w = w; rd.fp = fp; rd.va = Math.round(w / fp); rd.v = d.v ? +d.v : pr.v;
      }
      if (a) {
        const ra = R.amb[a.id];
        if (d.k === 'luz' || d.k === 'arandela') ra.ilumVA += rd.va;
        if (d.k === 'tug') ra.tugVA += rd.va;
        if (d.k === 'tue') ra.tueW += rd.w;
      }
    }
    R.kAte = kAte;

    // --- circuitos
    montarCircuitos(P, R, ambById, issue);

    // --- carga instalada, demanda e categoria GED-13
    calcularEntrada(P, R, issue);

    // --- roteamento (rede de eletrodutos na laje + descidas)
    rotear(P, R, issue);

    // --- alimentador e dimensionamento dos circuitos
    dimensionarAlimentador(P, R, issue);
    for (const c of R.circ) dimensionarCircuito(P, R, c, issue);
    dimensionarEletrodutos(P, R);

    // --- quadro
    montarQuadro(P, R);

    // --- SPDA
    R.spda = E.spda(P, R);

    // --- verificações
    verificar(P, R, ambById, issue);

    // --- quantitativos
    R.bom = quantitativos(P, R);
    paredesNosEletrodutos(P, R);

    const sevOrd = { erro: 0, aviso: 1, info: 2 };
    R.issues.sort((a, b) => sevOrd[a.sev] - sevOrd[b.sev]);
    R.resumo.nErro = R.issues.filter((i) => i.sev === 'erro').length;
    R.resumo.nAviso = R.issues.filter((i) => i.sev === 'aviso').length;
    return R;
  };

  /* ------------------------------------------------------------------ */
  function montarCircuitos(P, R, ambById, issue) {
    const par = P.par;
    const nomeAmb = (id) => (ambById[id] ? ambById[id].nome : 'sem ambiente');
    const cargas = P.dev.filter((d) => ['luz', 'arandela', 'tug', 'tue'].includes(d.k));
    const circ = [];
    const novo = (tipo, v) => { const c = { tipo, v, devs: [], va: 0, w: 0, manual: false }; circ.push(c); return c; };
    const add = (c, d) => { c.devs.push(d.id); c.va += R.dev[d.id].va; c.w += R.dev[d.id].w; };
    // grupos manuais
    const manuais = {};
    for (const d of cargas) if (d.grupo) {
      const key = String(d.grupo).trim();
      if (!manuais[key]) { manuais[key] = novo('manual', par.vfn); manuais[key].manual = true; manuais[key].grupo = key; }
      add(manuais[key], d);
    }
    const livres = cargas.filter((d) => !d.grupo);
    // ordem dos ambientes: como aparecem no projeto
    const ordemAmb = P.amb.map((a) => a.id).concat([null]);
    const porAmb = (filtro) => ordemAmb.map((id) => ({ id, ds: livres.filter((d) => filtro(d) && R.dev[d.id].amb === id) })).filter((g) => g.ds.length);
    const agrupar = (grupos, tipo, lim) => {
      let atual = null;
      for (const g of grupos) {
        const tot = g.ds.reduce((s, d) => s + R.dev[d.id].va, 0);
        if (!atual || atual.va + tot > lim) {
          if (atual && atual.va + tot > lim && tot <= lim) atual = null;
        }
        for (const d of g.ds) {
          if (!atual || atual.va + R.dev[d.id].va > lim) atual = novo(tipo, par.vfn);
          add(atual, d);
        }
      }
    };
    // iluminação
    agrupar(porAmb((d) => d.k === 'luz' || d.k === 'arandela'), 'ilum', par.limIlum);
    // TUG social (inclui banheiros, varandas e demais)
    agrupar(porAmb((d) => d.k === 'tug' && !(ambById[R.dev[d.id].amb] && E.tipoAmb(ambById[R.dev[d.id].amb].tipo).exclusivo)), 'tug', par.limTug);
    // TUG de cozinhas, copas, áreas de serviço: circuitos exclusivos por ambiente (9.5.3.3)
    for (const g of porAmb((d) => d.k === 'tug' && ambById[R.dev[d.id].amb] && E.tipoAmb(ambById[R.dev[d.id].amb].tipo).exclusivo)) {
      let atual = null;
      for (const d of g.ds) { if (!atual || atual.va + R.dev[d.id].va > par.limCoz) atual = novo('tug_coz', par.vfn); add(atual, d); }
    }
    // TUE: um circuito por equipamento (9.5.3.2 exige para In > 10 A)
    for (const d of livres.filter((d) => d.k === 'tue')) { const c = novo('tue', R.dev[d.id].v || par.vfn); add(c, d); }

    // classificação dos manuais
    for (const c of circ.filter((c) => c.manual)) {
      const ks = new Set(c.devs.map((id) => P.dev.find((d) => d.id === id).k));
      const temIlum = ks.has('luz') || ks.has('arandela');
      const temTug = ks.has('tug'), temTue = ks.has('tue');
      if (temTue && !temIlum && !temTug && c.devs.length === 1) c.tipo = 'tue';
      else if (temIlum && !temTug && !temTue) c.tipo = 'ilum';
      else if (!temIlum) {
        const excl = c.devs.every((id) => { const a = ambById[R.dev[id].amb]; return a && E.tipoAmb(a.tipo).exclusivo; });
        c.tipo = excl ? 'tug_coz' : 'tug';
      } else c.tipo = 'misto';
      const vs = new Set(c.devs.map((id) => { const d = P.dev.find((x) => x.id === id); return d.k === 'tue' ? R.dev[id].v : par.vfn; }));
      c.v = Math.max(...vs);
      if (vs.size > 1) issue('erro', 'NBR 5410 4.2.5', `Circuito manual "${c.grupo}" mistura cargas de tensões diferentes.`, { tipo: 'grupo', id: c.grupo });
    }

    // ordenar e numerar
    const ord = { ilum: 0, misto: 1, tug: 2, tug_coz: 3, tue: 4 };
    circ.sort((a, b) => (ord[a.tipo] - ord[b.tipo]) || 0);
    circ.forEach((c, i) => {
      c.num = i + 1; c.id = 'C' + c.num;
      c.polos = c.v === par.vff ? 2 : 1;
      const ambs = [...new Set(c.devs.map((id) => R.dev[id].amb))];
      const nomes = ambs.map(nomeAmb);
      const tipoTxt = { ilum: 'Iluminação', tug: 'Tomadas', tug_coz: 'Tomadas', misto: 'Ilum. + tomadas', tue: '' }[c.tipo];
      if (c.tipo === 'tue') {
        const d = P.dev.find((x) => x.id === c.devs[0]);
        c.desc = (d.rotulo || (E.TUE[d.tipo] || E.TUE.outro).n) + ' — ' + nomes[0];
      } else c.desc = tipoTxt + ' — ' + nomes.join(', ');
      c.ambs = ambs;
      for (const id of c.devs) R.dev[id].circ = c.id;
    });

    // interruptores herdam o circuito da luz que comandam
    const luzes = P.dev.filter((d) => (d.k === 'luz' || d.k === 'arandela'));
    for (const s of P.dev.filter((d) => d.k.startsWith('int'))) {
      const rs = R.dev[s.id];
      let alvo = luzes.filter((l) => s.cmd && l.cmd === s.cmd);
      const mesmoAmb = alvo.filter((l) => R.dev[l.id].amb === rs.amb);
      if (mesmoAmb.length) alvo = mesmoAmb;
      if (!alvo.length) alvo = luzes.filter((l) => R.dev[l.id].amb === rs.amb && rs.amb);
      alvo.sort((a, b) => dist(a, s) - dist(b, s));
      rs.luz = alvo.length ? alvo[0].id : null;
      rs.circ = rs.luz ? R.dev[rs.luz].circ : null;
      const c = circ.find((x) => x.id === rs.circ);
      if (c) { c.cmds = c.cmds || []; c.cmds.push(s.id); }
    }

    // DR — NBR 5410 5.1.3.2.2
    for (const c of circ) {
      const mot = new Set();
      for (const id of c.devs) {
        const d = P.dev.find((x) => x.id === id);
        const a = ambById[R.dev[id].amb];
        const t = a ? E.tipoAmb(a.tipo) : null;
        if (d.k === 'tue' && ['chuveiro', 'hidro'].includes(d.tipo)) mot.add('ponto em local com chuveiro/banheira');
        if (d.externo) mot.add('tomada que pode alimentar equipamento externo');
        if (!t) continue;
        if (t.chuveiro) mot.add('ponto em banheiro (local com chuveiro)');
        else if (t.externa && d.k !== 'luz' && d.k !== 'arandela') mot.add('tomada em área externa');
        else if (t.dr && !t.externa) {
          const ilum = d.k === 'luz' || d.k === 'arandela';
          if (!(ilum && R.dev[id].h >= 2.5 - EPS)) mot.add('ponto em ' + t.n.toLowerCase() + ' (área molhada ou sujeita a lavagem)');
        }
      }
      if (par.drTodos && !mot.size) mot.add('critério do projeto: DR em todos os circuitos');
      c.dr = mot.size > 0;
      c.drMotivo = [...mot].join('; ');
    }
    R.circ = circ;
  }

  /* ------------------------------------------------------------------ */
  function calcularEntrada(P, R, issue) {
    const par = P.par;
    const g = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0 };
    const n = { b: 0, d: 0, f: 0, e: 0 };
    let ilumTugW = 0;
    let cargaW = 0;
    const ajustes = [];
    for (const d of P.dev) {
      const rd = R.dev[d.id];
      if (d.k === 'luz' || d.k === 'arandela' || d.k === 'tug') { ilumTugW += rd.w; cargaW += rd.w; }
      if (d.k === 'tue') {
        const pr = E.TUE[d.tipo] || E.TUE.outro;
        let w = rd.w;
        if (pr.minGED && w < pr.minGED) { ajustes.push(`${pr.n}: ${w} W → ${pr.minGED} W (potência mínima GED-13)`); w = pr.minGED; }
        cargaW += w;
        const kva = w / 1000 / (rd.fp || 1);
        g[pr.ged] += pr.ged === 'b' ? w / 1000 : kva;
        if (n[pr.ged] != null) n[pr.ged]++;
      }
    }
    const C = cargaW / 1000;
    const fdA = E.fd3(ilumTugW / 1000);
    const dem = {
      a: (ilumTugW / 1000) * fdA, b: g.b * E.fd4(n.b), c: g.c, d: g.d * E.fd6(n.d),
      e: g.e * (n.e <= 1 ? 1 : 0.75), f: g.f * E.fdAr(n.f), g: g.g, h: g.h, i: g.i
    };
    const D = Object.values(dem).reduce((s, x) => s + x, 0);
    const precisa220 = R.circ.some((c) => c.v === par.vff);
    let cat;
    if (C <= 25 + EPS) cat = E.GED.cat.find((k) => k.cMax != null && C <= k.cMax + EPS);
    else cat = E.GED.cat.find((k) => k.dMax != null && D <= k.dMax + EPS) || E.GED.cat[E.GED.cat.length - 1];
    let fases = cat.fases;
    let catUsada = cat;
    const notas = [];
    if (precisa220 && fases === 1) {
      catUsada = E.GED.cat.find((k) => k.c === 'B1');
      fases = 2;
      notas.push('Há equipamentos em 220 V: o atendimento monofásico (fase-neutro 127 V) não os alimenta. A GED-13 permite atendimento bifásico a pedido do cliente, com taxa adicional; adotada a categoria B1.');
    }
    if (par.fases !== 'auto' && +par.fases) {
      const f = +par.fases;
      if (f < fases) issue('erro', 'GED-13 6.7', `Número de fases fixado (${f}) é menor que o exigido pela carga (${fases}).`);
      else if (f > fases) { const alt = E.GED.cat.find((k) => k.fases === f); notas.push(`Número de fases fixado no projeto: ${f}.`); if (alt && f > catUsada.fases) catUsada = f === 3 ? (E.GED.cat.find((k) => k.c === 'C1')) : alt; }
      fases = f;
    }
    if (C > 75) issue('erro', 'GED-13 6.1', 'Carga instalada acima de 75 kW: atendimento em tensão primária (fora do escopo da GED-13).');
    if (cat.est) notas.push('Faixas de demanda das categorias C4–C6 estimadas pela corrente do disjuntor; confira a Tabela 1A vigente.');
    R.entrada = {
      C, D, dem, fdA, nB: n.b, nD: n.d, nF: n.f, catCarga: cat, cat: catUsada, fases, precisa220, notas, ajustes,
      ilumTugW, porDemanda: C > 25 + EPS
    };
    // balanceamento de fases
    const F = ['A', 'B', 'C'].slice(0, fases);
    const load = { A: 0, B: 0, C: 0 };
    const ord = [...R.circ].sort((a, b) => b.va - a.va);
    for (const c of ord) {
      if (fases === 1) { c.fase = 'A'; load.A += c.va; continue; }
      if (c.v === par.vff) {
        const pairs = fases === 2 ? [['A', 'B']] : [['A', 'B'], ['B', 'C'], ['C', 'A']];
        let best = pairs[0], bv = Infinity;
        for (const p of pairs) { const m = Math.max(load[p[0]], load[p[1]]) + c.va / 2; if (m < bv - EPS) { bv = m; best = p; } }
        c.fase = best.join(''); load[best[0]] += c.va / 2; load[best[1]] += c.va / 2;
      } else {
        let best = F[0];
        for (const f of F) if (load[f] < load[best] - EPS) best = f;
        c.fase = best; load[best] += c.va;
      }
    }
    const usadas = F.map((f) => load[f]);
    const mx = Math.max(...usadas), mn = Math.min(...usadas);
    R.entrada.cargaFase = load;
    R.entrada.desequilibrio = fases > 1 && mx > 0 ? ((mx - mn) / mx) * 100 : 0;
  }

  /* ------------------------------------------------------------------ */
  function rotear(P, R, issue) {
    const par = P.par;
    const nodes = P.dev.filter((d) => d.k !== 'porta' && d.k !== 'med');
    const byId = {};
    for (const d of nodes) byId[d.id] = d;
    const qd = nodes.find((d) => d.k === 'qdc');
    R.qd = qd ? qd.id : null;
    const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const edges = new Map();
    for (const e of P.eletr) {
      if (byId[e.a] && byId[e.b] && e.a !== e.b) edges.set(key(e.a, e.b), { id: e.id, a: e.a, b: e.b, manual: true });
    }
    // Prim–Dijkstra: equilíbrio entre árvore mínima e caminhos curtos até o quadro
    const arvore = (sub, raiz, saidaUnica) => {
      const c = par.primC != null ? par.primC : 0.3;
      const inTree = new Set([raiz.id]);
      const pl = { [raiz.id]: 0 };
      const keyv = {}, par_ = {};
      const custo = (u, v) => (edges.has(key(u.id, v.id)) ? 0 : dist(u, v));
      for (const v of sub) if (v.id !== raiz.id) { keyv[v.id] = custo(raiz, v); par_[v.id] = raiz.id; }
      if (saidaUnica) { // só um eletroduto sai do quadro: o do ponto mais próximo; o resto deriva das caixas
        let m = null; for (const v of sub) if (v.id !== raiz.id && (!m || keyv[v.id] < keyv[m.id])) m = v;
        for (const v of sub) if (v.id !== raiz.id && v !== m) keyv[v.id] = Infinity;
      }
      while (inTree.size < sub.length) {
        let best = null, bk = Infinity;
        for (const v of sub) if (!inTree.has(v.id) && keyv[v.id] < bk) { bk = keyv[v.id]; best = v; }
        if (!best) break;
        inTree.add(best.id);
        const u = byId[par_[best.id]];
        pl[best.id] = pl[u.id] + dist(u, best);
        const k = key(u.id, best.id);
        if (!edges.has(k)) edges.set(k, { id: 'auto:' + k, a: u.id, b: best.id, manual: false });
        for (const v of sub) if (!inTree.has(v.id)) {
          const kk = c * pl[best.id] + custo(best, v);
          if (kk < keyv[v.id]) { keyv[v.id] = kk; par_[v.id] = best.id; }
        }
      }
    };
    // conjunto de pontos de cada circuito (o interruptor viaja com o circuito da luz que comanda)
    const setCirc = {};
    for (const c of R.circ) setCirc[c.id] = new Set([...(qd ? [qd.id] : []), ...c.devs, ...(c.cmds || [])].filter((id) => byId[id]));
    const porCircuito = par.porCircuito !== false;
    if (qd && par.autoRota) {
      if (porCircuito) {
        // um eletroduto por circuito: cada circuito tem sua própria árvore saindo do QDC;
        // derivações só acontecem dentro das caixas dos pontos do próprio circuito
        for (const c of R.circ) arvore([...setCirc[c.id]].map((id) => byId[id]), qd, true);
        // pontos sem circuito (ex.: interruptor sem luz) ligam-se ao ponto mais próximo já ligado
        const ligados = new Set(); for (const e of edges.values()) { ligados.add(e.a); ligados.add(e.b); }
        ligados.add(qd.id);
        for (const v of nodes) if (!ligados.has(v.id)) {
          let best = null, bd = Infinity;
          for (const id of ligados) { const dd = dist(v, byId[id]); if (dd < bd) { bd = dd; best = id; } }
          if (best) { const k = key(v.id, best); if (!edges.has(k)) edges.set(k, { id: 'auto:' + k, a: best, b: v.id, manual: false }); ligados.add(v.id); }
        }
      } else arvore(nodes, qd);
    }
    const E_ = [...edges.values()].map((e) => ({ ...e, L: dist(byId[e.a], byId[e.b]), circs: new Set(), ret: [] }));
    R.edges = E_;
    const adj = {};
    for (const d of nodes) adj[d.id] = [];
    E_.forEach((e, i) => { adj[e.a].push([e.b, i]); adj[e.b].push([e.a, i]); });
    R.adj = adj;
    // Dijkstra a partir do QDC
    const dst = {}, prevE = {};
    if (qd) {
      for (const d of nodes) dst[d.id] = Infinity;
      dst[qd.id] = 0;
      const vis = new Set();
      while (true) {
        let u = null, bu = Infinity;
        for (const d of nodes) if (!vis.has(d.id) && dst[d.id] < bu) { bu = dst[d.id]; u = d.id; }
        if (u == null) break;
        vis.add(u);
        for (const [v, ei] of adj[u]) { const nd = dst[u] + E_[ei].L; if (nd < dst[v] - EPS) { dst[v] = nd; prevE[v] = ei; } }
      }
    }
    const caminho = (id) => {
      const out = [];
      let cur = id, guard = 0;
      while (cur !== (qd && qd.id) && prevE[cur] != null && guard++ < 1000) { const e = E_[prevE[cur]]; out.push(prevE[cur]); cur = e.a === cur ? e.b : e.a; }
      return cur === (qd && qd.id) ? out : null;
    };
    R.caminho = caminho;
    R.distQD = dst;
    for (const d of nodes) {
      const rd = R.dev[d.id];
      rd.path = qd ? caminho(d.id) : null;
    }
    // caminho de cada ponto só pelos eletrodutos do seu próprio circuito
    if (qd && porCircuito) {
      for (const c of R.circ) {
        const ok = setCirc[c.id];
        const dc = {}, pe = {}, vis = new Set();
        for (const id of ok) dc[id] = Infinity;
        dc[qd.id] = 0;
        while (true) {
          let u = null, bu = Infinity;
          for (const id of ok) if (!vis.has(id) && dc[id] < bu) { bu = dc[id]; u = id; }
          if (u == null) break;
          vis.add(u);
          for (const [v, ei] of adj[u]) { if (!ok.has(v)) continue; const nd = dc[u] + E_[ei].L; if (nd < dc[v] - EPS) { dc[v] = nd; pe[v] = ei; } }
        }
        for (const id of ok) {
          if (id === qd.id) continue;
          const out = []; let cur = id, guard = 0;
          while (cur !== qd.id && pe[cur] != null && guard++ < 1000) { const e = E_[pe[cur]]; out.push(pe[cur]); cur = e.a === cur ? e.b : e.a; }
          if (cur === qd.id) R.dev[id].path = out; // senão mantém o caminho geral (rotas manuais antigas)
        }
      }
    }
    for (const d of nodes) { const rd = R.dev[d.id]; if (qd && d.id !== qd.id && !rd.path) rd.semRota = true; }
    // uso das arestas pelos circuitos
    for (const c of R.circ) {
      const set = new Set();
      for (const id of c.devs.concat(c.cmds || [])) { const p = R.dev[id].path; if (p) p.forEach((ei) => set.add(ei)); }
      c.edges = [...set];
      c.edges.forEach((ei) => E_[ei].circs.add(c.id));
      // retornos: interruptor → luz pelo caminho da árvore
      c.retornos = [];
      for (const sid of c.cmds || []) {
        const s = P.dev.find((d) => d.id === sid), rs = R.dev[sid];
        if (!rs.luz) continue;
        const pa = R.dev[sid].path || [], pb = R.dev[rs.luz].path || [];
        const sa = new Set(pa), sb = new Set(pb);
        const trecho = pa.filter((e) => !sb.has(e)).concat(pb.filter((e) => !sa.has(e)));
        const nCond = s.k === 'int1' ? 1 : 2;
        const L = trecho.reduce((t, ei) => t + E_[ei].L, 0) + rs.drop + R.dev[rs.luz].drop;
        trecho.forEach((ei) => E_[ei].ret.push({ c: c.id, n: nCond }));
        c.retornos.push({ s: sid, n: nCond, L });
      }
    }
    for (const e of E_) {
      const n = e.circs.size;
      e.k = Math.max(1, Math.ceil(n / Math.max(1, par.maxCircEletr)));
      e.grp = n ? Math.ceil(n / e.k) : 0;
    }
  }

  /* ------------------------------------------------------------------ */
  E.iz = function (metodo, S, carregados) {
    const t = E.IZ[metodo] || E.IZ.B1;
    return t[S] ? t[S][carregados >= 3 ? 1 : 0] : 0;
  };

  function dimensionarAlimentador(P, R, issue) {
    const par = P.par, en = R.entrada;
    const med = P.dev.find((d) => d.k === 'med');
    const qd = P.dev.find((d) => d.k === 'qdc');
    let L = par.alimComp;
    if (!(L > 0)) L = med && qd ? Math.abs(med.x - qd.x) + Math.abs(med.y - qd.y) + 1.5 + (R.dev[qd.id] ? R.dev[qd.id].drop : 1.3) : 15;
    const fases = en.fases;
    const fatorDem = en.C > 0 ? Math.min(1, en.D / (en.C / 0.92)) : 1;
    const iBal = (en.D * 1000) / (par.vfn * fases);
    const maxFase = Math.max(en.cargaFase.A, en.cargaFase.B, en.cargaFase.C) * fatorDem / par.vfn;
    const Ib = Math.max(iBal, maxFase);
    const inPadrao = en.cat.disj;
    let inQD = E.DISJ.find((x) => x >= Ib - EPS) || inPadrao;
    let avisoQD = null;
    if (inQD > inPadrao) { avisoQD = `Corrente de demanda (${Ib.toFixed(1)} A) acima do disjuntor do padrão (${inPadrao} A).`; inQD = inPadrao; }
    const carreg = fases === 1 ? 2 : 3;
    const solo = par.alimMetodo === 'D';
    const fct = E.fct(par.tAmb, solo && false);
    const k = fases === 1 ? 2 : 1;
    let S = null, dv = null;
    const ramalMin = en.cat.ramal || 0;
    for (const s of E.SECOES) {
      if (s < 4 || s < ramalMin) continue;
      const iz = E.iz(par.alimMetodo, s, carreg) * fct;
      if (iz + EPS < inPadrao) continue;
      const d = ((k * par.rho * L * Ib) / s) / par.vfn * 100;
      if (d > par.dvAlim + EPS && s < 120) continue;
      S = s; dv = d; break;
    }
    if (!S) { S = 120; dv = ((k * par.rho * L * Ib) / S) / par.vfn * 100; }
    R.alim = { L, Ib, inPadrao, inQD, S, pe: E.peSecao(S), neutro: S, dv, fases, iz: E.iz(par.alimMetodo, S, carreg) * fct, avisoQD, fatorDem };
    if (avisoQD) issue('aviso', 'NBR 5410 5.3.4', avisoQD);
    R.dvTermLim = Math.min(par.dvTerm, par.dvTotal - dv);
  }

  function dimensionarCircuito(P, R, c, issue) {
    const par = P.par;
    const E_ = R.edges;
    c.ib = c.va / c.v;
    c.fct = E.fct(par.tAmb);
    c.nGrupo = Math.max(1, ...c.edges.map((ei) => E_[ei].grp));
    c.fca = E.fca(c.nGrupo);
    const qdDrop = R.qd ? R.dev[R.qd].drop : 0;
    // corrente por aresta (soma das cargas a jusante)
    const ie = {};
    for (const id of c.devs) { const p = R.dev[id].path; if (!p) continue; for (const ei of p) ie[ei] = (ie[ei] || 0) + R.dev[id].va / c.v; }
    const dvPara = (S) => {
      let max = 0, alvo = null;
      for (const id of c.devs) {
        const p = R.dev[id].path; if (!p) continue;
        let s = qdDrop * c.ib + R.dev[id].drop * (R.dev[id].va / c.v);
        for (const ei of p) s += E_[ei].L * ie[ei];
        const dvp = (2 * par.rho * s / S) / c.v * 100;
        if (dvp > max) { max = dvp; alvo = id; }
      }
      return { max, alvo };
    };
    c.comp = (qdDrop + c.edges.reduce((t, ei) => t + E_[ei].L, 0) + c.devs.concat(c.cmds || []).reduce((t, id) => t + R.dev[id].drop, 0)) * (1 + par.sobra / 100);
    c.retM = (c.retornos || []).reduce((t, r) => t + r.L * r.n, 0) * (1 + par.sobra / 100);
    const sMin = c.tipo === 'ilum' ? 1.5 : 2.5;
    const inDisj = E.DISJ.find((x) => x >= c.ib - EPS);
    c.disj = inDisj;
    c.ok = false;
    const lim = R.dvTermLim;
    for (const S of E.SECOES) {
      if (S < sMin) continue;
      const izc = E.iz(par.metodo, S, 2) * c.fct * c.fca;
      if (!inDisj || inDisj > izc + EPS) continue;
      const dv = dvPara(S);
      if (dv.max > lim + EPS) continue;
      c.secao = S; c.iz = izc; c.dv = dv.max; c.dvAlvo = dv.alvo; c.ok = true; break;
    }
    if (!c.ok) {
      c.secao = 120; c.iz = E.iz(par.metodo, 120, 2) * c.fct * c.fca; const dv = dvPara(120); c.dv = dv.max; c.dvAlvo = dv.alvo;
      issue('erro', 'NBR 5410 6.2.5 / 6.2.7', `${c.id}: nenhuma seção atende simultaneamente à capacidade de condução e à queda de tensão. Divida o circuito ou aproxime o quadro.`, { tipo: 'circ', id: c.id });
    }
    c.pe = E.peSecao(c.secao);
    c.secaoMinima = sMin;
    c.drIn = c.dr ? (E.DR.find((x) => x >= c.disj) || 100) : null;
    c.semRota = c.devs.some((id) => !R.dev[id].path);
    // condutores por circuito: F + N + PE (127 V) ou F + F + PE (220 V)
    c.nCond = 3;
  }

  function areaCabo(S) { const d = E.DIAM[S] || 4; return Math.PI * d * d / 4; }
  function escolherEletroduto(area, n) {
    const taxa = n >= 3 ? 0.4 : n === 2 ? 0.31 : 0.53;
    for (const el of E.ELETRODUTOS) { if (area <= taxa * Math.PI * el.di * el.di / 4 + EPS) return el; }
    return null;
  }
  function dimensionarEletrodutos(P, R) {
    const byC = {};
    for (const c of R.circ) byC[c.id] = c;
    for (const e of R.edges) {
      let area = 0, n = 0;
      for (const cid of e.circs) { const c = byC[cid]; area += 3 * areaCabo(c.secao); n += 3; }
      for (const r of e.ret) { const c = byC[r.c]; area += r.n * areaCabo(c.secao); n += r.n; }
      const k = e.k || 1;
      e.area = area / k; e.nCond = Math.ceil(n / k);
      e.el = n ? escolherEletroduto(e.area, e.nCond) : E.ELETRODUTOS[0];
      e.excede = n > 0 && !e.el;
      if (!e.el) e.el = E.ELETRODUTOS[E.ELETRODUTOS.length - 1];
    }
    // descidas
    R.descidas = [];
    for (const d of P.dev) {
      const rd = R.dev[d.id];
      if (!rd || d.k === 'porta' || d.k === 'med' || d.k === 'luz' || rd.drop <= 0) continue;
      if (d.k === 'qdc') {
        const n = R.circ.length;
        const k = Math.max(1, Math.ceil(n / Math.max(1, P.par.maxCircEletr)));
        let area = 0; R.circ.forEach((c) => { area += 3 * areaCabo(c.secao); });
        const el = escolherEletroduto(area / k, Math.ceil(3 * n / k)) || E.ELETRODUTOS[E.ELETRODUTOS.length - 1];
        R.descidas.push({ id: d.id, L: rd.drop, k, el });
        continue;
      }
      const c = byC[rd.circ];
      if (!c) { R.descidas.push({ id: d.id, L: rd.drop, k: 1, el: E.ELETRODUTOS[0] }); continue; }
      let area = 3 * areaCabo(c.secao), n = 3;
      if (d.k.startsWith('int')) { const r = (c.retornos || []).find((x) => x.s === d.id); if (r) { area += r.n * areaCabo(c.secao); n += r.n; } }
      R.descidas.push({ id: d.id, L: rd.drop, k: 1, el: escolherEletroduto(area, n) || E.ELETRODUTOS[0] });
    }
  }

  function montarQuadro(P, R) {
    const par = P.par;
    const nC = R.circ.length;
    let mod = 0;
    for (const c of R.circ) { mod += c.polos; if (c.dr) mod += 2; }
    const fases = R.entrada.fases;
    mod += fases; // disjuntor geral do QD
    if (par.dpsQd) mod += fases + 1;
    const reserva = E.reservaQD(nC);
    const total = mod + reserva;
    const tam = [12, 18, 24, 36, 48, 56, 72].find((x) => x >= total) || 72;
    R.quadro = { modulos: mod, reserva, total, tamanho: tam, nCirc: nC };
  }

  /* ------------------------------------------------------------------ */
  /* NBR 5419 — pré-avaliação de R1 e parâmetros do SPDA                   */
  /* ------------------------------------------------------------------ */
  E.SPDA_CLASSES = {
    I: { r: 20, malha: 5, desc: 10, pb: 0.02 }, II: { r: 30, malha: 10, desc: 10, pb: 0.05 },
    III: { r: 45, malha: 15, desc: 15, pb: 0.1 }, IV: { r: 60, malha: 20, desc: 20, pb: 0.2 }
  };
  E.PEB = { nenhum: 1, 'III-IV': 0.05, II: 0.02, I: 0.01 };
  E.spda = function (P, R) {
    const s = P.spda;
    let bb = null;
    if (P.amb.length) {
      const x0 = Math.min(...P.amb.map((a) => a.x)), y0 = Math.min(...P.amb.map((a) => a.y));
      const x1 = Math.max(...P.amb.map((a) => a.x + a.w)), y1 = Math.max(...P.amb.map((a) => a.y + a.h));
      bb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const L = s.L > 0 ? +s.L : bb ? bb.w : 10, W = s.W > 0 ? +s.W : bb ? bb.h : 10, H = +s.h || 4.5;
    const AD = L * W + 2 * 3 * H * (L + W) + Math.PI * (3 * H) ** 2;
    const out = { L, W, H, AD, bb };
    if (!(s.ng > 0)) { out.semNg = true; return out; }
    const ND = s.ng * AD * s.cd * 1e-6;
    const AL = 40 * s.ll, NL = s.ng * AL * s.ci * s.ce * 1e-6;
    const LA = s.rt * s.lt, LB = s.rp * s.rf * s.hz * s.lf;
    const calc = (classe, dps) => {
      const PB = classe === 'nenhum' ? 1 : E.SPDA_CLASSES[classe].pb;
      const PEB = E.PEB[dps];
      const RA = ND * s.pta * PB * LA, RB = ND * PB * LB, RU = NL * PEB * LA, RV = NL * PEB * LB;
      return { RA, RB, RU, RV, R1: RA + RB + RU + RV };
    };
    const atual = calc(s.classe, s.dps);
    let rec = null;
    for (const cl of ['nenhum', 'IV', 'III', 'II', 'I']) {
      for (const dp of ['II', 'I']) { const r = calc(cl, dp); if (r.R1 <= 1e-5) { rec = { classe: cl, dps: dp, R1: r.R1 }; break; } }
      if (rec) break;
    }
    Object.assign(out, { ND, NL, AL, LA, LB, ...atual, RT: 1e-5, necessario: atual.R1 > 1e-5, rec });
    if (s.classe !== 'nenhum') {
      const k = E.SPDA_CLASSES[s.classe];
      const per = 2 * (L + W);
      out.geo = {
        raio: k.r, malha: k.malha, espDesc: k.desc,
        nDesc: Math.max(2, Math.ceil(per / k.desc - EPS)),
        captacao: (Math.floor(L / k.malha + EPS) + 1) * W + (Math.floor(W / k.malha + EPS) + 1) * L + per,
        anel: 2 * (L + 2 + W + 2),
        descidas: Math.max(2, Math.ceil(per / k.desc - EPS)) * (H + 0.5)
      };
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  function verificar(P, R, ambById, issue) {
    const par = P.par;
    const qds = P.dev.filter((d) => d.k === 'qdc');
    const meds = P.dev.filter((d) => d.k === 'med');
    if (!qds.length) issue('erro', 'NBR 5410 6.5.4', 'Insira o quadro de distribuição (QDC) na planta: sem ele não há como rotear e dimensionar os circuitos.');
    if (qds.length > 1) issue('aviso', 'Projeto', 'Mais de um QDC: este ambiente dimensiona um único quadro; os demais são ignorados no roteamento.', { tipo: 'dev', id: qds[1].id });
    if (!meds.length) issue('aviso', 'GED-13 6.14', 'Insira o padrão de entrada (medição) no limite do terreno com a via pública.');
    for (const q of qds) {
      const a = ambById[R.dev[q.id].amb];
      if (a && E.tipoAmb(a.tipo).chuveiro) issue('erro', 'NBR 5410 9.1', 'O QDC está em banheiro: instale-o em local seco e de fácil acesso.', { tipo: 'dev', id: q.id });
    }
    for (const m of meds) {
      const a = ambById[R.dev[m.id].amb];
      if (a && ['cozinha', 'copa', 'banheiro', 'lavabo'].includes(a.tipo)) issue('erro', 'GED-13 6.14.1', 'A medição não pode ficar em cozinha, copa ou dependência sanitária.', { tipo: 'dev', id: m.id });
    }
    // ambientes
    for (const a of P.amb) {
      const ra = R.amb[a.id];
      if (!ra.tipo.semLuzMin && ra.nLuz === 0) issue('erro', 'NBR 5410 9.5.2.1.1', `${a.nome}: falta ponto de luz (mínimo 1 por cômodo).`, { tipo: 'amb', id: a.id });
      if (ra.nTug < ra.tugMin) issue('erro', 'NBR 5410 9.5.2.2.1', `${a.nome}: ${ra.nTug} de ${ra.tugMin} tomadas mínimas (${E.regraTug(a.tipo)}).`, { tipo: 'amb', id: a.id });
      if (ra.nLuz > 0 && ra.ilumVA + EPS < ra.ilumMin) issue('aviso', 'NBR 5410 9.5.2.1.2', `${a.nome}: iluminação prevista ${ra.ilumVA} VA, mínimo ${ra.ilumMin} VA.`, { tipo: 'amb', id: a.id });
      if (a.w < 0.3 || a.h < 0.3) issue('aviso', 'Modelo', `${a.nome}: dimensões muito pequenas.`, { tipo: 'amb', id: a.id });
    }
    // sobreposição de ambientes
    for (let i = 0; i < P.amb.length; i++) for (let j = i + 1; j < P.amb.length; j++) {
      const a = P.amb[i], b = P.amb[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.05 && oy > 0.05) issue('aviso', 'Modelo (conflito)', `${a.nome} e ${b.nome} se sobrepõem (${(ox * oy).toFixed(2)} m²).`, { tipo: 'amb', id: b.id });
    }
    // elementos
    const luzes = P.dev.filter((d) => d.k === 'luz' || d.k === 'arandela');
    for (const d of P.dev) {
      const rd = R.dev[d.id];
      const K = E.KINDS[d.k] || {};
      if (!rd.amb && !['med', 'porta'].includes(d.k)) issue('aviso', 'Modelo', `${K.n || d.k} fora de qualquer ambiente.`, { tipo: 'dev', id: d.id });
      if (K.mount === 'parede' && rd.amb && !rd.nrm && !['med', 'porta'].includes(d.k)) issue('info', 'Modelo', `${K.n} não está sobre uma parede (arraste até a parede para fixar).`, { tipo: 'dev', id: d.id });
      if (rd.semRota) issue('erro', 'Roteamento', `${K.n} sem eletroduto até o QDC.`, { tipo: 'dev', id: d.id });
      if ((d.k === 'luz' || d.k === 'arandela') && !P.dev.some((s) => s.k.startsWith('int') && R.dev[s.id].luz && (P.dev.find((x) => x.id === R.dev[s.id].luz) || {}).cmd === d.cmd && d.cmd)) {
        issue('aviso', 'NBR 5410 9.5.2.1.1', `Ponto de luz${d.cmd ? ' "' + d.cmd + '"' : ''} sem interruptor associado (mesma letra de comando).`, { tipo: 'dev', id: d.id });
      }
      if (d.k.startsWith('int') && !rd.luz) issue('aviso', 'Projeto', 'Interruptor sem ponto de luz associado.', { tipo: 'dev', id: d.id });
      if (d.k === 'tug' && rd.amb) {
        const a = ambById[rd.amb];
        if (a && E.tipoAmb(a.tipo).chuveiro) {
          for (const ch of P.dev.filter((x) => x.k === 'tue' && ['chuveiro', 'hidro'].includes(x.tipo) && R.dev[x.id].amb === a.id)) {
            if (dist(ch, d) < 0.6) issue('erro', 'NBR 5410 9.1 (volumes)', `Tomada a ${dist(ch, d).toFixed(2)} m do chuveiro: fora dos volumes 0, 1 e 2 exige-se ao menos 0,60 m.`, { tipo: 'dev', id: d.id });
          }
        }
      }
      if (d.k === 'tue') {
        const pr = E.TUE[d.tipo] || E.TUE.outro;
        const v = rd.v;
        if (v !== par.vfn && v !== par.vff) issue('erro', 'Projeto', `${pr.n}: tensão ${v} V incompatível com o sistema ${par.vfn}/${par.vff} V.`, { tipo: 'dev', id: d.id });
      }
    }
    for (let i = 0; i < P.dev.length; i++) for (let j = i + 1; j < P.dev.length; j++) {
      const a = P.dev[i], b = P.dev[j];
      if (a.k === 'porta' || b.k === 'porta') continue;
      const na = R.dev[a.id].nrm, nb = R.dev[b.id].nrm;
      if (na && nb && na[0] * nb[0] + na[1] * nb[1] < -0.5) continue; // lados opostos da parede
      if (dist(a, b) < 0.12 && Math.abs(R.dev[a.id].h - R.dev[b.id].h) < 0.2) issue('aviso', 'Modelo (conflito)', `${E.KINDS[a.k].n} e ${E.KINDS[b.k].n} ocupam o mesmo lugar.`, { tipo: 'dev', id: b.id });
    }
    // circuitos
    for (const c of R.circ) {
      if (c.tipo === 'misto') {
        if (c.ib > 16 + EPS) issue('erro', 'NBR 5410 9.5.3.4', `${c.id}: circuito comum (iluminação + tomadas) com Ib = ${c.ib.toFixed(1)} A > 16 A.`, { tipo: 'circ', id: c.id });
        else issue('aviso', 'NBR 5410 4.2.5.5 / 9.5.3.4', `${c.id}: iluminação e tomadas no mesmo circuito; só é admitido nas condições da 9.5.3.4.`, { tipo: 'circ', id: c.id });
      }
      if (c.manual) {
        const tem = c.devs.map((id) => P.dev.find((x) => x.id === id));
        const excl = tem.filter((d) => d.k === 'tug' && ambById[R.dev[d.id].amb] && E.tipoAmb(ambById[R.dev[d.id].amb].tipo).exclusivo);
        if (excl.length && excl.length < tem.length) issue('erro', 'NBR 5410 9.5.3.3', `${c.id}: tomadas de cozinha/copa/área de serviço devem ter circuito exclusivo.`, { tipo: 'circ', id: c.id });
        const tue = tem.filter((d) => d.k === 'tue' && R.dev[d.id].va / R.dev[d.id].v > 10);
        if (tue.length && tem.length > 1) issue('erro', 'NBR 5410 9.5.3.2', `${c.id}: equipamento com corrente acima de 10 A exige circuito independente.`, { tipo: 'circ', id: c.id });
      }
      if (c.ok && c.dv > par.dvTerm - 0.5) issue('info', 'NBR 5410 6.2.7', `${c.id}: queda de tensão ${c.dv.toFixed(2)} % próxima do limite.`, { tipo: 'circ', id: c.id });
    }
    for (const e of R.edges) if (e.excede) issue('aviso', 'NBR 5410 6.2.11.1.6', `Trecho de eletroduto com ${e.nCond} condutores excede a taxa de ocupação do maior diâmetro: divida o trecho.`, { tipo: 'edge', id: e.id });
    const en = R.entrada;
    for (const n of en.notas) issue('info', 'GED-13', n);
    for (const a of en.ajustes) issue('info', 'GED-13 6.23', a);
    if (en.fases > 1 && en.desequilibrio > 20) issue('aviso', 'Projeto', `Desequilíbrio entre fases de ${en.desequilibrio.toFixed(0)} %: redistribua circuitos.`);
    if (R.alim.dv + Math.max(0, ...R.circ.map((c) => c.dv || 0)) > par.dvTotal + EPS) issue('erro', 'NBR 5410 6.2.7', 'Queda de tensão total (alimentador + circuito terminal) acima do limite.');
    // SPDA
    const sp = R.spda;
    if (sp.semNg) issue('aviso', 'NBR 5419-2:2026', 'Informe a densidade de descargas NG do município (tabela da NBR 5419-2:2026) para avaliar o risco R1.', { tipo: 'aba', id: 'spda' });
    else if (sp.necessario) issue('erro', 'NBR 5419-2:2026', `Risco R1 estimado ${sp.R1.toExponential(2)} acima do tolerável (1×10⁻⁵): ${sp.rec ? 'adote SPDA classe ' + sp.rec.classe + ' e DPS ' + sp.rec.dps : 'reveja as medidas de proteção'}.`, { tipo: 'aba', id: 'spda' });
    // NR-10
    const pend = E.NR10.filter((it) => !it.auto && !P.nr10[E.nrKey(it.id)]).length;
    if (pend) issue('info', 'NR-10 10.3', `${pend} itens de segurança em projeto aguardam confirmação na aba NR-10.`, { tipo: 'aba', id: 'nr10' });
  }

  /* ------------------------------------------------------------------ */
  /* NR-10 — segurança em projetos (item 10.3, texto vigente)              */
  /* ------------------------------------------------------------------ */
  E.nrKey = (id) => 'i' + String(id).replace(/\./g, '_');
  E.NR10 = [
    { id: '10.3.1', t: 'Dispositivos de desligamento dos circuitos com recurso para impedir a reenergização e sinalização da condição operativa.', auto: true },
    { id: '10.3.2', t: 'Dispositivo de seccionamento de ação simultânea que permita bloqueio (disjuntor geral do QDC e do padrão).', auto: true },
    { id: '10.3.3', t: 'Espaço seguro de operação e manutenção junto ao QDC e ao padrão, considerando influências externas.' },
    { id: '10.3.4', t: 'Esquema de aterramento definido, inclusive interligação neutro–terra e aterramento das massas.', auto: true },
    { id: '10.3.5', t: 'Seccionamento com recursos de equipotencialização e aterramento do circuito seccionado, quando viável.' },
    { id: '10.3.6', t: 'Condições para instalação de aterramento temporário (barramento de terra acessível no QDC).' },
    { id: '10.3.7', t: 'Projeto atualizado à disposição dos trabalhadores autorizados e das autoridades.' },
    { id: '10.3.9', t: 'Memorial descritivo com proteção contra choques, identificação dos circuitos e posição dos dispositivos de manobra.', auto: true },
    { id: '10.3.10', t: 'Iluminação adequada e posição de trabalho segura no acesso ao QDC e ao padrão de entrada.' }
  ];

  /* ------------------------------------------------------------------ */
  function quantitativos(P, R) {
    const par = P.par;
    const itens = [];
    const add = (grupo, item, unid, qtd, obs, pk) => { if (qtd > 0) itens.push({ grupo, item, unid, qtd, obs: obs || '', pk: pk || null }); };
    // cabos
    const cabos = {};
    const cab = (S, f, m) => { const k = S + '|' + f; cabos[k] = (cabos[k] || 0) + m; };
    for (const c of R.circ) {
      if (c.v === par.vfn) { cab(c.secao, 'Fase (preto)', c.comp); cab(c.secao, 'Neutro (azul-claro)', c.comp); }
      else { cab(c.secao, 'Fase (preto)', c.comp); cab(c.secao, 'Fase (vermelho)', c.comp); }
      cab(c.pe, 'Proteção PE (verde-amarelo)', c.comp);
      if (c.retM) cab(c.secao, 'Retorno (cinza)', c.retM);
    }
    const al = R.alim;
    const Lal = al.L * (1 + par.sobra / 100);
    cab(al.S, 'Fase (preto)', Lal * al.fases);
    cab(al.S, 'Neutro (azul-claro)', Lal);
    cab(al.pe, 'Proteção PE (verde-amarelo)', Lal);
    for (const k of Object.keys(cabos).sort((a, b) => parseFloat(a) - parseFloat(b))) {
      const [S, f] = k.split('|');
      add('Condutores', `Cabo flexível cobre 450/750 V ${String(S).replace('.', ',')} mm² — ${f}`, 'm', Math.ceil(cabos[k]), '', 'cabo:' + S);
    }
    // eletrodutos
    const ele = {};
    for (const e of R.edges) { if (!e.circs.size && !e.ret.length) continue; const k = e.el.dn; ele[k] = (ele[k] || 0) + e.L * e.k; }
    for (const d of R.descidas) { const k = d.el.dn; ele[k] = (ele[k] || 0) + d.L * d.k; }
    for (const dn of Object.keys(ele).sort((a, b) => a - b)) {
      const el = E.ELETRODUTOS.find((x) => x.dn === +dn);
      add('Eletrodutos', `Eletroduto PVC corrugado DN ${dn} (${el.pol})`, 'm', Math.ceil(ele[dn] * (1 + par.sobra / 100)), '', 'ele:' + dn);
    }
    add('Eletrodutos', `Eletroduto do alimentador medição → QDC (dimensionar para ${al.fases + 2} cabos de ${String(al.S).replace('.', ',')} mm²)`, 'm', Math.ceil(Lal), '', 'ele:alim');
    // caixas e dispositivos
    const cont = (f) => P.dev.filter(f).length;
    const nParede = cont((d) => ['int1', 'int2', 'int3', 'tug', 'tue', 'arandela'].includes(d.k));
    const deg = {};
    for (const e of R.edges) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; }
    const nPass = P.dev.filter((d) => !['luz', 'qdc', 'med', 'porta'].includes(d.k) && (deg[d.id] || 0) >= 2).length;
    add('Caixas', 'Caixa de luz 4×2" PVC (parede)', 'un', nParede, '', 'cx42');
    add('Caixas', 'Caixa octogonal 4×4" PVC (laje) — pontos de luz', 'un', cont((d) => d.k === 'luz'), '', 'cx44');
    add('Caixas', 'Caixa octogonal 4×4" PVC (laje) — passagem/derivação', 'un', nPass, '', 'cx44');
    add('Dispositivos', 'Interruptor simples 10 A 250 V', 'un', cont((d) => d.k === 'int1'), '', 'int1');
    add('Dispositivos', 'Interruptor paralelo 10 A 250 V', 'un', cont((d) => d.k === 'int2'), '', 'int2');
    add('Dispositivos', 'Interruptor intermediário 10 A 250 V', 'un', cont((d) => d.k === 'int3'), '', 'int3');
    let t10 = 0, t20 = 0, tue20 = 0, direta = 0;
    for (const d of P.dev) {
      const rd = R.dev[d.id]; const c = R.circ.find((x) => x.id === rd.circ);
      if (d.k === 'tug') { if (c && c.disj > 10) t20++; else t10++; }
      if (d.k === 'tue') { const pr = E.TUE[d.tipo] || E.TUE.outro; if (pr.plug) tue20++; else direta++; }
    }
    add('Dispositivos', 'Tomada 2P+T 10 A (NBR 14136)', 'un', t10, '', 'tom10');
    add('Dispositivos', 'Tomada 2P+T 20 A (NBR 14136) — TUG em circuito com disjuntor > 10 A', 'un', t20, '', 'tom20');
    add('Dispositivos', 'Tomada 2P+T 20 A (NBR 14136) — uso específico', 'un', tue20, '', 'tom20');
    add('Dispositivos', 'Conector/borne para ligação direta de equipamento (chuveiro, ar, etc.)', 'un', direta, '', 'borne');
    add('Dispositivos', 'Placa 4×2" para interruptor/tomada', 'un', nParede, '', 'placa');
    add('Iluminação', 'Luminária/lâmpada LED — ponto de teto (potência conforme projeto luminotécnico)', 'un', cont((d) => d.k === 'luz'), '', 'luz');
    add('Iluminação', 'Arandela LED', 'un', cont((d) => d.k === 'arandela'), '', 'arandela');
    // proteção
    const disj = {};
    for (const c of R.circ) { const k = `${c.polos}|${c.disj}`; disj[k] = (disj[k] || 0) + 1; }
    for (const k of Object.keys(disj).sort((a, b) => { const [pa, ia] = a.split('|').map(Number), [pb, ib] = b.split('|').map(Number); return pa - pb || ia - ib; })) {
      const [p, i] = k.split('|');
      add('Proteção (QDC)', `Disjuntor termomagnético DIN ${p}P curva ${par.curva} ${i} A, Icn ≥ 4,5 kA (confirmar Icc presumida)`, 'un', disj[k], '', `disj:${p}:${i}`);
    }
    const drs = {};
    for (const c of R.circ) if (c.dr) drs[c.drIn] = (drs[c.drIn] || 0) + 1;
    for (const k of Object.keys(drs).sort((a, b) => a - b)) add('Proteção (QDC)', `Interruptor diferencial residual (IDR) 2P ${k} A, IΔn 30 mA`, 'un', drs[k], '', 'idr:' + k);
    add('Proteção (QDC)', `Disjuntor geral do QDC ${R.entrada.fases}P ${al.inQD} A`, 'un', 1, '', `disj:${R.entrada.fases}:${al.inQD}`);
    if (par.dpsQd) add('Proteção (QDC)', 'DPS classe II, Uc 175 V, In ≥ 5 kA, Imáx ≥ 12 kA, Up ≤ 1,5 kV (fases e neutro)', 'un', R.entrada.fases + 1, '', 'dps2');
    add('Quadro', `Quadro de distribuição de embutir ${R.quadro.tamanho} módulos DIN, barramentos de fase, neutro e terra`, 'un', 1, '', 'qd:' + R.quadro.tamanho);
    // padrão de entrada
    const G = E.GED.dps;
    add('Padrão de entrada (GED-13)', `Disjuntor termomagnético geral ${R.entrada.fases}P ${al.inPadrao} A, Icn ≥ ${E.GED.icnKA} kA, classe 250 V`, 'un', 1, '', `disj:${R.entrada.fases}:${al.inPadrao}`);
    add('Padrão de entrada (GED-13)', `DPS classe ${G.classe}, ${G.uc} V, In ≥ ${G.inKA} kA, Imáx ≥ ${G.imaxKA} kA, Up ≤ ${String(G.upKV).replace('.', ',')} kV, com indicador de estado`, 'un', R.entrada.fases, '', 'dps2');
    add('Padrão de entrada (GED-13)', `Poste, caixa de medição, ramal de entrada e aterramento — categoria ${R.entrada.cat.c} (Tabela 1A)`, 'cj', 1, '', 'padrao:' + R.entrada.cat.c);
    add('Aterramento', 'Haste de aterramento aço-cobre (padrão de entrada, GED-13 Desenho 12)', 'un', 1, '', 'haste');
    add('Aterramento', 'Barramento de equipotencialização principal (BEP)', 'un', 1, '', 'bep');
    // SPDA
    const sp = R.spda;
    if (sp.geo) {
      add('SPDA (NBR 5419-3)', `Condutor de captação em malha ${sp.geo.malha}×${sp.geo.malha} m (cobre 35 mm² ou equivalente)`, 'm', Math.ceil(sp.geo.captacao), '', 'nu:35');
      add('SPDA (NBR 5419-3)', `Descidas (${sp.geo.nDesc} un, espaçamento ≤ ${sp.geo.espDesc} m)`, 'm', Math.ceil(sp.geo.descidas), '', 'nu:35');
      add('SPDA (NBR 5419-3)', 'Anel de aterramento a ~1 m das fundações (cobre nu 50 mm² ou equivalente)', 'm', Math.ceil(sp.geo.anel), '', 'nu:50');
      add('SPDA (NBR 5419-3)', 'Caixa de inspeção e conector de medição nas descidas', 'un', sp.geo.nDesc, '', 'cxinsp');
      add('SPDA (NBR 5419-4)', 'DPS classe I na entrada da linha (coordenado com o classe II)', 'un', R.entrada.fases + 1, '', 'dps1');
    }
    return itens;
  }



  /* ------------------------------------------------------------------ */
  /* Eletrodutos que passam pela parede: atravessam (furo/rasgo) ou      */
  /* correm por dentro dela. Vãos de porta não contam.                   */
  /* ------------------------------------------------------------------ */
  function paredesNosEletrodutos(P, R) {
    const byId = {}; for (const d of P.dev) byId[d.id] = d;
    const walls = [];
    for (const a of P.amb) {
      walls.push({ o: 'h', c: a.y, a: a.x, b: a.x + a.w }, { o: 'h', c: a.y + a.h, a: a.x, b: a.x + a.w });
      walls.push({ o: 'v', c: a.x, a: a.y, b: a.y + a.h }, { o: 'v', c: a.x + a.w, a: a.y, b: a.y + a.h });
    }
    for (const w of P.paredes || []) {
      if (E.paredeOrient(w) === 'h') walls.push({ o: 'h', c: w.y1, a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2) });
      else walls.push({ o: 'v', c: w.x1, a: Math.min(w.y1, w.y2), b: Math.max(w.y1, w.y2) });
    }
    const portas = P.dev.filter((d) => d.k === 'porta');
    const naPorta = (o, c, m) => portas.some((d) => { const w = d.w || 0.8; return o === 'h' ? Math.abs(d.y - c) < 0.08 && Math.abs(d.x - m) < w / 2 : Math.abs(d.x - c) < 0.08 && Math.abs(d.y - m) < w / 2; });
    const TOL = 0.08, PONTA = 0.15;
    let nTrechos = 0;
    for (const e of R.edges) {
      e.cruza = []; e.naParede = 0;
      if (!e.circs.size && !e.ret.length) continue;
      const A = byId[e.a], B = byId[e.b]; if (!A || !B) continue;
      for (const w of walls) {
        const pa = w.o === 'h' ? A.y : A.x, pb = w.o === 'h' ? B.y : B.x; // coordenada perpendicular à parede
        const qa = w.o === 'h' ? A.x : A.y, qb = w.o === 'h' ? B.x : B.y; // ao longo da parede
        // corre por dentro da parede
        if (Math.abs(pa - w.c) < TOL && Math.abs(pb - w.c) < TOL) {
          const lo = Math.max(Math.min(qa, qb), w.a), hi = Math.min(Math.max(qa, qb), w.b);
          if (hi - lo > 0.1) e.naParede = Math.max(e.naParede, hi - lo);
          continue;
        }
        // atravessa a parede
        if ((pa - w.c) * (pb - w.c) >= 0) continue;
        const t = (w.c - pa) / (pb - pa), m = qa + t * (qb - qa);
        if (m < w.a + 0.1 || m > w.b - 0.1) continue; // fora da parede ou no encontro de paredes (canto / T)
        const x = w.o === 'h' ? m : w.c, y = w.o === 'h' ? w.c : m;
        if (Math.hypot(x - A.x, y - A.y) < PONTA || Math.hypot(x - B.x, y - B.y) < PONTA) continue; // ponto preso na própria parede
        if (naPorta(w.o, w.c, m)) continue;
        if (e.cruza.some((p) => Math.hypot(p.x - x, p.y - y) < 0.2)) continue; // parede compartilhada por dois ambientes
        e.cruza.push({ x: +x.toFixed(3), y: +y.toFixed(3) });
      }
      if (e.cruza.length || e.naParede) nTrechos++;
    }
    R.resumo.nParede = nTrechos;
    R.resumo.nFuros = R.edges.reduce((t, e) => t + (e.cruza ? e.cruza.length : 0), 0);
  }

  /* ------------------------------------------------------------------ */
  /* Preços de referência (orçamento)                                     */
  /* SINAPI = custo de insumo, média nacional, Caixa — consultado em       */
  /* orcamentor.com em 28/10/2026 (referência 09/2026 salvo indicação).    */
  /* Lojas = preço de varejo na data da consulta.                          */
  /* ------------------------------------------------------------------ */
  const SIN = (cod, v, d) => ({ v, f: 'SINAPI ' + cod, d: d || '09/2026', url: 'https://orcamentor.com/insumo/' + cod + '/' });
  const SINC = (cod, v, d) => ({ v, f: 'SINAPI comp. ' + cod, d: d || '09/2026', url: 'https://orcamentor.com/composicao/' + cod + '/' });
  E.PRECOS = {
    consulta: '28/10/2026',
    fonte: 'SINAPI (Caixa) 09/2026 — custo médio nacional de insumos, via orcamentor.com; itens sem código SINAPI com preço de loja on-line.',
    cabo: { 1.5: SIN(1013, 1.73), 2.5: SIN(1014, 2.74), 4: SIN(981, 4.55), 6: SIN(982, 6.54), 10: SIN(980, 12.50), 16: SIN(979, 17.86), 25: SIN(39232, 27.97), 35: SIN(39233, 40.76) },
    ele: { 20: SIN(39243, 2.72), 25: SIN(39244, 3.68), 32: SIN(39245, 7.08), 40: Object.assign(SIN(12070, 5.76), { nota: 'referência: eletroduto PVC rígido 40 mm' }) },
    item: {
      cx42: SIN(1872, 2.01), cx44: SIN(12001, 5.20),
      int1: SIN(38062, 6.79), int2: SIN(38063, 9.25), int3: SIN(38065, 27.20),
      tom10: SIN(7528, 8.85), tom20: SIN(38075, 15.33),
      placa: { v: 0, f: 'incluída', d: '', nota: 'placa já incluída nos conjuntos montados de interruptor/tomada' },
      borne: { v: 14.97, f: 'Casas Bahia (Wago 221-612, kit 3 un R$ 44,90)', d: '10/2026', url: 'https://www.casasbahia.com.br/kit-c-3-conector-p-chuveiro-2p-221-612-41a-450v-wago/p/1571658770' },
      luz: Object.assign(SIN(39385, 9.07), { nota: 'plafon LED 12/13 W de sobrepor' }),
      arandela: Object.assign(SIN(38769, 50.11), { nota: 'arandela E27, sem lâmpada' }),
      dps2: SIN(39465, 62.40),
      haste: { v: 79.39, f: 'SINAPI 3380 + 425', d: '09/2026', url: 'https://orcamentor.com/insumo/3380/', nota: 'haste aço-cobre 5/8" × 3 m (R$ 72,73) + grampo (R$ 6,66)' },
      bep: { v: 49.90, f: 'Telhanorte (barramento terra Steck 11 terminais)', d: '10/2026', url: 'https://www.telhanorte.com.br/barramento-terra-11-terminais-89mm-verde-steck-1597841/p' },
      cxinsp: SIN(41480, 58.92, '07/2026'),
      'nu:35': SIN(863, 45.39), 'nu:50': SIN(867, 64.66)
    },
    // disjuntores: [polos, até In, preço]
    disj: [
      [1, 32, SIN(34653, 8.34)], [1, 50, SIN(34686, 12.36)], [1, 63, SIN(34688, 15.11)],
      [2, 32, SIN(34616, 47.80)], [2, 50, SIN(34623, 47.06)], [2, 63, SIN(34628, 67.41)], [2, 100, Object.assign(SIN(34606, 89.98, '07/2026'), { nota: 'referência: disjuntor NEMA bipolar 60–100 A' })],
      [3, 50, SIN(34709, 58.56)], [3, 63, SIN(34714, 69.94)], [3, 100, Object.assign(SIN(2373, 102.14), { nota: 'referência: disjuntor NEMA tripolar 60–100 A' })], [3, 125, SIN(2391, 319.44)]
    ],
    idr: { 25: SIN(39445, 128.40), 40: SIN(39446, 130.68), 63: SIN(39447, 139.75), 80: SIN(39448, 240.50, '07/2026'), 100: SIN(39459, 258.09, '07/2026') },
    qd: [[16, SIN(39805, 135.64)], [24, SIN(39806, 251.30)], [36, SIN(39807, 544.63)], [48, SIN(43100, 425.79)]],
    // padrão de entrada: composição SINAPI (sem poste) + poste duplo T 8 m 150 daN (insumo 41195, R$ 560,37)
    padrao: {
      1: { v: 1996.84 + 560.37, f: 'SINAPI comp. 101490 + insumo 41195', d: '09/2026', url: 'https://orcamentor.com/composicao/101490/', nota: 'entrada aérea monofásica (caixa, cabo 16 mm², disjuntor, materiais e mão de obra) + poste de concreto 8 m' },
      2: { v: 2335.43 + 560.37, f: 'SINAPI comp. 101498 + insumo 41195', d: '09/2026', url: 'https://orcamentor.com/composicao/101498/', nota: 'entrada aérea bifásica (caixa, cabo 16 mm², disjuntor, materiais e mão de obra) + poste de concreto 8 m' },
      3: { v: 2545.31 + 560.37, f: 'SINAPI comp. 101506 + insumo 41195', d: '09/2026', url: 'https://orcamentor.com/composicao/101506/', nota: 'entrada aérea trifásica, cabo 16 mm², + poste de concreto 8 m' },
      '3g': { v: 2914.76 + 560.37, f: 'SINAPI comp. 101508 + insumo 41195', d: '09/2026', url: 'https://orcamentor.com/composicao/101508/', nota: 'entrada aérea trifásica, cabo 35 mm², + poste de concreto 8 m' }
    }
  };
  E.precoRef = function (pk) {
    const T = E.PRECOS;
    if (!pk) return null;
    const [k, a, b] = String(pk).split(':');
    if (k === 'cabo') return T.cabo[+a] || null;
    if (k === 'ele') return a === 'alim' ? T.ele[32] : (T.ele[+a] || null);
    if (k === 'disj') { const r = T.disj.find((x) => x[0] === +a && +b <= x[1]); return r ? r[2] : null; }
    if (k === 'idr') return T.idr[+a] || null;
    if (k === 'qd') { const r = T.qd.find((x) => +a <= x[0]); return r ? r[1] : null; }
    if (k === 'padrao') { const c = E.GED.cat.find((x) => x.c === a); if (!c) return null; return c.fases < 3 ? T.padrao[c.fases] : (c.dMax > 38 ? T.padrao['3g'] : T.padrao[3]); }
    if (k === 'nu') return T.item['nu:' + a] || null;
    return T.item[k] || null;
  };
  E.orcamento = function (P, R) {
    const o = Object.assign({ ajuste: 0, mo: 0, bdi: 0 }, P.orc || {});
    const fator = 1 + (+o.ajuste || 0) / 100;
    const linhas = R.bom.map((b) => {
      const ref = E.precoRef(b.pk);
      const man = b.pk && P.precos && P.precos[b.pk] != null ? +P.precos[b.pk] : null;
      const unit = man != null ? man : ref ? +(ref.v * fator).toFixed(2) : null;
      return Object.assign({}, b, { ref, manual: man != null, unit, total: unit != null ? +(unit * b.qtd).toFixed(2) : null });
    });
    const material = linhas.reduce((s, l) => s + (l.total || 0), 0);
    const mo = material * (+o.mo || 0) / 100;
    const bdi = (material + mo) * (+o.bdi || 0) / 100;
    const grupos = [];
    for (const l of linhas) { let g = grupos.find((x) => x.n === l.grupo); if (!g) { g = { n: l.grupo, total: 0, it: [] }; grupos.push(g); } g.it.push(l); g.total += l.total || 0; }
    return { linhas, grupos, material, mo, bdi, total: material + mo + bdi, semPreco: linhas.filter((l) => l.unit == null), op: o };
  };


  /* ------------------------------------------------------------------ */
  /* Projeto exemplo — residência térrea, 2 dormitórios                    */
  /* ------------------------------------------------------------------ */
  E.exemplo = function () {
    const P = E.novoProjeto('Residência térrea — 2 dormitórios');
    P.meta = { cliente: 'Exemplo (substitua pelos dados do cliente)', endereco: 'Rua Exemplo, 100', municipio: 'Bauru/SP', responsavel: '', registro: '', art: '', obs: 'Projeto de exemplo para demonstração.' };
    const R_ = (nome, tipo, x, y, w, h) => { const a = { id: uid('a'), nome, tipo, x, y, w, h }; P.amb.push(a); return a; };
    const d1 = R_('Dormitório 1', 'dormitorio', 0, 0, 3.4, 3.2);
    const ban = R_('Banheiro', 'banheiro', 3.4, 0, 2.0, 2.2);
    const d2 = R_('Dormitório 2', 'dormitorio', 5.4, 0, 3.2, 3.2);
    const cir = R_('Circulação', 'circulacao', 3.4, 2.2, 2.0, 1.0);
    const sala = R_('Sala de estar/jantar', 'sala', 0, 3.2, 4.6, 4.0);
    const coz = R_('Cozinha', 'cozinha', 4.6, 3.2, 4.0, 3.0);
    const as = R_('Área de serviço', 'area_servico', 8.6, 3.2, 1.8, 3.0);
    const var_ = R_('Varanda', 'varanda', 0, 7.2, 4.6, 1.6);
    const porta = (x, y, w) => P.dev.push({ id: uid('d'), k: 'porta', x, y, w: w || 0.8 });
    porta(2.3, 7.2, 0.9); porta(4.0, 3.2); porta(3.4, 2.7, 0.7); porta(5.4, 2.7, 0.7); porta(4.4, 2.2, 0.7); porta(4.6, 4.8, 0.9); porta(8.6, 4.8, 0.8);
    P.dev.push({ id: uid('d'), k: 'qdc', x: 3.85, y: 2.2, amb: cir.id });
    P.dev.push({ id: uid('d'), k: 'med', x: 7.4, y: 9.4 });
    P.dev.push({ id: uid('d'), k: 'tue', tipo: 'chuveiro', x: 5.0, y: 0, amb: ban.id });
    P.dev.push({ id: uid('d'), k: 'tue', tipo: 'microondas', x: 7.6, y: 3.2, amb: coz.id });
    P.dev.push({ id: uid('d'), k: 'tue', tipo: 'lavaroupa', x: 10.4, y: 4.2, amb: as.id });
    P.dev.push({ id: uid('d'), k: 'tue', tipo: 'ar', x: 1.7, y: 0, amb: d1.id });
    for (const a of P.amb) E.completarPontos(P, a.id);
    void sala; void d2; void var_;
    return P;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.PEB = E;
})(typeof window !== 'undefined' ? window : globalThis);

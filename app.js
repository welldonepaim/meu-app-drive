"use strict";

/**
 * DB offline
 * - tipos: {id, nome}
 * - setores: {id, nome}
 * - equipamentos: {tasy, patrimonio, nome, modelo, setorId, tipoId, status, recebePreventiva, createdAt, updatedAt}
 * - manutencoes: {id, seq, planKey, planAtivo, equipKey, tasy, atividade, ultima, periodicidadeDias, proxima, createdAt, updatedAt}
 * - os: {id, seq, planKey, equipKey, tasy, atividade, prevista, status, atendidaEm, createdAt, updatedAt}
 * - laudos: {id, fileId, fileName, link, equipKey, tasy, modifiedTime, createdTime, scannedAt}
 * - eventos: {id, equipKey, tasy, type, title, details, at}
 */
const DB_KEY = "gm_offline_v3";

function nowISO(){ return new Date().toISOString(); }
function norm(s){ return String(s ?? "").trim(); }
function pad2(n){ return String(n).padStart(2,"0"); }

function loadDB(){
  const raw = localStorage.getItem(DB_KEY);
  if(!raw) return { tipos: [], setores: [], equipamentos: [], manutencoes: [], os: [], laudos: [], eventos: [], logs: [] };
  try{
    const p = JSON.parse(raw);
    return {
      tipos: Array.isArray(p.tipos) ? p.tipos : [],
      setores: Array.isArray(p.setores) ? p.setores : [],
      equipamentos: Array.isArray(p.equipamentos) ? p.equipamentos : [],
      manutencoes: Array.isArray(p.manutencoes) ? p.manutencoes : [],
      os: Array.isArray(p.os) ? p.os : [],
      laudos: Array.isArray(p.laudos) ? p.laudos : [],
      eventos: Array.isArray(p.eventos) ? p.eventos : [],
      logs: Array.isArray(p.logs) ? p.logs : []
    };
  }catch{
    return { tipos: [], setores: [], equipamentos: [], manutencoes: [], os: [], laudos: [], eventos: [], logs: [] };
  }
}
function saveDB(){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
let db = loadDB();

function log(action, details){
  db.logs.unshift({ at: nowISO(), action, details: details || "" });
  db.logs = db.logs.slice(0,500);
  saveDB();
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function addTimelineEvent({ equipKey, tasy, type, title, details }){
  if(!db.eventos) db.eventos = [];
  db.eventos.unshift({
    id: `ev_${Date.now()}_${Math.random().toString(16).slice(2,8)}`,
    equipKey: equipKey || "",
    tasy: norm(tasy),
    type: type || "equip",
    title: title || "Evento",
    details: details || "",
    at: nowISO()
  });
  db.eventos = db.eventos.slice(0,2000);
}

function showProgress(title, subtitle){
  const overlay = document.getElementById("progressOverlay");
  if(!overlay) return;
  document.getElementById("progressTitle").innerText = title || "Processando...";
  document.getElementById("progressSubtitle").innerText = subtitle || "Por favor, aguarde.";
  overlay.style.display = "flex";
}

function hideProgress(){
  const overlay = document.getElementById("progressOverlay");
  if(!overlay) return;
  overlay.style.display = "none";
}

// =====================
// Datas (BR dd/mm/aaaa)
// =====================
// aceita: dd/mm/aaaa, yyyy-mm-dd, mm/aaaa, mm/aa
function normalizeDateBR(input){
  const s0 = norm(input);
  if(!s0) return "";
  const s = s0.replaceAll("-", "/").replace(/\s+/g,"").trim();

  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if(m) return `${pad2(m[3])}/${pad2(m[2])}/${m[1]}`;

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return `${pad2(m[1])}/${pad2(m[2])}/${m[3]}`;

  // mm/yyyy -> assume dia 01
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if(m) return `01/${pad2(m[1])}/${m[2]}`;

  // mm/yy -> assume dia 01 e século 2000
  m = s.match(/^(\d{1,2})\/(\d{2})$/);
  if(m) return `01/${pad2(m[1])}/20${m[2]}`;

  return s0;
}

function parseBRToDate(br){
  const s = normalizeDateBR(br);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]) - 1, yy = Number(m[3]);
  const d = new Date(yy, mm, dd);
  if(Number.isNaN(d.getTime())) return null;
  return d;
}

function dateToBR(d){
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth()+1);
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function toIntSafe(v){
  const s = norm(v).replace(/[^\d]/g,"");
  if(!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : "";
}

function addDaysBR(brDate, daysStr){
  const d = parseBRToDate(brDate);
  const n = Number(daysStr);
  if(!d || !Number.isFinite(n) || n <= 0) return "";
  d.setDate(d.getDate() + n);
  return dateToBR(d);
}

// =====================
// Chave equipamento
// =====================
function keyOfEquip(eq){
  const t = norm(eq.tasy);
  if(t) return `tasy:${t}`;
  const p = norm(eq.patrimonio);
  if(p) return `pat:${p}`;
  return "";
}

function findEquipByTasy(tasy){
  const tt = norm(tasy);
  if(!tt) return null;
  return db.equipamentos.find(e => norm(e.tasy) === tt) || null;
}

function typeName(tipoId){
  const t = db.tipos.find(x => x.id === tipoId);
  return t ? t.nome : "—";
}

function listLaudosForEquip(eq){
  if(!eq) return [];
  const equipKey = keyOfEquip(eq);
  const matchByTasy = norm(eq.tasy);
  return (db.laudos || []).filter(l =>
    (equipKey && l.equipKey === equipKey) ||
    (matchByTasy && norm(l.tasy) === matchByTasy)
  );
}

function getLatestLaudoForEquip(eq){
  const laudos = listLaudosForEquip(eq);
  if(laudos.length === 0) return null;
  return laudos
    .slice()
    .sort((a,b)=>{
      const ta = Date.parse(a.modifiedTime || a.createdTime || a.scannedAt || "");
      const tb = Date.parse(b.modifiedTime || b.createdTime || b.scannedAt || "");
      return (tb || 0) - (ta || 0);
    })[0];
}

window.listLaudosForEquip = listLaudosForEquip;
window.getLatestLaudoForEquip = getLatestLaudoForEquip;

function setorName(setorId){
  const s = db.setores.find(x => x.id === setorId);
  return s ? s.nome : "—";
}

function sectorNameFromEquip(e){
  if(e && e.setorId) return setorName(e.setorId);
  const legacy = norm(e && e.setor);
  return legacy || "—";
}

function resolveSetorInput(rawValue){
  const val = norm(rawValue);
  if(!val) return { setorId:null, setorNome:"" };
  const asNum = Number(val);
  if(Number.isFinite(asNum) && String(asNum) === val){
    const byId = db.setores.find(s => s.id === asNum);
    if(byId) return { setorId: byId.id, setorNome: byId.nome };
  }
  const byName = db.setores.find(s => norm(s.nome).toLowerCase() === val.toLowerCase());
  if(byName) return { setorId: byName.id, setorNome: byName.nome };
  return { setorId: null, setorNome: val };
}

function parseEquipStatus(rawValue){
  const val = norm(rawValue).toLowerCase();
  if(!val) return "";
  if(val === "a" || val === "ativo" || val === "ativa") return "ativo";
  if(val === "i" || val === "inativo" || val === "inativa" || val === "d" || val === "descontinuado" || val === "descontinuada"){
    return "descontinuado";
  }
  return "";
}

// =====================
// UI Tabs
// =====================
const tabs = document.querySelectorAll(".tab");
tabs.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    tabs.forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const key = btn.dataset.tab;
    document.getElementById("tab-equip").style.display = key==="equip" ? "" : "none";
    document.getElementById("tab-tipos").style.display = key==="tipos" ? "" : "none";
    document.getElementById("tab-setores").style.display = key==="setores" ? "" : "none";
    document.getElementById("tab-manut").style.display = key==="manut" ? "" : "none";
    document.getElementById("tab-os").style.display = key==="os" ? "" : "none";
    document.getElementById("tab-relatorios").style.display = key==="relatorios" ? "" : "none";
    document.getElementById("tab-import").style.display = key==="import" ? "" : "none";
    document.getElementById("tab-logs").style.display = key==="logs" ? "" : "none";
    renderAll();
  });
});

// =====================
// KPIs
// =====================
function calcOsStatus(o){
  const dPrev = parseBRToDate(o.prevista);
  if(!dPrev) return "—";
  const today = new Date(); today.setHours(0,0,0,0);
  const diffDays = Math.floor((dPrev - today) / (1000*60*60*24));
  if(diffDays < 0) return "vencida";
  if(diffDays <= 30) return "proxima";
  return "emdia";
}

function ensureOsForUpcoming(){
  const today = new Date(); today.setHours(0,0,0,0);
  let changed = false;

  for(const p of db.manutencoes){
    if(p.planAtivo === false) continue;
    const dProx = parseBRToDate(p.proxima);
    if(!dProx) continue;
    const diffDays = Math.floor((dProx - today) / (1000*60*60*24));
    if(diffDays > 30) continue;

    const exists = db.os.some(o=>o.planKey===p.planKey && o.prevista===p.proxima && o.status==="aberta");
    if(exists) continue;

    const seq = nextOsSeq();
    db.os.push({
      id: `os:${seq}`,
      seq,
      planKey: p.planKey,
      equipKey: p.equipKey,
      tasy: p.tasy,
      atividade: p.atividade,
      prevista: p.proxima,
      status: "aberta",
      atendidaEm: "",
      createdAt: nowISO(),
      updatedAt: nowISO()
    });
    changed = true;
  }

  if(changed) saveDB();
}

function renderKPIs(){
  ensureOsForUpcoming();
  document.getElementById("kpiEquip").innerText = String(db.equipamentos.length);
  document.getElementById("kpiManut").innerText = String(db.os.filter(o=>o.status==="aberta").length);

  let venc = 0, prox = 0;
  for(const o of db.os){
    if(o.status !== "aberta") continue;
    const st = calcOsStatus(o);
    if(st==="vencida") venc++;
    if(st==="proxima") prox++;
  }
  document.getElementById("kpiVencidas").innerText = String(venc);
  document.getElementById("kpiProximas").innerText = String(prox);
}

// =====================
// IMPORTAÇÃO CSV (equip / manut) com preview
// =====================
let lastPreview = null;

document.getElementById("btnPreview").addEventListener("click", async ()=>{
  const file = document.getElementById("fileCsv").files[0];
  if(!file) return alert("Selecione um CSV ou XLS.");
  let parsed;
  try{
    parsed = await parseImportFile(file);
  }catch(err){
    if(err && err.message === "XLSX_LIB_MISSING"){
      return alert("Leitura XLS/XLSX indisponível. Use CSV ou inclua a biblioteca XLSX.");
    }
    return alert("Falha ao ler o arquivo.");
  }
  if(parsed.rows.length===0) return alert("Arquivo sem linhas.");

  const mode = document.getElementById("importMode").value;
  const mapping = getMapping();
  const allowed = getUpdateFlags();
  const ruleDisc = document.getElementById("ruleDiscontinued").value;

  lastPreview = (mode==="equip")
    ? buildPreviewEquip(parsed, mapping, allowed, ruleDisc)
    : (mode==="setores")
      ? buildPreviewSetores(parsed, mapping)
      : (mode==="datas")
        ? buildPreviewDatas(parsed, mapping)
        : buildPreviewManut(parsed, mapping, allowed);

  renderPreview(lastPreview);
  document.getElementById("btnApply").disabled = false;
});

document.getElementById("btnApply").addEventListener("click", ()=>{
  if(!lastPreview) return alert("Gere a prévia antes.");
  if(!confirm("Aplicar alterações?")) return;
  showProgress("Aplicando alterações...", "Atualizando base local.");
  const hadInvalid = (lastPreview.invalid || []).length > 0;
  applyPreview(lastPreview);
  lastPreview = null;
  document.getElementById("btnApply").disabled = true;
  document.getElementById("previewTable").innerHTML = "";
  document.getElementById("previewHint").innerText = "Alterações aplicadas.";
  renderAll();
  setTimeout(hideProgress, 0);
  if(!hadInvalid){
    alert("Importação finalizada sem erros.");
  }else{
    alert("Importação concluída com avisos. Há linhas inválidas na prévia.");
  }
});

document.getElementById("btnAutoMap").addEventListener("click", async ()=>{
  const file = document.getElementById("fileCsv").files[0];
  if(!file) return alert("Selecione um CSV ou XLS primeiro.");
  let parsed;
  try{
    parsed = await parseImportFile(file);
  }catch(err){
    if(err && err.message === "XLSX_LIB_MISSING"){
      return alert("Leitura XLS/XLSX indisponível. Use CSV ou inclua a biblioteca XLSX.");
    }
    return alert("Falha ao ler o arquivo.");
  }
  if(!parsed.header.length) return alert("Não encontrei cabeçalho.");

  const m = autodetectMappingFromHeader(parsed.header);
  setMappingUI(m);
  alert("Auto-mapeamento aplicado. Confira antes de gerar a prévia.");
});

function setMappingUI(m){
  document.getElementById("mapTasy").value = m.tasy || "";
  document.getElementById("mapPatrimonio").value = m.patrimonio || "";
  document.getElementById("mapNome").value = m.nome || "";
  document.getElementById("mapSetor").value = m.setor || "";
  document.getElementById("mapModelo").value = m.modelo || "";
  document.getElementById("mapTipo").value = m.tipo || "";
  document.getElementById("mapAtividade").value = m.atividade || "";
  document.getElementById("mapSituacao").value = m.situacao || "";
  document.getElementById("mapUltima").value = m.ultima || "";
  document.getElementById("mapProxima").value = m.proxima || "";
  document.getElementById("mapPeriodicidade").value = m.periodicidade || "";
  document.getElementById("mapLaudo").value = m.laudo || "";
}

function getMapping(){
  return {
    tasy: norm(document.getElementById("mapTasy").value),
    patrimonio: norm(document.getElementById("mapPatrimonio").value),
    nome: norm(document.getElementById("mapNome").value),
    setor: norm(document.getElementById("mapSetor").value),
    modelo: norm(document.getElementById("mapModelo").value),
    tipo: norm(document.getElementById("mapTipo").value),

    atividade: norm(document.getElementById("mapAtividade").value),
    situacao: norm(document.getElementById("mapSituacao").value),
    ultima: norm(document.getElementById("mapUltima").value),
    proxima: norm(document.getElementById("mapProxima").value),
    periodicidade: norm(document.getElementById("mapPeriodicidade").value),
    laudo: norm(document.getElementById("mapLaudo").value),
  };
}

function getUpdateFlags(){
  return {
    nome: document.getElementById("updNome").checked,
    setor: document.getElementById("updSetor").checked,
    modelo: document.getElementById("updModelo").checked,
    patrimonio: document.getElementById("updPatrimonio").checked,
    tipo: document.getElementById("updTipo").checked,
    status: document.getElementById("updStatus").checked,

    datas: document.getElementById("updDatas").checked,
    periodicidade: document.getElementById("updPeriodicidade").checked,
    atividade: document.getElementById("updAtividade").checked,
    laudo: document.getElementById("updLaudo").checked,
  };
}

// CSV/XLS
async function parseImportFile(file){
  const name = String(file?.name || "").toLowerCase();
  if(name.endsWith(".xls") || name.endsWith(".xlsx")){
    if(typeof XLSX === "undefined") throw new Error("XLSX_LIB_MISSING");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type:"array" });
    const sheetName = wb.SheetNames[0];
    if(!sheetName) return { header:[], rows:[] };
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
    if(rows.length===0) return { header:[], rows:[] };
    const header = rows[0].map(h=>normalizeHeader(String(h ?? "")));
    const objs = rows.slice(1)
      .filter(r=>r.some(c=>String(c ?? "").trim()!==""))
      .map(r=>{
        const o = {};
        header.forEach((h,i)=>{ o[h] = String(r[i] ?? "").trim(); });
        return o;
      });
    return { header, rows: objs };
  }
  const text = await file.text();
  return parseCsvSmart(text);
}

function parseCsvSmart(text){
  const lines = text.split(/\r\n|\n/).filter(l=>l.trim()!=="");
  if(lines.length===0) return { header:[], rows:[] };

  const first = lines[0];
  const tab = (first.match(/\t/g)||[]).length;
  const semi = (first.match(/;/g)||[]).length;
  const comma = (first.match(/,/g)||[]).length;
  const wsParts = first.trim().split(/\s+/);

  let delim = ",";
  if(tab>=semi && tab>=comma && tab>0) delim="\t";
  else if(semi>comma && semi>0) delim=";";
  else if(comma>0) delim=",";
  else if(wsParts.length>1) delim="WS";

  const rawRows = lines.map(line=>splitLine(line, delim));
  const header = rawRows[0].map(h=>normalizeHeader(h));
  const dataRows = rawRows.slice(1);

  const objs = dataRows.map(r=>{
    const o = {};
    header.forEach((h,i)=>{ o[h] = r[i] ?? ""; });
    return o;
  });

  return { header, rows: objs };
}
function splitLine(line, delim){
  if(delim === "WS"){
    return line.trim().split(/\s+/).map(x=>String(x??"").trim());
  }
  const out=[]; let cur=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch === '"'){
      if(inQ && line[i+1] === '"'){ cur+='"'; i++; }
      else inQ=!inQ;
      continue;
    }
    if(ch===delim && !inQ){ out.push(cur); cur=""; continue; }
    cur+=ch;
  }
  out.push(cur);
  return out.map(x=>String(x??"").trim());
}
function normalizeHeader(h){
  const s = String(h??"").trim().toLowerCase();
  const noAcc = s.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  return noAcc.replace(/\s+/g," ").trim();
}
function pick(rowObj, headerName){
  if(!headerName) return "";
  const key = normalizeHeader(headerName);
  return rowObj[key] ?? "";
}

// Auto-map
function autodetectMappingFromHeader(parsedHeader){
  const has = (name)=> parsedHeader.includes(normalizeHeader(name));
  const pickOne = (cands)=> cands.map(normalizeHeader).find(c=>has(c)) || "";

  return {
    tasy: pickOne(["tasy","cod tasy","cód tasy","codigo tasy","cod. tasy"]),
    patrimonio: pickOne(["patrimonio","patrimônio"]),
    nome: pickOne(["descricao","descricao","descriao","equipamento","nome"]),
    setor: pickOne(["setor","unidade","local"]),
    modelo: pickOne(["coluna 4","marca","fabricante","modelo"]),
    tipo: pickOne(["tipo","categoria"]),
    atividade: pickOne(["atividade","coluna 4","descricao atividade"]),
    situacao: pickOne(["situacao","situação","status"]),
    ultima: pickOne(["data da ultima preventiva","data da última preventiva","ultima preventiva"]),
    proxima: pickOne(["data da proxima","data da próxima","proxima preventiva","data_final","data final","data fim"]),
    periodicidade: pickOne(["periodicidade","periodicidade (dias)"]),
    laudo: pickOne(["coluna 10","laudo","link"]),
  };
}

// ===== Preview Datas (TASY + DATA_FINAL) =====
function buildPreviewDatas(parsed, mapping){
  const changes = [];
  const invalid = [];

  for(const row of parsed.rows){
    const tasy = norm(pick(row, mapping.tasy));
    const proxima = normalizeDateBR(pick(row, mapping.proxima));
    if(!tasy){ invalid.push({ reason:"Sem TASY", row }); continue; }
    if(!proxima){ invalid.push({ reason:`Sem DATA_FINAL (TASY ${tasy})`, row }); continue; }

    const plans = db.manutencoes.filter(m=>norm(m.tasy)===tasy);
    if(plans.length===0){ invalid.push({ reason:`Sem planejamento (TASY ${tasy})`, row }); continue; }

    for(const cur of plans){
      if(proxima && proxima !== norm(cur.proxima)){
        const after = { ...cur, proxima };
        changes.push({
          type:"M_UPDATE",
          key:cur.planKey || cur.id,
          before:cur,
          after,
          fields:{ proxima:{ before:cur.proxima, after:proxima } }
        });
      }
    }
  }

  const summary = {
    create: 0,
    update: changes.length,
    invalid: invalid.length
  };

  return { mode:"datas", summary, changes, invalid };
}

// ===== Preview Equipamentos =====
function buildPreviewEquip(parsed, mapping, allowed, ruleDisc){
  const mapCurrent = new Map(db.equipamentos.map(e=>[keyOfEquip(e), e]));
  const seen = new Set();
  const changes = [];
  const invalid = [];

  for(const row of parsed.rows){
    const tasy = norm(pick(row, mapping.tasy));
    const patrimonio = norm(pick(row, mapping.patrimonio));
    const nome = norm(pick(row, mapping.nome));
    const setorInput = resolveSetorInput(pick(row, mapping.setor));
    const modelo = norm(pick(row, mapping.modelo));
    const tipoNome = norm(pick(row, mapping.tipo));
    const status = parseEquipStatus(pick(row, mapping.situacao));

    // resolve tipoId (cria se necessário, mas só na aplicação — aqui só sugere)
    const candidate = { tasy, patrimonio, nome, setorNome: setorInput.setorNome, setorId: setorInput.setorId, modelo, tipoNome, status };

    const key = keyOfEquip(candidate);
    if(!key){
      invalid.push({ reason:"Sem chave (TASY/Patrimônio)", row:candidate });
      continue;
    }
    seen.add(key);

    const current = mapCurrent.get(key);

    if(!current){
      changes.push({ type:"E_CREATE", key, after:candidate });
      continue;
    }

    const fields = {};
    const after = { ...current };
    const currentSetor = sectorNameFromEquip(current);
    const currentSetorId = current.setorId ? Number(current.setorId) : null;

    if(allowed.nome && nome && nome !== norm(current.nome)){ fields.nome={before:current.nome, after:nome}; after.nome=nome; }
    if(allowed.setor && setorInput.setorNome){
      if(setorInput.setorId && setorInput.setorId !== currentSetorId){
        fields.setor = { before: currentSetor, after: setorInput.setorNome };
        after.setorId = setorInput.setorId;
        after.setorNome = setorInput.setorNome;
      }else if(!setorInput.setorId && setorInput.setorNome !== norm(currentSetor)){
        fields.setor = { before: currentSetor, after: setorInput.setorNome };
        after.setorNome = setorInput.setorNome;
      }
    }
    if(allowed.modelo && modelo && modelo !== norm(current.modelo)){ fields.modelo={before:current.modelo, after:modelo}; after.modelo=modelo; }
    if(allowed.patrimonio && patrimonio && patrimonio !== norm(current.patrimonio)){ fields.patrimonio={before:current.patrimonio, after:patrimonio}; after.patrimonio=patrimonio; }
    if(allowed.tipo && tipoNome){ fields.tipoNome={before:typeName(current.tipoId), after:tipoNome}; after.tipoNome=tipoNome; }
    if(allowed.status && status && status !== norm(current.status)){
      fields.status={before:current.status, after:status};
      after.status=status;
    }

    if(Object.keys(fields).length>0) changes.push({ type:"E_UPDATE", key, before:current, after, fields });
  }

  if(ruleDisc === "mark_missing"){
    for(const e of db.equipamentos){
      const k = keyOfEquip(e);
      if(!k) continue;
      if(e.status === "descontinuado") continue;
      if(!seen.has(k)){
        changes.push({ type:"E_DISCONTINUE", key:k, before:e });
      }
    }
  }

  const summary = {
    create: changes.filter(c=>c.type==="E_CREATE").length,
    update: changes.filter(c=>c.type==="E_UPDATE").length,
    discontinue: changes.filter(c=>c.type==="E_DISCONTINUE").length,
    invalid: invalid.length
  };

  return { mode:"equip", summary, changes, invalid, allowed };
}

// ===== Preview Manutenções =====
function buildPreviewManut(parsed, mapping, allowed){
  const changes = [];
  const invalid = [];

  // index atual por planejamento
  const mapCur = new Map(db.manutencoes.map(m=>[m.planKey || planKeyOf(m.equipKey, m.atividade), m]));

  for(const row of parsed.rows){
    const tasy = norm(pick(row, mapping.tasy));
    if(!tasy){ invalid.push({ reason:"Sem TASY", row }); continue; }

    const atividade = allowed.atividade ? norm(pick(row, mapping.atividade)) : norm(pick(row, mapping.atividade));
    const ultima = normalizeDateBR(pick(row, mapping.ultima));
    const periodicidade = toIntSafe(pick(row, mapping.periodicidade));
    const proximaCsv = normalizeDateBR(pick(row, mapping.proxima));

    const eq = findEquipByTasy(tasy);
    const equipKey = eq ? keyOfEquip(eq) : `tasy:${tasy}`;

    if(!atividade){ invalid.push({ reason:`Sem atividade (TASY ${tasy})`, row }); continue; }
    if(!ultima || !periodicidade){ invalid.push({ reason:`Sem última/periodicidade (TASY ${tasy})`, row }); continue; }

    const proximaCalc = addDaysBR(ultima, periodicidade);
    const proxima = proximaCalc || proximaCsv;

    const planKey = planKeyOf(equipKey, atividade);

    const candidate = {
      id: planKey,
      planKey,
      equipKey,
      tasy,
      atividade,
      ultima,
      periodicidadeDias: periodicidade,
      proxima
    };

    const cur = mapCur.get(planKey);
    if(!cur){
      changes.push({ type:"M_CREATE", key:planKey, after:candidate });
      continue;
    }

    const fields = {};
    const after = { ...cur };

    if(allowed.datas){
      if(ultima && ultima !== norm(cur.ultima)){ fields.ultima={before:cur.ultima, after:ultima}; after.ultima=ultima; }
      if(proxima && proxima !== norm(cur.proxima)){ fields.proxima={before:cur.proxima, after:proxima}; after.proxima=proxima; }
    }
    if(allowed.periodicidade && periodicidade && periodicidade !== norm(cur.periodicidadeDias)){
      fields.periodicidadeDias={before:cur.periodicidadeDias, after:periodicidade};
      after.periodicidadeDias = periodicidade;
    }
    if(allowed.atividade && atividade && atividade !== norm(cur.atividade)){
      fields.atividade={before:cur.atividade, after:atividade};
      after.atividade = atividade;
    }

    if(Object.keys(fields).length>0){
      changes.push({ type:"M_UPDATE", key:id, before:cur, after, fields });
    }
  }

  const summary = {
    create: changes.filter(c=>c.type==="M_CREATE").length,
    update: changes.filter(c=>c.type==="M_UPDATE").length,
    invalid: invalid.length
  };

  return { mode:"manut", summary, changes, invalid };
}

// ===== Preview Setores =====
function buildPreviewSetores(parsed, mapping){
  const changes = [];
  const invalid = [];
  const seen = new Set();

  for(const row of parsed.rows){
    const nome = norm(pick(row, mapping.setor));
    if(!nome){ invalid.push({ reason:"Sem setor", row }); continue; }
    const key = nome.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    const exists = db.setores.some(s=>norm(s.nome).toLowerCase()===nome.toLowerCase());
    if(exists) continue;
    changes.push({ type:"S_CREATE", after:{ nome } });
  }

  const summary = {
    create: changes.length,
    invalid: invalid.length
  };

  return { mode:"setores", summary, changes, invalid };
}

function renderPreview(preview){
  const hint = document.getElementById("previewHint");
  const table = document.getElementById("previewTable");

  if(preview.mode === "equip"){
    hint.innerText = `Prévia EQUIP — Criar: ${preview.summary.create}, Atualizar: ${preview.summary.update}, Descontinuar: ${preview.summary.discontinue}, Inválidos: ${preview.summary.invalid}.`;
  }else if(preview.mode === "setores"){
    hint.innerText = `Prévia SETORES — Criar: ${preview.summary.create}, Inválidos: ${preview.summary.invalid}.`;
  }else if(preview.mode === "datas"){
    hint.innerText = `Prévia DATAS — Atualizar: ${preview.summary.update}, Inválidos: ${preview.summary.invalid}.`;
  }else{
    hint.innerText = `Prévia PLANO — Criar: ${preview.summary.create}, Atualizar: ${preview.summary.update}, Inválidos: ${preview.summary.invalid}.`;
  }

  const rows = [];
  for(const ch of preview.changes){
    if(ch.type==="E_CREATE") rows.push({ tipo:"CRIAR EQUIP", chave:ch.key, detalhes:`${ch.after.nome||"—"} • TASY:${ch.after.tasy||"—"} • Setor:${ch.after.setorNome||"—"}` });
    if(ch.type==="E_UPDATE"){
      const fields = Object.entries(ch.fields).map(([k,v])=>`${k}: "${norm(v.before)}"→"${norm(v.after)}"`).join(" • ");
      rows.push({ tipo:"ATUALIZAR EQUIP", chave:ch.key, detalhes:fields });
    }
    if(ch.type==="E_DISCONTINUE") rows.push({ tipo:"DESCONTINUAR", chave:ch.key, detalhes:"Não apareceu no CSV" });

    if(ch.type==="M_CREATE") rows.push({ tipo:"CRIAR PLANO", chave:ch.key, detalhes:`${ch.after.atividade} • Última:${ch.after.ultima} • Próxima:${ch.after.proxima} • Per:${ch.after.periodicidadeDias}` });
    if(ch.type==="M_UPDATE"){
      const fields = Object.entries(ch.fields).map(([k,v])=>`${k}: "${norm(v.before)}"→"${norm(v.after)}"`).join(" • ");
      rows.push({ tipo: preview.mode==="datas" ? "ATUALIZAR DATA" : "ATUALIZAR PLANO", chave:ch.key, detalhes:fields });
    }
    if(ch.type==="S_CREATE") rows.push({ tipo:"CRIAR SETOR", chave:"—", detalhes:ch.after.nome });
  }
  for(const inv of preview.invalid){
    rows.push({ tipo:"INVÁLIDO", chave:"—", detalhes: inv.reason || "linha inválida" });
  }

  if(rows.length===0){
    table.innerHTML = `<div class="muted">Nada a fazer.</div>`;
    return;
  }

  table.innerHTML = `
    <table>
      <thead><tr><th>Tipo</th><th>Chave</th><th>Detalhes</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${escapeHtml(r.tipo)}</td>
            <td class="mono">${escapeHtml(r.chave)}</td>
            <td>${escapeHtml(r.detalhes)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function applyPreview(preview){
  if(preview.mode === "equip"){
    const allowed = preview.allowed || getUpdateFlags();
    let cC=0,cU=0,cD=0;
    for(const ch of preview.changes){
      if(ch.type==="E_CREATE"){
        // cria tipo se necessário
        let tipoId = null;
        const tipoNome = norm(ch.after.tipoNome);
        if(tipoNome){
          tipoId = ensureTipo(tipoNome);
        }
        const setorId = ch.after.setorId ? Number(ch.after.setorId) : (ch.after.setorNome ? ensureSetor(ch.after.setorNome) : null);
        const status = (allowed.status ? parseEquipStatus(ch.after.status) : "") || "ativo";
        const e = {
          tasy: norm(ch.after.tasy),
          patrimonio: norm(ch.after.patrimonio),
          nome: norm(ch.after.nome),
          setorId,
          modelo: norm(ch.after.modelo),
          tipoId,
          status,
          recebePreventiva: true, // novo = true por padrão (segurança)
          createdAt: nowISO(),
          updatedAt: nowISO()
        };
        db.equipamentos.push(e);
        cC++;
      }
      if(ch.type==="E_UPDATE"){
        const cur = db.equipamentos.find(e=>keyOfEquip(e)===ch.key);
        if(!cur) continue;

        // preserva recebePreventiva SEMPRE por import
        const keepRecebe = (cur.recebePreventiva===false)?false:true;
        const keepStatus = cur.status || "ativo";
        const statusFromImport = allowed.status ? parseEquipStatus(ch.after.status) : "";
        const next = { ...ch.after };
        delete next.setorId;
        delete next.setorNome;

        // aplica campos
        Object.assign(cur, next);

        // tipo via nome
        if(ch.after.tipoNome){
          cur.tipoId = ensureTipo(ch.after.tipoNome);
        }
        if(ch.after.setorId){
          cur.setorId = Number(ch.after.setorId);
        }else if(ch.after.setorNome){
          cur.setorId = ensureSetor(ch.after.setorNome);
        }

        cur.recebePreventiva = keepRecebe;
        cur.status = statusFromImport || keepStatus;
        if(cur.status === "descontinuado"){
          for(const m of db.manutencoes){
            if(m.equipKey === ch.key){
              m.planAtivo = false;
              m.updatedAt = nowISO();
            }
          }
        }
        cur.updatedAt = nowISO();
        cU++;
      }
      if(ch.type==="E_DISCONTINUE"){
        const cur = db.equipamentos.find(e=>keyOfEquip(e)===ch.key);
        if(!cur) continue;
        cur.status = "descontinuado";
        for(const m of db.manutencoes){
          if(m.equipKey === ch.key){
            m.planAtivo = false;
            m.updatedAt = nowISO();
          }
        }
        cur.updatedAt = nowISO();
        cD++;
      }
    }
    saveDB();
    log("IMPORT_EQUIP_APPLY", `Criados=${cC}, Atualizados=${cU}, Descontinuados=${cD}`);
    return;
  }

  if(preview.mode === "setores"){
    let cC = 0;
    for(const ch of preview.changes){
      if(ch.type==="S_CREATE"){
        ensureSetor(ch.after.nome);
        cC++;
      }
    }
    saveDB();
    log("IMPORT_SETOR_APPLY", `Criados=${cC}`);
    return;
  }

  if(preview.mode === "datas"){
    let cU = 0;
    for(const ch of preview.changes){
      if(ch.type !== "M_UPDATE") continue;
      const cur = db.manutencoes.find(m=>m.planKey===ch.key || m.id===ch.key);
      if(!cur) continue;
      cur.proxima = ch.after.proxima;
      cur.updatedAt = nowISO();
      addTimelineEvent({
        equipKey: cur.equipKey,
        tasy: cur.tasy,
        type: "manut",
        title: "Data próxima atualizada (importação)",
        details: `#${cur.seq || "—"} • ${cur.atividade || "—"}`
      });
      cU++;
    }
    saveDB();
    log("IMPORT_DATAS_APPLY", `Atualizados=${cU}`);
    return;
  }

  // planos (importação de manutenções -> planejamentos)
  let cC=0,cU=0;
  for(const ch of preview.changes){
    if(ch.type==="M_CREATE"){
      const seq = nextPlanSeq();
      db.manutencoes.push({
        ...ch.after,
        seq,
        planKey: ch.after.planKey || planKeyOf(ch.after.equipKey, ch.after.atividade),
        planAtivo: true,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
      addTimelineEvent({
        equipKey: ch.after.equipKey,
        tasy: ch.after.tasy,
        type: "manut",
        title: "Planejamento criado (importação)",
        details: `#${seq} • ${ch.after.atividade || "—"}`
      });
      cC++;
    }
    if(ch.type==="M_UPDATE"){
      const cur = db.manutencoes.find(m=>m.planKey===ch.key || m.id===ch.key);
      if(!cur) continue;
      Object.assign(cur, ch.after);
      cur.planKey = cur.planKey || planKeyOf(cur.equipKey, cur.atividade);
      if(cur.planAtivo === undefined) cur.planAtivo = true;
      cur.updatedAt = nowISO();
      addTimelineEvent({
        equipKey: cur.equipKey,
        tasy: cur.tasy,
        type: "manut",
        title: "Planejamento atualizado (importação)",
        details: `#${cur.seq || "—"} • ${cur.atividade || "—"}`
      });
      cU++;
    }
  }
  saveDB();
  log("IMPORT_MANUT_APPLY", `Criados=${cC}, Atualizados=${cU}`);
}

function ensureTipo(nomeTipo){
  const nome = norm(nomeTipo);
  if(!nome) return null;
  let t = db.tipos.find(x=>norm(x.nome).toLowerCase()===nome.toLowerCase());
  if(t) return t.id;
  const id = db.tipos.length ? Math.max(...db.tipos.map(x=>x.id))+1 : 1;
  db.tipos.push({ id, nome });
  return id;
}

function ensureSetor(nomeSetor){
  const nome = norm(nomeSetor);
  if(!nome) return null;
  let s = db.setores.find(x=>norm(x.nome).toLowerCase()===nome.toLowerCase());
  if(s) return s.id;
  const id = db.setores.length ? Math.max(...db.setores.map(x=>x.id))+1 : 1;
  db.setores.push({ id, nome });
  return id;
}

function nextPlanSeq(){
  const maxSeq = db.manutencoes.reduce((acc,m)=> Math.max(acc, Number(m.seq)||0), 0);
  return maxSeq + 1;
}

function planKeyOf(equipKey, atividade){
  const a = norm(atividade).toLowerCase();
  return `${equipKey}::${a || "preventiva"}`;
}

function nextOsSeq(){
  const maxSeq = db.os.reduce((acc,o)=> Math.max(acc, Number(o.seq)||0), 0);
  return maxSeq + 1;
}

function migrateLegacySetores(){
  let changed = false;
  for(const e of db.equipamentos){
    if(e.setorId) continue;
    const legacy = norm(e.setor);
    if(!legacy) continue;
    e.setorId = ensureSetor(legacy);
    changed = true;
  }
  if(changed) saveDB();
}

migrateLegacySetores();

function migratePlanSeq(){
  let changed = false;
  let seq = db.manutencoes.reduce((acc,m)=> Math.max(acc, Number(m.seq)||0), 0);
  for(const m of db.manutencoes){
    if(!m.seq){
      seq += 1;
      m.seq = seq;
      changed = true;
    }
    if(!m.planKey){
      m.planKey = planKeyOf(m.equipKey, m.atividade);
      changed = true;
    }
    if(m.planAtivo === undefined){
      m.planAtivo = true;
      changed = true;
    }
  }
  if(changed) saveDB();
}

migratePlanSeq();

// =====================
// Logs
// =====================
document.getElementById("btnClearLogs").addEventListener("click", ()=>{
  if(!confirm("Limpar logs?")) return;
  db.logs = [];
  saveDB();
  renderLogs();
});

function renderLogs(){
  const el = document.getElementById("logList");
  if(db.logs.length===0){
    el.innerHTML = `<div class="muted">Sem logs ainda.</div>`;
    return;
  }
  el.innerHTML = db.logs.map(l=>`
    <div class="card" style="margin-bottom:10px">
      <div class="row">
        <div style="font-weight:1100">${escapeHtml(l.action)}</div>
        <div class="right muted small">${new Date(l.at).toLocaleString("pt-BR")}</div>
      </div>
      <div class="muted small" style="margin-top:6px">${escapeHtml(l.details)}</div>
    </div>
  `).join("");
}

// =====================
// Backup / Reset
// =====================
document.getElementById("btnExport").addEventListener("click", ()=>{
  showProgress("Gerando backup...", "Montando arquivo para exportação.");
  const blob = new Blob([JSON.stringify(db,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_gm_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(hideProgress, 0);
  alert("Exportação concluída. O arquivo foi gerado.");
});

document.getElementById("fileImportBackup").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    if(!parsed || typeof parsed!=="object") throw new Error("JSON inválido");
    db = {
      tipos: Array.isArray(parsed.tipos)?parsed.tipos:[],
      setores: Array.isArray(parsed.setores)?parsed.setores:[],
      equipamentos: Array.isArray(parsed.equipamentos)?parsed.equipamentos:[],
      manutencoes: Array.isArray(parsed.manutencoes)?parsed.manutencoes:[],
      os: Array.isArray(parsed.os)?parsed.os:[],
      laudos: Array.isArray(parsed.laudos)?parsed.laudos:[],
      eventos: Array.isArray(parsed.eventos)?parsed.eventos:[],
      logs: Array.isArray(parsed.logs)?parsed.logs:[]
    };
    saveDB();
    log("BACKUP_IMPORT", "Backup importado");
    renderAll();
    alert("Backup importado com sucesso.");
  }catch(err){
    console.error(err);
    alert("Falha ao importar backup.");
  }finally{
    e.target.value = "";
  }
});

document.getElementById("btnReset").addEventListener("click", ()=>{
  if(!confirm("Isso apaga tudo do sistema offline. Tem certeza?")) return;
  localStorage.removeItem(DB_KEY);
  db = loadDB();
  renderAll();
});

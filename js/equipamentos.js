"use strict";

// =====================
// EQUIPAMENTOS (CRUD)
// =====================
const modalEq = document.getElementById("modalEq");
const btnNovoEq = document.getElementById("btnNovoEq");
const btnCloseEq = document.getElementById("btnCloseEq");
const btnSaveEq = document.getElementById("btnSaveEq");
const btnDelEq  = document.getElementById("btnDelEq");
const btnToggleEqList = document.getElementById("btnToggleEqList");
const modalEqTitle = document.getElementById("modalEqTitle");
const modalHistEquip = document.getElementById("modalHistEquip");
const btnCloseHistEquip = document.getElementById("btnCloseHistEquip");
const histEquipFilter = document.getElementById("histEquipFilter");
let editingEquipKey = null;
let viewingEquipKey = null;
let showEquipList = false;

function refreshTipoSelect(){
  const sel = document.getElementById("eTipo");
  sel.innerHTML = `<option value="">(sem tipo)</option>`;
  const sorted = db.tipos.slice().sort((a,b)=>norm(a.nome).localeCompare(norm(b.nome)));
  for(const t of sorted){
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = t.nome;
    sel.appendChild(opt);
  }
}

function refreshSetorSelect(){
  const sel = document.getElementById("eSetor");
  sel.innerHTML = `<option value="">(sem setor)</option>`;
  const sorted = db.setores.slice().sort((a,b)=>norm(a.nome).localeCompare(norm(b.nome)));
  for(const s of sorted){
    const opt = document.createElement("option");
    opt.value = String(s.id);
    opt.textContent = s.nome;
    sel.appendChild(opt);
  }
}

function ensureSetorOption(setorId, fallbackNome){
  if(!setorId) return;
  const sel = document.getElementById("eSetor");
  const exists = Array.from(sel.options).some(o=>norm(o.value) === String(setorId));
  if(exists) return;
  const opt = document.createElement("option");
  opt.value = String(setorId);
  const nome = fallbackNome ? norm(fallbackNome) : `ID ${setorId}`;
  opt.textContent = `${nome} (fora da lista)`;
  sel.appendChild(opt);
}

btnNovoEq.addEventListener("click", ()=>{
  editingEquipKey = null;
  modalEqTitle.innerText = "Novo equipamento";
  btnDelEq.style.display = "none";
  refreshTipoSelect();
  refreshSetorSelect();
  setEqFields({ tasy:"", patrimonio:"", nome:"", modelo:"", setor:"", tipoId:"", status:"ativo", recebePreventiva:true });
  modalEq.style.display = "flex";
});
btnCloseEq.addEventListener("click", ()=> modalEq.style.display="none");
modalEq.addEventListener("click", (e)=>{ if(e.target===modalEq) modalEq.style.display="none"; });
btnCloseHistEquip.addEventListener("click", ()=> modalHistEquip.style.display="none");
modalHistEquip.addEventListener("click", (e)=>{ if(e.target===modalHistEquip) modalHistEquip.style.display="none"; });
histEquipFilter.addEventListener("change", ()=> renderEquipHistory());
btnToggleEqList.addEventListener("click", ()=>{
  showEquipList = !showEquipList;
  btnToggleEqList.innerText = showEquipList ? "🙈 Ocultar lista" : "👁️ Mostrar lista";
  renderEquipList();
});

function getEqFields(){
  const tipoId = norm(document.getElementById("eTipo").value);
  const setorId = norm(document.getElementById("eSetor").value);
  return {
    tasy: norm(document.getElementById("eTasy").value),
    patrimonio: norm(document.getElementById("ePat").value),
    nome: norm(document.getElementById("eNome").value),
    modelo: norm(document.getElementById("eModelo").value),
    setorId: setorId ? Number(setorId) : null,
    tipoId: tipoId ? Number(tipoId) : null,
    status: norm(document.getElementById("eStatus").value) || "ativo",
    recebePreventiva: document.getElementById("eRecebe").value === "true",
  };
}
function setEqFields(e){
  document.getElementById("eTasy").value = norm(e.tasy);
  document.getElementById("ePat").value = norm(e.patrimonio);
  document.getElementById("eNome").value = norm(e.nome);
  document.getElementById("eModelo").value = norm(e.modelo);
  const legacySetor = norm(e.setor);
  const setorId = e.setorId ? Number(e.setorId) : (legacySetor ? ensureSetor(legacySetor) : null);
  document.getElementById("eSetor").value = setorId ? String(setorId) : "";
  ensureSetorOption(setorId, legacySetor);
  document.getElementById("eStatus").value = norm(e.status) || "ativo";
  document.getElementById("eRecebe").value = (e.recebePreventiva === false) ? "false" : "true";
  document.getElementById("eTipo").value = e.tipoId ? String(e.tipoId) : "";
}

window.openEditEquip = (equipKey)=>{
  const e = db.equipamentos.find(x=>keyOfEquip(x)===equipKey);
  if(!e) return alert("Equipamento não encontrado.");
  editingEquipKey = equipKey;
  modalEqTitle.innerText = "Editar equipamento";
  btnDelEq.style.display = "";
  refreshTipoSelect();
  refreshSetorSelect();
  setEqFields(e);
  modalEq.style.display = "flex";
};

function formatDateTime(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function buildEquipTimeline(e){
  const events = [];
  const addEvent = (type, at, title, details)=>{
    if(!at) return;
    events.push({ type, at, title, details });
  };

  addEvent("equip", e.createdAt, "Equipamento criado", `${e.nome || "—"} • TASY:${e.tasy || "—"}`);
  if(e.updatedAt && e.updatedAt !== e.createdAt){
    addEvent("equip", e.updatedAt, "Equipamento atualizado", `${e.nome || "—"} • Setor:${sectorNameFromEquip(e)}`);
  }

  const matchByTasy = norm(e.tasy);
  const equipKey = keyOfEquip(e);
  const planos = db.manutencoes.filter(m => m.equipKey === equipKey || (matchByTasy && norm(m.tasy) === matchByTasy));
  for(const m of planos){
    addEvent("manut", m.createdAt, "Planejamento criado", `${m.atividade || "—"} • Próxima:${m.proxima || "—"}`);
    if(m.updatedAt && m.updatedAt !== m.createdAt){
      addEvent("manut", m.updatedAt, "Planejamento atualizado", `${m.atividade || "—"} • Próxima:${m.proxima || "—"}`);
    }
  }

  const osList = (db.os || []).filter(o => o.equipKey === equipKey || (matchByTasy && norm(o.tasy) === matchByTasy));
  const osIds = new Set(osList.map(o=>o.id));
  for(const o of osList){
    addEvent("manut", o.createdAt, "OS gerada", `OS #${o.seq} • Prevista:${o.prevista || "—"}`);
    if(o.atendidaEm){
      addEvent("manut", o.updatedAt || o.createdAt, "OS atendida", `OS #${o.seq} • ${o.atendidaEm}`);
    }
  }

  const laudos = db.laudos.filter(l =>
    l.equipKey === equipKey ||
    (matchByTasy && norm(l.tasy) === matchByTasy) ||
    (l.osId && osIds.has(l.osId))
  );
  for(const l of laudos){
    const at = l.modifiedTime || l.createdTime || l.scannedAt || l.createdAt;
    const nome = l.fileName || l.nomeFinal || "Laudo";
    const link = l.link || l.caminhoRelativo || "";
    const ref = l.osId ? `OS:${l.osId}` : (l.manutId ? `Manut:${l.manutId}` : "");
    const details = `${nome}${ref ? " • " + ref : ""}${link ? " • " + link : ""}`;
    addEvent("laudos", at, "Laudo vinculado", details);
  }

  const extra = (db.eventos || []).filter(ev => ev.equipKey === equipKey || (matchByTasy && norm(ev.tasy) === matchByTasy));
  for(const ev of extra){
    addEvent(ev.type || "equip", ev.at, ev.title, ev.details);
  }

  return events.sort((a,b)=> (a.at < b.at ? 1 : -1));
}

function renderEquipHistory(){
  const e = db.equipamentos.find(x=>keyOfEquip(x)===viewingEquipKey);
  if(!e) return;
  const filter = histEquipFilter.value || "all";
  const list = document.getElementById("histEquipList");
  document.getElementById("histEquipTitle").innerText = `Histórico do equipamento`;
  document.getElementById("histEquipSubtitle").innerText = `${e.nome || "—"} • TASY:${e.tasy || "—"} • Setor:${sectorNameFromEquip(e)}`;

  let events = buildEquipTimeline(e);
  if(filter !== "all") events = events.filter(ev=>ev.type===filter);

  if(events.length===0){
    list.innerHTML = `<div class="muted">Nenhum registro para este filtro.</div>`;
    return;
  }

  list.innerHTML = events.map(ev=>`
    <div class="card" style="margin-bottom:10px">
      <div class="row">
        <div style="font-weight:1100">${escapeHtml(ev.title)}</div>
        <div class="right muted small">${escapeHtml(formatDateTime(ev.at))}</div>
      </div>
      <div class="muted small" style="margin-top:6px">${escapeHtml(ev.details || "—")}</div>
    </div>
  `).join("");
}

window.openEquipHistory = (equipKey)=>{
  const e = db.equipamentos.find(x=>keyOfEquip(x)===equipKey);
  if(!e) return alert("Equipamento não encontrado.");
  viewingEquipKey = equipKey;
  histEquipFilter.value = "all";
  renderEquipHistory();
  modalHistEquip.style.display = "flex";
};

btnSaveEq.addEventListener("click", ()=>{
  const e = getEqFields();
  if(!e.tasy && !e.patrimonio) return alert("Informe TASY ou Patrimônio.");
  if(!e.nome) return alert("Informe nome/descrição.");

  const k = keyOfEquip(e);
  if(!k) return alert("Chave inválida.");

  const dup = db.equipamentos.some(x=>keyOfEquip(x)===k && keyOfEquip(x)!==editingEquipKey);
  if(dup) return alert("Já existe equipamento com esse TASY/Patrimônio.");

  if(!editingEquipKey){
    db.equipamentos.push({ ...e, createdAt: nowISO(), updatedAt: nowISO() });
    log("EQUIP_CREATE", `Criado ${k} (${e.nome})`);
  }else{
    const idx = db.equipamentos.findIndex(x=>keyOfEquip(x)===editingEquipKey);
    if(idx<0) return alert("Equipamento não encontrado.");
    // OBS: aqui é edição manual, então pode alterar recebePreventiva
    db.equipamentos[idx] = { ...db.equipamentos[idx], ...e, updatedAt: nowISO() };

    // se mudou chave (tasy/patrimonio), precisamos re-ligar manutenções
    const newKey = keyOfEquip(db.equipamentos[idx]);
    if(newKey !== editingEquipKey){
      for(const m of db.manutencoes){
        if(m.equipKey === editingEquipKey){
          m.equipKey = newKey;
        }
      }
    }

    log("EQUIP_UPDATE", `Atualizado ${editingEquipKey} → ${keyOfEquip(e)}`);
  }

  saveDB();
  modalEq.style.display = "none";
  renderAll();
});

btnDelEq.addEventListener("click", ()=>{
  if(!editingEquipKey) return;
  const hasManut = db.manutencoes.some(m=>m.equipKey===editingEquipKey);
  if(hasManut) return alert("Esse equipamento tem manutenções vinculadas. Remova/realinhe as manutenções antes.");
  if(!confirm("Excluir equipamento?")) return;
  db.equipamentos = db.equipamentos.filter(x=>keyOfEquip(x)!==editingEquipKey);
  saveDB();
  log("EQUIP_DELETE", `Excluído ${editingEquipKey}`);
  modalEq.style.display = "none";
  renderAll();
});

const elSearchEq = document.getElementById("searchEq");
const elFilterEq = document.getElementById("filterEq");
const elFilterEqTipo = document.getElementById("filterEqTipo");
elSearchEq.addEventListener("input", renderEquipList);
elFilterEq.addEventListener("change", renderEquipList);
elFilterEqTipo.addEventListener("change", renderEquipList);

function refreshTipoFilter(){
  if(!elFilterEqTipo) return;
  const current = norm(elFilterEqTipo.value);
  elFilterEqTipo.innerHTML = `<option value="">Tipo (todos)</option><option value="__SEM__">Sem tipo</option>`;
  const sorted = db.tipos.slice().sort((a,b)=>norm(a.nome).localeCompare(norm(b.nome)));
  for(const t of sorted){
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = t.nome;
    elFilterEqTipo.appendChild(opt);
  }
  if(current && Array.from(elFilterEqTipo.options).some(o=>o.value===current)){
    elFilterEqTipo.value = current;
  }
}

function renderEquipList(){
  const q = norm(elSearchEq.value).toLowerCase();
  const f = norm(elFilterEq.value);
  const fTipo = norm(elFilterEqTipo?.value || "");
  const el = document.getElementById("eqList");

  if(!showEquipList){
    el.innerHTML = `<div class="muted">Lista oculta. Clique em “Mostrar lista”.</div>`;
    return;
  }

  let rows = db.equipamentos.slice();

  rows = rows.filter(e=>{
    if(f==="ativo" && e.status!=="ativo") return false;
    if(f==="descontinuado" && e.status!=="descontinuado") return false;
    if(f==="nao_recebe" && e.recebePreventiva!==false) return false;
    if(fTipo){
      if(fTipo==="__SEM__" && e.tipoId) return false;
      if(fTipo!=="__SEM__" && String(e.tipoId || "") !== fTipo) return false;
    }

    const setor = sectorNameFromEquip(e);
    const hay = `${e.nome} ${e.tasy} ${e.patrimonio} ${setor} ${e.modelo} ${typeName(e.tipoId)}`.toLowerCase();
    return !q || hay.includes(q);
  });

  rows.sort((a,b)=> (norm(sectorNameFromEquip(a)).localeCompare(norm(sectorNameFromEquip(b))) || norm(a.nome).localeCompare(norm(b.nome))));

  if(rows.length===0){
    el.innerHTML = `<div class="muted">Nenhum equipamento encontrado.</div>`;
    return;
  }

  el.innerHTML = rows.map(e=>{
    const k = keyOfEquip(e);
    const tipo = typeName(e.tipoId);
    const setor = sectorNameFromEquip(e);
    const pill = e.status==="ativo" ? `<span class="pill ok">Ativo</span>` : `<span class="pill bad">Descontinuado</span>`;
    const rp = e.recebePreventiva===false ? `<span class="pill warn">Não recebe preventiva</span>` : "";
    return `
      <div class="card" style="margin-bottom:10px">
        <div class="row">
          <div style="font-weight:1100">${escapeHtml(e.nome||"—")}</div>
          <div class="right">${pill} ${rp}</div>
        </div>
        <div class="muted small" style="margin-top:6px">
          <b>Tipo:</b> ${escapeHtml(tipo)} •
          <b>Setor:</b> ${escapeHtml(setor)} •
          <b>TASY:</b> ${escapeHtml(e.tasy||"—")} •
          <b>Patrimônio:</b> ${escapeHtml(e.patrimonio||"—")} •
          <b>Modelo:</b> ${escapeHtml(e.modelo||"—")}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn soft" onclick="openEditEquip('${k.replaceAll("'","\\'")}')">✏️ Editar</button>
          <button class="btn gray" onclick="openEquipHistory('${k.replaceAll("'","\\'")}')">👁️ Ver equipamento</button>
        </div>
      </div>
    `;
  }).join("");
}

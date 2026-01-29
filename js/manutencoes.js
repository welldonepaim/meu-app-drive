"use strict";

// =====================
// MANUTENÇÕES (CRUD)
// =====================
const modalManut = document.getElementById("modalManut");
const btnNovaManut = document.getElementById("btnNovaManut");
const btnCloseManut = document.getElementById("btnCloseManut");
const btnSaveManut = document.getElementById("btnSaveManut");
const btnDelManut  = document.getElementById("btnDelManut");
const modalManutTitle = document.getElementById("modalManutTitle");
const modalOS = document.getElementById("modalOS");
const btnCloseOS = document.getElementById("btnCloseOS");
const btnAtenderOS = document.getElementById("btnAtenderOS");
let editingManutId = null;
let viewingOsId = null;

btnNovaManut.addEventListener("click", ()=>{
  editingManutId = null;
  modalManutTitle.innerText = "Nova manutenção";
  btnDelManut.style.display = "none";
  setManutFields({ tasy:"", atividade:"", ultima:"", periodicidadeDias:"", proxima:"", planAtivo:true });
  modalManut.style.display = "flex";
});
btnCloseManut.addEventListener("click", ()=> modalManut.style.display="none");
modalManut.addEventListener("click", (e)=>{ if(e.target===modalManut) modalManut.style.display="none"; });

function setManutFields(m){
  document.getElementById("mSeq").value = m.seq ? String(m.seq) : "";
  document.getElementById("mTasy").value = norm(m.tasy);
  document.getElementById("mAtiv").value = norm(m.atividade);
  document.getElementById("mUlt").value = norm(m.ultima);
  document.getElementById("mPer").value = norm(m.periodicidadeDias);
  document.getElementById("mProx").value = norm(m.proxima);
  document.getElementById("mAtivo").value = (m.planAtivo === false) ? "false" : "true";
}

function computeProximaFromFields(){
  const ultima = normalizeDateBR(document.getElementById("mUlt").value);
  const per = toIntSafe(document.getElementById("mPer").value);
  const prox = addDaysBR(ultima, per);
  document.getElementById("mProx").value = prox;
}

document.getElementById("mUlt").addEventListener("input", computeProximaFromFields);
document.getElementById("mPer").addEventListener("input", computeProximaFromFields);

function getManutFields(){

  const tasy = norm(document.getElementById("mTasy").value);
  const ultima = normalizeDateBR(document.getElementById("mUlt").value);
  const per = toIntSafe(document.getElementById("mPer").value);
  const proxima = addDaysBR(ultima, per) || normalizeDateBR(document.getElementById("mProx").value);
  return {
    seq: Number(document.getElementById("mSeq").value) || null,
    tasy,
    atividade: norm(document.getElementById("mAtiv").value),
    ultima,
    periodicidadeDias: per,
    proxima,
    planAtivo: document.getElementById("mAtivo").value === "true"
  };
}

function makeManutId(equipKey, atividade){
  return planKeyOf(equipKey, atividade);
}

window.openEditManut = (id)=>{
  const m = db.manutencoes.find(x=>x.id===id);
  if(!m) return alert("Manutenção não encontrada.");
  editingManutId = id;
  modalManutTitle.innerText = "Editar manutenção";
  btnDelManut.style.display = "";
  setManutFields(m);
  modalManut.style.display = "flex";
};

function tipoSiglaFromEquip(eq){
  const nome = norm(eq ? typeName(eq.tipoId) : "");
  const s = nome.replace(/[^A-Za-z0-9]/g,"");
  return (s || "SEM").slice(0,4).toUpperCase();
}


btnSaveManut.addEventListener("click", ()=>{
  const m = getManutFields();
  if(!m.tasy) return alert("Informe o TASY.");
  if(!m.atividade) return alert("Informe a atividade.");
  if(!m.ultima) return alert("Informe a data da última (dd/mm/aaaa ou mm/aa).");
  if(!m.periodicidadeDias) return alert("Informe a periodicidade (dias).");

  const eq = findEquipByTasy(m.tasy);
  const equipKey = eq ? keyOfEquip(eq) : `tasy:${m.tasy}`; // se não achar, fica pendente

  const planKey = planKeyOf(equipKey, m.atividade);
  const activeExists = db.manutencoes.some(x=>x.planKey===planKey && x.planAtivo !== false && x.id!==editingManutId);
  if(activeExists) return alert("Já existe uma manutenção ativa para esse equipamento/atividade.");

  const seq = m.seq || nextPlanSeq();
  const newId = makeManutId(equipKey, m.atividade);
  const id = editingManutId || newId;

  if(!editingManutId){
    const exists = db.manutencoes.some(x=>x.id===id);
    if(exists) return alert("Já existe manutenção com essa atividade para este equipamento.");
    db.manutencoes.push({
      id,
      equipKey,
      seq,
      planKey,
      planAtivo: m.planAtivo !== false,
      ...m,
      createdAt: nowISO(),
      updatedAt: nowISO()
    });
    log("MANUT_CREATE", `Criada ${id}`);
    addTimelineEvent({
      equipKey,
      tasy: m.tasy,
      type: "manut",
      title: "Manutenção criada",
      details: `#${seq} • ${m.atividade || "—"} • Última:${m.ultima || "—"}`
    });
  }else{
    const idx = db.manutencoes.findIndex(x=>x.id===editingManutId);
    if(idx<0) return alert("Manutenção não encontrada.");
    db.manutencoes[idx] = {
      ...db.manutencoes[idx],
      equipKey,
      planKey,
      seq,
      planAtivo: m.planAtivo !== false,
      ...m,
      updatedAt: nowISO()
    };
    // se id mudou por troca de atividade/tasy, precisamos evitar colisão
    if(newId !== editingManutId){
      if(db.manutencoes.some(x=>x.id===newId)) return alert("Conflito: já existe uma manutenção com esse id.");
      db.manutencoes[idx].id = newId;
      log("MANUT_UPDATE", `Atualizada ${editingManutId} → ${newId}`);
      addTimelineEvent({
        equipKey,
        tasy: m.tasy,
        type: "manut",
        title: "Manutenção atualizada",
        details: `#${seq} • ${m.atividade || "—"} • Última:${m.ultima || "—"} • Próxima:${m.proxima || "—"}`
      });
    }else{
      log("MANUT_UPDATE", `Atualizada ${id}`);
      addTimelineEvent({
        equipKey,
        tasy: m.tasy,
        type: "manut",
        title: "Manutenção atualizada",
        details: `#${seq} • ${m.atividade || "—"} • Última:${m.ultima || "—"} • Próxima:${m.proxima || "—"}`
      });
    }
  }

  saveDB();
  modalManut.style.display = "none";
  renderAll();
});

btnDelManut.addEventListener("click", ()=>{
  if(!editingManutId) return;
  if(!confirm("Excluir manutenção?")) return;
  db.manutencoes = db.manutencoes.filter(x=>x.id!==editingManutId);
  addTimelineEvent({
    equipKey: editingManutId.split("::")[0],
    tasy: "",
    type: "manut",
    title: "Manutenção excluída",
    details: `${editingManutId}`
  });
  saveDB();
  log("MANUT_DELETE", `Excluída ${editingManutId}`);
  modalManut.style.display = "none";
  renderAll();
});


const elSearchManut = document.getElementById("searchManut");
const elFilterManut = document.getElementById("filterManut");
elSearchManut.addEventListener("input", renderManutList);
elFilterManut.addEventListener("change", renderManutList);

function renderManutList(){
  const q = norm(elSearchManut.value).toLowerCase();
  const f = norm(elFilterManut.value);
  const el = document.getElementById("manutList");

  let rows = db.manutencoes.slice().map(m=>{
    const eq = db.equipamentos.find(e=>keyOfEquip(e)===m.equipKey) || findEquipByTasy(m.tasy);
    const eqNome = eq ? eq.nome : "(equipamento não encontrado)";
    const setor = eq ? sectorNameFromEquip(eq) : "—";
    const tipo = eq ? typeName(eq.tipoId) : "—";
    return { ...m, _eqNome: eqNome, _setor: setor, _tipo: tipo, _planAtivo: m.planAtivo !== false };
  });

  rows = rows.filter(m=>{
    if(f === "inativos" && m._planAtivo) return false;
    if((!f || f === "ativos") && !m._planAtivo) return false;
    const hay = `${m._eqNome} ${m.tasy} ${m._setor} ${m._tipo} ${m.atividade}`.toLowerCase();
    return !q || hay.includes(q);
  });

  rows.sort((a,b)=>{
    const da = parseBRToDate(a.proxima)?.getTime() ?? 9e18;
    const dbb = parseBRToDate(b.proxima)?.getTime() ?? 9e18;
    return da - dbb;
  });

  if(rows.length===0){
    el.innerHTML = `<div class="muted">Nenhum planejamento encontrado.</div>`;
    return;
  }

  el.innerHTML = rows.map(m=>{
    const pill = m._planAtivo ? `<span class="pill ok">Ativo</span>` : `<span class="pill neutral">Inativo</span>`;
    return `
      <div class="card" style="margin-bottom:10px">
        <div class="row">
          <div style="font-weight:1100">#${escapeHtml(m.seq || "—")} ${escapeHtml(m._eqNome)} <span class="muted small">(${escapeHtml(m.tasy || "—")})</span></div>
          <div class="right">${pill}</div>
        </div>

        <div class="muted small" style="margin-top:6px">
          <b>Atividade:</b> ${escapeHtml(m.atividade || "—")} •
          <b>Tipo:</b> ${escapeHtml(m._tipo)} •
          <b>Setor:</b> ${escapeHtml(m._setor)}
        </div>

        <div class="muted small" style="margin-top:6px">
          <b>Última:</b> ${escapeHtml(m.ultima || "—")} •
          <b>Periodicidade:</b> ${escapeHtml(m.periodicidadeDias || "—")} dias •
          <b>Próxima:</b> ${escapeHtml(m.proxima || "—")}
        </div>

        <div class="row" style="margin-top:10px">
          <button class="btn soft" onclick="openEditManut('${m.id.replaceAll("'","\\'")}')">✏️ Editar</button>
        </div>
      </div>
    `;
  }).join("");
}

function setOsFields(o){
  document.getElementById("osSeq").value = o.seq ? String(o.seq) : "";
  document.getElementById("osTasy").value = norm(o.tasy);
  document.getElementById("osAtiv").value = norm(o.atividade);
  document.getElementById("osPrevista").value = norm(o.prevista);
  const disabled = o.status !== "aberta";
  btnAtenderOS.disabled = disabled;
  btnAtenderOS.innerText = disabled ? "✅ Atendida" : "✅ Atender OS";
  renderOsLaudoInfo(o);
}

function renderOsLaudoInfo(o){
  const el = document.getElementById("osLaudoInfo");
  if(!el) return;
  const eq = db.equipamentos.find(e=>keyOfEquip(e)===o.equipKey) || findEquipByTasy(o.tasy);
  const laudo = eq ? getLatestLaudoForEquip(eq) : null;
  if(!laudo || !laudo.link){
    el.innerText = "Nenhum laudo vinculado.";
    return;
  }
  const name = escapeHtml(laudo.fileName || "Abrir laudo");
  const link = escapeHtml(laudo.link);
  el.innerHTML = `Último laudo: <a href="${link}" target="_blank" rel="noopener">${name}</a>`;
}

function openOS(osId){
  const o = db.os.find(x=>x.id===osId);
  if(!o) return alert("OS não encontrada.");
  viewingOsId = osId;
  document.getElementById("modalOSTitle").innerText = `OS #${o.seq}`;
  setOsFields(o);
  modalOS.style.display = "flex";
}

window.openOS = openOS;

btnCloseOS.addEventListener("click", ()=> modalOS.style.display="none");
modalOS.addEventListener("click", (e)=>{ if(e.target===modalOS) modalOS.style.display="none"; });

btnAtenderOS.addEventListener("click", async ()=>{
  if(!viewingOsId) return;
  const o = db.os.find(x=>x.id===viewingOsId);
  if(!o) return alert("OS não encontrada.");
  if(o.status !== "aberta") return alert("OS já atendida.");
  const eq = db.equipamentos.find(e=>keyOfEquip(e)===o.equipKey) || findEquipByTasy(o.tasy);
  const laudo = eq ? getLatestLaudoForEquip(eq) : null;
  if(!laudo || !laudo.link) return alert("Nenhum laudo vinculado para este equipamento.");

  const atendimento = o.prevista || dateToBR(new Date());
  o.status = "atendida";
  o.atendidaEm = atendimento;
  o.updatedAt = nowISO();
  o.laudoLink = laudo.link;

  const plan = db.manutencoes.find(p=>p.planKey===o.planKey);
  if(plan){
    plan.ultima = atendimento;
    plan.proxima = addDaysBR(plan.ultima, plan.periodicidadeDias);
    plan.updatedAt = nowISO();
  }

  addTimelineEvent({
    equipKey: o.equipKey,
    tasy: o.tasy,
    type: "manut",
    title: "OS atendida",
    details: `OS #${o.seq} • ${o.atividade || "—"} • ${laudo.fileName || "Laudo"}`
  });

  saveDB();
  renderAll();
  modalOS.style.display = "none";
  alert("OS atendida.");
});

const elSearchOS = document.getElementById("searchOS");
const elFilterOS = document.getElementById("filterOS");
elSearchOS.addEventListener("input", renderOSList);
elFilterOS.addEventListener("change", renderOSList);

function renderOSList(){
  ensureOsForUpcoming();
  const q = norm(elSearchOS.value).toLowerCase();
  const f = norm(elFilterOS.value) || "abertas";
  const el = document.getElementById("osList");

  let rows = db.os.slice().map(o=>{
    const eq = db.equipamentos.find(e=>keyOfEquip(e)===o.equipKey) || findEquipByTasy(o.tasy);
    const eqNome = eq ? eq.nome : "(equipamento não encontrado)";
    const setor = eq ? sectorNameFromEquip(eq) : "—";
    const tipo = eq ? typeName(eq.tipoId) : "—";
    return { ...o, _eqNome: eqNome, _setor: setor, _tipo: tipo };
  });

  rows = rows.filter(o=>{
    if(f === "abertas" && o.status !== "aberta") return false;
    if(f === "atendidas" && o.status !== "atendida") return false;
    const hay = `${o._eqNome} ${o.tasy} ${o._setor} ${o._tipo} ${o.atividade}`.toLowerCase();
    return !q || hay.includes(q);
  });

  rows.sort((a,b)=>{
    const da = parseBRToDate(a.prevista)?.getTime() ?? 9e18;
    const dbb = parseBRToDate(b.prevista)?.getTime() ?? 9e18;
    return da - dbb;
  });

  if(rows.length===0){
    el.innerHTML = `<div class="muted">Nenhuma OS encontrada.</div>`;
    return;
  }

  el.innerHTML = rows.map(o=>{
    const pill = o.status === "aberta" ? `<span class="pill warn">Aberta</span>` : `<span class="pill ok">Atendida</span>`;
    const btnLabel = o.status === "aberta" ? "✅ Atender" : "👁️ Ver";
    return `
      <div class="card" style="margin-bottom:10px">
        <div class="row">
          <div style="font-weight:1100">OS #${escapeHtml(o.seq || "—")} ${escapeHtml(o._eqNome)} <span class="muted small">(${escapeHtml(o.tasy || "—")})</span></div>
          <div class="right">${pill}</div>
        </div>

        <div class="muted small" style="margin-top:6px">
          <b>Atividade:</b> ${escapeHtml(o.atividade || "—")} •
          <b>Tipo:</b> ${escapeHtml(o._tipo)} •
          <b>Setor:</b> ${escapeHtml(o._setor)}
        </div>

        <div class="muted small" style="margin-top:6px">
          <b>Prevista:</b> ${escapeHtml(o.prevista || "—")} •
          <b>Status:</b> ${escapeHtml(o.status || "—")}
        </div>

        <div class="row" style="margin-top:10px">
          <button class="btn primary" onclick="openOS('${o.id.replaceAll("'","\\'")}')">${btnLabel}</button>
        </div>
      </div>
    `;
  }).join("");
}

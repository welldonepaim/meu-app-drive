"use strict";

// =====================
// TIPOS
// =====================
document.getElementById("btnAddTipo").addEventListener("click", ()=>{
  const nome = norm(document.getElementById("newTipoNome").value);
  if(!nome) return alert("Informe o nome do tipo.");
  const exists = db.tipos.some(t => norm(t.nome).toLowerCase() === nome.toLowerCase());
  if(exists) return alert("Esse tipo já existe.");

  const id = db.tipos.length ? Math.max(...db.tipos.map(t=>t.id)) + 1 : 1;
  db.tipos.push({ id, nome });
  document.getElementById("newTipoNome").value = "";
  saveDB();
  log("TIPO_CREATE", `Criado tipo ${id} (${nome})`);
  renderAll();
});

function renderTipos(){
  const el = document.getElementById("tipoList");
  if(db.tipos.length === 0){
    el.innerHTML = `<div class="muted">Nenhum tipo cadastrado.</div>`;
    return;
  }
  el.innerHTML = db.tipos
    .slice()
    .sort((a,b)=> norm(a.nome).localeCompare(norm(b.nome)))
    .map(t=>`
      <div class="card" style="margin-bottom:10px">
        <div class="row">
          <div style="font-weight:1100">${escapeHtml(t.nome)}</div>
          <div class="right">
            <button class="btn soft" onclick="editTipo(${t.id})">✏️ Editar</button>
            <button class="btn danger" onclick="delTipo(${t.id})">🗑</button>
          </div>
        </div>
      </div>
    `).join("");
}

window.editTipo = (id)=>{
  const t = db.tipos.find(x=>x.id===id);
  if(!t) return;
  const novo = prompt("Novo nome do tipo:", t.nome);
  if(novo === null) return;
  const nome = norm(novo);
  if(!nome) return alert("Nome inválido.");
  t.nome = nome;
  saveDB();
  log("TIPO_UPDATE", `Tipo ${id} renomeado para ${nome}`);
  renderAll();
};

window.delTipo = (id)=>{
  const inUse = db.equipamentos.some(e=>e.tipoId===id);
  if(inUse) return alert("Esse tipo está em uso em equipamentos. Troque o tipo desses equipamentos antes.");
  if(!confirm("Excluir tipo?")) return;
  db.tipos = db.tipos.filter(x=>x.id!==id);
  saveDB();
  log("TIPO_DELETE", `Excluído tipo ${id}`);
  renderAll();
};

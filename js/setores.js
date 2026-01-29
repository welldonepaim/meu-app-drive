"use strict";

// =====================
// SETORES
// =====================
document.getElementById("btnAddSetor").addEventListener("click", ()=>{
  const nome = norm(document.getElementById("newSetorNome").value);
  if(!nome) return alert("Informe o nome do setor.");
  const exists = db.setores.some(s => norm(s.nome).toLowerCase() === nome.toLowerCase());
  if(exists) return alert("Esse setor já existe.");

  const id = db.setores.length ? Math.max(...db.setores.map(s=>s.id)) + 1 : 1;
  db.setores.push({ id, nome });
  document.getElementById("newSetorNome").value = "";
  saveDB();
  log("SETOR_CREATE", `Criado setor ${id} (${nome})`);
  renderAll();
});

function renderSetores(){
  const el = document.getElementById("setorList");
  if(db.setores.length === 0){
    el.innerHTML = `<div class="muted">Nenhum setor cadastrado.</div>`;
    return;
  }
  el.innerHTML = db.setores
    .slice()
    .sort((a,b)=> norm(a.nome).localeCompare(norm(b.nome)))
    .map(s=>`
      <div class="card" style="margin-bottom:10px">
        <div class="row">
          <div style="font-weight:1100">${escapeHtml(s.nome)} <span class="pill neutral">ID ${s.id}</span></div>
          <div class="right">
            <button class="btn soft" onclick="editSetor(${s.id})">✏️ Editar</button>
            <button class="btn danger" onclick="delSetor(${s.id})">🗑</button>
          </div>
        </div>
      </div>
    `).join("");
}

window.editSetor = (id)=>{
  const s = db.setores.find(x=>x.id===id);
  if(!s) return;
  const novo = prompt("Novo nome do setor:", s.nome);
  if(novo === null) return;
  const nome = norm(novo);
  if(!nome) return alert("Nome inválido.");
  const exists = db.setores.some(x=>x.id!==id && norm(x.nome).toLowerCase() === nome.toLowerCase());
  if(exists) return alert("Já existe um setor com esse nome.");

  s.nome = nome;
  saveDB();
  log("SETOR_UPDATE", `Setor ${id} renomeado para ${nome}`);
  renderAll();
};

window.delSetor = (id)=>{
  const s = db.setores.find(x=>x.id===id);
  if(!s) return;
  const inUse = db.equipamentos.some(e=>Number(e.setorId) === id);
  if(inUse) return alert("Esse setor está em uso em equipamentos. Troque o setor desses equipamentos antes.");
  if(!confirm("Excluir setor?")) return;
  db.setores = db.setores.filter(x=>x.id!==id);
  saveDB();
  log("SETOR_DELETE", `Excluído setor ${id}`);
  renderAll();
};

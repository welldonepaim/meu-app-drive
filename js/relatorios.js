"use strict";

const RELATORIOS_DB_NAME = "relatorios_db";
const RELATORIOS_STORE = "handles";
const RELATORIOS_KEY = "rootHandle";
let relatoriosRoot = null;

function sanitizeFsName(s){
  return String(s || "")
    .replace(/[\\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function openRelatoriosDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(RELATORIOS_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(RELATORIOS_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function saveRelatoriosRoot(handle){
  const dbi = await openRelatoriosDB();
  return new Promise((resolve, reject)=>{
    const tx = dbi.transaction(RELATORIOS_STORE, "readwrite");
    tx.objectStore(RELATORIOS_STORE).put(handle, RELATORIOS_KEY);
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}

async function loadRelatoriosRoot(){
  const dbi = await openRelatoriosDB();
  return new Promise((resolve, reject)=>{
    const tx = dbi.transaction(RELATORIOS_STORE, "readonly");
    const req = tx.objectStore(RELATORIOS_STORE).get(RELATORIOS_KEY);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  });
}

function setRelatoriosRootInfo(text){
  const el = document.getElementById("relatoriosRootInfo");
  if(el) el.innerText = text;
}

async function initRelatoriosRoot(){
  try{
    const handle = await loadRelatoriosRoot();
    if(!handle) return;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if(perm !== "granted"){
      const req = await handle.requestPermission({ mode: "readwrite" });
      if(req !== "granted") return;
    }
    relatoriosRoot = handle;
    window.relatoriosRoot = relatoriosRoot;
    setRelatoriosRootInfo("Pasta de exportação carregada.");
  }catch(err){
    console.error(err);
  }
}

async function selectRelatoriosRoot(){
  if(!window.showDirectoryPicker){
    alert("Seu navegador não suporta seleção de pasta.");
    return;
  }
  try{
    relatoriosRoot = await window.showDirectoryPicker();
    window.relatoriosRoot = relatoriosRoot;
    await saveRelatoriosRoot(relatoriosRoot);
    setRelatoriosRootInfo("Pasta de exportação selecionada.");
  }catch(err){
    console.error(err);
  }
}

async function ensureRelatoriosRoot(){
  if(relatoriosRoot) return relatoriosRoot;
  const handle = await loadRelatoriosRoot();
  if(!handle) return null;
  const perm = await handle.queryPermission({ mode: "readwrite" });
  if(perm !== "granted"){
    const req = await handle.requestPermission({ mode: "readwrite" });
    if(req !== "granted") return null;
  }
  relatoriosRoot = handle;
  window.relatoriosRoot = relatoriosRoot;
  return relatoriosRoot;
}

async function ensureDirLocal(rootHandle, path){
  const parts = String(path || "").split("/").filter(Boolean);
  let current = rootHandle;
  for(const p of parts){
    current = await current.getDirectoryHandle(p, { create: true });
  }
  return current;
}

function renderRelatoriosFilters(){
  const selSetor = document.getElementById("relSetor");
  const selTipo = document.getElementById("relTipo");
  if(!selSetor || !selTipo) return;

  const prevSetor = selSetor.value;
  const prevTipos = Array.from(selTipo.selectedOptions || []).map(o=>o.value);

  selSetor.innerHTML = `<option value="">Todos os setores</option><option value="__SEM__">(sem setor)</option>`;
  db.setores
    .slice()
    .sort((a,b)=> norm(a.nome).localeCompare(norm(b.nome)))
    .forEach(s=>{
      const opt = document.createElement("option");
      opt.value = String(s.id);
      opt.textContent = s.nome;
      selSetor.appendChild(opt);
    });

  selTipo.innerHTML = `<option value="__SEM__">(sem tipo)</option>`;
  db.tipos
    .slice()
    .sort((a,b)=> norm(a.nome).localeCompare(norm(b.nome)))
    .forEach(t=>{
      const opt = document.createElement("option");
      opt.value = String(t.id);
      opt.textContent = t.nome;
      selTipo.appendChild(opt);
    });

  if(prevSetor && Array.from(selSetor.options).some(o=>o.value===prevSetor)) selSetor.value = prevSetor;
  if(prevTipos.length){
    const options = Array.from(selTipo.options);
    for(const opt of options){
      if(prevTipos.includes(opt.value)) opt.selected = true;
    }
  }
}

function getRelatorioFilters(){
  const tipoSelected = Array.from(document.getElementById("relTipo").selectedOptions || [])
    .map(o=>norm(o.value))
    .filter(Boolean);
  return {
    setor: norm(document.getElementById("relSetor").value),
    tipos: tipoSelected,
    somenteComTipo: document.getElementById("relSomenteComTipo").checked,
    fields: {
      showTasy: document.getElementById("relShowTasy").checked,
      showPat: document.getElementById("relShowPat").checked,
      showModelo: document.getElementById("relShowModelo").checked,
      showStatus: document.getElementById("relShowStatus").checked,
      showRecebe: document.getElementById("relShowRecebe").checked,
      showPlanAtivo: document.getElementById("relShowPlanAtivo").checked,
      showPlanDatas: document.getElementById("relShowPlanDatas").checked,
      showPlanPer: document.getElementById("relShowPlanPer").checked,
      showAtividade: document.getElementById("relShowAtividade").checked
    }
  };
}

function matchesSetorFilter(e, setorFilter){
  if(!setorFilter) return true;
  const setorId = e.setorId ? String(e.setorId) : "";
  if(setorFilter === "__SEM__") return !setorId && !norm(e.setor);
  return setorId === setorFilter;
}

function matchesTipoFilter(e, tipoFilter, somenteComTipo){
  const tipoId = e.tipoId ? String(e.tipoId) : "";
  if(somenteComTipo && !tipoId) return false;
  if(!tipoFilter || tipoFilter.length === 0) return true;
  if(tipoFilter.includes("__SEM__") && !tipoId) return true;
  return tipoFilter.includes(tipoId);
}

function buildRelatorioTable(setorNome, equipamentos, filters){
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "2-digit" }).format(now);
  const totalPlanos = equipamentos.reduce((acc, e)=> acc + countPlansForEquip(e), 0);
  const f = filters.fields || {};

  const formatMonthYear = (br)=>{
    const d = parseBRToDate(br);
    if(!d) return br || "Indisp.";
    return `${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
  };

  const today = new Date();
  today.setHours(0,0,0,0);

  const rows = [];
  const sorted = equipamentos.slice().sort((a,b)=> norm(a.nome).localeCompare(norm(b.nome)));
  for(const e of sorted){
    const descBase = norm(e.nome) || "-";
    const planos = listPlansForEquip(e);
    const laudo = getLatestLaudoForEquip(e);
    const link = laudo && laudo.link ? String(laudo.link) : "";
    const laudoLabel = link ? "link" : "Indisp.";

    let ultimaLabel = "Indisp.";
    let proximaLabel = "Indisp.";
    if(planos.length){
      let bestUltima = "";
      let bestUltimaMs = 0;
      let bestProxima = "";
      let bestProximaMs = 0;
      for(const p of planos){
        const u = norm(p.ultima);
        const pu = parseBRToDate(u);
        const um = pu ? pu.getTime() : 0;
        if(u && (!bestUltima || (um && um >= bestUltimaMs))){
          bestUltima = u;
          bestUltimaMs = um || bestUltimaMs;
        }
        const pr = norm(p.proxima);
        const pp = parseBRToDate(pr);
        const pm = pp ? pp.getTime() : 0;
        if(pr && (!bestProxima || (pm && (!bestProximaMs || pm <= bestProximaMs)))){
          bestProxima = pr;
          bestProximaMs = pm || bestProximaMs;
        }
      }
      ultimaLabel = bestUltima || "Indisp.";
      proximaLabel = bestProxima || "Indisp.";
    }

    let proximaTxt = formatMonthYear(proximaLabel);
    const ultimaTxt = formatMonthYear(ultimaLabel);
    const dProx = parseBRToDate(proximaLabel);
    if(dProx && dProx < today && link){
      proximaTxt = `${proximaTxt}*`;
    }

    const atividades = planos
      .map(p=>norm(p.atividade))
      .filter(Boolean);
    const atividadesTxt = Array.from(new Set(atividades)).join(", ");
    const descricao = (f.showAtividade && atividadesTxt)
      ? `${descBase} / ${atividadesTxt}`
      : descBase;

    rows.push({
      patrimonio: f.showPat ? (norm(e.patrimonio) || "-") : "",
      tasy: f.showTasy ? (norm(e.tasy) || "-") : "",
      descricao,
      ultima: f.showPlanDatas ? ultimaTxt : "",
      proxima: f.showPlanDatas ? proximaTxt : "",
      laudo: laudoLabel,
      laudoLink: link || "",
      vencida: Boolean(dProx && dProx < today && link)
    });
  }

  return {
    title: "RELATORIO DE PREVENTIVAS",
    setor: setorNome || "SEM SETOR",
    geradoEm: dateStr,
    filtroSomenteComTipo: Boolean(filters.somenteComTipo),
    totalEquip: equipamentos.length,
    totalPlanos,
    rows
  };
}

function countPlansForEquip(e){
  return listPlansForEquip(e).length;
}

function listPlansForEquip(e){
  const equipKey = keyOfEquip(e);
  const matchByTasy = norm(e.tasy);
  return db.manutencoes
    .filter(m => m.equipKey === equipKey || (matchByTasy && norm(m.tasy) === matchByTasy))
    .sort((a,b)=> norm(a.atividade).localeCompare(norm(b.atividade)));
}

function wrapLines(lines, maxChars){
  const out = [];
  for(const line of lines){
    if(!line){
      out.push("");
      continue;
    }
    let rest = String(line);
    while(rest.length > maxChars){
      let cut = rest.lastIndexOf(" ", maxChars);
      if(cut < 20) cut = maxChars;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}

function pdfEscapeText(s){
  const input = String(s ?? "");
  let out = "";
  for(let i=0;i<input.length;i++){
    let code = input.charCodeAt(i);
    if(code > 255) code = 63;
    if(code === 0x28 || code === 0x29 || code === 0x5c){
      out += "\\" + String.fromCharCode(code);
      continue;
    }
    if(code < 32 || code > 126){
      const oct = code.toString(8).padStart(3, "0");
      out += `\\${oct}`;
      continue;
    }
    out += String.fromCharCode(code);
  }
  return out;
}

function buildPdfBytes(table){
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const headerHeight = 110;
  const footerHeight = 30;
  const headerRowHeight = 30;
  const fontSize = 10;
  const fontSizeHeader = 11;
  const charWidth = fontSize * 0.55;
  const cellPadX = 4;
  const cellPadY = 5;
  const baseRowHeight = 22;
  const lineHeight = fontSize + 2;
  const tableTop = pageHeight - margin - headerHeight;
  const tableBottom = margin + footerHeight;
  const tableHeight = tableTop - tableBottom;
  const blankRowCount = 1;
  const blankRowHeight = baseRowHeight * blankRowCount;

  const columns = [
    { key: "patrimonio", title: "Patrimônio", width: 60 },
    { key: "tasy", title: "Tasy", width: 38 },
    { key: "descricao", title: "Descrição", width: 274 },
    { key: "ultima", title: "Última", width: 55 },
    { key: "proxima", title: "Próxima", width: 55 },
    { key: "laudo", title: "Laudo", width: 40 }
  ];

  const rows = Array.isArray(table.rows) ? table.rows : [];
  const availableHeight = tableHeight - headerRowHeight - blankRowHeight;
  const maxLinesPerChunk = Math.max(1, Math.floor((availableHeight - (cellPadY * 2)) / lineHeight));
  const rowChunks = [];
  for(const row of rows){
    const colLines = {};
    let maxLines = 1;
    for(const col of columns){
      let text = row[col.key] ?? "";
      if(col.key === "laudo" && row.laudoLink){
        text = "link";
      }
      const maxChars = Math.max(1, Math.floor((col.width - cellPadX * 2) / charWidth));
      const lines = wrapLines([text], maxChars);
      colLines[col.key] = lines;
      if(lines.length > maxLines) maxLines = lines.length;
    }
    const chunkCount = Math.max(1, Math.ceil(maxLines / maxLinesPerChunk));
    for(let c=0;c<chunkCount;c++){
      const chunkLines = {};
      let chunkMax = 1;
      for(const col of columns){
        const lines = colLines[col.key] || [""];
        const start = c * maxLinesPerChunk;
        const slice = lines.slice(start, start + maxLinesPerChunk);
        chunkLines[col.key] = slice;
        if(slice.length > chunkMax) chunkMax = slice.length;
      }
      rowChunks.push({
        row,
        lines: chunkLines,
        lineCount: chunkMax,
        isContinuation: c > 0
      });
    }
  }

  const pages = [];
  let current = [];
  let used = 0;
  for(const chunk of rowChunks){
    chunk.height = (cellPadY * 2) + (chunk.lineCount * lineHeight);
    if(current.length && (used + chunk.height > availableHeight)){
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(chunk);
    used += chunk.height;
  }
  if(current.length || pages.length === 0){
    pages.push(current);
  }

  const objects = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const fontBoldId = 4;
  let nextId = 5;
  const pageIds = [];

  objects.push(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj`);
  objects.push(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`);
  objects.push(`${fontBoldId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`);

  const contentObjects = [];
  for(const pageRows of (pages.length ? pages : [[]])){
    const contentId = nextId++;
    const pageId = nextId++;
    pageIds.push(pageId);
    const annots = [];

    const contentParts = [];

    // Header
    contentParts.push("BT");
    contentParts.push(`/F2 ${fontSizeHeader} Tf`);
    contentParts.push(`${margin} ${pageHeight - margin - 10} Td`);
    contentParts.push(`(${pdfEscapeText(table.title || "RELATORIO")}) Tj`);
    contentParts.push("ET");

    contentParts.push("BT");
    contentParts.push(`/F1 ${fontSize} Tf`);
    contentParts.push(`${margin} ${pageHeight - margin - 28} Td`);
    contentParts.push(`(${pdfEscapeText(`Setor: ${table.setor || "SEM SETOR"}`)}) Tj`);
    contentParts.push("ET");

    contentParts.push("BT");
    contentParts.push(`/F1 ${fontSize} Tf`);
    contentParts.push(`${margin} ${pageHeight - margin - 42} Td`);
    contentParts.push(`(${pdfEscapeText(`Gerado em: ${table.geradoEm || ""}`)}) Tj`);
    contentParts.push("ET");

    contentParts.push("BT");
    contentParts.push(`/F1 ${fontSize} Tf`);
    contentParts.push(`${margin} ${pageHeight - margin - 56} Td`);
    contentParts.push(`(${pdfEscapeText(`Equipamentos: ${table.totalEquip || 0} | Planejamentos: ${table.totalPlanos || 0}`)}) Tj`);
    contentParts.push("ET");

    // Table header background
    const tableX = margin;
    const headerY = tableTop - headerRowHeight;
    contentParts.push("q");
    contentParts.push("0.94 g");
    contentParts.push(`${tableX} ${headerY} ${columns.reduce((a,c)=>a+c.width,0)} ${headerRowHeight} re f`);
    contentParts.push("Q");

    // Table grid
    contentParts.push("q");
    contentParts.push("0 G");
    contentParts.push("0.5 w");
    const totalWidth = columns.reduce((a,c)=>a+c.width,0);
    const rowsHeight = pageRows.reduce((acc,r)=>acc + (r.height || baseRowHeight), 0);
    const totalRowsHeight = headerRowHeight + blankRowHeight + rowsHeight;
    contentParts.push(`${tableX} ${tableTop - totalRowsHeight} ${totalWidth} ${totalRowsHeight} re S`);
    let xCursor = tableX;
    for(const col of columns){
      xCursor += col.width;
      contentParts.push(`${xCursor} ${tableTop - totalRowsHeight} m ${xCursor} ${tableTop} l S`);
    }
    let yLine = tableTop - headerRowHeight;
    contentParts.push(`${tableX} ${yLine} m ${tableX + totalWidth} ${yLine} l S`);
    yLine -= blankRowHeight;
    contentParts.push(`${tableX} ${yLine} m ${tableX + totalWidth} ${yLine} l S`);
    for(const r of pageRows){
      yLine -= (r.height || baseRowHeight);
      contentParts.push(`${tableX} ${yLine} m ${tableX + totalWidth} ${yLine} l S`);
    }
    contentParts.push("Q");

    // Header text
    let hx = tableX + cellPadX;
    const hy = tableTop - headerRowHeight + cellPadY;
    for(const col of columns){
      contentParts.push("BT");
      contentParts.push(`/F2 ${fontSize} Tf`);
      contentParts.push(`${hx} ${hy} Td`);
      contentParts.push(`(${pdfEscapeText(col.title)}) Tj`);
      contentParts.push("ET");
      hx += col.width;
    }

    let yCursor = tableTop - headerRowHeight - blankRowHeight;
    for(const chunk of pageRows){
      const row = chunk.row;
      const rowTop = yCursor;
      let cx = tableX + cellPadX;
      for(const col of columns){
        const lines = chunk.lines?.[col.key] || [""];
        for(let li=0;li<lines.length;li++){
          const text = lines[li] ?? "";
          if(text === "" && lines.length > 1) continue;
          const cy = rowTop - cellPadY - fontSize - (li * lineHeight);
          contentParts.push("BT");
          contentParts.push(`/F1 ${fontSize} Tf`);
          if(col.key === "proxima" && row.vencida){
            contentParts.push("1 0 0 rg");
          }else if(col.key === "laudo" && row.laudoLink){
            contentParts.push("0 0 1 rg");
          }else{
            contentParts.push("0 0 0 rg");
          }
          contentParts.push(`${cx} ${cy} Td`);
          contentParts.push(`(${pdfEscapeText(text)}) Tj`);
          contentParts.push("ET");
        }

        if(col.key === "laudo" && row.laudoLink && !chunk.isContinuation){
          const linkStart = cx;
          const linkEnd = cx + (4 * charWidth);
          const y1 = rowTop - cellPadY - fontSize - 2;
          const y2 = y1 + fontSize + 4;
          const url = pdfEscapeText(row.laudoLink);
          const annotId = nextId++;
          annots.push(annotId);
          objects.push(`${annotId} 0 obj\n<< /Type /Annot /Subtype /Link /Rect [${linkStart.toFixed(2)} ${y1.toFixed(2)} ${linkEnd.toFixed(2)} ${y2.toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${url}) >> >>\nendobj`);
        }

        cx += col.width;
      }
      yCursor -= (chunk.height || baseRowHeight);
    }

    const footerText = "* Próxima vencida (laudo existente).";
    contentParts.push("BT");
    contentParts.push(`/F1 ${fontSize} Tf`);
    contentParts.push(`${margin} ${tableBottom - 10} Td`);
    contentParts.push(`(${pdfEscapeText(footerText)}) Tj`);
    contentParts.push("ET");

    const content = contentParts.join("\n") + "\n";

    const enc = new TextEncoder();
    const contentLen = enc.encode(content).length;
    contentObjects.push(`${contentId} 0 obj\n<< /Length ${contentLen} >>\nstream\n${content}\nendstream\nendobj`);
    const annotsPart = annots.length ? ` /Annots [${annots.map(id=>`${id} 0 R`).join(" ")}]` : "";
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >>${annotsPart} /Contents ${contentId} 0 R >>\nendobj`);
  }

  const kids = pageIds.map(id=>`${id} 0 R`).join(" ");
  objects.splice(1, 0, `${pagesId} 0 obj\n<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>\nendobj`);

  const allObjects = [];
  allObjects.push(...objects.slice(0,4));
  allObjects.push(...contentObjects);
  allObjects.push(...objects.slice(4));

  const enc = new TextEncoder();
  const header = "%PDF-1.4\n";
  const chunks = [header];
  const offsets = [0];
  let offset = enc.encode(header).length;
  for(const obj of allObjects){
    offsets.push(offset);
    const piece = `${obj}\n`;
    chunks.push(piece);
    offset += enc.encode(piece).length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${allObjects.length + 1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++){
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${allObjects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(xref + trailer);
  return enc.encode(chunks.join(""));
}

async function savePdfToFolder(rootHandle, folderName, fileName, bytes){
  const safeFolder = sanitizeFsName(folderName || "SEM SETOR") || "SEM SETOR";
  const safeFile = sanitizeFsName(fileName || "relatorio.pdf") || "relatorio.pdf";
  const ensure = window.ensureDir || ensureDirLocal;
  const dir = await ensure(rootHandle, `relatorios/${safeFolder}`);
  const fileHandle = await dir.getFileHandle(safeFile, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

function downloadPdfFallback(fileName, bytes){
  const blob = new Blob([bytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
}

async function gerarRelatoriosPdf(){
  if(db.equipamentos.length === 0) return alert("Nenhum equipamento cadastrado.");
  const filters = getRelatorioFilters();
  const equipamentos = db.equipamentos.filter(e=>{
    return matchesSetorFilter(e, filters.setor) && matchesTipoFilter(e, filters.tipos, filters.somenteComTipo);
  });
  if(equipamentos.length === 0) return alert("Nenhum equipamento encontrado para os filtros.");

  const bySetor = new Map();
  for(const e of equipamentos){
    const setorNome = sectorNameFromEquip(e) || "SEM SETOR";
    if(!bySetor.has(setorNome)) bySetor.set(setorNome, []);
    bySetor.get(setorNome).push(e);
  }

  const date = new Date();
  const dateKey = `${date.toISOString().slice(0,10)}_${String(date.getHours()).padStart(2,"0")}${String(date.getMinutes()).padStart(2,"0")}`;
  const tipoTag = (filters.tipos && filters.tipos.length)
    ? (filters.tipos.length === 1
      ? `TIPO-${sanitizeFsName(filters.tipos[0] === "__SEM__" ? "SEM" : typeName(Number(filters.tipos[0])))}`
      : `MULTI-${filters.tipos.length}`)
    : "TODOS";

  const root = await ensureRelatoriosRoot();
  if(!root && !window.showDirectoryPicker){
    for(const [setorNome, list] of bySetor){
      const table = buildRelatorioTable(setorNome, list, filters);
      const bytes = buildPdfBytes(table);
      const fileName = `relatorio_${sanitizeFsName(setorNome)}_${tipoTag}_${dateKey}.pdf`;
      downloadPdfFallback(fileName, bytes);
    }
    alert("PDFs gerados (download).");
    return;
  }
  if(!root){
    alert("Selecione a pasta de exportação antes de gerar.");
    return;
  }

  showProgress("Gerando PDFs...", "Montando relatórios por setor.");
  try{
    for(const [setorNome, list] of bySetor){
      const table = buildRelatorioTable(setorNome, list, filters);
      const bytes = buildPdfBytes(table);
      const fileName = `relatorio_${sanitizeFsName(setorNome)}_${tipoTag}_${dateKey}.pdf`;
      await savePdfToFolder(root, setorNome, fileName, bytes);
    }
    alert("Relatórios gerados com sucesso.");
  }catch(err){
    console.error(err);
    alert("Falha ao gerar os relatórios.");
  }finally{
    setTimeout(hideProgress, 0);
  }
}

document.getElementById("btnSelectRelatoriosRoot")?.addEventListener("click", selectRelatoriosRoot);
document.getElementById("btnGerarRelatorio")?.addEventListener("click", gerarRelatoriosPdf);

initRelatoriosRoot();
window.renderRelatoriosFilters = renderRelatoriosFilters;

"use strict";

const DRIVE_SETTINGS_KEY = "gm_drive_settings_v1";
const DRIVE_DEFAULT_FOLDER = "1365s3Gd4_0rMc-T113gkl-mx5CJ1WgwV";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files";

let driveTokenClient = null;
let driveAccessToken = "";
let driveTokenExpiresAt = 0;
let driveTokenClientId = "";

function loadDriveSettings(){
  const raw = localStorage.getItem(DRIVE_SETTINGS_KEY);
  let data = {};
  try{ data = JSON.parse(raw || "{}") || {}; }catch{ data = {}; }
  return {
    clientId: norm(data.clientId) || "",
    folderId: norm(data.folderId) || DRIVE_DEFAULT_FOLDER
  };
}

function saveDriveSettings(settings){
  localStorage.setItem(DRIVE_SETTINGS_KEY, JSON.stringify({
    clientId: norm(settings.clientId),
    folderId: norm(settings.folderId)
  }));
}

function setDriveStatus(text){
  const el = document.getElementById("driveStatus");
  if(el) el.innerText = text || "";
}

function ensureGisLoaded(){
  return new Promise((resolve, reject)=>{
    const start = Date.now();
    const tick = ()=>{
      if(window.google && window.google.accounts && window.google.accounts.oauth2){
        resolve();
        return;
      }
      if(Date.now() - start > 12000){
        reject(new Error("Google Identity Services não carregou."));
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

function initDriveTokenClient(clientId){
  driveTokenClientId = clientId;
  driveTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: ()=>{}
  });
}

async function requestDriveToken(interactive){
  await ensureGisLoaded();
  const settings = loadDriveSettings();
  if(!settings.clientId){
    alert("Informe o Client ID do Google Cloud.");
    return null;
  }
  if(!driveTokenClient || driveTokenClientId !== settings.clientId){
    initDriveTokenClient(settings.clientId);
  }
  return new Promise((resolve, reject)=>{
    driveTokenClient.callback = (resp)=>{
      if(resp && resp.error){
        reject(resp);
        return;
      }
      driveAccessToken = resp.access_token || "";
      const expiresIn = Number(resp.expires_in || 0);
      driveTokenExpiresAt = Date.now() + (expiresIn ? (expiresIn - 30) * 1000 : 3600 * 1000);
      setDriveStatus("Conectado ao Google Drive.");
      resolve(driveAccessToken);
    };
    driveTokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

async function ensureDriveToken(interactive){
  if(driveAccessToken && Date.now() < driveTokenExpiresAt){
    return driveAccessToken;
  }
  try{
    return await requestDriveToken(interactive);
  }catch(err){
    console.error(err);
    if(!interactive){
      return await requestDriveToken(true);
    }
    return null;
  }
}

async function driveFetchJson(url, token){
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if(!res.ok){
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text}`);
  }
  return res.json();
}

async function listFolderChildren(folderId, token, pageToken){
  const q = `'${folderId}' in parents and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,parents)",
    pageSize: "1000",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });
  if(pageToken) params.set("pageToken", pageToken);
  const url = `${DRIVE_API_BASE}?${params.toString()}`;
  return driveFetchJson(url, token);
}

async function listAllFilesRecursive(rootFolderId, token, onProgress){
  const files = [];
  const queue = [rootFolderId];
  const stats = { foldersScanned: 0, pages: 0, totalListed: 0 };
  while(queue.length){
    const folderId = queue.shift();
    stats.foldersScanned++;
    let pageToken = "";
    do{
      if(onProgress){
        onProgress({
          ...stats,
          queueSize: queue.length,
          filesCount: files.length,
          currentFolderId: folderId
        });
      }
      stats.pages++;
      const data = await listFolderChildren(folderId, token, pageToken);
      const list = Array.isArray(data.files) ? data.files : [];
      stats.totalListed += list.length;
      for(const f of list){
        if(f.mimeType === "application/vnd.google-apps.folder"){
          queue.push(f.id);
        }else{
          files.push(f);
        }
      }
      pageToken = data.nextPageToken || "";
    }while(pageToken);
  }
  return { files, stats };
}

function extractTasyFromName(name){
  const s = String(name || "");
  const m = s.match(/tasy[\s._-]*([0-9]{1,})/i);
  return m ? m[1] : "";
}

function fileTimeMs(file){
  const ts = file.modifiedTime || file.createdTime || "";
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

function buildDriveLink(file){
  return file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
}

function ensureDriveInputs(){
  const settings = loadDriveSettings();
  const clientInput = document.getElementById("driveClientId");
  const folderInput = document.getElementById("driveFolderId");
  if(clientInput && !clientInput.value) clientInput.value = settings.clientId;
  if(folderInput && !folderInput.value) folderInput.value = settings.folderId || DRIVE_DEFAULT_FOLDER;
}

function readDriveInputs(){
  const clientId = norm(document.getElementById("driveClientId")?.value || "");
  const folderId = norm(document.getElementById("driveFolderId")?.value || "");
  return { clientId, folderId };
}

function bindDriveInputAutosave(){
  const clientInput = document.getElementById("driveClientId");
  const folderInput = document.getElementById("driveFolderId");
  if(!clientInput && !folderInput) return;
  let t = 0;
  const save = ()=>{
    saveDriveSettings(readDriveInputs());
  };
  const schedule = ()=>{
    clearTimeout(t);
    t = setTimeout(save, 250);
  };
  clientInput?.addEventListener("input", schedule);
  folderInput?.addEventListener("input", schedule);
  clientInput?.addEventListener("blur", save);
  folderInput?.addEventListener("blur", save);
}

async function uploadFileToDrive({ folderId, name, mimeType, bytes, token }){
  const metadata = { name };
  if(folderId) metadata.parents = [folderId];
  const boundary = `gm_${Math.random().toString(36).slice(2)}`;
  const fileBlob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`,
    fileBlob,
    `\r\n--${boundary}--`
  ], { type: `multipart/related; boundary=${boundary}` });
  const res = await fetch(`${DRIVE_API_BASE}?uploadType=multipart&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  if(!res.ok){
    const text = await res.text();
    throw new Error(`Drive upload ${res.status}: ${text}`);
  }
  return res.json();
}

async function scanDriveAndLink(){
  const settings = readDriveInputs();
  if(!settings.clientId) return alert("Informe o Client ID do Google Cloud.");
  if(!settings.folderId) return alert("Informe o ID da pasta no Drive.");
  saveDriveSettings(settings);

  setDriveStatus("Conectando ao Google...");
  const token = await ensureDriveToken(false);
  if(!token) return;

  showProgress("Varrendo Google Drive...", "Lendo arquivos e vinculando laudos.");
  try{
    const progressEl = document.getElementById("progressSubtitle");
    const setProgress = (text)=>{
      if(progressEl) progressEl.innerText = text || "";
    };
    const { files, stats } = await listAllFilesRecursive(settings.folderId, token, (p)=>{
      setProgress(`Pastas: ${p.foldersScanned} • Na fila: ${p.queueSize} • Páginas: ${p.pages} • Arquivos: ${p.totalListed}`);
    });
    setProgress(`Pastas: ${stats.foldersScanned} • Páginas: ${stats.pages} • Arquivos: ${stats.totalListed}`);
    const byTasy = new Map();
    let pdfCount = 0;
    let matched = 0;
    let lastTick = 0;

    for(let i = 0; i < files.length; i++){
      const f = files[i];
      const isPdf = (f.mimeType === "application/pdf") || String(f.name || "").toLowerCase().endsWith(".pdf");
      if(!isPdf) continue;
      pdfCount++;
      const tasy = extractTasyFromName(f.name);
      if(!tasy) continue;
      matched++;
      const current = byTasy.get(tasy);
      if(!current || fileTimeMs(f) >= fileTimeMs(current)){
        byTasy.set(tasy, f);
      }
      if(Date.now() - lastTick > 200){
        setProgress(`Analisando arquivos: ${i + 1}/${files.length} • PDFs: ${pdfCount} • TASY: ${matched}`);
        lastTick = Date.now();
      }
    }

    let linked = 0;
    let updated = 0;
    let missingEquip = 0;
    const now = nowISO();
    const todayBR = dateToBR(new Date());

    let idx = 0;
    for(const [tasy, f] of byTasy.entries()){
      idx++;
      const eq = findEquipByTasy(tasy);
      if(!eq){
        missingEquip++;
        continue;
      }
      const equipKey = keyOfEquip(eq);
      const link = buildDriveLink(f);
      const isNew = eq.laudoFileId !== f.id || eq.laudoLink !== link;

      eq.laudoLink = link;
      eq.laudoFileId = f.id;
      eq.laudoFileName = f.name || "";
      eq.laudoModifiedTime = f.modifiedTime || f.createdTime || "";
      eq.laudoUpdatedAt = now;

      const existing = db.laudos.find(l => l.fileId === f.id);
      if(existing){
        existing.link = link;
        existing.fileName = f.name || "";
        existing.modifiedTime = f.modifiedTime || "";
        existing.createdTime = f.createdTime || "";
        existing.scannedAt = now;
        existing.tasy = tasy;
        existing.equipKey = equipKey;
        updated++;
      }else{
        db.laudos.push({
          id: `drive_${f.id}`,
          fileId: f.id,
          fileName: f.name || "",
          link,
          tasy,
          equipKey,
          modifiedTime: f.modifiedTime || "",
          createdTime: f.createdTime || "",
          scannedAt: now
        });
        linked++;
      }

      if(isNew){
        addTimelineEvent({
          equipKey,
          tasy,
          type: "laudos",
          title: "Laudo vinculado",
          details: `${f.name || "Laudo"} • ${link}`
        });
      }
      if(Date.now() - lastTick > 200){
        setProgress(`Vinculando: ${idx}/${byTasy.size} • Vinculados: ${linked} • Atualizados: ${updated}`);
        lastTick = Date.now();
      }
    }

    // Atende OS abertas quando existir laudo vinculado
    let osAtendidas = 0;
    for(const o of db.os){
      if(o.status !== "aberta") continue;
      const eq = db.equipamentos.find(e=>keyOfEquip(e)===o.equipKey) || findEquipByTasy(o.tasy);
      if(!eq) continue;
      const laudo = getLatestLaudoForEquip(eq);
      if(!laudo || !laudo.link) continue;

      o.status = "atendida";
      o.atendidaEm = todayBR;
      o.updatedAt = now;
      o.laudoLink = laudo.link;

      const plan = db.manutencoes.find(p=>p.planKey===o.planKey);
      if(plan){
        plan.ultima = todayBR;
        plan.proxima = addDaysBR(plan.ultima, plan.periodicidadeDias);
        plan.updatedAt = now;
      }

      addTimelineEvent({
        equipKey: o.equipKey,
        tasy: o.tasy,
        type: "manut",
        title: "OS atendida",
        details: `OS #${o.seq} • ${o.atividade || "—"} • ${laudo.fileName || "Laudo"}`
      });
      osAtendidas++;
    }

    saveDB();
    renderAll();

    const msg = `PDFs: ${pdfCount} | Com TASY: ${matched} | Vinculados: ${linked} | Atualizados: ${updated} | Sem equipamento: ${missingEquip} | OS atendidas: ${osAtendidas}`;
    setDriveStatus(`Última varredura em ${new Date().toLocaleString("pt-BR")}. ${msg}`);
    log("LAUDO_SCAN", msg);
    alert("Varredura concluída.");
  }catch(err){
    console.error(err);
    alert("Falha na varredura do Drive. Verifique permissões e o ID da pasta.");
  }finally{
    setTimeout(hideProgress, 0);
  }
}

document.getElementById("btnDriveAuth")?.addEventListener("click", async ()=>{
  const settings = readDriveInputs();
  if(!settings.clientId) return alert("Informe o Client ID do Google Cloud.");
  saveDriveSettings(settings);
  setDriveStatus("Conectando ao Google...");
  await ensureDriveToken(true);
});

document.getElementById("btnScanDriveLaudos")?.addEventListener("click", scanDriveAndLink);

ensureDriveInputs();
bindDriveInputAutosave();
setDriveStatus("Aguardando configuração.");

window.gmDrive = {
  ensureDriveToken,
  readDriveInputs,
  saveDriveSettings,
  uploadFileToDrive
};

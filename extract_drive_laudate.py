import os
import re
import json
import io
import tempfile
from pathlib import Path
from dateutil import parser as dtparser

import pdfplumber
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from openpyxl import Workbook

# -------------------------
# REGEX / CONSTANTES
# -------------------------

RE_DMY = re.compile(r"\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b")

RE_KEY = re.compile(
    r"(emiss[aã]o|data do laudo|data do relat[oó]rio|relat[oó]rio|laudo|realizado em|calibra[cç][aã]o|inspe[cç][aã]o|validade|vencimento)",
    re.I
)

RE_TASY = re.compile(r"\btasy[\s\-_]*0*(\d{2,10})\b", re.IGNORECASE)

FOLDER_MIME = "application/vnd.google-apps.folder"
PDF_MIME = "application/pdf"

##adicionado novos regex para ser mais seletivo no selecionamento de datas .

RE_HEADER_DATE = re.compile(
 r"(?im)^\s*(data)\s*[:\-]\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b"
)
RE_FILENAME_DATE=re.compile(
    r"\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b"

)
RE_AVOID_LINE = re.compile(
    r"(?i)\b(v[aá]lido\s+at[eé]|validade|vencimento)\b"
)
# -------------------------
# ENV HELPERS
# -------------------------

def env_str(name: str, default: str = "") -> str:
    v = os.getenv(name, default)
    return (v or "").strip()

def env_int(name: str, default: int) -> int:
    try:
        return int(env_str(name, str(default)))
    except Exception:
        return default

def env_bool(name: str, default: bool = False) -> bool:
    v = env_str(name, "")
    if not v:
        return default
    return v.lower() in {"1", "true", "yes", "y", "on"}

def must_env(name: str) -> str:
    v = env_str(name, "")
    if not v:
        raise RuntimeError(f"Missing env var: {name}")
    return v


# -------------------------
# HELPERS
# -------------------------

def tasy_from_name(filename: str) -> str | None:
    stem = Path(filename).stem
    m = RE_TASY.search(stem)
    if not m:
        return None
    return m.group(1)

def parse_all_dates(text: str):
    dates = []
    for m in RE_DMY.finditer(text):
        s = m.group(1)
        try:
            d = dtparser.parse(s, dayfirst=True).date()
            dates.append(d)
        except Exception:
            pass
    return dates

def pick_date(text: str, filename: str = ""):
    """
    Prioridade:
    1) Data no topo: "Data: dd/mm/aaaa" (primeiras linhas)
    2) Data no nome do arquivo (ex: 19-11-2025.pdf)
    3) Data em linha com keyword (ignorando validade/vencimento)
    4) Maior data do texto todo (fallback)
    """
    if not text or not text.strip():
        return None, "SEM_TEXTO"

    # 1) Topo do documento (onde fica "Data:")
    top = "\n".join(text.splitlines()[:40])
    m = RE_HEADER_DATE.search(top)
    if m:
        try:
            d = dtparser.parse(m.group(2), dayfirst=True).date()
            return d, "OK_TOPO_DATA"
        except Exception:
            pass

    # 2) Data no nome do arquivo (muito comum e bem confiável)
    if filename:
        m2 = RE_FILENAME_DATE.search(filename)
        if m2:
            try:
                d = dtparser.parse(m2.group(1), dayfirst=True).date()
                return d, "OK_NOME_ARQUIVO"
            except Exception:
                pass

    # 3) Linhas com keyword, mas ignorando validade/vencimento
    key_candidates = []
    for line in text.splitlines():
        if RE_KEY.search(line):
            if RE_AVOID_LINE.search(line):
                continue
            key_candidates.extend(parse_all_dates(line))
    if key_candidates:
        return max(key_candidates), "OK_KEYWORD_FILTRADO"

    # 4) fallback: maior data no texto todo
    all_dates = parse_all_dates(text)
    if all_dates:
        return max(all_dates), "OK_MAX"

    return None, "SEM_DATA"


def drive_service(sa_json_str: str):
    info = json.loads(sa_json_str)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)

def validate_root_access(drive, root_id: str):
    """Falha rápido se o folderId estiver errado ou sem permissão."""
    try:
        meta = drive.files().get(
            fileId=root_id,
            fields="id,name,mimeType",
            supportsAllDrives=True
        ).execute()
        print("[ROOT OK]", meta)
        return meta
    except Exception as e:
        print("[ROOT FAIL] root_id=", repr(root_id))
        raise

def list_children(drive, parent_id: str, name_contains: str = ""):
    """
    Lista filhos de uma pasta (Meu Drive e Drive Compartilhado).
    Pode filtrar por name_contains (Drive 'name contains').
    """
    parent_id = (parent_id or "").strip()
    name_contains = (name_contains or "").strip()

    q = f"'{parent_id}' in parents and trashed=false"
    if name_contains:
        # Drive query: 'name contains'
        q += f" and name contains '{name_contains}'"

    res = []
    page_token = None
    loops = 0

    while True:
        loops += 1
        print(f"[LIST] parent={parent_id} token={page_token} loop={loops}")

        r = drive.files().list(
            q=q,
            fields="nextPageToken, files(id,name,mimeType,modifiedTime,size)",
            pageSize=1000,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()

        batch = r.get("files", [])
        res.extend(batch)
        page_token = r.get("nextPageToken")

        print(f"[LIST] got={len(batch)} total={len(res)} next={bool(page_token)}")

        if not page_token:
            break

    return res

def download_file(drive, file_id: str, dest_path: Path):
    """Baixa arquivo do Drive com progresso simples."""
    request = drive.files().get_media(fileId=file_id)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    with io.FileIO(dest_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request, chunksize=1024 * 1024)
        done = False
        while not done:
            status, done = downloader.next_chunk()
            if status:
                pct = int(status.progress() * 100)
                # não spamma demais: mostra só a cada 10%
                if pct % 10 == 0:
                    print(f"[DL] {dest_path.name} {pct}%")

def extract_text_first_pages(pdf_path: Path, max_pages=2):
    chunks = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for p in pdf.pages[:max_pages]:
            chunks.append(p.extract_text() or "")
    return "\n".join(chunks)

def list_pdfs_recursive(
    drive,
    folder_id: str,
    path_prefix: str,
    name_contains: str = "",
    max_depth: int = 8,
    max_pdfs_total: int = 300,
):
    """
    Lista PDFs dentro de subpastas com:
    - limite de profundidade
    - limite total de PDFs (para não ficar infinito)
    - filtro opcional por name_contains (aplicado na listagem)
    Retorna [(file_obj, path_hint), ...]
    """
    out = []
    stack = [(folder_id, path_prefix, 0)]

    while stack:
        fid, prefix, depth = stack.pop()
        if depth > max_depth:
            print(f"[SKIP] depth>{max_depth} em {prefix}")
            continue

        # Filtra listagem por name_contains: isso acelera bastante se seus PDFs têm "tasy"
        children = list_children(drive, fid, name_contains=name_contains)

        folders = 0
        pdfs_here = 0

        for f in children:
            name = f.get("name", "")
            mime = f.get("mimeType", "")

            if mime == FOLDER_MIME:
                folders += 1
                stack.append((f["id"], f"{prefix}/{name}", depth + 1))
                continue

            is_pdf = (mime == PDF_MIME) or name.lower().endswith(".pdf")
            if is_pdf:
                pdfs_here += 1
                out.append((f, f"{prefix}/{name}"))
                if len(out) >= max_pdfs_total:
                    print(f"[STOP] atingiu max_pdfs_total={max_pdfs_total} (parando varredura)")
                    return out

        print(f"[SCAN] {prefix} depth={depth} folders={folders} pdfs={pdfs_here} total_pdfs={len(out)}")

    return out


# -------------------------
# MAIN
# -------------------------

def main():
    print("[START] extractor iniciado")

    sa_json = must_env("GDRIVE_SA_JSON")
    root_id = env_str("GDRIVE_ROOT_FOLDER_ID", "root")
    if root_id in {"", ".", "./"}:
        root_id = "root"

    # Configs via env (do workflow)
    max_pdfs = env_int("MAX_PDFS", 300)
    name_contains = env_str("NAME_CONTAINS", "tasy")  # use "" pra não filtrar
    download_dir = env_str("DOWNLOAD_DIR", "downloads")
    max_depth = env_int("MAX_DEPTH", 10)
    keep_downloads = env_bool("KEEP_DOWNLOADS", True)  # no Actions, True é bom (vai pro artifact)

    print("[CFG] root_id       =", repr(root_id))
    print("[CFG] max_pdfs      =", max_pdfs)
    print("[CFG] name_contains =", repr(name_contains))
    print("[CFG] download_dir  =", repr(download_dir))
    print("[CFG] max_depth     =", max_depth)
    print("[CFG] keep_downloads=", keep_downloads)

    drive = drive_service(sa_json)
    validate_root_access(drive, root_id)

    # 1) pegar pastas "ano" na raiz
    root_children = list_children(drive, root_id)
    years = []
    for f in root_children:
        if f.get("mimeType") == FOLDER_MIME and f.get("name", "").isdigit() and len(f["name"]) == 4:
            years.append((int(f["name"]), f["id"], f["name"]))
    years.sort(key=lambda x: x[0])

    print("[ROOT] children =", len(root_children))
    print("[ROOT] anos =", [y[2] for y in years])

    results = {}    # tasy -> (date, year_name, path_hint, motivo)
    not_found = []  # (tasy_or_label, year_name, path_hint, motivo)

    # Se keep_downloads=True, salvamos numa pasta persistente (para o artifact)
    persistent_dir = Path(download_dir)
    persistent_dir.mkdir(parents=True, exist_ok=True)

    # Caso contrário, usa temp dir
    tmp_ctx = tempfile.TemporaryDirectory()
    try:
        temp_dir = Path(tmp_ctx.name)

        total_processed = 0

        for year_int, year_id, year_name in years:
            print(f"[YEAR] {year_name} id={year_id}")

            pdf_items = list_pdfs_recursive(
                drive,
                year_id,
                f"{year_name}",
                name_contains=name_contains,
                max_depth=max_depth,
                max_pdfs_total=max_pdfs,
            )
            print(f"[YEAR] {year_name} PDFs encontrados: {len(pdf_items)}")

            for f, path_hint in pdf_items:
                if total_processed >= max_pdfs:
                    print("[STOP] MAX_PDFS atingido (parando processamento)")
                    break

                name = f.get("name", "")
                file_id = f.get("id")
                tasy = tasy_from_name(name)

                total_processed += 1
                print(f"[FILE] ({total_processed}/{max_pdfs}) {name} | tasy={tasy} | path={path_hint}")

                if not tasy:
                    not_found.append(("SEM_TASY_NO_NOME", year_name, path_hint, "NAO_IDENTIFICOU_TASY"))
                    continue

                # baixa para temp e (opcional) copia para downloads/
                local_pdf = temp_dir / f"{file_id}.pdf"

                try:
                    download_file(drive, file_id, local_pdf)
                except Exception as e:
                    not_found.append((tasy, year_name, path_hint, f"ERRO_DOWNLOAD: {type(e).__name__}"))
                    continue

                # copia pro downloads/ com nome original (pra artifact)
                if keep_downloads:
                    dest = persistent_dir / name
                    try:
                        # sobrescreve se repetir
                        dest.write_bytes(local_pdf.read_bytes())
                        print(f"[SAVED] {dest}")
                    except Exception as e:
                        print(f"[WARN] falha ao copiar para downloads/: {type(e).__name__}")

                try:
                    text = extract_text_first_pages(local_pdf, max_pages=2)
                except Exception as e:
                    not_found.append((tasy, year_name, path_hint, f"ERRO_PDF: {type(e).__name__}"))
                    continue

                d, motivo = pick_date(text,filename=name)
                if d is None:
                    not_found.append((tasy, year_name, path_hint, motivo))
                    continue

                # Regra: sobrescreve sempre (ano crescente -> último ganha)
                results[tasy] = (d, year_name, path_hint, motivo)

            if total_processed >= max_pdfs:
                break

    finally:
        tmp_ctx.cleanup()

    # 2) gerar XLSX
    wb = Workbook()
    ws = wb.active
    ws.title = "RESULTADO"
    ws.append(["TASY", "DATA_FINAL", "ANO_PASTA", "CAMINHO_PDF", "MOTIVO"])

    def sort_key(item):
        tasy = item[0]
        if str(tasy).isdigit():
            return int(tasy)
        return str(tasy)

    for tasy, (d, year_name, path_hint, motivo) in sorted(results.items(), key=sort_key):
        ws.append([tasy, d.isoformat(), year_name, path_hint, motivo])

    ws2 = wb.create_sheet("NAO_ENCONTRADOS")
    ws2.append(["TASY", "ANO_PASTA", "CAMINHO_PDF", "MOTIVO"])
    for row in not_found:
        ws2.append(list(row))

    wb.save("resultado.xlsx")
    print(f"[DONE] OK: {len(results)} | NAO_ENCONTRADOS: {len(not_found)} | ANOS: {len(years)} | PROCESSADOS: {min(max_pdfs, len(results)+len(not_found))}")


if __name__ == "__main__":
    main()

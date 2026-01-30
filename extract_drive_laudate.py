import os, re, json, io, tempfile
from pathlib import Path
from dateutil import parser as dtparser

import pdfplumber
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from openpyxl import Workbook

# --- Datas comuns BR ---
RE_DMY = re.compile(r"\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b")

# Palavras-chave pra priorizar datas "certas"
RE_KEY = re.compile(r"(emiss[aã]o|data do laudo|laudo|realizado em|calibra[cç][aã]o|inspe[cç][aã]o|relat[oó]rio)", re.I)

# --- TASY: "tasy" + separadores opcionais + número ---
# Aceita: tasy123 | tasy_123 | tasy-123 | tasy 123 | tasy__- 00123
RE_TASY = re.compile(r"\btasy[\s\-_]*0*(\d{2,10})\b", re.IGNORECASE)

FOLDER_MIME = "application/vnd.google-apps.folder"

def tasy_from_name(filename: str):
    stem = Path(filename).stem
    m = RE_TASY.search(stem)
    if not m:
        return None
    num = m.group(1)
    # Se você preferir "tasy123" ao invés de "123", use:
    # return f"tasy{num}"
    return num

def parse_all_dates(text: str):
    dates = []
    for m in RE_DMY.finditer(text):
        s = m.group(1)
        try:
            d = dtparser.parse(s, dayfirst=True).date()
            dates.append(d)
        except:
            pass
    return dates

def pick_date(text: str):
    if not text or not text.strip():
        return None, "SEM_TEXTO"

    # 1) tenta datas em linhas com palavras-chave
    key_candidates = []
    for line in text.splitlines():
        if RE_KEY.search(line):
            key_candidates.extend(parse_all_dates(line))
    if key_candidates:
        return max(key_candidates), "OK_KEYWORD"

    # 2) fallback: maior data no texto
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

def list_children(drive, parent_id):
    q = f"'{parent_id}' in parents and trashed=false"
    res = []
    page_token = None
    while True:
        r = drive.files().list(
            q=q,
            fields="nextPageToken, files(id,name,mimeType,modifiedTime)",
            pageSize=1000,
            pageToken=page_token,
        ).execute()
        res.extend(r.get("files", []))
        page_token = r.get("nextPageToken")
        if not page_token:
            break
    return res

def download_file(drive, file_id, dest_path: Path):
    request = drive.files().get_media(fileId=file_id)
    with io.FileIO(dest_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request, chunksize=1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()

def extract_text_first_pages(pdf_path: Path, max_pages=2):
    chunks = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for p in pdf.pages[:max_pages]:
            chunks.append(p.extract_text() or "")
    return "\n".join(chunks)

def list_pdfs_recursive(drive, folder_id, path_prefix, max_depth=4):
    """
    Retorna lista de tuplas (file, path_hint) para PDFs em qualquer subpasta.
    max_depth evita loop infinito / estrutura muito profunda.
    """
    out = []
    stack = [(folder_id, path_prefix, 0)]
    while stack:
        fid, prefix, depth = stack.pop()
        if depth > max_depth:
            continue

        children = list_children(drive, fid)
        for f in children:
            name = f["name"]
            mime = f["mimeType"]

            if mime == FOLDER_MIME:
                stack.append((f["id"], f"{prefix}/{name}", depth + 1))
            else:
                if name.lower().endswith(".pdf"):
                    out.append((f, f"{prefix}/{name}"))
    return out

def main():
    sa_json = os.environ["GDRIVE_SA_JSON"]
    root_id = os.environ["GDRIVE_ROOT_FOLDER_ID"]
    drive = drive_service(sa_json)

    # 1) pegar pastas "ano"
    root_children = list_children(drive, root_id)
    years = []
    for f in root_children:
        if f["mimeType"] == FOLDER_MIME and f["name"].isdigit() and len(f["name"]) == 4:
            years.append((int(f["name"]), f["id"], f["name"]))
    years.sort(key=lambda x: x[0])  # 2024 -> 2025 -> 2026

    results = {}   # tasy -> (date, year_name, path_hint, motivo)
    not_found = [] # (tasy_or_NONE, year_name, path_hint, motivo)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)

        for year_int, year_id, year_name in years:
            # 2) lista PDFs recursivo dentro do ano (meses, etc.)
            pdf_items = list_pdfs_recursive(drive, year_id, f"{year_name}", max_depth=6)

            for f, path_hint in pdf_items:
                tasy = tasy_from_name(f["name"])
                if not tasy:
                    not_found.append(("SEM_TASY_NO_NOME", year_name, path_hint, "NAO_IDENTIFICOU_TASY"))
                    continue

                local_pdf = td / f"{f['id']}.pdf"
                download_file(drive, f["id"], local_pdf)

                text = extract_text_first_pages(local_pdf, max_pages=2)
                d, motivo = pick_date(text)

                if d is None:
                    not_found.append((tasy, year_name, path_hint, motivo))
                    continue

                # Regra: sobrescreve sempre por ordem de varredura (ano crescente)
                results[tasy] = (d, year_name, path_hint, motivo)

    # 3) gerar XLSX
    wb = Workbook()
    ws = wb.active
    ws.title = "RESULTADO"
    ws.append(["TASY", "DATA_FINAL", "ANO_PASTA", "CAMINHO_PDF", "MOTIVO"])

    for tasy, (d, year_name, path_hint, motivo) in sorted(results.items(), key=lambda x: int(x[0]) if x[0].isdigit() else x[0]):
        ws.append([tasy, d.isoformat(), year_name, path_hint, motivo])

    ws2 = wb.create_sheet("NAO_ENCONTRADOS")
    ws2.append(["TASY", "ANO_PASTA", "CAMINHO_PDF", "MOTIVO"])
    for row in not_found:
        ws2.append(list(row))

    wb.save("resultado.xlsx")
    print(f"OK: {len(results)} registros | NAO_ENCONTRADOS: {len(not_found)} | ANOS: {len(years)}")

if __name__ == "__main__":
    main()

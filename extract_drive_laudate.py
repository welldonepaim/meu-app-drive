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

# Datas comuns BR
RE_DMY = re.compile(r"\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b")

# Palavras-chave pra priorizar datas "certas"
RE_KEY = re.compile(
    r"(emiss[aã]o|data do laudo|data do relat[oó]rio|relat[oó]rio|laudo|realizado em|calibra[cç][aã]o|inspe[cç][aã]o|validade|vencimento)",
    re.I
)

# TASY: "tasy" + separadores opcionais + número
# Aceita: tasy123 | tasy_123 | tasy-123 | tasy 123 | tasy__- 00123 | ...tasy-000123...
RE_TASY = re.compile(r"\btasy[\s\-_]*0*(\d{2,10})\b", re.IGNORECASE)

FOLDER_MIME = "application/vnd.google-apps.folder"
PDF_MIME = "application/pdf"


# -------------------------
# HELPERS
# -------------------------

def tasy_from_name(filename: str) -> str | None:
    """Extrai o número do TASY do nome do arquivo."""
    stem = Path(filename).stem
    m = RE_TASY.search(stem)
    if not m:
        return None
    num = m.group(1)
    # Se preferir retornar "tasy123" ao invés de "123", troque por:
    # return f"tasy{num}"
    return num


def parse_all_dates(text: str):
    """Extrai todas as datas dd/mm/aaaa (ou variações) do texto."""
    dates = []
    for m in RE_DMY.finditer(text):
        s = m.group(1)
        try:
            d = dtparser.parse(s, dayfirst=True).date()
            dates.append(d)
        except Exception:
            pass
    return dates


def pick_date(text: str):
    """
    Escolhe uma data final:
    1) maior data nas linhas com palavra-chave
    2) senão, maior data no texto todo
    """
    if not text or not text.strip():
        return None, "SEM_TEXTO"

    key_candidates = []
    for line in text.splitlines():
        if RE_KEY.search(line):
            key_candidates.extend(parse_all_dates(line))
    if key_candidates:
        return max(key_candidates), "OK_KEYWORD"

    all_dates = parse_all_dates(text)
    if all_dates:
        return max(all_dates), "OK_MAX"

    return None, "SEM_DATA"


def drive_service(sa_json_str: str):
    """Cria o cliente da API do Drive."""
    info = json.loads(sa_json_str)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_children(drive, parent_id: str):
    """Lista filhos de uma pasta (funciona em Meu Drive e Drive Compartilhado)."""
    q = f"'{parent_id}' in parents and trashed=false"
    res = []
    page_token = None
    while True:
        r = drive.files().list(
            q=q,
            fields="nextPageToken, files(id,name,mimeType,modifiedTime)",
            pageSize=1000,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        res.extend(r.get("files", []))
        page_token = r.get("nextPageToken")
        if not page_token:
            break
    return res


def download_file(drive, file_id: str, dest_path: Path):
    """Baixa arquivo do Drive para o disco temporário."""
    request = drive.files().get_media(fileId=file_id)
    with io.FileIO(dest_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request, chunksize=1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()


def extract_text_first_pages(pdf_path: Path, max_pages=2):
    """Extrai texto somente das primeiras páginas (mais rápido)."""
    chunks = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for p in pdf.pages[:max_pages]:
            chunks.append(p.extract_text() or "")
    return "\n".join(chunks)


def list_pdfs_recursive(drive, folder_id: str, path_prefix: str, max_depth=8):
    """
    Lista PDFs dentro de qualquer subpasta.
    max_depth evita loop / profundidade infinita.
    Retorna [(file_obj, path_hint), ...]
    """
    out = []
    stack = [(folder_id, path_prefix, 0)]

    while stack:
        fid, prefix, depth = stack.pop()
        if depth > max_depth:
            continue

        children = list_children(drive, fid)
        for f in children:
            name = f.get("name", "")
            mime = f.get("mimeType", "")

            if mime == FOLDER_MIME:
                stack.append((f["id"], f"{prefix}/{name}", depth + 1))
            else:
                # pega por mimeType (mais correto) ou extensão (fallback)
                if mime == PDF_MIME or name.lower().endswith(".pdf"):
                    out.append((f, f"{prefix}/{name}"))

    return out


# -------------------------
# MAIN
# -------------------------

def main():
    sa_json = os.environ.get("GDRIVE_SA_JSON", "")
    root_id = os.environ.get("GDRIVE_ROOT_FOLDER_ID", "")

    if not sa_json.strip():
        raise RuntimeError("Secret GDRIVE_SA_JSON está vazio.")
    if not root_id.strip():
        raise RuntimeError("Secret GDRIVE_ROOT_FOLDER_ID está vazio.")

    drive = drive_service(sa_json)

    # 1) pegar pastas "ano" na raiz
    root_children = list_children(drive, root_id)
    years = []
    for f in root_children:
        if f["mimeType"] == FOLDER_MIME and f["name"].isdigit() and len(f["name"]) == 4:
            years.append((int(f["name"]), f["id"], f["name"]))
    years.sort(key=lambda x: x[0])  # 2024 -> 2025 -> 2026

    print("ROOT CHILDREN:", len(root_children))
    print("ANOS ENCONTRADOS:", [y[2] for y in years])

    results = {}    # tasy -> (date, year_name, path_hint, motivo)
    not_found = []  # (tasy_or_label, year_name, path_hint, motivo)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)

        for year_int, year_id, year_name in years:
            pdf_items = list_pdfs_recursive(drive, year_id, f"{year_name}", max_depth=10)
            print(year_name, "PDFs encontrados:", len(pdf_items))

            for f, path_hint in pdf_items:
                name = f["name"]
                tasy = tasy_from_name(name)

                if not tasy:
                    not_found.append(("SEM_TASY_NO_NOME", year_name, path_hint, "NAO_IDENTIFICOU_TASY"))
                    continue

                local_pdf = td / f"{f['id']}.pdf"

                try:
                    download_file(drive, f["id"], local_pdf)
                except Exception as e:
                    not_found.append((tasy, year_name, path_hint, f"ERRO_DOWNLOAD: {type(e).__name__}"))
                    continue

                try:
                    text = extract_text_first_pages(local_pdf, max_pages=2)
                except Exception as e:
                    not_found.append((tasy, year_name, path_hint, f"ERRO_PDF: {type(e).__name__}"))
                    continue

                d, motivo = pick_date(text)
                if d is None:
                    not_found.append((tasy, year_name, path_hint, motivo))
                    continue

                # Regra: sobrescreve sempre (ano crescente -> último ganha)
                results[tasy] = (d, year_name, path_hint, motivo)

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
    print(f"OK: {len(results)} registros | NAO_ENCONTRADOS: {len(not_found)} | ANOS: {len(years)}")


if __name__ == "__main__":
    main()

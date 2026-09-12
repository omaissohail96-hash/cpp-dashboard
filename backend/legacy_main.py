"""Legacy single-workbook Waste dashboard API."""
from __future__ import annotations
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
import math, re, shutil, uuid, json, os
import logging
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data"))
UPLOADS = DATA_DIR / "uploads"; UPLOADS.mkdir(parents=True, exist_ok=True)
CACHE_FILE = DATA_DIR / "cache.json"
active: Path | None = None
cache: dict[str, Any] = {"rows": [], "columns": [], "total": {}, "line_rows": [], "stock_totals": {}, "rejection_rows": [], "rejection_weight_field": None, "reporting_period": None, "uploaded_date": None, "uploader_name": None, "loaded_at": None}
app = FastAPI(title="CPP Waste Dashboard", version="1.1.0")
logger = logging.getLogger("cpp-dashboard")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["*"], allow_headers=["*"])

def persist_cache() -> None:
    """Persist the parsed snapshot and upload metadata atomically."""
    payload = dict(cache)
    payload["active_file"] = str(active) if active else None
    temporary = CACHE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(CACHE_FILE)

def restore_cache() -> None:
    """Restore the last successful upload when its workbook still exists."""
    global active
    if not CACHE_FILE.exists():
        return
    try:
        payload = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        saved_file = payload.pop("active_file", None)
        if not saved_file or not Path(saved_file).exists():
            logger.warning("Persisted cache found, but uploaded workbook is missing: %s", saved_file)
            return
        cache.update(payload)
        active = Path(saved_file)
        logger.info("Restored persisted dashboard cache from %s", CACHE_FILE)
    except Exception as error:
        logger.warning("Could not restore persisted dashboard cache: %s", error)

restore_cache()

def engine(path: Path): return "pyxlsb" if path.suffix.lower() == ".xlsb" else None
def clean(value: Any, index=0): return re.sub(r"\s+", " ", str(value or "").replace("\r", " ").replace("\n", " ")).strip() or f"Column {index+1}"
def json_value(value: Any, column: str):
    if pd.isna(value) or value in ("", "nan", "NaT"): return None
    if isinstance(value, (int,float)):
        if "date" in column.lower() and 20000 < value < 60000: return (datetime(1899,12,30)+timedelta(days=float(value))).date().isoformat()
        return float(value)
    return str(value).strip()
def parse(path: Path):
    raw=pd.read_excel(path,sheet_name="Waste",engine=engine(path),header=None)
    title=next((i for i,v in raw.iloc[:,0].items() if str(v).strip().lower()=="film wise waste"),None)
    if title is None: raise ValueError('Expected "FILM WISE WASTE" table was not found in the Waste sheet.')
    header=title+1; seen={}; columns=[]
    for i,value in enumerate(raw.iloc[header].tolist()):
        name=clean(value,i); seen[name]=seen.get(name,0)+1; columns.append(name if seen[name]==1 else f"{name} ({seen[name]})")
    total_row=next((i for i in range(header+1,len(raw)) if str(raw.iloc[i,0]).strip().lower()=="total"),None)
    if total_row is None: raise ValueError('The "FILM WISE WASTE" table has no Total row.')
    rows=raw.iloc[header+1:total_row].copy(); rows.columns=columns; rows=rows.dropna(how="all")
    total={name:json_value(raw.iloc[total_row,i],name) for i,name in enumerate(columns)}
    return [{k:json_value(v,k) for k,v in row.items()} for row in rows.to_dict("records")],columns,total
def parse_line_waste(path: Path):
    frame=pd.read_excel(path,sheet_name="Line waste",engine=engine(path),header=1)
    seen={}; normalized=[]
    for i, column in enumerate(frame.columns):
        name=clean(column,i); seen[name.lower()]=seen.get(name.lower(),0)+1; normalized.append(name if seen[name.lower()]==1 else f"{name} ({seen[name.lower()]})")
    frame.columns=normalized
    return [{k:json_value(v,k) for k,v in row.items()} for row in frame.dropna(how="all").to_dict("records")]
def parse_metallized_stock_total(path: Path, sheet: str, kind: str):
    """Read only the Total row from the metallized opening/closing summary table."""
    try:
        raw = pd.read_excel(path, sheet_name=sheet, engine=engine(path), header=None)
    except Exception:
        return None
    title = next((i for i, row in raw.iterrows() if any(kind in str(value or "").upper() and "SUMMARY CPP METALLIZED" in str(value or "").upper() for value in row.tolist())), None)
    if title is None or title + 1 >= len(raw): return None
    headers = [clean(value, i) for i, value in enumerate(raw.iloc[title + 1].tolist())]
    total_row = next((i for i in range(title + 2, len(raw)) if str(raw.iloc[i, 0] or "").strip().lower() == "total"), None)
    if total_row is None: return None
    values = {headers[i]: json_value(raw.iloc[total_row, i], headers[i]) for i in range(min(len(headers), len(raw.columns)))}
    return values
def parse_rejection(path: Path):
    raw = pd.read_excel(path, sheet_name="Rejection (Software)", engine=engine(path), header=None)
    header = next((i for i, row in raw.iterrows() if sum(str(value or "").strip().lower() in {"reason", "net wt", "gross wt"} for value in row.tolist()) >= 2), None)
    if header is None: return [], None
    columns = [clean(value, i) for i, value in enumerate(raw.iloc[header].tolist())]
    # The sheet contains stacked historical/monthly blocks. Read through the
    # end of the sheet; subtotal rows are ignored during record validation.
    end = len(raw)
    frame = raw.iloc[header + 1:end].copy(); frame.columns = columns; frame = frame.dropna(how="all")
    reason_key = next((c for c in columns if c.strip().lower() in {"reason", "reason:"} or "reason" in c.lower()), None)
    dept_key = next((c for c in columns if c.strip().lower() in {"responsible dept", "responsible department"} or "responsible dept" in c.lower()), None)
    month_key = next((c for c in columns if c.strip().lower() == "month"), None)
    if not month_key: raise ValueError("The Rejection (Software) sheet has no Month column.")
    weight_key = next((c for c in columns if c.strip().lower() in {"net wt", "net weight"}), None) or next((c for c in columns if "gross wt" in c.lower() or "gross weight" in c.lower()), None)
    if not reason_key or not weight_key: return [], weight_key
    records = []
    for row in frame.to_dict("records"):
        weight = json_value(row.get(weight_key), weight_key)
        reason = json_value(row.get(reason_key), reason_key)
        if not isinstance(weight, (int, float)) or not math.isfinite(float(weight)): continue
        if not reason or str(reason).strip().lower() in {"total", "subtotal", "grand total"}: continue
        month_value = json_value(row.get(month_key), "Month") if month_key else None
        records.append({"Reason": reason, "Responsible Dept": json_value(row.get(dept_key), dept_key) if dept_key else None, "Net Wt": float(weight), "Month": month_value})
    month_index = columns.index(month_key) + 1 if month_key in columns else None
    logger.info("Rejection detail parse: sheet='Rejection (Software)', header_row=%s, month_column='%s' (Excel column %s), end_row=%s, weight_field='%s', full_year_detail_rows=%s, raw_net_weight_sum=%.3f", header, month_key, month_index, end, weight_key, len(records), sum(row["Net Wt"] for row in records))
    return records, weight_key
def find_category_key(rows):
    if not rows: return "Cattegory"
    return next((key for key in rows[0] if key.lower().startswith(("categ", "catteg"))), "Cattegory")
def summary(rows):
    fields=["RM Input","Line Production","Line Waste","Overall CPP waste","Transparent/ Metallizable Stock Opening","Transparent/ Metallizable Stock Closing","Metallizer Input","Metallized Stock Opening","Metallized Stock Closing","PS Input","PS Production","Rejection","Conversion Waste"]
    data={field:round(sum(float(row.get(field) or 0) for row in rows if isinstance(row.get(field),(int,float))),3) for field in fields}; data["Overall CPP waste %"]=data["Overall CPP waste"]/data["RM Input"] if data["RM Input"] else 0; return data
def apply_filters(rows, text, query):
    result=rows
    for key,value in query.items(): result=[row for row in result if not value or str(row.get(key,"")).lower()==value.lower()]
    if text: result=[row for row in result if text.lower() in " ".join(str(v or "") for v in row.values()).lower()]
    return result
def require_data():
    if active is None: raise HTTPException(404,"No workbook uploaded. Please upload a valid Excel file.")

@app.get("/api/health")
def health(): return {"uploaded":active is not None,"file":str(active) if active else None,"sheet":"Waste","loaded_at":cache["loaded_at"]}
@app.post("/api/upload")
def upload(file: UploadFile=File(...), reporting_date: str|None = Form(None), uploader_name: str|None = Form(None)):
    global active
    suffix=Path(file.filename or "").suffix.lower()
    if suffix not in {".xls", ".xlsx", ".xlsb"}: raise HTTPException(400,"Unsupported file type. Upload .xls, .xlsx or .xlsb")
    filename = Path(file.filename or "").name
    match = re.search(r"(?<!\d)(\d{2})[.\-_](\d{2})[.\-_](\d{4})(?!\d)", filename)
    detected = f"{match.group(3)}-{match.group(2)}-{match.group(1)}" if match else reporting_date
    if not detected: raise HTTPException(400, "Filename date not found. Enter a reporting date (YYYY-MM-DD) and upload again.")
    if not uploader_name or not uploader_name.strip(): raise HTTPException(400, "Uploader name is required.")
    try: parsed_date = datetime.strptime(detected, "%Y-%m-%d")
    except ValueError: raise HTTPException(400, "Invalid reporting date. Use YYYY-MM-DD.")
    path=UPLOADS/f"upload_{uuid.uuid4().hex}_{filename}"
    with path.open("wb") as output: shutil.copyfileobj(file.file,output)
    try: rows,columns,total=parse(path)
    except Exception as error: path.unlink(missing_ok=True); raise HTTPException(400,f"Uploaded file could not be parsed: {error}")
    try: line_rows=parse_line_waste(path)
    except Exception: line_rows=[]
    stock_totals = {"opening": parse_metallized_stock_total(path, "Opening Stock Summary", "OPENING"), "closing": parse_metallized_stock_total(path, "Closing Stock Summary", "CLOSING")}
    try: rejection_rows, rejection_weight_field = parse_rejection(path)
    except Exception: rejection_rows, rejection_weight_field = [], None
    period = parsed_date.strftime("%Y-%m")
    active=path; cache.update(rows=rows,columns=columns,total=total,line_rows=line_rows,stock_totals=stock_totals,rejection_rows=rejection_rows,rejection_weight_field=rejection_weight_field,reporting_period=period,uploaded_date=parsed_date.date().isoformat(),uploader_name=uploader_name.strip(),loaded_at=datetime.now().isoformat(timespec="seconds")); persist_cache(); return {"ok":True,"file_name":file.filename,"sheet":"Waste","reporting_period":period,"uploaded_date":cache["uploaded_date"],"uploader_name":cache["uploader_name"],"loaded_at":cache["loaded_at"]}
@app.get("/api/overview")
def overview(filters: str|None=None, search: str|None=None):
    if active is None:return {"loaded_at":None,"file":None,"sheet":"Waste","sections":[],"kpis":[],"message":"No workbook uploaded"}
    query=dict(pair.split("=",1) for pair in (filters or "").split("|") if "=" in pair); rows=apply_filters(cache["rows"],search,query); total=summary(rows) if (filters or search) else cache["total"]
    number=lambda value:round(float(value),2) if isinstance(value,(int,float)) and math.isfinite(value) else 0
    kpis=[("RM Input","RM Input","kg"),("Line Production","Line Production","kg"),("Line Waste","Line Waste","kg"),("Overall CPP Waste","Overall CPP waste","kg"),("Overall CPP Waste %","Overall CPP waste %","%")]
    return {"loaded_at":cache["loaded_at"],"file":str(active),"sheet":"Waste","reporting_period":cache.get("reporting_period"),"uploaded_date":cache.get("uploaded_date"),"uploader_name":cache.get("uploader_name"),"sections":[{"id":"waste","label":"Waste","count":len(cache["rows"]),"value":number(total.get("Line Waste")),"unit":"kg","source":["Waste"]}],"kpis":[{"label":a,"value":number(total.get(b)),"unit":c} for a,b,c in kpis],"totals":total}
@app.get("/api/sections/waste")
def waste(search: str|None=None,limit:int=Query(150,ge=1,le=1000),filters: str|None=None):
    require_data(); query=dict(pair.split("=",1) for pair in (filters or "").split("|") if "=" in pair); rows=apply_filters(cache["rows"],search,query); return {"section":"waste","source_sheets":["Waste"],"total":len(rows),"columns":cache["columns"],"rows":rows[:limit],"summary":summary(rows)}
@app.get("/api/sections/waste/filters")
def waste_filters():
    require_data(); columns=[c for c in cache["columns"] if "film" in c.lower() or "group" in c.lower()]; return {"filters":{c:sorted({str(row[c]) for row in cache["rows"] if row.get(c) is not None}) for c in columns}}

@app.get("/api/kpis/line-waste")
def line_waste_detail():
    require_data(); rows=cache.get("line_rows",[])
    month_values=[str(r.get("Month")).strip() for r in rows if re.fullmatch(r"(?:0[1-9]|1[0-2])-\d{2}", str(r.get("Month") or "").strip()) and str(r.get("Month")).strip() != "01-00"]
    month=max(month_values, key=lambda value: (int(value.split("-")[1]), int(value.split("-")[0]))) if month_values else None
    rows=[r for r in rows if month is None or str(r.get("Month")).strip()==month]
    if not rows: logger.warning("Line Waste month filter returned zero rows for month %s", month)
    def groups(key):
        out={}
        for row in rows:
            name=str(row.get(key) or "Unspecified"); item=out.setdefault(name,{"name":name,"waste":0,"hours":0,"instances":0}); item["waste"]+=float(row.get("Waste (Kg)") or 0); item["hours"]+=float(row.get("Downtime (Hours)") or 0); item["instances"]+=float(row.get("Instances") or 0)
        return sorted(out.values(),key=lambda x:x["waste"],reverse=True)
    reasons=groups("Nature of DT"); categories=groups("Category"); films=groups("Film"); total_waste=sum(x["waste"] for x in reasons); total_hours=sum(x["hours"] for x in reasons); total_instances=sum(x["instances"] for x in reasons)
    nested={}; category_key=find_category_key(rows)
    downtime_by_category={}
    for row in rows:
        film=str(row.get("Film") or "Unspecified"); category=str(row.get(category_key) or "Unspecified")
        item=nested.setdefault(film,{}).setdefault(category,{"waste":0,"hours":0})
        item["waste"]+=float(row.get("Waste (Kg)") or 0); item["hours"]+=float(row.get("Downtime (Hours)") or 0)
        downtime_by_category[category]=downtime_by_category.get(category,0)+float(row.get("Downtime (Hours)") or 0)
    film_categories=[{"film":film,"total":sum(v["waste"] for v in values.values()),"categories":[{"name":name,"waste":v["waste"],"hours":v["hours"]} for name,v in sorted(values.items(),key=lambda item:item[1]["waste"],reverse=True) if v["waste"] != 0 or v["hours"] != 0]} for film,values in sorted(nested.items(),key=lambda item:sum(v["waste"] for v in item[1].values()),reverse=True) if sum(v["waste"] for v in values.values()) != 0]
    downtime_categories=[{"name":name,"hours":hours} for name,hours in sorted(downtime_by_category.items(),key=lambda item:item[1],reverse=True)]
    for item in reasons: item["share"]=item["waste"]/total_waste*100 if total_waste else 0
    return {"month":month,"summary":{"waste":total_waste,"hours":total_hours,"instances":total_instances,"events":len(rows)},"reasons":reasons,"categories":categories,"films":films,"film_categories":film_categories,"downtime_categories":downtime_categories}

@app.get("/api/kpis/metallized-stock/{kind}")
def metallized_stock_detail(kind: str):
    require_data()
    if kind not in {"opening", "closing"}: raise HTTPException(400, "Kind must be opening or closing")
    return {"kind": kind, "total": cache.get("stock_totals", {}).get(kind)}

@app.get("/api/kpis/rejection-reasons")
def rejection_reason_summary():
    require_data(); grouped: dict[str, float] = {}
    rejection_rows = cache.get("rejection_rows", [])
    def month_period(value):
        if re.fullmatch(r"\d{2}-\d{2}", str(value or "").strip()):
            month, year = str(value).strip().split("-"); return f"20{year}-{month}"
        try: return (datetime(1899, 12, 30) + timedelta(days=float(value))).strftime("%Y-%m")
        except (TypeError, ValueError, OverflowError): return None
    periods = [month_period(row.get("Month")) for row in rejection_rows]
    periods = [period for period in periods if period]
    reporting_month = cache.get("reporting_period") or (max(periods) if periods else None)
    if reporting_month: rejection_rows = [row for row in rejection_rows if month_period(row.get("Month")) == reporting_month]
    standard = ["BAND", "CREASING SLITTER", "DEMATALIZE", "LOW OD", "PIN HOLES", "SCRATCHES", "SIZE VARIATION", "SLACKNESS", "SPITTING", "STRUCTURE", "TD IMPRESSION", "THICKNESS VARIATION", "TRAM LINES", "WRINKLES"]
    def canonical_reason(value: Any) -> str:
        text = re.sub(r"\s+", " ", str(value or "").strip().upper())
        if not text: return "Other"
        aliases = {
            "BAND": ["BAND", "MD BAND"],
            "CREASING SLITTER": ["CREASING SLITTER", "CREASING", "SLITTER CREASING"],
            "DEMATALIZE": ["DEMATALIZE", "DEMATT", "DEMETALIZE", "DEMAT"],
            "LOW OD": ["LOW OD", "LOW O.D", "LOW OPTICAL DENSITY"],
            "PIN HOLES": ["PIN HOLE", "PIN HOLES", "PINHOLE", "PINHOLES"],
            "SCRATCHES": ["SCRATCH", "SCRATCHES"],
            "SIZE VARIATION": ["SIZE VARIATION", "SIZE VARIATIONS"],
            "SLACKNESS": ["SLACK", "SLACKNESS"],
            "SPITTING": ["SPIT", "SPITTING"],
            "STRUCTURE": ["STRUCTURE", "STRUCTURAL"],
            "TD IMPRESSION": ["TD IMPRESSION"],
            "THICKNESS VARIATION": ["THICKNESS", "THICKNESS VARIATION", "THICKNESS VARIATIONS"],
            "TRAM LINES": ["TRAM LINE", "TRAM LINES"],
            "WRINKLES": ["WRINKLE", "WRINKLES", "BOTTOM WRINKLES"],
        }
        for category in standard:
            if text in aliases.get(category, []) or any(alias in text for alias in aliases.get(category, [])): return category
        return "Other"
    details: dict[str, list[dict[str, Any]]] = {}
    for index, row in enumerate(rejection_rows, start=1):
        reason = canonical_reason(row.get("Reason"))
        grouped[reason] = grouped.get(reason, 0) + row.get("Net Wt", 0)
        raw_month = row.get("Month")
        details.setdefault(reason, []).append({"row": index, "raw_reason": row.get("Reason"), "net": row.get("Net Wt", 0), "month": raw_month, "month_period": month_period(raw_month), "responsible_dept": row.get("Responsible Dept") or "Other"})
    reasons = [{"reason": reason, "net": weight, "count": len(details.get(reason, [])), "detail": details.get(reason, [])} for reason, weight in sorted(grouped.items(), key=lambda item: item[1], reverse=True)]
    departments: dict[str, float] = {}
    for row in rejection_rows:
        name = re.sub(r"\s+", " ", str(row.get("Responsible Dept") or "Other").strip()) or "Other"
        departments[name] = departments.get(name, 0) + float(row.get("Net Wt") or 0)
    department_rows = [{"department": name, "net": weight} for name, weight in sorted(departments.items(), key=lambda item: item[1], reverse=True)]
    combined_map: dict[str, dict[str, float]] = {}
    for row in rejection_rows:
        reason = canonical_reason(row.get("Reason")); dept = re.sub(r"\s+", " ", str(row.get("Responsible Dept") or "Other").strip()) or "Other"
        combined_map.setdefault(reason, {})[dept] = combined_map.setdefault(reason, {}).get(dept, 0) + float(row.get("Net Wt") or 0)
    combined = [{"reason": reason, "departments": values, "net": sum(values.values())} for reason, values in sorted(combined_map.items(), key=lambda item: sum(item[1].values()), reverse=True)]
    total = {"net": sum(item["net"] for item in reasons)}
    logger.info("Rejection reason aggregation: reporting_month=%s, detail_rows=%s, net_weight_sum=%.3f, duplicate_processing=false", reporting_month, len(rejection_rows), total["net"])
    return {"reporting_month": reporting_month, "weight_field": cache.get("rejection_weight_field") or "Unavailable", "detail_rows": len(rejection_rows), "reasons": reasons, "departments": department_rows, "combined": combined, "total": total}

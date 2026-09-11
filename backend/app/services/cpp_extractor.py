from __future__ import annotations
from datetime import date
import math
from typing import Any
from .excel_reader import WorkbookReader
from ..utils.dates import as_date

WASTE = {"date": (["date"], 1), "production": (["production (kgs)", "production"], 11), "waste": (["day total waste", "day wise waste", "total waste with trial", "total waste (day)"], 17)}
MONTHLY = {"production_tons": (["production (tons)"], (6,3)), "performance": (["performance %"], (6,8)), "availability": (["availability %"], (7,8)), "electrical": (["electrical"], (15,4)), "mechanical": (["mechanical"], (16,4)), "karsaz": (["karsaz"], (17,4)), "pm": (["planned maintenance"], (18,4)), "powerhouse": (["power house"], (19,4)), "process_planned": (["process planned downtime"], (23,4)), "process_unplanned": (["process unplanned downtime"], (24,4)), "waste_kg": (["waste kgs"], (32,17)), "waste_pct": (["waste %"], (32,18)), "available_days": (["total available days"], (33,14)), "available_hours": (["total available hours"], (34,14))}
DT_KEYS = ["electrical", "mechanical", "karsaz", "powerhouse", "pm", "process_planned", "process_unplanned", "other"]

def norm(v: Any): return " ".join(str(v or "").lower().split())
def numeric(v: Any):
    try:
        result=float(v); return result if math.isfinite(result) else None
    except (ValueError, TypeError): return None
def match(v, aliases): return any(norm(a) in norm(v) for a in aliases)

def find_header_col(reader, sheet, header_row_range, label_aliases):
    for _, row in reader.iter_rows(sheet, min(header_row_range), max(header_row_range)):
        for col, value in row.items():
            if match(value, label_aliases): return col
    return None
def find_label_cell(reader, sheet, search_range, label_aliases):
    for r, row in reader.iter_rows(sheet, search_range[0], search_range[1]):
        for c, value in row.items():
            if match(value, label_aliases):
                for candidate in range(c+1, c+7):
                    if numeric(row.get(candidate)) is not None: return r, candidate
    return None
def _headers(reader, sheet, maps, warnings, limit=10):
    header=next((r for r,vals in reader.iter_rows(sheet,1,limit) if any(norm(v)=="date" for v in vals.values())),1); output={}
    for key,(aliases,fallback) in maps.items():
        col=find_header_col(reader,sheet,range(header,header+1),aliases); output[key]=col or fallback
        if not col: warnings.append(f"{sheet}: '{key}' used fallback lookup")
    return header,output
def _waste_headers(reader,warnings): return _headers(reader,"Waste",WASTE,warnings,8)

def find_latest_data_date(reader,warnings):
    header, cols=_waste_headers(reader,warnings); found=None
    for _, row in reader.iter_rows("Waste",header+1):
        d=as_date(row.get(cols['date']))
        if d and (numeric(row.get(cols['production'])) or 0)>0: found=max(found,d) if found else d
    return found
def get_day_waste_row(reader,target_date,warnings):
    header,cols=_waste_headers(reader,warnings); result={"production":None,"waste":None}
    for _,row in reader.iter_rows("Waste",header+1):
        if as_date(row.get(cols['date']))==target_date: result={key:numeric(row.get(cols[key])) for key in ("production","waste")}
    return result
def get_monthly_summary(reader,warnings):
    result={}
    for key,(aliases,fallback) in MONTHLY.items():
        found=find_label_cell(reader,"Monthly Summary",(1,80),aliases)
        if not found: warnings.append(f"Monthly Summary: '{key}' used fallback lookup"); found=fallback
        result[key]=numeric(reader.cell("Monthly Summary",*found))
    return result
def get_oee_day_row(reader,target,warnings):
    maps={"date":(["date"],2),"operator":(["shift incharge","operator"],3),"performance":(["performance %"],8),"availability":(["availability %"],9),"quality":(["quality %"],10)}
    header,cols=_headers(reader,"OEE",maps,warnings); rows=[row for _,row in reader.iter_rows("OEE",header+1) if as_date(row.get(cols['date']))==target and not norm(row.get(cols['operator']))]
    if len(rows)>1:warnings.append("OEE: multiple daily aggregate rows; last one used")
    row=rows[-1] if rows else {}; return {key:numeric(row.get(cols[key])) for key in ("performance","availability","quality")}
def get_downtime_day_breakdown(reader,target,warnings):
    maps={"date":(["date"],1),"depart":(["depart","department"],5),"nature":(["nature of dt","nature"],7),"hours":(["downtime (hours)","downtime (hrs)"],12)}
    header,cols=_headers(reader,"Downtime",maps,warnings); output={key:0.0 for key in DT_KEYS}
    for _,row in reader.iter_rows("Downtime",header+1):
        if as_date(row.get(cols['date'])) != target: continue
        department,nature=norm(row.get(cols['depart'])),norm(row.get(cols['nature'])); key="other"
        if "process" in department: key="process_unplanned" if "unplanned" in department else "process_planned" if "planned" in department else key
        elif "planned maintenance" in nature:key="pm"
        elif "electrical" in nature:key="electrical"
        elif "mechanical" in nature:key="mechanical"
        elif "karsaz" in nature:key="karsaz"
        elif "power house" in nature or "powerhouse" in nature:key="powerhouse"
        output[key]+=numeric(row.get(cols['hours'])) or 0
    return output

def extract_cpp_data(file_like,filename,target_date=None):
    warnings=[]; reader=WorkbookReader(file_like,filename)
    try:
        for sheet in ("Waste","Monthly Summary","OEE","Downtime"): reader.require_sheet(sheet)
        target=target_date or find_latest_data_date(reader,warnings)
        if not target: raise ValueError("No latest production date found")
        day=get_day_waste_row(reader,target,warnings); mtd=get_monthly_summary(reader,warnings); oee=get_oee_day_row(reader,target,warnings); dt=get_downtime_day_breakdown(reader,target,warnings)
        prod=(day['production'] or 0)/1000; waste=(day['waste'] or 0)/1000
        result={"date":target,"production_tons_day":prod,"waste_tons_day":waste,"waste_pct_day":waste/prod*100 if prod else None,"production_tons_mtd":mtd['production_tons'],"waste_tons_mtd":mtd['waste_kg']/1000 if mtd['waste_kg'] is not None else None,"waste_pct_mtd":mtd['waste_pct'],"availability_day":oee['availability'],"performance_day":oee['performance'],"quality_day":oee['quality'],"availability_mtd":mtd['availability'],"performance_mtd":mtd['performance'],"quality_mtd":None,"available_days_mtd":mtd['available_days'],"available_hours_mtd":mtd['available_hours']}
        for key in DT_KEYS: result[f"{key}_hrs_day"]=dt[key]; result[f"{key}_hrs_mtd"]=mtd.get(key,0 if key=="other" else None)
        return result,warnings
    finally: reader.close()
def extract_series(file_like,filename):
    warnings=[]; reader=WorkbookReader(file_like,filename)
    try:
        header,cols=_waste_headers(reader,warnings); output=[]
        for _,row in reader.iter_rows("Waste",header+1):
            d=as_date(row.get(cols['date'])); prod=(numeric(row.get(cols['production'])) or 0)/1000; waste=(numeric(row.get(cols['waste'])) or 0)/1000
            if d: output.append({"date":d,"production_tons":prod,"waste_tons":waste,"waste_pct":waste/prod*100 if prod else None})
        return output
    finally: reader.close()

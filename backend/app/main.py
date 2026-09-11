from datetime import date
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from .services.cpp_extractor import extract_cpp_data, extract_series
from .utils.dates import as_date

app=FastAPI(title="CPP Daily Meeting Dashboard",version="2.0")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:3000","http://127.0.0.1:3000"],allow_methods=["*"],allow_headers=["*"])
@app.get('/api/health')
def health(): return {"ok":True}
@app.post('/api/dashboard/upload')
def upload_dashboard(cpp1_file:UploadFile=File(...),cpp2_file:UploadFile=File(...),target_date:str|None=None):
    for upload in (cpp1_file,cpp2_file):
        if Path(upload.filename or "").suffix.lower() not in {'.xlsb','.xlsx','.xlsm'}: raise HTTPException(400,"Only .xlsb, .xlsx, and .xlsm files are supported")
    requested=as_date(target_date) if target_date else None
    if target_date and not requested: raise HTTPException(400,"target_date must be YYYY-MM-DD")
    try:
        cpp1,w1=extract_cpp_data(cpp1_file.file,cpp1_file.filename,requested)
        cpp2,w2=extract_cpp_data(cpp2_file.file,cpp2_file.filename,cpp1['date'])
        return {"date":cpp1['date'],"cpp1":cpp1,"cpp2":cpp2,"cpp1_series":extract_series(cpp1_file.file,cpp1_file.filename),"cpp2_series":extract_series(cpp2_file.file,cpp2_file.filename),"warnings":[f"CPP-1: {x}" for x in w1]+[f"CPP-2: {x}" for x in w2]}
    except KeyError as error: raise HTTPException(422,f"Couldn't find sheet '{error.args[0]}' in uploaded file — is this a CPP OEE Waste Report workbook?")
    except Exception as error: raise HTTPException(422,f"Could not process workbooks: {error}")

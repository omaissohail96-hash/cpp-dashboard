from datetime import date
from typing import Optional
from pydantic import BaseModel

class SeriesPoint(BaseModel):
    date: date
    production_tons: float = 0
    waste_tons: float = 0
    waste_pct: Optional[float] = None

class LineDayData(BaseModel):
    date: date
    production_tons_day: float = 0
    waste_tons_day: float = 0
    waste_pct_day: Optional[float] = None
    production_tons_mtd: Optional[float] = None
    waste_tons_mtd: Optional[float] = None
    waste_pct_mtd: Optional[float] = None
    availability_day: Optional[float] = None
    performance_day: Optional[float] = None
    quality_day: Optional[float] = None
    availability_mtd: Optional[float] = None
    performance_mtd: Optional[float] = None
    available_days_mtd: Optional[float] = None
    available_hours_mtd: Optional[float] = None

class DashboardResponse(BaseModel):
    date: date
    cpp1: LineDayData
    cpp2: LineDayData
    cpp1_series: list[SeriesPoint]
    cpp2_series: list[SeriesPoint]
    warnings: list[str] = []

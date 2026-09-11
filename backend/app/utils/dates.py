from datetime import date, datetime, timedelta
from typing import Any

def as_date(value: Any) -> date | None:
    if value is None or value == "": return None
    if isinstance(value, datetime): return value.date()
    if isinstance(value, date): return value
    if isinstance(value, (int, float)) and 20000 < value < 60000: return (datetime(1899, 12, 30) + timedelta(days=float(value))).date()
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
            try: return datetime.strptime(value.strip(), fmt).date()
            except ValueError: pass
    return None

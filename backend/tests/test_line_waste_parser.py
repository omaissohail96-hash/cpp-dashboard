import pandas as pd
import pytest
from pathlib import Path

import backend.legacy_main as legacy_main
from backend.legacy_main import parse_line_waste


HEADERS = ["Date", "Shift", "Batch", "Film", "Cattegory", "Nature of DT", "Waste (Kg)", "Downtime (Hours)", "Month"]


def make_workbook(monkeypatch, header_row):
    monkeypatch.setattr(legacy_main, "resolve_sheet_name", lambda path, expected: expected)
    rows = [[None] * len(HEADERS) for _ in range(header_row)]
    rows.append(HEADERS)
    rows.append(["2026-08-01", "A", "B1", "CPP 25", "Process Planned", "Waste", 12.5, 1.25, "08-26"])
    frame = pd.DataFrame(rows)
    monkeypatch.setattr(pd, "read_excel", lambda *args, **kwargs: frame)


def test_line_waste_header_at_row_2(monkeypatch):
    make_workbook(monkeypatch, 1)
    rows = parse_line_waste(Path("report.xlsx"))
    assert rows[0]["Waste (Kg)"] == 12.5


def test_line_waste_header_at_row_5(monkeypatch):
    make_workbook(monkeypatch, 4)
    rows = parse_line_waste(Path("report.xlsx"))
    assert rows[0]["Month"] == "08-26"


def test_line_waste_header_missing(monkeypatch):
    monkeypatch.setattr(legacy_main, "resolve_sheet_name", lambda path, expected: expected)
    frame = pd.DataFrame([["not a header"] for _ in range(4)])
    monkeypatch.setattr(pd, "read_excel", lambda *args, **kwargs: frame)
    with pytest.raises(ValueError, match="Could not find the.*Line waste.*header"):
        parse_line_waste(Path("report.xlsx"))


@pytest.mark.parametrize("actual, expected", [
    ("Waste", "waste"),
    ("  LINE WASTE  ", "line waste"),
    ("Rejection   (Software)", "rejection (software)"),
])
def test_sheet_name_normalization(actual, expected):
    assert legacy_main.normalize_sheet_name(actual) == legacy_main.normalize_sheet_name(expected)

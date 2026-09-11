export type LineDayData = Record<string, number | string | null>;
export type SeriesPoint = { date:string; production_tons:number; waste_tons:number; waste_pct:number|null };
export type DashboardResponse = {date:string;cpp1:LineDayData;cpp2:LineDayData;cpp1_series:SeriesPoint[];cpp2_series:SeriesPoint[];warnings:string[]};

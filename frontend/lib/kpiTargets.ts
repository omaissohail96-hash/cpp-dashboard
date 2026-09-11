export type KpiTargetDirection = "lower-is-better" | "higher-is-better";

export type KpiTarget = {
  /** Target values use the same raw units as the parsed workbook (kg or ratio). */
  target: number;
  direction: KpiTargetDirection;
};

/**
 * Team-lead targets for the Waste dashboard. Keep these values in raw workbook
 * units so the status is unchanged when the display is switched to tons.
 * Percentage targets are ratios (for example, 0.05 means 5%).
 */
export const KPI_TARGETS: Record<string, KpiTarget> = {
  "RM Input": { target: 700000, direction: "higher-is-better" },
  "Line Production": { target: 650000, direction: "higher-is-better" },
  "Line Waste": { target: 20000, direction: "lower-is-better" },
  "Overall CPP Waste": { target: 30000, direction: "lower-is-better" },
  "Overall CPP Waste %": { target: 0.05, direction: "lower-is-better" },
  "Transparent/Metallize Stock Opening": { target: 200000, direction: "higher-is-better" },
  "Transparent/Metallize Stock Closing": { target: 200000, direction: "higher-is-better" },
  "Metallizer Input": { target: 650000, direction: "higher-is-better" },
  "Metallized Stock Opening": { target: 140000, direction: "higher-is-better" },
  "Metallized Stock Closing": { target: 170000, direction: "higher-is-better" },
  "PS Input": { target: 600000, direction: "higher-is-better" },
  "PS Production": { target: 600000, direction: "higher-is-better" },
  Rejection: { target: 15000, direction: "lower-is-better" },
  "Rejection Rate": { target: 0.025, direction: "lower-is-better" },
};

export type KpiStatus = "safe" | "unsafe" | "neutral";

export function getKpiStatus(label: string, value: number, targets: Record<string, KpiTarget> = KPI_TARGETS): KpiStatus {
  const config = targets[label];
  if (!config || !Number.isFinite(value)) return "neutral";
  const meetsTarget = config.direction === "lower-is-better"
    ? value <= config.target
    : value >= config.target;
  return meetsTarget ? "safe" : "unsafe";
}

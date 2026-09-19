import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import type { ChartDataset, ScriptableContext } from "chart.js";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

export type SeriesRow = {
  generation_mw: number;
  gas: number;
  liquid_fuel: number;
  coal: number;
  hydro: number;
  solar: number;
  wind: number;
  bheramara: number;
  tripura: number;
  adani: number;
  nepal: number;
  datetime?: string;
  date?: string;
  month?: string;
  remark?: string;
};

export type GridData = {
  current: SeriesRow;
  hourly: SeriesRow[];
  last7: SeriesRow[];
  prevDay: SeriesRow | null;
  months: SeriesRow[];
};

type FuelKey =
  | "gas"
  | "liquid_fuel"
  | "coal"
  | "hydro"
  | "solar"
  | "wind"
  | "imports";
type CorridorKey = "bheramara" | "tripura" | "adani" | "nepal";
type FocusKey = FuelKey | CorridorKey;
type Unit = "mw" | "share";
type MixKind = "single" | "stack" | "corridors";
type Pin = { kind: "hourly" | "day" | "month"; key: string } | null;

type SeriesDef = { key: FocusKey | "generation_mw"; label: string };

const COLORS: Record<string, string> = {
  gas: "#3d6b99",
  liquid_fuel: "#c4842a",
  coal: "#3a3a3a",
  hydro: "#2a8a82",
  solar: "#c9a227",
  wind: "#5a9eaf",
  imports: "#6b5b95",
  bheramara: "#5c4d86",
  tripura: "#8a7ab0",
  adani: "#3d335c",
  nepal: "#b7a8d4",
  total: "#1f5c45",
};

const STACK: SeriesDef[] = [
  { key: "gas", label: "Gas" },
  { key: "liquid_fuel", label: "Liquid fuel" },
  { key: "coal", label: "Coal" },
  { key: "hydro", label: "Hydro" },
  { key: "solar", label: "Solar" },
  { key: "wind", label: "Wind" },
  { key: "imports", label: "Imports" },
];

const CORRIDORS: SeriesDef[] = [
  { key: "bheramara", label: "Bheramara" },
  { key: "tripura", label: "Tripura" },
  { key: "adani", label: "Adani" },
  { key: "nepal", label: "Nepal" },
];

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const INSPECT_ENABLED = false;

const state = {
  focus: null as FocusKey | null,
  unit: "mw" as Unit,
  hourlyMode: "total" as "total" | "mix",
  monthWindow: "12m",
  pin: null as Pin,
};

let data: GridData;
let bound = false;
let chartHourly: Chart | null = null;
let chartWeek: Chart | null = null;
let chartMonthly: Chart | null = null;

function isCorridor(key: string | null): key is CorridorKey {
  return (
    key === "bheramara" ||
    key === "tripura" ||
    key === "adani" ||
    key === "nepal"
  );
}

function importsOf(row: SeriesRow): number {
  return row.bheramara + row.tripura + row.adani + row.nepal;
}

function valueOf(row: SeriesRow, key: FocusKey | "generation_mw"): number {
  if (key === "generation_mw") return row.generation_mw;
  if (key === "imports") return importsOf(row);
  return Number(row[key] || 0);
}

function shareOf(row: SeriesRow, key: FocusKey | "generation_mw"): number {
  const t = row.generation_mw;
  if (t <= 0) return 0;
  return (valueOf(row, key) / t) * 100;
}

function labelOf(key: string): string {
  if (key === "generation_mw" || key === "total") return "Generation";
  return [...STACK, ...CORRIDORS].find((s) => s.key === key)?.label ?? key;
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function fmtMw(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtTick(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function fmtDayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const name = MONTH_NAMES[Number(m) - 1] ?? ym;
  return `${name} ${y}`;
}

function mean(rows: SeriesRow[], key: FocusKey | "generation_mw"): number {
  if (!rows.length) return 0;
  return (
    rows.reduce((sum, row) => sum + valueOf(row, key), 0) / rows.length
  );
}

function windowedMonths(): SeriesRow[] {
  const rows = data.months;
  const w = state.monthWindow;
  if (w === "all") return rows;
  if (w === "12m") return rows.slice(-12);
  return rows.filter((row) => (row.month ?? "").startsWith(w));
}

function windowRangeLabel(): string {
  const rows = windowedMonths();
  if (!rows.length) return "";
  const a = rows[0].month ?? "";
  const b = rows[rows.length - 1].month ?? "";
  return a && b && a !== b ? `${a} – ${b}` : a || b;
}

function windowTitle(): string {
  if (state.monthWindow === "12m") return "Last 12 months";
  if (state.monthWindow === "all") return "Archive";
  return state.monthWindow;
}

function importsFocus(): boolean {
  return state.focus === "imports" || isCorridor(state.focus);
}

function hourlyKind(): MixKind {
  if (state.hourlyMode === "total") return "single";
  if (importsFocus()) return "corridors";
  return "stack";
}

function mixKind(): MixKind {
  if (isCorridor(state.focus)) return "single";
  if (state.focus === "imports") return "corridors";
  if (state.focus) return "single";
  return "stack";
}

function singleKey(): FocusKey | "generation_mw" {
  return state.focus ?? "generation_mw";
}

function dimKey(key: string): boolean {
  if (!state.focus) return false;
  if (state.focus === "imports") return false;
  return state.focus !== key;
}

function yTitle(kind: MixKind, unit: Unit): string {
  if (unit === "share") return "% of generation";
  if (kind === "single" && state.focus) return `${labelOf(state.focus)} (MW)`;
  if (kind === "corridors") return "Imports (MW)";
  return "Generation (MW)";
}

function seriesColor(key: string, dim: boolean): string {
  const hex = COLORS[key] ?? COLORS.total;
  return dim ? withAlpha(hex, 0.18) : hex;
}

function pointRadiusFor(
  kind: "hourly" | "day" | "month",
  ctx: ScriptableContext<"line" | "bar">,
): number {
  if (!state.pin || state.pin.kind !== kind) return 0;
  if (kind === "hourly") {
    return data.hourly[ctx.dataIndex]?.datetime === state.pin.key ? 3.5 : 0;
  }
  if (kind === "month") {
    return windowedMonths()[ctx.dataIndex]?.month === state.pin.key ? 3.5 : 0;
  }
  return 0;
}

function barBorder(ctx: ScriptableContext<"bar">): number {
  if (!state.pin || state.pin.kind !== "day") return 0;
  return data.last7[ctx.dataIndex]?.date === state.pin.key ? 1.75 : 0;
}

function stackedDatasets(
  rows: SeriesRow[],
  series: SeriesDef[],
  unit: Unit,
  chartType: "line" | "bar",
  pinKind: "hourly" | "day" | "month",
): ChartDataset[] {
  return series.map((item) => {
    const dim = dimKey(item.key);
    const color = seriesColor(item.key, dim);
    const values = rows.map((row) =>
      unit === "share" ? shareOf(row, item.key) : valueOf(row, item.key),
    );
    const ds: ChartDataset & { fuelKey: string } = {
      fuelKey: item.key,
      label: item.label,
      data: values,
      backgroundColor:
        chartType === "line" ? withAlpha(color, dim ? 0.08 : 0.85) : color,
      borderColor: color,
      borderWidth: chartType === "bar" ? barBorder : 0,
      stack: "mix",
      fill: chartType === "line",
      pointRadius:
        chartType === "line"
          ? (ctx) => pointRadiusFor(pinKind, ctx)
          : undefined,
      pointHoverRadius: chartType === "line" ? 4 : undefined,
      tension: 0.15,
    };
    return ds;
  });
}

function singleDataset(
  rows: SeriesRow[],
  key: FocusKey | "generation_mw",
  unit: Unit,
  chartType: "line" | "bar",
  pinKind: "hourly" | "day" | "month",
): ChartDataset[] {
  const colorKey = key === "generation_mw" ? "total" : key;
  const color = COLORS[colorKey] ?? COLORS.total;
  const values = rows.map((row) =>
    unit === "share" ? shareOf(row, key) : valueOf(row, key),
  );
  const ds: ChartDataset & { fuelKey: string } = {
    fuelKey: key,
    label: labelOf(key),
    data: values,
    backgroundColor: chartType === "line" ? "transparent" : color,
    borderColor: color,
    borderWidth: chartType === "bar" ? barBorder : 1.75,
    fill: false,
    pointRadius:
      chartType === "line" ? (ctx) => pointRadiusFor(pinKind, ctx) : undefined,
    pointHoverRadius: chartType === "line" ? 4 : undefined,
    tension: 0.1,
  };
  return [ds];
}

function datasetsFor(
  rows: SeriesRow[],
  kind: MixKind,
  unit: Unit,
  chartType: "line" | "bar",
  pinKind: "hourly" | "day" | "month",
): ChartDataset[] {
  if (kind === "single") {
    return singleDataset(rows, singleKey(), unit, chartType, pinKind);
  }
  const series = kind === "corridors" ? CORRIDORS : STACK;
  return stackedDatasets(rows, series, unit, chartType, pinKind);
}

function tooltipLabel(unit: Unit) {
  return (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => {
    const y = ctx.parsed.y ?? 0;
    const name = ctx.dataset.label ?? "";
    if (unit === "share") return `${name}: ${fmtPct(y)}`;
    return `${name}: ${fmtMw(y)} MW`;
  };
}

function setCursor(event: { native?: Event | null }, elements: unknown[]) {
  if (!INSPECT_ENABLED) return;
  const native = event.native;
  const target = native?.target;
  if (target instanceof HTMLElement) {
    target.style.cursor = elements.length ? "pointer" : "default";
  }
}

function scaleOpts(
  kind: MixKind,
  unit: Unit,
  xTitle: string,
  stacked: boolean,
) {
  return {
    x: {
      stacked,
      title: { display: true, text: xTitle },
      ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
      grid: { color: stacked ? "transparent" : "#e6e0d6", display: !stacked },
    },
    y: {
      stacked,
      min: 0,
      ...(unit === "share" && kind !== "single" ? { max: 100 as const } : {}),
      title: { display: true, text: yTitle(kind, unit) },
      grid: { color: "#e6e0d6" },
    },
  };
}

function applyScales(chart: Chart, scales: ReturnType<typeof scaleOpts>) {
  chart.options.scales = scales;
  const y = chart.options.scales?.y;
  if (y && "max" in y && y.max === undefined) delete y.max;
}

function legendClick(
  _e: unknown,
  item: { datasetIndex: number },
  legend: { chart: Chart },
) {
  const ds = legend.chart.data.datasets[item.datasetIndex] as
    | { fuelKey?: string }
    | undefined;
  if (ds?.fuelKey && ds.fuelKey !== "generation_mw") {
    toggleFocus(ds.fuelKey);
  }
}

function applyHourly() {
  if (!chartHourly) return;
  const kind = hourlyKind();
  const stacked = kind !== "single";
  chartHourly.data.labels = data.hourly.map((row) =>
    fmtTick(row.datetime ?? ""),
  );
  chartHourly.data.datasets = datasetsFor(
    data.hourly,
    kind,
    "mw",
    "line",
    "hourly",
  );
  chartHourly.options.plugins = {
    legend: {
      display: stacked,
      position: "bottom",
      labels: { boxWidth: 10, font: { size: 11 } },
      onClick: legendClick,
    },
    tooltip: { callbacks: { label: tooltipLabel("mw") } },
  };
  applyScales(
    chartHourly,
    scaleOpts(kind, "mw", "Bangladesh time", stacked),
  );
}

function applyWeek() {
  if (!chartWeek) return;
  const kind = mixKind();
  const stacked = kind !== "single";
  const unit = state.unit;
  chartWeek.data.labels = data.last7.map((row) =>
    fmtDayShort(row.date ?? ""),
  );
  chartWeek.data.datasets = datasetsFor(
    data.last7,
    kind,
    unit,
    "bar",
    "day",
  );
  chartWeek.options.plugins = {
    legend: {
      display: stacked,
      position: "bottom",
      labels: { boxWidth: 10, font: { size: 11 } },
      onClick: legendClick,
    },
    tooltip: { callbacks: { label: tooltipLabel(unit) } },
  };
  const scales = scaleOpts(kind, unit, "Date", stacked);
  scales.x.grid = { color: "transparent", display: false };
  scales.x.ticks = { maxRotation: 0, autoSkip: false, maxTicksLimit: 7 };
  applyScales(chartWeek, scales);
}

function applyMonthly() {
  if (!chartMonthly) return;
  const kind = mixKind();
  const stacked = kind !== "single";
  const unit = state.unit;
  const rows = windowedMonths();
  const all = state.monthWindow === "all";
  chartMonthly.data.labels = rows.map((row) => row.month ?? "");
  chartMonthly.data.datasets = datasetsFor(
    rows,
    kind,
    unit,
    "line",
    "month",
  );
  chartMonthly.options.plugins = {
    legend: {
      display: stacked,
      position: "bottom",
      labels: { boxWidth: 10, font: { size: 11 } },
      onClick: legendClick,
    },
    tooltip: { callbacks: { label: tooltipLabel(unit) } },
  };
  const scales = scaleOpts(kind, unit, "Month", stacked);
  scales.x.ticks = {
    maxRotation: 0,
    autoSkip: all,
    maxTicksLimit: all ? 12 : 12,
    callback(this: { getLabelForValue: (v: string | number) => string }, value: string | number) {
      const label = String(this.getLabelForValue(value));
      if (all) return label.endsWith("-01") ? label.slice(0, 4) : "";
      const monthIdx = Number(label.slice(5, 7)) - 1;
      const name = MONTH_NAMES[monthIdx] ?? label;
      if (state.monthWindow === "12m" && monthIdx === 0) {
        return `${name} ${label.slice(0, 4)}`;
      }
      return name;
    },
  };
  scales.x.grid = { color: "#e6e0d6", display: true };
  applyScales(chartMonthly, scales);
}

function toggleFocus(raw: string) {
  if (raw === "all" || raw === state.focus) {
    state.focus = null;
  } else {
    state.focus = raw as FocusKey;
  }
  sync();
}

function pinFrom(
  kind: "hourly" | "day" | "month",
  index: number,
  rows: SeriesRow[],
  keyOf: (row: SeriesRow) => string,
) {
  if (!INSPECT_ENABLED) return;
  const row = rows[index];
  if (!row) return;
  const key = keyOf(row);
  if (state.pin?.kind === kind && state.pin.key === key) {
    state.pin = null;
  } else {
    state.pin = { kind, key };
  }
  sync();
}

function bindOnce() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fuel = target.closest<HTMLElement>("[data-fuel]");
    if (fuel?.dataset.fuel) {
      toggleFocus(fuel.dataset.fuel);
      return;
    }
    const hourly = target.closest<HTMLElement>("[data-hourly]");
    if (hourly?.dataset.hourly === "total" || hourly?.dataset.hourly === "mix") {
      state.hourlyMode = hourly.dataset.hourly;
      sync();
      return;
    }
    const unit = target.closest<HTMLElement>("[data-unit]");
    if (unit?.dataset.unit === "mw" || unit?.dataset.unit === "share") {
      state.unit = unit.dataset.unit;
      sync();
      return;
    }
    const win = target.closest<HTMLElement>("[data-window]");
    if (win?.dataset.window) {
      state.monthWindow = win.dataset.window;
      sync();
      return;
    }
    if (INSPECT_ENABLED && target.closest("[data-clear-pin]")) {
      state.pin = null;
      sync();
    }
  });
}

function buildWindowChips() {
  const host = document.getElementById("month-windows");
  if (!host) return;
  const years = [
    ...new Set(
      data.months
        .map((row) => (row.month ?? "").slice(0, 4))
        .filter(Boolean),
    ),
  ].reverse();
  host.innerHTML = [
    `<button type="button" class="chip" data-window="12m">Last 12 months</button>`,
    ...years.map(
      (year) =>
        `<button type="button" class="chip" data-window="${esc(year)}">${esc(year)}</button>`,
    ),
    `<button type="button" class="chip" data-window="all">All</button>`,
  ].join("");
}

function applyFuelButtonState() {
  const focusVal = state.focus ?? "all";
  setPressed("[data-fuel]", focusVal);
  document.querySelectorAll<HTMLElement>("[data-fuel]").forEach((el) => {
    const key = el.dataset.fuel ?? "";
    const dim =
      Boolean(state.focus) &&
      key !== "all" &&
      key !== state.focus &&
      !(state.focus && isCorridor(state.focus) && key === "imports");
    el.classList.toggle("is-dim", dim);
  });
}

function setPressed(selector: string, value: string) {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const attr = selector.includes("data-fuel")
      ? "fuel"
      : selector.includes("data-hourly")
        ? "hourly"
        : selector.includes("data-unit")
          ? "unit"
          : "window";
    const on = el.dataset[attr] === value;
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.classList.toggle("is-active", on);
  });
}

function syncDom() {
  setPressed("[data-hourly]", state.hourlyMode);
  setPressed("[data-unit]", state.unit);
  setPressed("[data-window]", state.monthWindow);

  const corridors = document.getElementById("corridor-legend");
  if (corridors) corridors.hidden = !importsFocus();

  const hourlyCaption = document.getElementById("caption-hourly");
  if (hourlyCaption) {
    if (state.hourlyMode === "mix" && importsFocus()) {
      hourlyCaption.textContent =
        "Import corridors each hour (MW): HVDC Bheramara, Tripura, Adani, and Nepal.";
    } else if (state.hourlyMode === "mix") {
      hourlyCaption.textContent =
        "Fuel mix each hour (MW), including the 19:30 evening-peak row when PGCB publishes it.";
    } else if (state.focus) {
      hourlyCaption.textContent = `${labelOf(state.focus)} (MW) over the last 48 hours, including the 19:30 evening-peak row when PGCB publishes it.`;
    } else {
      hourlyCaption.textContent =
        "Total generation (MW), including the 19:30 evening-peak row when PGCB publishes it.";
    }
  }

  const cap7 = document.getElementById("caption-7d");
  if (cap7) {
    const unit = state.unit === "share" ? "share of generation" : "MW";
    if (importsFocus()) {
      cap7.textContent = `Daily mean import corridors (${unit}).`;
    } else if (state.focus) {
      cap7.textContent = `Daily mean ${labelOf(state.focus).toLowerCase()} (${unit}).`;
    } else {
      cap7.textContent = `Daily mean mix (${unit}). Imports are HVDC Bheramara, Tripura, Adani, and Nepal combined.`;
    }
  }

  const capMo = document.getElementById("caption-monthly");
  if (capMo) {
    const unit = state.unit === "share" ? "share of generation" : "mean MW";
    capMo.textContent = `${windowTitle()} (${windowRangeLabel()}): ${unit}. Seeded from the public PGCB hourly archive; the last month updates as new hours arrive.`;
  }

  syncReadout();
  syncInspect();
  applyFuelButtonState();
}

function syncReadout() {
  const el = document.getElementById("focus-readout");
  if (!el) return;
  if (!state.focus) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const key = state.focus;
  const latest = data.current;
  const week = data.last7;
  const months = windowedMonths();
  const latestMw = valueOf(latest, key);
  const weekMw = mean(week, key);
  const monthMw = mean(months, key);
  const latestShare = shareOf(latest, key);
  const weekShare = week.length
    ? (mean(week, key) / (mean(week, "generation_mw") || 1)) * 100
    : 0;
  const monthShare = months.length
    ? (mean(months, key) / (mean(months, "generation_mw") || 1)) * 100
    : 0;
  el.hidden = false;
  el.innerHTML = `
    <p class="focus-kicker">${esc(labelOf(key))}</p>
    <dl class="focus-stats">
      <div>
        <dt>Latest</dt>
        <dd>${fmtMw(latestMw)} MW · ${fmtPct(latestShare)}</dd>
      </div>
      <div>
        <dt>Last 7 days</dt>
        <dd>${fmtMw(weekMw)} MW · ${fmtPct(weekShare)}</dd>
      </div>
      <div>
        <dt>${esc(windowTitle())}</dt>
        <dd>${fmtMw(monthMw)} MW · ${fmtPct(monthShare)}</dd>
      </div>
    </dl>
  `;
}

function pinRows(): {
  row: SeriesRow;
  prev: SeriesRow | null;
  when: string;
  prevLabel: string;
  slot: string;
} | null {
  if (!state.pin) return null;
  if (state.pin.kind === "hourly") {
    const i = data.hourly.findIndex((row) => row.datetime === state.pin?.key);
    if (i < 0) return null;
    return {
      row: data.hourly[i],
      prev: i > 0 ? data.hourly[i - 1] : null,
      when: `${fmtWhen(data.hourly[i].datetime ?? "")} Bangladesh time`,
      prevLabel: "previous hour",
      slot: "inspect-hourly",
    };
  }
  if (state.pin.kind === "day") {
    const i = data.last7.findIndex((row) => row.date === state.pin?.key);
    if (i < 0) return null;
    const prev = i > 0 ? data.last7[i - 1] : data.prevDay;
    return {
      row: data.last7[i],
      prev,
      when: `${fmtDay(data.last7[i].date ?? "")} daily mean`,
      prevLabel: "previous day",
      slot: "inspect-7d",
    };
  }
  const i = data.months.findIndex((row) => row.month === state.pin?.key);
  if (i < 0) return null;
  return {
    row: data.months[i],
    prev: i > 0 ? data.months[i - 1] : null,
    when: `${fmtMonth(data.months[i].month ?? "")} monthly mean`,
    prevLabel: "previous month",
    slot: "inspect-monthly",
  };
}

function mixItems(row: SeriesRow): { key: string; label: string; mw: number }[] {
  return STACK.map((item) => ({
    key: item.key,
    label: item.label,
    mw: valueOf(row, item.key as FocusKey),
  }));
}

function syncInspect() {
  const slots = ["inspect-hourly", "inspect-7d", "inspect-monthly"];
  if (!INSPECT_ENABLED) {
    for (const id of slots) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.hidden = true;
      el.innerHTML = "";
    }
    return;
  }
  const ctx = pinRows();
  for (const id of slots) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!ctx || ctx.slot !== id) {
      el.hidden = true;
      el.innerHTML = "";
      continue;
    }
    const { row, prev, when, prevLabel } = ctx;
    const remark = row.remark?.trim();
    const total = row.generation_mw || 1;
    const items = mixItems(row);
    const focusKey = state.focus;
    const focusMw = focusKey ? valueOf(row, focusKey) : null;
    let deltaHtml = "";
    if (prev) {
      const currV = focusKey ? valueOf(row, focusKey) : row.generation_mw;
      const prevV = focusKey ? valueOf(prev, focusKey) : prev.generation_mw;
      const dMw = currV - prevV;
      const dPct = prevV ? (dMw / prevV) * 100 : 0;
      const sign = dMw > 0 ? "+" : "";
      const who = focusKey ? labelOf(focusKey).toLowerCase() : "total";
      deltaHtml = `<p class="inspect-delta">${sign}${fmtMw(dMw)} MW ${who} vs ${esc(prevLabel)} (${sign}${dPct.toFixed(1)}%)</p>`;
    }
    const corridors =
      importsOf(row) > 0
        ? `<p class="inspect-subkicker">Import corridors</p>
           <ul class="legend inspect-corridors">${CORRIDORS.map((item) => {
             const mw = valueOf(row, item.key as FocusKey);
             return `<li>
               <button type="button" data-fuel="${item.key}">
                 <span class="fuel-swatch seg-${item.key}" aria-hidden="true"></span>
                 <span class="fuel-copy">${esc(item.label)} <span class="muted">${fmtMw(mw)} MW · ${fmtPct((mw / total) * 100)}</span></span>
               </button>
             </li>`;
           }).join("")}</ul>`
        : "";
    el.hidden = false;
    el.innerHTML = `
      <div class="inspect-head">
        <p class="kicker">Inspect</p>
        <button type="button" class="inspect-clear" data-clear-pin aria-label="Clear inspect">Clear</button>
      </div>
      <p class="inspect-when">${esc(when)}${remark ? ` · ${esc(remark)}` : ""}</p>
      <p class="mw inspect-mw-row">
        <span class="mw-num inspect-mw">${fmtMw(row.generation_mw)}</span>
        <span class="mw-unit">MW</span>
      </p>
      ${
        focusMw != null && focusKey
          ? `<p class="inspect-focus">${esc(labelOf(focusKey))} ${fmtMw(focusMw)} MW · ${fmtPct(shareOf(row, focusKey))}</p>`
          : ""
      }
      ${deltaHtml}
      <div class="mixbar" role="img" aria-label="Fuel mix">
        ${items
          .map((item) => {
            const w = (item.mw / total) * 100;
            return `<button type="button" class="seg seg-${item.key}" data-fuel="${item.key}" style="width:${w}%" title="${esc(item.label)}: ${fmtMw(item.mw)} MW" aria-label="${esc(item.label)}: ${fmtMw(item.mw)} MW"></button>`;
          })
          .join("")}
      </div>
      <ul class="legend">
        ${items
          .map(
            (item) => `<li>
              <button type="button" data-fuel="${item.key}">
                <span class="fuel-swatch seg-${item.key}" aria-hidden="true"></span>
                <span class="fuel-copy">${esc(item.label)} <span class="muted">${fmtMw(item.mw)} MW · ${fmtPct((item.mw / total) * 100)}</span></span>
              </button>
            </li>`,
          )
          .join("")}
      </ul>
      ${corridors}
    `;
  }
}

function syncCharts() {
  applyHourly();
  applyWeek();
  applyMonthly();
  chartHourly?.update();
  chartWeek?.update();
  chartMonthly?.update();
}

function sync() {
  syncDom();
  syncCharts();
}

function commonOptions(onClick: Chart["options"]["onClick"]) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    onHover: setCursor,
    onClick: INSPECT_ENABLED ? onClick : undefined,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { boxWidth: 10, font: { size: 11 } },
      },
    },
  };
}

export function renderCharts(payload: GridData) {
  data = payload;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    Chart.defaults.animation = false;
  }
  bindOnce();
  buildWindowChips();

  const hourly = document.getElementById("chart-48h") as HTMLCanvasElement | null;
  const week = document.getElementById("chart-7d") as HTMLCanvasElement | null;
  const monthly = document.getElementById("chart-monthly") as HTMLCanvasElement | null;
  if (!hourly || !week || !monthly) return;

  chartHourly = new Chart(hourly, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: commonOptions((_event, elements) => {
      if (!elements.length) return;
      pinFrom("hourly", elements[0].index, data.hourly, (row) => row.datetime ?? "");
    }),
  });
  chartWeek = new Chart(week, {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: commonOptions((_event, elements) => {
      if (!elements.length) return;
      pinFrom("day", elements[0].index, data.last7, (row) => row.date ?? "");
    }),
  });
  chartMonthly = new Chart(monthly, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: commonOptions((_event, elements) => {
      if (!elements.length) return;
      pinFrom(
        "month",
        elements[0].index,
        windowedMonths(),
        (row) => row.month ?? "",
      );
    }),
  });

  sync();
}

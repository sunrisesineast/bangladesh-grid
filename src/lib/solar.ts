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

export type SredaTech = {
  key: string;
  label: string;
  quantity: number;
  off_grid_mwp: number;
  on_grid_mwp: number;
  total_mwp: number;
};

export type SredaHistoryPoint = {
  date: string;
  solar_mw: number;
  on_grid_mw: number;
  off_grid_mw: number;
};

export type SredaSolar = {
  source: string;
  source_name: string;
  updated_at: string;
  database_updated_at: string | null;
  current: {
    solar_mwp: number;
    on_grid_mwp: number;
    off_grid_mwp: number;
    parks_mwp: number;
    technologies: SredaTech[];
  };
  history: SredaHistoryPoint[];
};

const SOLAR = "#c9a227";
const PARKS = "#8a6e12";
const OFF = "#c4b496";
const GRID = "#e6e0d6";
const OTHER_MIN = 8;
const YEAR_LABELS = new Set(["2016", "2020", "2024", "2026"]);

function yearTickIndexes(dates: string[]): Set<number> {
  const show = new Set<number>();
  dates.forEach((date, index) => {
    const year = date.slice(0, 4);
    const prev = index > 0 ? dates[index - 1].slice(0, 4) : "";
    if (year !== prev && YEAR_LABELS.has(year)) show.add(index);
  });
  return show;
}

let payload: SredaSolar | null = null;
let historyChart: Chart | null = null;
let mixChart: Chart | null = null;
let built = false;

function fmtMw(n: number): string {
  return Math.round(n).toLocaleString("en-US");
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

type MixBar = { key: string; label: string; mwp: number };

function mixBars(techs: SredaTech[]): MixBar[] {
  const bars: MixBar[] = [];
  let other = 0;
  for (const tech of [...techs].sort((a, b) => b.total_mwp - a.total_mwp)) {
    if (tech.total_mwp >= OTHER_MIN) {
      bars.push({ key: tech.key, label: tech.label, mwp: tech.total_mwp });
    } else {
      other += tech.total_mwp;
    }
  }
  if (other >= 0.5) bars.push({ key: "other", label: "Other solar", mwp: other });
  return bars;
}

function buildCharts() {
  if (!payload || built) return;
  const historyEl = document.getElementById("chart-solar-history") as HTMLCanvasElement | null;
  const mixEl = document.getElementById("chart-solar-mix") as HTMLCanvasElement | null;
  if (!historyEl || !mixEl) return;

  const history = payload.history;
  const dates = history.map((point) => point.date);
  const yearTicks = yearTickIndexes(dates);
  historyChart = new Chart(historyEl, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: "Off-grid",
          data: history.map((point) => point.off_grid_mw),
          borderColor: SOLAR,
          backgroundColor: OFF,
          borderWidth: 1.25,
          fill: true,
          stack: "cap",
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 3,
        },
        {
          label: "On-grid",
          data: history.map((point) => point.on_grid_mw),
          borderColor: PARKS,
          backgroundColor: SOLAR,
          borderWidth: 1.25,
          fill: "-1",
          stack: "cap",
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => fmtDay(dates[items[0]?.dataIndex ?? 0] ?? ""),
            label: (item) => `${item.dataset.label}: ${fmtMw(item.parsed.y ?? 0)} MW`,
            footer: (items) => {
              const point = history[items[0]?.dataIndex ?? 0];
              return point ? `Total ${fmtMw(point.solar_mw)} MW` : "";
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            maxRotation: 0,
            autoSkip: false,
            callback(value) {
              return yearTicks.has(Number(value)) ? dates[Number(value)].slice(0, 4) : "";
            },
          },
          grid: { color: GRID },
        },
        y: {
          stacked: true,
          min: 0,
          title: { display: true, text: "Installed capacity (MW)" },
          grid: { color: GRID },
        },
      },
    },
  });

  const bars = mixBars(payload.current.technologies);
  mixChart = new Chart(mixEl, {
    type: "bar",
    data: {
      labels: bars.map((bar) => bar.label),
      datasets: [
        {
          label: "Installed",
          data: bars.map((bar) => bar.mwp),
          backgroundColor: bars.map((bar) => (bar.key === "solar_park" ? PARKS : SOLAR)),
          borderWidth: 0,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${fmtMw(item.parsed.x ?? 0)} MW`,
          },
        },
      },
      scales: {
        x: {
          min: 0,
          title: { display: true, text: "Installed capacity (MW)" },
          grid: { color: GRID },
          ticks: { maxRotation: 0 },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
  built = true;
}

export function mountSolar(sreda: SredaSolar | null) {
  payload = sreda && sreda.history?.length ? sreda : null;
}

export function setSolarVisible(visible: boolean) {
  const section = document.getElementById("solar-capacity");
  if (!section) return;
  const show = visible && payload != null;
  const wasHidden = section.hidden;
  section.hidden = !show;
  if (!show || !wasHidden) return;
  requestAnimationFrame(() => {
    buildCharts();
    historyChart?.resize();
    mixChart?.resize();
    historyChart?.update();
    mixChart?.update();
  });
}

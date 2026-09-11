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

export type MixRow = {
  label: string;
  gas: number;
  liquid_fuel: number;
  coal: number;
  hydro: number;
  solar: number;
  wind: number;
  imports: number;
};

export type GridData = {
  hourly: { labels: string[]; values: number[] };
  last7: MixRow[];
  months: MixRow[];
};

const COLORS = {
  gas: "#3d6b99",
  liquid_fuel: "#c4842a",
  coal: "#3a3a3a",
  hydro: "#2a8a82",
  solar: "#c9a227",
  wind: "#5a9eaf",
  imports: "#6b5b95",
  total: "#1f5c45",
};

const STACK = [
  { key: "gas", label: "Gas" },
  { key: "liquid_fuel", label: "Liquid fuel" },
  { key: "coal", label: "Coal" },
  { key: "hydro", label: "Hydro" },
  { key: "solar", label: "Solar" },
  { key: "wind", label: "Wind" },
  { key: "imports", label: "Imports" },
] as const;

const baseOptions = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      position: "bottom" as const,
      labels: { boxWidth: 10, font: { size: 11 } },
    },
  },
};

function stackedDatasets(rows: MixRow[]) {
  return STACK.map((fuel) => ({
    label: fuel.label,
    data: rows.map((row) => Number(row[fuel.key] || 0)),
    backgroundColor: COLORS[fuel.key],
    borderColor: COLORS[fuel.key],
    borderWidth: 0,
    stack: "mix",
    fill: true,
    pointRadius: 0,
    tension: 0.15,
  }));
}

export function renderCharts(data: GridData) {
  const hourly = document.getElementById("chart-48h") as HTMLCanvasElement | null;
  const week = document.getElementById("chart-7d") as HTMLCanvasElement | null;
  const monthly = document.getElementById("chart-monthly") as HTMLCanvasElement | null;
  if (!hourly || !week || !monthly) return;

  new Chart(hourly, {
    type: "line",
    data: {
      labels: data.hourly.labels,
      datasets: [
        {
          label: "Generation (MW)",
          data: data.hourly.values,
          borderColor: COLORS.total,
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.75,
          tension: 0.1,
        },
      ],
    },
    options: {
      ...baseOptions,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          title: { display: true, text: "Bangladesh time" },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: "#e6e0d6" },
        },
        y: {
          title: { display: true, text: "Generation (MW)" },
          grid: { color: "#e6e0d6" },
        },
      },
    },
  });

  new Chart(week, {
    type: "bar",
    data: {
      labels: data.last7.map((row) => row.label),
      datasets: stackedDatasets(data.last7),
    },
    options: {
      ...baseOptions,
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: "Date" },
          grid: { display: false },
        },
        y: {
          stacked: true,
          title: { display: true, text: "Mean generation (MW)" },
          grid: { color: "#e6e0d6" },
        },
      },
    },
  });

  new Chart(monthly, {
    type: "line",
    data: {
      labels: data.months.map((row) => row.label),
      datasets: stackedDatasets(data.months),
    },
    options: {
      ...baseOptions,
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: "Month" },
          ticks: {
            maxRotation: 0,
            autoSkip: false,
            callback(value) {
              const label = String(this.getLabelForValue(value as string | number));
              return label.endsWith("-01") ? label.slice(0, 4) : "";
            },
          },
          grid: { color: "#e6e0d6" },
        },
        y: {
          stacked: true,
          title: { display: true, text: "Mean generation (MW)" },
          grid: { color: "#e6e0d6" },
        },
      },
    },
  });
}

import Chart from "chart.js/auto";
import "chartjs-adapter-date-fns";

export type FuelRow = {
  datetime?: string;
  date?: string;
  month?: string;
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
};

export type GridData = {
  hourly: FuelRow[];
  last7: FuelRow[];
  months: FuelRow[];
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

function importsOf(row: FuelRow) {
  return (
    Number(row.bheramara || 0) +
    Number(row.tripura || 0) +
    Number(row.adani || 0) +
    Number(row.nepal || 0)
  );
}

function fuelValue(row: FuelRow, key: string) {
  if (key === "imports") return importsOf(row);
  return Number(row[key as keyof FuelRow] || 0);
}

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

function stackedDatasets(rows: FuelRow[]) {
  return STACK.map((fuel) => ({
    label: fuel.label,
    data: rows.map((row) => fuelValue(row, fuel.key)),
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
      datasets: [
        {
          label: "Generation (MW)",
          data: data.hourly.map((row) => ({
            x: row.datetime,
            y: row.generation_mw,
          })),
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
          type: "time",
          time: { tooltipFormat: "d MMM yyyy HH:mm" },
          title: { display: true, text: "Bangladesh time" },
          ticks: { maxRotation: 0 },
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
      labels: data.last7.map((row) => row.date),
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
      labels: data.months.map((row) => row.month),
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

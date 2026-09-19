import {
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
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

export type DemandDay = {
  date: string;
  evening_load_shed_mw: number | null;
  unserved_gwh: number | null;
};

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

function addDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function withGaps(days: DemandDay[]): DemandDay[] {
  if (days.length === 0) return [];
  const byDate = new Map(days.map((row) => [row.date, row]));
  const start = days[0].date;
  const end = days[days.length - 1].date;
  const out: DemandDay[] = [];
  for (let iso = start; iso <= end; iso = addDay(iso, 1)) {
    out.push(
      byDate.get(iso) ?? {
        date: iso,
        evening_load_shed_mw: null,
        unserved_gwh: null,
      },
    );
  }
  return out;
}

function fmtTick(iso: string) {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return `${day} ${MONTH_NAMES[month - 1] ?? iso}`;
}

function fmtMw(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function fmtGwh(n: number) {
  const digits = Math.abs(n) >= 10 ? 1 : 2;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function lineOptions(yTitle: string, formatY: (n: number) => string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    spanGaps: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) => {
            const y = ctx.parsed.y;
            if (y == null) return "No report";
            return formatY(y);
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        grid: { color: "transparent", display: false },
        title: { display: true, text: "Report date" },
      },
      y: {
        min: 0,
        title: { display: true, text: yTitle },
        grid: { color: "#e6e0d6" },
      },
    },
  };
}

export function renderDemandCharts(days: DemandDay[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    Chart.defaults.animation = false;
  }
  const rows = withGaps(days);
  if (rows.filter((row) => row.evening_load_shed_mw != null).length < 2) {
    return;
  }
  const labels = rows.map((row) => fmtTick(row.date));
  const shed = document.getElementById("chart-shed") as HTMLCanvasElement | null;
  const unserved = document.getElementById(
    "chart-unserved",
  ) as HTMLCanvasElement | null;
  if (!shed || !unserved) return;

  new Chart(shed, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Evening load-shed",
          data: rows.map((row) => row.evening_load_shed_mw),
          borderColor: "#9a4a32",
          backgroundColor: "rgba(154, 74, 50, 0.12)",
          fill: true,
          tension: 0.15,
          pointRadius: 2,
          spanGaps: false,
        },
      ],
    },
    options: lineOptions("MW", (n) => `${fmtMw(n)} MW`),
  });
  new Chart(unserved, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Energy unserved",
          data: rows.map((row) => row.unserved_gwh),
          borderColor: "#1f5c45",
          backgroundColor: "rgba(31, 92, 69, 0.12)",
          fill: true,
          tension: 0.15,
          pointRadius: 2,
          spanGaps: false,
        },
      ],
    },
    options: lineOptions("GWh", (n) => `${fmtGwh(n)} GWh`),
  });
}

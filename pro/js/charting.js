import { formatDate, formatNumber } from './apiClient.js';

const DEFAULT_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' },
  scales: {
    x: {
      ticks: {
        color: 'rgba(255,255,255,0.6)',
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 8,
      },
      grid: { color: 'rgba(255,255,255,0.08)' },
    },
    y: {
      ticks: {
        color: 'rgba(255,255,255,0.6)',
        callback(value) {
          return formatNumber(value, { maximumFractionDigits: 2 });
        },
      },
      grid: { color: 'rgba(255,255,255,0.08)' },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label(context) {
          if (!context?.parsed?.y) return '';
          return `Price: ${formatNumber(context.parsed.y, { maximumFractionDigits: 2 })}`;
        },
        title(points) {
          if (!points?.length) return '';
          const point = points[0];
          return formatDate(point.raw?.date || point.label);
        },
      },
    },
  },
};

export function buildLineChart(canvas, series, options = {}) {
  if (!canvas) return null;
  const labels = series.map((point) => point?.date || '');
  const prices = series.map((point) => Number(point?.close ?? point?.price ?? point?.last ?? 0));
  const dataset = {
    label: 'Price',
    data: series.map((point, index) => ({ x: labels[index], y: prices[index], date: point?.date })),
    borderColor: 'rgba(63, 140, 255, 1)',
    borderWidth: 2,
    tension: 0.25,
    fill: {
      target: 'origin',
      above: 'rgba(63, 140, 255, 0.18)',
    },
    pointRadius: 0,
  };
  const config = {
    type: 'line',
    data: { labels, datasets: [dataset, ...(options.extraDatasets || [])] },
    options: {
      ...DEFAULT_CHART_OPTIONS,
      ...options.chart,
      scales: {
        ...DEFAULT_CHART_OPTIONS.scales,
        ...(options.chart?.scales || {}),
      },
    },
  };

  if (canvas.__chartist) {
    canvas.__chartist.destroy();
  }
  const chart = new window.Chart(canvas, config);
  canvas.__chartist = chart;
  return chart;
}

export function overlaySeriesOnChart(chart, seriesList) {
  if (!chart) return;
  const baseDataset = chart.data.datasets[0];
  const overlays = seriesList.map(({ label, series, color }) => ({
    label,
    data: series.map((point, index) => ({ x: point?.date || index, y: Number(point?.close ?? point?.price ?? 0) })),
    borderColor: color || 'rgba(239, 83, 80, 0.8)',
    borderWidth: 1.5,
    tension: 0.2,
    pointRadius: 0,
  }));
  chart.data.datasets = [baseDataset, ...overlays];
  chart.update();
}


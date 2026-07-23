import type { ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';
import { BarChart3 } from 'lucide-react';

interface DashboardChartProps {
  title: string;
  subtitle: string;
  seriesName: string;
  categories: string[];
  values: number[];
  type: 'line' | 'bar';
  unit: 'percent' | 'count';
  darkMode: boolean;
  color: string;
  pointColors?: string[];
}

function formatDateCategory(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short'
  }).format(new Date(`${value}T12:00:00`));
}

export function DashboardChart({
  title,
  subtitle,
  seriesName,
  categories,
  values,
  type,
  unit,
  darkMode,
  color,
  pointColors
}: DashboardChartProps) {
  const isPercentage = unit === 'percent';
  const isBar = type === 'bar';
  const markerColors = pointColors || [];

  const options: ApexOptions = {
    chart: {
      type,
      background: 'transparent',
      fontFamily: 'inherit',
      foreColor: darkMode ? '#94a3b8' : '#64748b',
      toolbar: {
        show: false
      },
      animations: {
        enabled: true,
        speed: 300
      }
    },
    colors: isBar && markerColors.length > 0 ? markerColors : [color],
    theme: {
      mode: darkMode ? 'dark' : 'light'
    },
    grid: {
      borderColor: darkMode ? '#1e293b' : '#e2e8f0',
      strokeDashArray: 4,
      padding: {
        left: 8,
        right: 12
      }
    },
    stroke: {
      curve: 'smooth',
      width: isBar ? 0 : 3
    },
    markers: {
      size: isBar ? 0 : 4,
      strokeWidth: 2,
      strokeColors: darkMode ? '#0f172a' : '#ffffff',
      hover: {
        sizeOffset: 2
      },
      discrete:
        !isBar && markerColors.length > 0
          ? markerColors.map((markerColor, index) => ({
              seriesIndex: 0,
              dataPointIndex: index,
              fillColor: markerColor,
              strokeColor: darkMode ? '#0f172a' : '#ffffff',
              size: 5
            }))
          : []
    },
    dataLabels: {
      enabled: isBar,
      formatter: (value) =>
        isPercentage ? `${Number(value).toFixed(1)}%` : String(value),
      style: {
        colors: [darkMode ? '#e2e8f0' : '#334155'],
        fontSize: '11px',
        fontWeight: 600
      },
      offsetX: 6
    },
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
        borderRadius: 6,
        barHeight: '52%',
        dataLabels: {
          position: 'top'
        }
      }
    },
    xaxis: {
      categories,
      min: isBar && isPercentage ? 0 : undefined,
      max: isBar && isPercentage ? 100 : undefined,
      labels: {
        formatter: (value) =>
          isBar
            ? isPercentage
              ? `${Number(value).toFixed(0)}%`
              : String(value)
            : formatDateCategory(String(value)),
        rotate: -35,
        hideOverlappingLabels: true,
        trim: true,
        style: {
          fontSize: '11px'
        }
      },
      axisBorder: {
        color: darkMode ? '#334155' : '#cbd5e1'
      },
      axisTicks: {
        color: darkMode ? '#334155' : '#cbd5e1'
      }
    },
    yaxis: {
      min: !isBar && isPercentage ? 0 : undefined,
      max: !isBar && isPercentage ? 100 : undefined,
      labels: {
        formatter: (value) =>
          isBar
            ? String(value)
            : isPercentage
              ? `${value.toFixed(0)}%`
              : value.toFixed(0)
      }
    },
    tooltip: {
      theme: darkMode ? 'dark' : 'light',
      y: {
        formatter: (value) =>
          isPercentage ? `${value.toFixed(2)}%` : value.toLocaleString('en-IN')
      }
    },
    legend: {
      show: false
    },
    noData: {
      text: 'No chart data'
    }
  };

  const series = [
    {
      name: seriesName,
      data: values
    }
  ];

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
          <BarChart3 aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-semibold text-slate-950 dark:text-white">
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
          No chart data for the current filters.
        </div>
      ) : (
        <div
          className="mt-4"
          role="img"
          aria-label={`${title}. ${subtitle}`}
        >
          <ReactApexChart
            key={`${darkMode ? 'dark' : 'light'}-${type}`}
            options={options}
            series={series}
            type={type}
            height={310}
          />
        </div>
      )}
    </article>
  );
}

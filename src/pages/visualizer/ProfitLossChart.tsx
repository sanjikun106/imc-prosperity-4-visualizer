import Highcharts from 'highcharts';
import { ReactNode } from 'react';
import { useStore } from '../../store.ts';
import { Chart } from './Chart.tsx';

export interface ProfitLossChartProps {
  symbols: string[];
}

export function ProfitLossChart({ symbols }: ProfitLossChartProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;
  const selectedSymbolSet = new Set(symbols);

  const dataByTimestamp = new Map<number, number>();
  for (const row of algorithm.activityLogs) {
    if (!selectedSymbolSet.has(row.product)) {
      continue;
    }

    if (!dataByTimestamp.has(row.timestamp)) {
      dataByTimestamp.set(row.timestamp, row.profitLoss);
    } else {
      dataByTimestamp.set(row.timestamp, dataByTimestamp.get(row.timestamp)! + row.profitLoss);
    }
  }

  const title = symbols.length === 1 ? `${symbols[0]} - Profit / Loss` : 'Profit / Loss';
  const series: Highcharts.SeriesOptionsType[] = [];

  if (symbols.length > 1) {
    series.push({
      type: 'line',
      name: 'Total',
      data: [...dataByTimestamp.keys()].map(timestamp => [timestamp, dataByTimestamp.get(timestamp)]),
    });
  }

  symbols.forEach(symbol => {
    const data = [];

    for (const row of algorithm.activityLogs) {
      if (row.product === symbol) {
        data.push([row.timestamp, row.profitLoss]);
      }
    }

    series.push({
      type: 'line',
      name: symbol,
      data,
      dashStyle: symbols.length > 1 ? 'Dash' : 'Solid',
    });
  });

  return <Chart title={title} series={series} />;
}

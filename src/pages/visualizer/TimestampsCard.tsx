import { Grid, NumberInput, Slider, SliderProps, Text } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { ReactNode, useState } from 'react';
import { AlgorithmDataRow } from '../../models.ts';
import { useStore } from '../../store.ts';
import { formatNumber } from '../../utils/format.ts';
import { TimestampDetail } from './TimestampDetail.tsx';
import { VisualizerCard } from './VisualizerCard.tsx';

export interface TimestampsCardProps {
  symbols: string[];
}

export function TimestampsCard({ symbols }: TimestampsCardProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;

  const rowsByTimestamp: Record<number, AlgorithmDataRow> = {};
  for (const row of algorithm.data) {
    rowsByTimestamp[row.state.timestamp] = row;
  }

  const timestampMin = algorithm.data[0].state.timestamp;
  const timestampMax = algorithm.data[algorithm.data.length - 1].state.timestamp;
  const timestampStep = algorithm.data[1].state.timestamp - algorithm.data[0].state.timestamp;

  const [timestamp, setTimestamp] = useState(timestampMin);

  function normalizeTimestamp(value: number): number {
    const clampedValue = Math.min(timestampMax, Math.max(timestampMin, value));
    const stepsFromStart = Math.round((clampedValue - timestampMin) / timestampStep);

    return timestampMin + stepsFromStart * timestampStep;
  }

  const marks: SliderProps['marks'] = [];
  for (let i = timestampMin; i < timestampMax; i += (timestampMax + 100) / 4) {
    marks.push({
      value: i,
      label: formatNumber(i),
    });
  }

  useHotkeys([
    ['ArrowLeft', () => setTimestamp(timestamp === timestampMin ? timestamp : timestamp - timestampStep)],
    ['ArrowRight', () => setTimestamp(timestamp === timestampMax ? timestamp : timestamp + timestampStep)],
  ]);

  return (
    <VisualizerCard title="Timestamps">
      <Grid mb="lg">
        <Grid.Col span={{ xs: 12, sm: 8 }}>
          <Slider
            min={timestampMin}
            max={timestampMax}
            step={timestampStep}
            marks={marks}
            label={value => `Timestamp ${formatNumber(value)}`}
            value={timestamp}
            onChange={setTimestamp}
          />
        </Grid.Col>
        <Grid.Col span={{ xs: 12, sm: 4 }}>
          <NumberInput
            label="Timestamp"
            value={timestamp}
            min={timestampMin}
            max={timestampMax}
            step={timestampStep}
            allowDecimal={false}
            thousandSeparator=","
            clampBehavior="strict"
            onChange={value => {
              if (typeof value === 'number' && Number.isFinite(value)) {
                setTimestamp(normalizeTimestamp(value));
              }
            }}
          />
        </Grid.Col>
      </Grid>

      {rowsByTimestamp[timestamp] ? (
        <TimestampDetail row={rowsByTimestamp[timestamp]} symbols={symbols} />
      ) : (
        <Text>No logs found for timestamp {formatNumber(timestamp)}</Text>
      )}
    </VisualizerCard>
  );
}

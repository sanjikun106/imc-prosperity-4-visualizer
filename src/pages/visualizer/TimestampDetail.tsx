import { Grid, Text, Title } from '@mantine/core';
import { ReactNode } from 'react';
import { ScrollableCodeHighlight } from '../../components/ScrollableCodeHighlight.tsx';
import { AlgorithmDataRow } from '../../models.ts';
import { useStore } from '../../store.ts';
import { formatNumber } from '../../utils/format.ts';
import { ListingsTable } from './ListingsTable.tsx';
import { OrderDepthTable } from './OrderDepthTable.tsx';
import { OrdersTable } from './OrdersTable.tsx';
import { PositionTable } from './PositionTable.tsx';
import { ProfitLossTable } from './ProfitLossTable.tsx';
import { TradesTable } from './TradesTable.tsx';

function formatTraderData(value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export interface TimestampDetailProps {
  row: AlgorithmDataRow;
  symbols: string[];
}

export function TimestampDetail({
  row: { state, orders, traderData, algorithmLogs },
  symbols,
}: TimestampDetailProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;
  const selectedSymbolSet = new Set(symbols);

  const filteredListings = Object.fromEntries(
    Object.entries(state.listings).filter(([symbol]) => selectedSymbolSet.has(symbol)),
  );
  const filteredOrderDepths = Object.fromEntries(
    Object.entries(state.orderDepths).filter(([symbol]) => selectedSymbolSet.has(symbol)),
  );
  const filteredOwnTrades = Object.fromEntries(
    Object.entries(state.ownTrades).filter(([symbol]) => selectedSymbolSet.has(symbol)),
  );
  const filteredMarketTrades = Object.fromEntries(
    Object.entries(state.marketTrades).filter(([symbol]) => selectedSymbolSet.has(symbol)),
  );
  const filteredOrders = Object.fromEntries(Object.entries(orders).filter(([symbol]) => selectedSymbolSet.has(symbol)));
  const filteredPosition = Object.fromEntries(
    Object.entries(state.position).filter(([symbol]) => selectedSymbolSet.has(symbol)),
  );

  const profitLoss = algorithm.activityLogs
    .filter(row => row.timestamp === state.timestamp && selectedSymbolSet.has(row.product))
    .reduce((acc, val) => acc + val.profitLoss, 0);

  return (
    <Grid columns={12}>
      <Grid.Col span={12}>
        {/* prettier-ignore */}
        <Title order={5}>
          Timestamp {formatNumber(state.timestamp)} • Profit / Loss: {formatNumber(profitLoss)}
        </Title>
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Listings</Title>
        <ListingsTable listings={filteredListings} />
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Positions</Title>
        <PositionTable position={filteredPosition} />
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Profit / Loss</Title>
        <ProfitLossTable timestamp={state.timestamp} symbols={symbols} />
      </Grid.Col>
      {Object.entries(filteredOrderDepths).map(([symbol, orderDepth], i) => (
        <Grid.Col key={i} span={{ xs: 12, sm: 4 }}>
          <Title order={5}>{symbol} order depth</Title>
          <OrderDepthTable orderDepth={orderDepth} />
        </Grid.Col>
      ))}
      {Object.keys(filteredOrderDepths).length > 0 && Object.keys(filteredOrderDepths).length % 3 <= 2 && (
        <Grid.Col span={{ xs: 12, sm: 4 }} />
      )}
      {Object.keys(filteredOrderDepths).length > 0 && Object.keys(filteredOrderDepths).length % 3 <= 1 && (
        <Grid.Col span={{ xs: 12, sm: 4 }} />
      )}
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Own trades</Title>
        {<TradesTable trades={filteredOwnTrades} />}
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Market trades</Title>
        {<TradesTable trades={filteredMarketTrades} />}
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Orders</Title>
        {<OrdersTable orders={filteredOrders} />}
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 6 }}>
        <Title order={5}>Algorithm logs</Title>
        {algorithmLogs ? (
          <ScrollableCodeHighlight code={algorithmLogs} language="markdown" />
        ) : (
          <Text>Timestamp has no algorithm logs</Text>
        )}
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 6 }}>
        <Title order={5}>Previous trader data</Title>
        {state.traderData ? (
          <ScrollableCodeHighlight code={formatTraderData(state.traderData)} language="json" />
        ) : (
          <Text>Timestamp has no previous trader data</Text>
        )}
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 6 }}>
        <Title order={5}>Next trader data</Title>
        {traderData ? (
          <ScrollableCodeHighlight code={formatTraderData(traderData)} language="json" />
        ) : (
          <Text>Timestamp has no next trader data</Text>
        )}
      </Grid.Col>
    </Grid>
  );
}

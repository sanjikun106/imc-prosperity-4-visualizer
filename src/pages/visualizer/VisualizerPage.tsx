import { Button, Center, Checkbox, Container, Grid, MultiSelect, Text, Title } from '@mantine/core';
import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store.ts';
import { formatNumber } from '../../utils/format.ts';
import { AlgorithmSummaryCard } from './AlgorithmSummaryCard.tsx';
import { ConversionPriceChart } from './ConversionPriceChart.tsx';
import { EnvironmentChart } from './EnvironmentChart.tsx';
import { PlainValueObservationChart } from './PlainValueObservationChart.tsx';
import { ProductPriceChart } from './ProductPriceChart.tsx';
import { TimestampsCard } from './TimestampsCard.tsx';
import { TransportChart } from './TransportChart.tsx';
import { VisualizerCard } from './VisualizerCard.tsx';
import { VolumeChart } from './VolumeChart.tsx';

function getRoundDayFromFileName(fileName: string | undefined): string | null {
  if (fileName === undefined || fileName.trim().length === 0) {
    return null;
  }

  const match = fileName.match(/round\s*-?\s*(\d+)\D+day\s*-?\s*(-?\d+)/i);
  if (match === null) {
    return null;
  }

  return `round${match[1]} day ${match[2]}`;
}

function formatCsvValue(value: number | string | undefined): string {
  if (value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
    return `"${stringValue.split('"').join('""')}"`;
  }

  return stringValue;
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export function VisualizerPage(): ReactNode {
  const algorithm = useStore(state => state.algorithm);
  const { search } = useLocation();

  if (algorithm === null) {
    return <Navigate to={`/${search}`} />;
  }

  const products = new Set<string>();
  const conversionProducts = new Set<string>();
  const plainValueObservationSymbols = new Set<string>();

  for (const row of algorithm.activityLogs) {
    products.add(row.product);
  }

  for (const row of algorithm.data) {
    for (const product of Object.keys(row.state.observations.conversionObservations)) {
      conversionProducts.add(product);
      products.add(product);
    }

    for (const product of Object.keys(row.state.listings)) {
      products.add(product);
    }

    for (const product of Object.keys(row.state.orderDepths)) {
      products.add(product);
    }

    for (const product of Object.keys(row.state.position)) {
      products.add(product);
    }

    for (const product of Object.keys(row.orders)) {
      products.add(product);
    }

    for (const product of Object.keys(row.state.observations.plainValueObservations)) {
      plainValueObservationSymbols.add(product);
      products.add(product);
    }
  }

  const sortedProducts = [...products].sort((a, b) => a.localeCompare(b));
  const [selectedProducts, setSelectedProducts] = useState<string[]>(sortedProducts);
  const [showVolumeCharts, setShowVolumeCharts] = useState(true);
  const [marketTradeBuyerFilter, setMarketTradeBuyerFilter] = useState('');
  const [marketTradeSellerFilter, setMarketTradeSellerFilter] = useState('');

  useEffect(() => {
    setSelectedProducts(sortedProducts);
  }, [algorithm]);

  const selectedProductSet = new Set(selectedProducts);
  const selectedActivityLogs = algorithm.activityLogs.filter(row => selectedProductSet.has(row.product));
  const sourceLogFileName = algorithm.sourceLogFileName || algorithm.summary?.fileName;
  const parsedRoundDay = getRoundDayFromFileName(sourceLogFileName);

  function handleDownloadOrderBookCsv(): void {
    const headers = [
      'day',
      'timestamp',
      'product',
      'bid_price_1',
      'bid_volume_1',
      'bid_price_2',
      'bid_volume_2',
      'bid_price_3',
      'bid_volume_3',
      'ask_price_1',
      'ask_volume_1',
      'ask_price_2',
      'ask_volume_2',
      'ask_price_3',
      'ask_volume_3',
      'mid_price',
      'profit_loss',
    ];

    const rows = selectedActivityLogs.map(row =>
      [
        row.day,
        row.timestamp,
        row.product,
        row.bidPrices[0],
        row.bidVolumes[0],
        row.bidPrices[1],
        row.bidVolumes[1],
        row.bidPrices[2],
        row.bidVolumes[2],
        row.askPrices[0],
        row.askVolumes[0],
        row.askPrices[1],
        row.askVolumes[1],
        row.askPrices[2],
        row.askVolumes[2],
        row.midPrice,
        row.profitLoss,
      ]
        .map(formatCsvValue)
        .join(','),
    );

    const csv = [headers.join(','), ...rows].join('\n');
    downloadCsv('order-book-data.csv', csv);
  }

  let profitLoss = 0;
  const lastTimestamp = algorithm.activityLogs[algorithm.activityLogs.length - 1].timestamp;
  for (let i = algorithm.activityLogs.length - 1; i >= 0 && algorithm.activityLogs[i].timestamp == lastTimestamp; i--) {
    if (!selectedProductSet.has(algorithm.activityLogs[i].product)) {
      continue;
    }

    profitLoss += algorithm.activityLogs[i].profitLoss;
  }

  const productSections: ReactNode[] = [];
  selectedProducts.forEach(symbol => {
    productSections.push(
      <Grid.Col key={`${symbol} - header`} span={12}>
        <Title order={3}>{symbol}</Title>
      </Grid.Col>,
    );

    productSections.push(
      <Grid.Col key={`${symbol} - product price`} span={12}>
        <ProductPriceChart
          symbol={symbol}
          marketTradeBuyerFilter={marketTradeBuyerFilter}
          setMarketTradeBuyerFilter={setMarketTradeBuyerFilter}
          marketTradeSellerFilter={marketTradeSellerFilter}
          setMarketTradeSellerFilter={setMarketTradeSellerFilter}
        />
      </Grid.Col>,
    );

    if (showVolumeCharts) {
      productSections.push(
        <Grid.Col key={`${symbol} - volume`} span={12}>
          <VolumeChart symbol={symbol} />
        </Grid.Col>,
      );
    }

    if (plainValueObservationSymbols.has(symbol)) {
      productSections.push(
        <Grid.Col key={`${symbol} - plain value observation`} span={12}>
          <PlainValueObservationChart symbol={symbol} />
        </Grid.Col>,
      );
    }

    if (!conversionProducts.has(symbol)) {
      return;
    }

    productSections.push(
      <Grid.Col key={`${symbol} - conversion price`} span={12}>
        <ConversionPriceChart symbol={symbol} />
      </Grid.Col>,
    );

    productSections.push(
      <Grid.Col key={`${symbol} - transport`} span={12}>
        <TransportChart symbol={symbol} />
      </Grid.Col>,
    );

    productSections.push(
      <Grid.Col key={`${symbol} - environment`} span={12}>
        <EnvironmentChart symbol={symbol} />
      </Grid.Col>,
    );
  });

  return (
    <Container fluid>
      <Grid>
        <Grid.Col span={12}>
          <VisualizerCard title="Products">
            <MultiSelect
              label="Visible products"
              description="Select one or more products to filter the charts and timestamp detail."
              data={sortedProducts}
              value={selectedProducts}
              onChange={setSelectedProducts}
              searchable
              clearable
            />
            <Checkbox
              mt="md"
              label="Show volume charts"
              checked={showVolumeCharts}
              onChange={event => setShowVolumeCharts(event.currentTarget.checked)}
            />
            <Button mt="md" onClick={handleDownloadOrderBookCsv} disabled={selectedActivityLogs.length === 0}>
              Download Bid/Ask CSV
            </Button>
            {sourceLogFileName && (
              <Text mt="md" size="sm">
                Log file: {sourceLogFileName}
              </Text>
            )}
            {parsedRoundDay && (
              <Text size="sm" fw={600}>
                {parsedRoundDay}
              </Text>
            )}
          </VisualizerCard>
        </Grid.Col>
        <Grid.Col span={12}>
          <VisualizerCard>
            <Center>
              <Title order={2}>Selected Profit / Loss: {formatNumber(profitLoss)}</Title>
            </Center>
          </VisualizerCard>
        </Grid.Col>
        {selectedProducts.length === 0 && (
          <Grid.Col span={12}>
            <VisualizerCard>
              <Text>Select at least one product to view product-specific charts and timestamp data.</Text>
            </VisualizerCard>
          </Grid.Col>
        )}
        {productSections}
        <Grid.Col span={12}>
          <TimestampsCard
            symbols={selectedProducts}
            marketTradeBuyerFilter={marketTradeBuyerFilter}
            marketTradeSellerFilter={marketTradeSellerFilter}
          />
        </Grid.Col>
        {algorithm.summary && (
          <Grid.Col span={12}>
            <AlgorithmSummaryCard />
          </Grid.Col>
        )}
      </Grid>
    </Container>
  );
}

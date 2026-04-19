import { Box, Checkbox, Grid, Stack, Text, TextInput } from '@mantine/core';
import {
  BaselineSeries,
  type Time as ChartTime,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  type IChartApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  LineSeries,
  LineStyle,
  type MouseEventHandler,
  type SeriesAttachedParameter,
  type SeriesMarker,
} from 'lightweight-charts';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useActualColorScheme } from '../../hooks/use-actual-color-scheme.ts';
import { ActivityLogRow, AlgorithmDataRow, OrderDepth, ProsperitySymbol, Trade } from '../../models.ts';
import { useStore } from '../../store.ts';
import { getAskColor, getBidColor } from '../../utils/colors.ts';
import { formatNumber } from '../../utils/format.ts';
import { VisualizerCard } from './VisualizerCard.tsx';

export interface ProductPriceChartProps {
  symbol: ProsperitySymbol;
}

type SeriesId =
  | 'bid-1'
  | 'bid-2'
  | 'bid-3'
  | 'ask-1'
  | 'ask-2'
  | 'ask-3'
  | 'mid-price'
  | 'fair-price'
  | 'take-buy'
  | 'take-sell'
  | 'make-bid-filled'
  | 'make-ask-filled'
  | 'market-trade-buy'
  | 'market-trade-sell';

type PriceLineSeriesId = Extract<
  SeriesId,
  'bid-1' | 'bid-2' | 'bid-3' | 'ask-1' | 'ask-2' | 'ask-3' | 'mid-price' | 'fair-price'
>;
type MarkerSeriesId = Exclude<SeriesId, PriceLineSeriesId>;

interface ParsedAction {
  id: MarkerSeriesId;
  symbol: string;
  price: number;
  side: 'buy' | 'sell';
}

interface DerivedChartData {
  activityRows: ActivityLogRow[];
  rowByTimestamp: Map<number, ActivityLogRow>;
  fairByTimestamp: Map<number, number>;
  pnlByTimestamp: Map<number, number>;
  positionByTimestamp: Map<number, number>;
  bid1Data: { time: ChartTime; value: number }[];
  bid2Data: { time: ChartTime; value: number }[];
  bid3Data: { time: ChartTime; value: number }[];
  ask1Data: { time: ChartTime; value: number }[];
  ask2Data: { time: ChartTime; value: number }[];
  ask3Data: { time: ChartTime; value: number }[];
  midData: { time: ChartTime; value: number }[];
  fairData: { time: ChartTime; value: number }[];
  pnlData: { time: ChartTime; value: number }[];
  positionData: { time: ChartTime; value: number }[];
  zeroLineData: { time: ChartTime; value: number }[];
  allMarkers: MarkerEntry[];
  triangleMarkers: TriangleMarkerEntry[];
  markerTooltipByTimestamp: Map<number, MarkerTooltipEntry[]>;
}

interface MarkerEntry {
  filterId: MarkerSeriesId;
  marker: SeriesMarker<ChartTime>;
  quantity: number;
}

interface TriangleMarkerEntry {
  filterId: 'take-buy' | 'take-sell';
  time: ChartTime;
  price: number;
  color: string;
  direction: 'up' | 'down';
  size: number;
}

interface MarkerTooltipEntry {
  filterId: MarkerSeriesId;
  label: string;
  color: string;
  price: number;
  quantity: number;
}

interface TooltipLine {
  key: string;
  label: string;
  value: string;
  color: string;
}

interface TooltipState {
  timestamp: number;
  lines: TooltipLine[];
}

interface MarketTradeVolumeFilter {
  exact?: number;
  min?: number;
  max?: number;
}

const SERIES_OPTIONS: { id: SeriesId; label: string; color: string; kind: 'line' | 'marker' }[] = [
  { id: 'bid-1', label: 'Bid 1', color: getBidColor(1.0), kind: 'line' },
  { id: 'bid-2', label: 'Bid 2', color: getBidColor(0.75), kind: 'line' },
  { id: 'bid-3', label: 'Bid 3', color: getBidColor(0.5), kind: 'line' },
  { id: 'ask-1', label: 'Ask 1', color: getAskColor(1.0), kind: 'line' },
  { id: 'ask-2', label: 'Ask 2', color: getAskColor(0.75), kind: 'line' },
  { id: 'ask-3', label: 'Ask 3', color: getAskColor(0.5), kind: 'line' },
  { id: 'mid-price', label: 'Mid price', color: '#94a3b8', kind: 'line' },
  { id: 'fair-price', label: 'Fair price', color: '#60a5fa', kind: 'line' },
  { id: 'take-buy', label: 'Take Buy ▲', color: '#22c55e', kind: 'marker' },
  { id: 'take-sell', label: 'Take Sell ▼', color: '#ef4444', kind: 'marker' },
  { id: 'make-bid-filled', label: 'Make Bid Filled ■', color: '#16a34a', kind: 'marker' },
  { id: 'make-ask-filled', label: 'Make Ask Filled ■', color: '#dc2626', kind: 'marker' },
  { id: 'market-trade-buy', label: 'Market Trade Buy ●', color: '#22c55e', kind: 'marker' },
  { id: 'market-trade-sell', label: 'Market Trade Sell ●', color: '#ef4444', kind: 'marker' },
];

const SERIES_LABELS = Object.fromEntries(SERIES_OPTIONS.map(option => [option.id, option.label])) as Record<
  SeriesId,
  string
>;
const SERIES_COLORS = Object.fromEntries(SERIES_OPTIONS.map(option => [option.id, option.color])) as Record<
  SeriesId,
  string
>;
const DEFAULT_VISIBLE_SERIES = SERIES_OPTIONS.map(option => option.id);

function toChartTime(timestamp: number): ChartTime {
  return timestamp as ChartTime;
}

function getNumericTime(time: ChartTime | undefined): number | null {
  return typeof time === 'number' ? time : null;
}

function formatValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }

  return Number.isInteger(value) ? formatNumber(value) : formatNumber(value, 2);
}

function formatChartTime(time: ChartTime): string {
  const numericTime = getNumericTime(time);
  return numericTime === null ? '' : formatNumber(numericTime);
}

function parseVolumeInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function matchesMarketTradeVolumeFilter(quantity: number, filter: MarketTradeVolumeFilter): boolean {
  const volume = Math.abs(quantity);

  if (filter.exact !== undefined) {
    return volume === filter.exact;
  }

  if (filter.min !== undefined && volume < filter.min) {
    return false;
  }

  if (filter.max !== undefined && volume > filter.max) {
    return false;
  }

  return true;
}

function isMarketTradeSeries(id: MarkerSeriesId): id is 'market-trade-buy' | 'market-trade-sell' {
  return id === 'market-trade-buy' || id === 'market-trade-sell';
}

function hasBookData(row: ActivityLogRow): boolean {
  return row.bidPrices.length > 0 || row.askPrices.length > 0;
}

function getMidPriceForChart(row: ActivityLogRow | undefined): number | undefined {
  if (row === undefined || Number.isNaN(row.midPrice)) {
    return undefined;
  }

  // Some exports contain fully empty book rows with mid_price=0.0.
  // Treat those as "no mid-price point" rather than plotting a fake drop to zero.
  if (!hasBookData(row) && row.midPrice === 0) {
    return undefined;
  }

  return row.midPrice;
}

function getBestBidPrice(orderDepth?: OrderDepth): number | undefined {
  const prices = Object.keys(orderDepth?.buyOrders || {}).map(Number);
  return prices.length > 0 ? Math.max(...prices) : undefined;
}

function getBestAskPrice(orderDepth?: OrderDepth): number | undefined {
  const prices = Object.keys(orderDepth?.sellOrders || {}).map(Number);
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

function getTradeKey(trade: Trade): string {
  return [trade.symbol, trade.price, trade.quantity, trade.buyer, trade.seller, trade.timestamp].join('|');
}

function getMarkerSize(quantity: number): number {
  return Math.max(1, Math.min(4, Math.round(Math.sqrt(Math.abs(quantity)) / 2)));
}

class TriangleMarkerRenderer implements IPrimitivePaneRenderer {
  public constructor(private readonly primitive: TriangleMarkerPrimitive) {}

  public draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const markers = this.primitive.getRenderableMarkers();
    if (markers.length === 0) {
      return;
    }

    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      for (const marker of markers) {
        const size = (5 + marker.size * 2) * Math.min(horizontalPixelRatio, verticalPixelRatio);
        const halfWidth = size * 0.75;
        const halfHeight = size * 0.65;
        const x = marker.x * horizontalPixelRatio;
        const y = marker.y * verticalPixelRatio;

        context.beginPath();
        context.fillStyle = marker.color;

        if (marker.direction === 'up') {
          context.moveTo(x, y - halfHeight);
          context.lineTo(x - halfWidth, y + halfHeight);
          context.lineTo(x + halfWidth, y + halfHeight);
        } else {
          context.moveTo(x, y + halfHeight);
          context.lineTo(x - halfWidth, y - halfHeight);
          context.lineTo(x + halfWidth, y - halfHeight);
        }

        context.closePath();
        context.fill();
      }
    });
  }
}

class TriangleMarkerPaneView implements IPrimitivePaneView {
  private readonly rendererInstance: TriangleMarkerRenderer;

  public constructor(private readonly primitive: TriangleMarkerPrimitive) {
    this.rendererInstance = new TriangleMarkerRenderer(primitive);
  }

  public zOrder(): 'top' {
    return 'top';
  }

  public renderer(): IPrimitivePaneRenderer | null {
    return this.primitive.hasMarkers() ? this.rendererInstance : null;
  }
}

class TriangleMarkerPrimitive implements ISeriesPrimitive<ChartTime> {
  private attachedParam: SeriesAttachedParameter<ChartTime> | null = null;
  private markers: TriangleMarkerEntry[] = [];
  private readonly paneViewInstance: TriangleMarkerPaneView;
  private readonly paneViewsArray: readonly TriangleMarkerPaneView[];

  public constructor() {
    this.paneViewInstance = new TriangleMarkerPaneView(this);
    this.paneViewsArray = [this.paneViewInstance];
  }

  public attached(param: SeriesAttachedParameter<ChartTime>): void {
    this.attachedParam = param;
  }

  public detached(): void {
    this.attachedParam = null;
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return this.paneViewsArray;
  }

  public setMarkers(markers: TriangleMarkerEntry[]): void {
    this.markers = markers;
    this.attachedParam?.requestUpdate();
  }

  public hasMarkers(): boolean {
    return this.markers.length > 0;
  }

  public getRenderableMarkers(): {
    x: number;
    y: number;
    color: string;
    direction: 'up' | 'down';
    size: number;
  }[] {
    if (this.attachedParam === null) {
      return [];
    }

    const timeScale = this.attachedParam.chart.timeScale();
    return this.markers
      .map(marker => {
        const x = timeScale.timeToCoordinate(marker.time);
        const y = this.attachedParam?.series.priceToCoordinate(marker.price);
        if (x === null || y === null) {
          return null;
        }

        return {
          x: Number(x),
          y: Number(y),
          color: marker.color,
          direction: marker.direction,
          size: marker.size,
        };
      })
      .filter(
        (marker): marker is { x: number; y: number; color: string; direction: 'up' | 'down'; size: number } =>
          marker !== null,
      );
  }
}

function getParsedActions(row: AlgorithmDataRow): ParsedAction[] {
  const logText = [row.sandboxLogs, row.algorithmLogs].filter(Boolean).join('\n');
  const actions: ParsedAction[] = [];

  for (const line of logText.split('\n')) {
    const match = line.match(/\b(TAKE|MAKE|FLATTEN)\s+(BUY|SELL|BID|ASK)\s+(\d+)x\s+([A-Z0-9_]+)\s+@\s+([0-9.]+)/);
    if (match === null) {
      continue;
    }

    const [, action, side, , parsedSymbol, price] = match;
    const normalizedSide = side === 'BUY' || side === 'BID' ? 'buy' : 'sell';
    let id: MarkerSeriesId | undefined;

    if (action === 'TAKE' && normalizedSide === 'buy') {
      id = 'take-buy';
    } else if (action === 'TAKE' && normalizedSide === 'sell') {
      id = 'take-sell';
    } else if (action === 'MAKE' && normalizedSide === 'buy') {
      id = 'make-bid-filled';
    } else if (action === 'MAKE' && normalizedSide === 'sell') {
      id = 'make-ask-filled';
    }

    if (id === undefined) {
      continue;
    }

    actions.push({
      id,
      symbol: parsedSymbol,
      price: Number(price),
      side: normalizedSide,
    });
  }

  return actions;
}

function getTradeSeriesIdFromLogs(row: AlgorithmDataRow | undefined, trade: Trade): MarkerSeriesId | null {
  if (row === undefined) {
    return null;
  }

  const tradeSide = trade.buyer === 'SUBMISSION' ? 'buy' : trade.seller === 'SUBMISSION' ? 'sell' : null;
  if (tradeSide === null) {
    return null;
  }

  const action = getParsedActions(row).find(
    candidate => candidate.symbol === trade.symbol && candidate.side === tradeSide && candidate.price === trade.price,
  );

  return action?.id || null;
}

function getTradeSeriesId(row: AlgorithmDataRow | undefined, trade: Trade): MarkerSeriesId | null {
  const logDerivedId = getTradeSeriesIdFromLogs(row, trade);
  if (logDerivedId !== null) {
    return logDerivedId;
  }

  if (row === undefined) {
    return null;
  }

  const symbolOrders = row.orders[trade.symbol] || [];
  const orderDepth = row.state.orderDepths[trade.symbol];
  const bestBid = getBestBidPrice(orderDepth);
  const bestAsk = getBestAskPrice(orderDepth);

  if (trade.buyer === 'SUBMISSION') {
    const hasMatchingBidOrder = symbolOrders.some(order => order.quantity > 0 && order.price === trade.price);

    if (bestAsk !== undefined && trade.price >= bestAsk) {
      return 'take-buy';
    }

    return hasMatchingBidOrder ? 'make-bid-filled' : 'take-buy';
  }

  if (trade.seller === 'SUBMISSION') {
    const hasMatchingAskOrder = symbolOrders.some(order => order.quantity < 0 && order.price === trade.price);

    if (bestBid !== undefined && trade.price <= bestBid) {
      return 'take-sell';
    }

    return hasMatchingAskOrder ? 'make-ask-filled' : 'take-sell';
  }

  return null;
}

function getMarketTradeSeriesId(
  row: ActivityLogRow | undefined,
  trade: Trade,
): 'market-trade-buy' | 'market-trade-sell' {
  const bestBid = row?.bidPrices[0];
  const bestAsk = row?.askPrices[0];

  if (bestAsk !== undefined && trade.price >= bestAsk) {
    return 'market-trade-buy';
  }

  if (bestBid !== undefined && trade.price <= bestBid) {
    return 'market-trade-sell';
  }

  return row !== undefined && trade.price >= row.midPrice ? 'market-trade-buy' : 'market-trade-sell';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFairPriceFromLogs(row: AlgorithmDataRow | undefined, symbol: string): number | undefined {
  if (row === undefined) {
    return undefined;
  }

  const symbolPattern = escapeRegExp(symbol);
  const headerPattern = new RegExp(`\\[${symbolPattern}\\].*`, 'i');
  const fairPattern = /\bfair(?:_price)?=([+-]?\d+(?:\.\d+)?)/i;
  const modelPattern = /\barima_pred=([+-]?\d+(?:\.\d+)?)/i;

  for (const line of [row.algorithmLogs, row.sandboxLogs].filter(Boolean).join('\n').split('\n')) {
    if (!headerPattern.test(line)) {
      continue;
    }

    const fairMatch = line.match(fairPattern);
    if (fairMatch !== null) {
      return Number(fairMatch[1]);
    }

    const modelMatch = line.match(modelPattern);
    if (modelMatch !== null) {
      return Number(modelMatch[1]);
    }
  }

  return undefined;
}

function createTooltipLines(
  row: ActivityLogRow | undefined,
  fairPrice: number | undefined,
  visibleSeries: Set<SeriesId>,
  markerEntries: MarkerTooltipEntry[],
  marketTradeVolumeFilter: MarketTradeVolumeFilter,
): TooltipLine[] {
  const lines: TooltipLine[] = [];

  if (row !== undefined) {
    const priceLines: [PriceLineSeriesId, number | undefined, number | undefined][] = [
      ['bid-1', row.bidPrices[0], row.bidVolumes[0]],
      ['bid-2', row.bidPrices[1], row.bidVolumes[1]],
      ['bid-3', row.bidPrices[2], row.bidVolumes[2]],
      ['ask-1', row.askPrices[0], row.askVolumes[0]],
      ['ask-2', row.askPrices[1], row.askVolumes[1]],
      ['ask-3', row.askPrices[2], row.askVolumes[2]],
      ['mid-price', getMidPriceForChart(row), undefined],
      ['fair-price', fairPrice, undefined],
    ];

    for (const [id, price, volume] of priceLines) {
      if (!visibleSeries.has(id) || price === undefined) {
        continue;
      }

      lines.push({
        key: id,
        label: SERIES_LABELS[id],
        value: volume === undefined ? formatValue(price) : `${formatValue(price)}, ${formatValue(volume)}`,
        color: SERIES_COLORS[id],
      });
    }
  }

  for (const entry of markerEntries) {
    if (!visibleSeries.has(entry.filterId)) {
      continue;
    }

    if (
      isMarketTradeSeries(entry.filterId) &&
      !matchesMarketTradeVolumeFilter(entry.quantity, marketTradeVolumeFilter)
    ) {
      continue;
    }

    lines.push({
      key: `${entry.filterId}-${entry.price}-${entry.quantity}`,
      label: entry.label,
      value: `${formatValue(entry.price)}, ${formatValue(entry.quantity)}`,
      color: entry.color,
    });
  }

  return lines;
}

export function ProductPriceChart({ symbol }: ProductPriceChartProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;
  const colorScheme = useActualColorScheme();

  const [visibleSeriesIds, setVisibleSeriesIds] = useState<string[]>(DEFAULT_VISIBLE_SERIES);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [exactMarketTradeVolume, setExactMarketTradeVolume] = useState('');
  const [minMarketTradeVolume, setMinMarketTradeVolume] = useState('');
  const [maxMarketTradeVolume, setMaxMarketTradeVolume] = useState('');

  const priceContainerRef = useRef<HTMLDivElement>(null);
  const pnlContainerRef = useRef<HTMLDivElement>(null);
  const posContainerRef = useRef<HTMLDivElement>(null);

  const priceChartRef = useRef<IChartApi | null>(null);
  const pnlChartRef = useRef<IChartApi | null>(null);
  const posChartRef = useRef<IChartApi | null>(null);

  const priceSeriesRefs = useRef<Record<PriceLineSeriesId, ISeriesApi<'Line'> | null>>({
    'bid-1': null,
    'bid-2': null,
    'bid-3': null,
    'ask-1': null,
    'ask-2': null,
    'ask-3': null,
    'mid-price': null,
    'fair-price': null,
  });
  const markerAnchorSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<ChartTime> | null>(null);
  const triangleMarkerPrimitiveRef = useRef<TriangleMarkerPrimitive | null>(null);
  const pnlSeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const positionSeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const positionZeroSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const visibleSeriesIdsRef = useRef<Set<SeriesId>>(new Set(DEFAULT_VISIBLE_SERIES as SeriesId[]));
  const marketTradeVolumeFilterRef = useRef<MarketTradeVolumeFilter>({});
  const rangeSyncingRef = useRef(false);
  const crosshairSyncingRef = useRef(false);
  const activeTooltipTimestamp = tooltip?.timestamp ?? null;

  const marketTradeVolumeFilter = useMemo<MarketTradeVolumeFilter>(() => {
    return {
      exact: parseVolumeInput(exactMarketTradeVolume),
      min: parseVolumeInput(minMarketTradeVolume),
      max: parseVolumeInput(maxMarketTradeVolume),
    };
  }, [exactMarketTradeVolume, maxMarketTradeVolume, minMarketTradeVolume]);

  useEffect(() => {
    marketTradeVolumeFilterRef.current = marketTradeVolumeFilter;
  }, [marketTradeVolumeFilter]);

  const derivedData = useMemo<DerivedChartData>(() => {
    const activityRows = algorithm.activityLogs
      .filter(row => row.product === symbol)
      .sort((a, b) => a.timestamp - b.timestamp);
    const rowByTimestamp = new Map<number, ActivityLogRow>();
    const fairByTimestamp = new Map<number, number>();
    const pnlByTimestamp = new Map<number, number>();

    const bid1Data: { time: ChartTime; value: number }[] = [];
    const bid2Data: { time: ChartTime; value: number }[] = [];
    const bid3Data: { time: ChartTime; value: number }[] = [];
    const ask1Data: { time: ChartTime; value: number }[] = [];
    const ask2Data: { time: ChartTime; value: number }[] = [];
    const ask3Data: { time: ChartTime; value: number }[] = [];
    const midData: { time: ChartTime; value: number }[] = [];
    const fairData: { time: ChartTime; value: number }[] = [];
    const pnlData: { time: ChartTime; value: number }[] = [];

    const rowsByTimestamp = new Map<number, AlgorithmDataRow>();
    for (const row of algorithm.data) {
      rowsByTimestamp.set(row.state.timestamp, row);
    }

    for (const row of activityRows) {
      rowByTimestamp.set(row.timestamp, row);
      pnlByTimestamp.set(row.timestamp, row.profitLoss);

      if (row.bidPrices[0] !== undefined) {
        bid1Data.push({ time: toChartTime(row.timestamp), value: row.bidPrices[0] });
      }
      if (row.bidPrices[1] !== undefined) {
        bid2Data.push({ time: toChartTime(row.timestamp), value: row.bidPrices[1] });
      }
      if (row.bidPrices[2] !== undefined) {
        bid3Data.push({ time: toChartTime(row.timestamp), value: row.bidPrices[2] });
      }
      if (row.askPrices[0] !== undefined) {
        ask1Data.push({ time: toChartTime(row.timestamp), value: row.askPrices[0] });
      }
      if (row.askPrices[1] !== undefined) {
        ask2Data.push({ time: toChartTime(row.timestamp), value: row.askPrices[1] });
      }
      if (row.askPrices[2] !== undefined) {
        ask3Data.push({ time: toChartTime(row.timestamp), value: row.askPrices[2] });
      }

      const midPrice = getMidPriceForChart(row);
      if (midPrice !== undefined) {
        midData.push({ time: toChartTime(row.timestamp), value: midPrice });
      }
      const fairPrice = getFairPriceFromLogs(rowsByTimestamp.get(row.timestamp), symbol);
      if (fairPrice !== undefined) {
        fairByTimestamp.set(row.timestamp, fairPrice);
        fairData.push({ time: toChartTime(row.timestamp), value: fairPrice });
      }
      pnlData.push({ time: toChartTime(row.timestamp), value: row.profitLoss });
    }

    const seenTrades = new Set<string>();
    const seenMarketTrades = new Set<string>();
    const tradeDeltasByTimestamp = new Map<number, number>();
    const allMarkers: MarkerEntry[] = [];
    const triangleMarkers: TriangleMarkerEntry[] = [];
    const markerTooltipByTimestamp = new Map<number, MarkerTooltipEntry[]>();

    for (const row of algorithm.data) {
      for (const trade of row.state.ownTrades[symbol] || []) {
        const key = getTradeKey(trade);
        if (seenTrades.has(key)) {
          continue;
        }

        seenTrades.add(key);

        const tradeSeriesId = getTradeSeriesId(rowsByTimestamp.get(trade.timestamp), trade);
        if (tradeSeriesId === null) {
          continue;
        }

        if (trade.buyer === 'SUBMISSION') {
          tradeDeltasByTimestamp.set(
            trade.timestamp,
            (tradeDeltasByTimestamp.get(trade.timestamp) || 0) + trade.quantity,
          );
        } else if (trade.seller === 'SUBMISSION') {
          tradeDeltasByTimestamp.set(
            trade.timestamp,
            (tradeDeltasByTimestamp.get(trade.timestamp) || 0) - trade.quantity,
          );
        }

        const isBuyMarker = tradeSeriesId === 'take-buy' || tradeSeriesId === 'make-bid-filled';
        const markerSize = getMarkerSize(trade.quantity);

        if (tradeSeriesId === 'take-buy' || tradeSeriesId === 'take-sell') {
          triangleMarkers.push({
            filterId: tradeSeriesId,
            time: toChartTime(trade.timestamp),
            price: trade.price,
            color: SERIES_COLORS[tradeSeriesId],
            direction: tradeSeriesId === 'take-buy' ? 'up' : 'down',
            size: markerSize,
          });
        } else {
          const marker: SeriesMarker<ChartTime> = {
            id: `${tradeSeriesId}-${key}`,
            time: toChartTime(trade.timestamp),
            position: isBuyMarker ? 'atPriceBottom' : 'atPriceTop',
            price: trade.price,
            color: SERIES_COLORS[tradeSeriesId],
            shape: tradeSeriesId === 'make-bid-filled' || tradeSeriesId === 'make-ask-filled' ? 'square' : 'circle',
            size: markerSize,
          };

          allMarkers.push({
            filterId: tradeSeriesId,
            marker,
            quantity: trade.quantity,
          });
        }

        const tooltipEntries = markerTooltipByTimestamp.get(trade.timestamp) || [];
        tooltipEntries.push({
          filterId: tradeSeriesId,
          label: SERIES_LABELS[tradeSeriesId],
          color: SERIES_COLORS[tradeSeriesId],
          price: trade.price,
          quantity: trade.quantity,
        });
        markerTooltipByTimestamp.set(trade.timestamp, tooltipEntries);
      }
    }

    const marketTrades =
      algorithm.marketTradeHistory.length > 0
        ? algorithm.marketTradeHistory
        : algorithm.data.flatMap(row => row.state.marketTrades[symbol] || []);

    for (const trade of marketTrades) {
      if (trade.symbol !== symbol) {
        continue;
      }

      const key = getTradeKey(trade);
      if (seenMarketTrades.has(key)) {
        continue;
      }

      seenMarketTrades.add(key);

      const tradeSeriesId = getMarketTradeSeriesId(rowByTimestamp.get(trade.timestamp), trade);
      allMarkers.push({
        filterId: tradeSeriesId,
        marker: {
          id: `${tradeSeriesId}-${key}`,
          time: toChartTime(trade.timestamp),
          position: tradeSeriesId === 'market-trade-buy' ? 'atPriceBottom' : 'atPriceTop',
          price: trade.price,
          color: SERIES_COLORS[tradeSeriesId],
          shape: 'circle',
          size: getMarkerSize(trade.quantity),
        },
        quantity: trade.quantity,
      });

      const tooltipEntries = markerTooltipByTimestamp.get(trade.timestamp) || [];
      tooltipEntries.push({
        filterId: tradeSeriesId,
        label: SERIES_LABELS[tradeSeriesId],
        color: SERIES_COLORS[tradeSeriesId],
        price: trade.price,
        quantity: trade.quantity,
      });
      markerTooltipByTimestamp.set(trade.timestamp, tooltipEntries);
    }

    allMarkers.sort((a, b) => getNumericTime(a.marker.time)! - getNumericTime(b.marker.time)!);
    triangleMarkers.sort((a, b) => getNumericTime(a.time)! - getNumericTime(b.time)!);

    const positionByTimestamp = new Map<number, number>();
    const positionData: { time: ChartTime; value: number }[] = [];
    let runningPosition = 0;

    for (const row of activityRows) {
      runningPosition += tradeDeltasByTimestamp.get(row.timestamp) || 0;
      positionByTimestamp.set(row.timestamp, runningPosition);
      positionData.push({
        time: toChartTime(row.timestamp),
        value: runningPosition,
      });
    }

    const zeroLineData =
      activityRows.length > 0
        ? [
            { time: toChartTime(activityRows[0].timestamp), value: 0 },
            { time: toChartTime(activityRows[activityRows.length - 1].timestamp), value: 0 },
          ]
        : [];

    return {
      activityRows,
      rowByTimestamp,
      fairByTimestamp,
      pnlByTimestamp,
      positionByTimestamp,
      bid1Data,
      bid2Data,
      bid3Data,
      ask1Data,
      ask2Data,
      ask3Data,
      midData,
      fairData,
      pnlData,
      positionData,
      zeroLineData,
      allMarkers,
      triangleMarkers,
      markerTooltipByTimestamp,
    };
  }, [algorithm, symbol]);

  const shouldPlotMidPrice = useMemo(() => derivedData.midData.some(point => point.value !== 0), [derivedData.midData]);
  const availableSeriesOptions = useMemo(
    () => SERIES_OPTIONS.filter(option => option.id !== 'mid-price' || shouldPlotMidPrice),
    [shouldPlotMidPrice],
  );

  useEffect(() => {
    const nextVisibleSeriesIds = new Set(visibleSeriesIds as SeriesId[]);
    if (!shouldPlotMidPrice) {
      nextVisibleSeriesIds.delete('mid-price');
    }

    visibleSeriesIdsRef.current = nextVisibleSeriesIds;
  }, [shouldPlotMidPrice, visibleSeriesIds]);

  useEffect(() => {
    if (activeTooltipTimestamp === null) {
      return;
    }

    setTooltip({
      timestamp: activeTooltipTimestamp,
      lines: createTooltipLines(
        derivedData.rowByTimestamp.get(activeTooltipTimestamp),
        derivedData.fairByTimestamp.get(activeTooltipTimestamp),
        visibleSeriesIdsRef.current,
        derivedData.markerTooltipByTimestamp.get(activeTooltipTimestamp) || [],
        marketTradeVolumeFilter,
      ),
    });
  }, [
    activeTooltipTimestamp,
    derivedData.fairByTimestamp,
    derivedData.markerTooltipByTimestamp,
    derivedData.rowByTimestamp,
    marketTradeVolumeFilter,
    shouldPlotMidPrice,
    visibleSeriesIds,
  ]);

  useEffect(() => {
    const priceContainer = priceContainerRef.current;
    const pnlContainer = pnlContainerRef.current;
    const posContainer = posContainerRef.current;
    if (priceContainer === null || pnlContainer === null || posContainer === null) {
      return;
    }

    const isDark = colorScheme === 'dark';
    const layout = {
      background: { type: ColorType.Solid, color: isDark ? '#0d1117' : '#ffffff' },
      textColor: isDark ? '#c9d1d9' : '#1f2937',
      attributionLogo: false,
    };
    const borderColor = isDark ? '#30363d' : '#d0d7de';
    const gridColor = isDark ? '#21262d' : '#e5e7eb';

    const sharedOptions = {
      autoSize: true,
      layout,
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor,
      },
      leftPriceScale: {
        visible: false,
      },
      localization: {
        locale: 'en-US',
        dateFormat: 'dd MMM yyyy',
        timeFormatter: formatChartTime,
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: true,
        minBarSpacing: 0.02,
        rightOffset: 4,
        tickMarkFormatter: formatChartTime,
      },
      handleScroll: true,
      handleScale: true,
    } as const;

    const priceChart = createChart(priceContainer, {
      ...sharedOptions,
      height: priceContainer.clientHeight || 480,
    });
    const pnlChart = createChart(pnlContainer, {
      ...sharedOptions,
      height: pnlContainer.clientHeight || 180,
    });
    const posChart = createChart(posContainer, {
      ...sharedOptions,
      height: posContainer.clientHeight || 180,
    });

    priceChartRef.current = priceChart;
    pnlChartRef.current = pnlChart;
    posChartRef.current = posChart;

    priceSeriesRefs.current['bid-1'] = priceChart.addSeries(LineSeries, {
      color: getBidColor(1.0),
      lineWidth: 1,
      title: 'Bid 1',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['bid-2'] = priceChart.addSeries(LineSeries, {
      color: getBidColor(0.75),
      lineWidth: 1,
      title: 'Bid 2',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['bid-3'] = priceChart.addSeries(LineSeries, {
      color: getBidColor(0.5),
      lineWidth: 1,
      title: 'Bid 3',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['ask-1'] = priceChart.addSeries(LineSeries, {
      color: getAskColor(1.0),
      lineWidth: 1,
      title: 'Ask 1',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['ask-2'] = priceChart.addSeries(LineSeries, {
      color: getAskColor(0.75),
      lineWidth: 1,
      title: 'Ask 2',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['ask-3'] = priceChart.addSeries(LineSeries, {
      color: getAskColor(0.5),
      lineWidth: 1,
      title: 'Ask 3',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['mid-price'] = priceChart.addSeries(LineSeries, {
      color: isDark ? '#cbd5e1' : '#64748b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: 'Mid price',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeriesRefs.current['fair-price'] = priceChart.addSeries(LineSeries, {
      color: '#60a5fa',
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      title: 'Fair price',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    markerAnchorSeriesRef.current = priceChart.addSeries(LineSeries, {
      color: 'rgba(0, 0, 0, 0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    markerPluginRef.current = createSeriesMarkers(markerAnchorSeriesRef.current, []);
    triangleMarkerPrimitiveRef.current = new TriangleMarkerPrimitive();
    markerAnchorSeriesRef.current.attachPrimitive(triangleMarkerPrimitiveRef.current);

    pnlSeriesRef.current = pnlChart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topFillColor1: 'rgba(34, 197, 94, 0.22)',
      topFillColor2: 'rgba(34, 197, 94, 0.05)',
      topLineColor: '#22c55e',
      bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.22)',
      bottomLineColor: '#ef4444',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'PnL',
    });

    positionSeriesRef.current = posChart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topFillColor1: 'rgba(34, 197, 94, 0.22)',
      topFillColor2: 'rgba(34, 197, 94, 0.05)',
      topLineColor: '#22c55e',
      bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.22)',
      bottomLineColor: '#ef4444',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'Position',
    });
    positionZeroSeriesRef.current = posChart.addSeries(LineSeries, {
      color: isDark ? '#64748b' : '#94a3b8',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const syncVisibleRange = (source: IChartApi, targets: IChartApi[]): void => {
      source.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range === null || rangeSyncingRef.current) {
          return;
        }

        rangeSyncingRef.current = true;
        targets.forEach(target => target.timeScale().setVisibleLogicalRange(range));
        rangeSyncingRef.current = false;
      });
    };

    syncVisibleRange(priceChart, [pnlChart, posChart]);
    syncVisibleRange(pnlChart, [priceChart, posChart]);
    syncVisibleRange(posChart, [priceChart, pnlChart]);

    const updateTooltip = (timestamp: number | null): void => {
      if (timestamp === null) {
        setTooltip(null);
        return;
      }

      const row = derivedData.rowByTimestamp.get(timestamp);
      const lines = createTooltipLines(
        row,
        derivedData.fairByTimestamp.get(timestamp),
        visibleSeriesIdsRef.current,
        derivedData.markerTooltipByTimestamp.get(timestamp) || [],
        marketTradeVolumeFilterRef.current,
      );

      setTooltip({
        timestamp,
        lines,
      });
    };

    const clearSyncedCrosshair = (targets: IChartApi[]): void => {
      crosshairSyncingRef.current = true;
      targets.forEach(target => target.clearCrosshairPosition());
      crosshairSyncingRef.current = false;
    };

    const syncCrosshair =
      (
        targets: {
          chart: IChartApi;
          series: ISeriesApi<'Line'> | ISeriesApi<'Baseline'>;
          valueAt: (time: number) => number | undefined;
        }[],
      ): MouseEventHandler<ChartTime> =>
      param => {
        if (crosshairSyncingRef.current) {
          return;
        }

        const timestamp = getNumericTime(param.time);
        updateTooltip(timestamp);

        if (timestamp === null || param.point === undefined) {
          clearSyncedCrosshair(targets.map(target => target.chart));
          return;
        }

        crosshairSyncingRef.current = true;
        targets.forEach(target => {
          const value = target.valueAt(timestamp);
          if (value === undefined) {
            target.chart.clearCrosshairPosition();
            return;
          }

          target.chart.setCrosshairPosition(value, toChartTime(timestamp), target.series);
        });
        crosshairSyncingRef.current = false;
      };

    const priceCrosshairHandler = syncCrosshair([
      {
        chart: pnlChart,
        series: pnlSeriesRef.current!,
        valueAt: time => derivedData.pnlByTimestamp.get(time),
      },
      {
        chart: posChart,
        series: positionSeriesRef.current!,
        valueAt: time => derivedData.positionByTimestamp.get(time),
      },
    ]);

    const pnlCrosshairHandler = syncCrosshair([
      {
        chart: priceChart,
        series: priceSeriesRefs.current['mid-price']!,
        valueAt: time => getMidPriceForChart(derivedData.rowByTimestamp.get(time)),
      },
      {
        chart: posChart,
        series: positionSeriesRef.current!,
        valueAt: time => derivedData.positionByTimestamp.get(time),
      },
    ]);

    const positionCrosshairHandler = syncCrosshair([
      {
        chart: priceChart,
        series: priceSeriesRefs.current['mid-price']!,
        valueAt: time => getMidPriceForChart(derivedData.rowByTimestamp.get(time)),
      },
      {
        chart: pnlChart,
        series: pnlSeriesRef.current!,
        valueAt: time => derivedData.pnlByTimestamp.get(time),
      },
    ]);

    priceChart.subscribeCrosshairMove(priceCrosshairHandler);
    pnlChart.subscribeCrosshairMove(pnlCrosshairHandler);
    posChart.subscribeCrosshairMove(positionCrosshairHandler);

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const target = entry.target;
        if (target === priceContainer) {
          priceChart.resize(priceContainer.clientWidth, priceContainer.clientHeight);
        } else if (target === pnlContainer) {
          pnlChart.resize(pnlContainer.clientWidth, pnlContainer.clientHeight);
        } else if (target === posContainer) {
          posChart.resize(posContainer.clientWidth, posContainer.clientHeight);
        }
      }
    });

    resizeObserver.observe(priceContainer);
    resizeObserver.observe(pnlContainer);
    resizeObserver.observe(posContainer);

    return () => {
      resizeObserver.disconnect();
      priceChart.unsubscribeCrosshairMove(priceCrosshairHandler);
      pnlChart.unsubscribeCrosshairMove(pnlCrosshairHandler);
      posChart.unsubscribeCrosshairMove(positionCrosshairHandler);
      markerPluginRef.current?.detach();
      if (markerAnchorSeriesRef.current !== null && triangleMarkerPrimitiveRef.current !== null) {
        markerAnchorSeriesRef.current.detachPrimitive(triangleMarkerPrimitiveRef.current);
      }
      priceChart.remove();
      pnlChart.remove();
      posChart.remove();
      priceChartRef.current = null;
      pnlChartRef.current = null;
      posChartRef.current = null;
      markerPluginRef.current = null;
      triangleMarkerPrimitiveRef.current = null;
      markerAnchorSeriesRef.current = null;
      pnlSeriesRef.current = null;
      positionSeriesRef.current = null;
      positionZeroSeriesRef.current = null;
      priceSeriesRefs.current = {
        'bid-1': null,
        'bid-2': null,
        'bid-3': null,
        'ask-1': null,
        'ask-2': null,
        'ask-3': null,
        'mid-price': null,
        'fair-price': null,
      };
      setTooltip(null);
    };
  }, [colorScheme, derivedData]);

  useEffect(() => {
    priceSeriesRefs.current['bid-1']?.setData(derivedData.bid1Data);
    priceSeriesRefs.current['bid-2']?.setData(derivedData.bid2Data);
    priceSeriesRefs.current['bid-3']?.setData(derivedData.bid3Data);
    priceSeriesRefs.current['ask-1']?.setData(derivedData.ask1Data);
    priceSeriesRefs.current['ask-2']?.setData(derivedData.ask2Data);
    priceSeriesRefs.current['ask-3']?.setData(derivedData.ask3Data);
    priceSeriesRefs.current['mid-price']?.setData(derivedData.midData);
    priceSeriesRefs.current['fair-price']?.setData(derivedData.fairData);
    markerAnchorSeriesRef.current?.setData(derivedData.midData);
    pnlSeriesRef.current?.setData(derivedData.pnlData);
    positionSeriesRef.current?.setData(derivedData.positionData);
    positionZeroSeriesRef.current?.setData(derivedData.zeroLineData);

    if (priceChartRef.current !== null) {
      priceChartRef.current.timeScale().fitContent();
      const range = priceChartRef.current.timeScale().getVisibleLogicalRange();
      if (range !== null) {
        pnlChartRef.current?.timeScale().setVisibleLogicalRange(range);
        posChartRef.current?.timeScale().setVisibleLogicalRange(range);
      }
    } else {
      pnlChartRef.current?.timeScale().fitContent();
      posChartRef.current?.timeScale().fitContent();
    }
  }, [derivedData]);

  useEffect(() => {
    const visibleIds = new Set(visibleSeriesIds as SeriesId[]);
    if (!shouldPlotMidPrice) {
      visibleIds.delete('mid-price');
    }

    (Object.entries(priceSeriesRefs.current) as [PriceLineSeriesId, ISeriesApi<'Line'> | null][]).forEach(
      ([id, series]) => {
        series?.applyOptions({ visible: visibleIds.has(id) });
      },
    );

    markerPluginRef.current?.setMarkers(
      derivedData.allMarkers
        .filter(entry => visibleIds.has(entry.filterId))
        .filter(entry => {
          if (!isMarketTradeSeries(entry.filterId)) {
            return true;
          }

          return matchesMarketTradeVolumeFilter(entry.quantity, marketTradeVolumeFilter);
        })
        .map(entry => entry.marker),
    );
    triangleMarkerPrimitiveRef.current?.setMarkers(
      derivedData.triangleMarkers.filter(entry => visibleIds.has(entry.filterId)),
    );
  }, [derivedData, marketTradeVolumeFilter, shouldPlotMidPrice, visibleSeriesIds]);

  return (
    <Grid align="flex-start">
      <Grid.Col span={12}>
        <VisualizerCard title="Price Plot Filter">
          <Checkbox.Group value={visibleSeriesIds} onChange={setVisibleSeriesIds}>
            <Box
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'stretch',
                gap: 8,
              }}
            >
              {availableSeriesOptions.map(option => (
                <Box key={option.id} style={{ flex: '0 0 auto' }}>
                  <Box
                    px="xs"
                    py={6}
                    style={{
                      border: '1px solid var(--mantine-color-default-border)',
                      borderRadius: 6,
                      minWidth: 96,
                    }}
                  >
                    <Stack gap={4} align="center">
                      <Text size="xs" fw={500} ta="center" style={{ lineHeight: 1.1 }}>
                        {option.label}
                      </Text>
                      <Checkbox value={option.id} aria-label={option.label} />
                    </Stack>
                  </Box>
                </Box>
              ))}
            </Box>
          </Checkbox.Group>
          <Text size="sm" fw={600} mt="md" mb={6}>
            Bot Trade Volume Filter
          </Text>
          <Stack gap="xs">
            <TextInput
              label="Exact volume"
              placeholder="e.g. 5"
              value={exactMarketTradeVolume}
              onChange={event => setExactMarketTradeVolume(event.currentTarget.value)}
            />
            <TextInput
              label="Min volume"
              placeholder="e.g. 1"
              value={minMarketTradeVolume}
              onChange={event => setMinMarketTradeVolume(event.currentTarget.value)}
              disabled={parseVolumeInput(exactMarketTradeVolume) !== undefined}
            />
            <TextInput
              label="Max volume"
              placeholder="e.g. 20"
              value={maxMarketTradeVolume}
              onChange={event => setMaxMarketTradeVolume(event.currentTarget.value)}
              disabled={parseVolumeInput(exactMarketTradeVolume) !== undefined}
            />
            <Text size="xs" c="dimmed">
              Exact volume overrides range. Applies to Market Trade Buy/Sell markers only.
            </Text>
          </Stack>
        </VisualizerCard>
      </Grid.Col>
      <Grid.Col span={12}>
        <VisualizerCard p={0}>
          <Box p="md" pb="xs">
            <Text fw={600} size="sm">
              {symbol} - Price, PnL, Position
            </Text>
          </Box>
          <Box px="md" pb="md">
            <Box style={{ position: 'relative' }}>
              <Box ref={priceContainerRef} style={{ height: '60vh', minHeight: 360 }} />
              {tooltip && (
                <Box
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    minWidth: 220,
                    maxWidth: 320,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: colorScheme === 'dark' ? 'rgba(13, 17, 23, 0.92)' : 'rgba(255, 255, 255, 0.94)',
                    border: `1px solid ${colorScheme === 'dark' ? '#30363d' : '#d0d7de'}`,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                >
                  <Text fw={700} size="sm" mb={6}>
                    Timestamp {formatNumber(tooltip.timestamp)}
                  </Text>
                  {tooltip.lines.length === 0 && (
                    <Text size="xs" c="dimmed">
                      No visible series at this timestamp
                    </Text>
                  )}
                  <Stack gap={4}>
                    {tooltip.lines.map((line, index) => (
                      <Text key={`${line.key}-${index}`} size="xs">
                        <span style={{ color: line.color }}>{line.label}</span>: {line.value}
                      </Text>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
            <Box mt="sm">
              <Text size="sm" fw={500} mb={4}>
                PnL
              </Text>
              <Box ref={pnlContainerRef} style={{ height: '20vh', minHeight: 140 }} />
            </Box>
            <Box mt="sm">
              <Text size="sm" fw={500} mb={4}>
                Position
              </Text>
              <Box ref={posContainerRef} style={{ height: '20vh', minHeight: 140 }} />
            </Box>
          </Box>
        </VisualizerCard>
      </Grid.Col>
    </Grid>
  );
}

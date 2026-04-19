import { Text } from '@mantine/core';
import { ReactNode } from 'react';
import {
  ActivityLogRow,
  Algorithm,
  AlgorithmDataRow,
  AlgorithmSummary,
  CompressedAlgorithmDataRow,
  CompressedListing,
  CompressedObservations,
  CompressedOrder,
  CompressedOrderDepth,
  CompressedTrade,
  CompressedTradingState,
  ConversionObservation,
  Listing,
  Observation,
  Order,
  OrderDepth,
  Product,
  ProsperitySymbol,
  Trade,
  TradingState,
} from '../models.ts';
import { authenticatedAxios } from './axios.ts';

export class AlgorithmParseError extends Error {
  public constructor(public readonly node: ReactNode) {
    super('Failed to parse algorithm logs');
  }
}

interface Prosperity4LogEntry {
  sandboxLog?: string;
  lambdaLog?: string;
  timestamp?: number;
}

interface Prosperity4TradeHistoryEntry {
  buyer?: string;
  price?: number;
  quantity?: number;
  seller?: string;
  symbol?: string;
  timestamp?: number;
}

interface Prosperity4LogFile {
  activitiesLog?: string;
  logs?: Prosperity4LogEntry[];
  graphLog?: string;
  positions?: unknown;
  tradeHistory?: Prosperity4TradeHistoryEntry[];
}

function getColumnValues(columns: string[], indices: number[]): number[] {
  const values: number[] = [];

  for (const index of indices) {
    const value = columns[index];
    if (value !== '') {
      values.push(parseFloat(value));
    }
  }

  return values;
}

function parseActivityLogLines(lines: string[]): ActivityLogRow[] {
  const rows: ActivityLogRow[] = [];
  let started = false;

  for (const line of lines) {
    if (line === '') {
      if (started) {
        break;
      }

      continue;
    }

    if (line === 'Activities log:') {
      continue;
    }

    if (line.startsWith('day;timestamp;product;')) {
      started = true;
      continue;
    }

    if (!started) {
      if (!/^[-\d]+;/.test(line)) {
        continue;
      }

      started = true;
    }

    const columns = line.split(';');
    if (columns.length < 17) {
      continue;
    }

    rows.push({
      day: Number(columns[0]),
      timestamp: Number(columns[1]),
      product: columns[2],
      bidPrices: getColumnValues(columns, [3, 5, 7]),
      bidVolumes: getColumnValues(columns, [4, 6, 8]),
      askPrices: getColumnValues(columns, [9, 11, 13]),
      askVolumes: getColumnValues(columns, [10, 12, 14]),
      midPrice: Number(columns[15]),
      profitLoss: Number(columns[16]),
    });
  }

  return rows;
}

function getActivityLogs(logLines: string[]): ActivityLogRow[] {
  const headerIndex = logLines.indexOf('Activities log:');
  if (headerIndex === -1) {
    return [];
  }

  return parseActivityLogLines(logLines.slice(headerIndex + 1));
}

function decompressListings(compressed: CompressedListing[]): Record<ProsperitySymbol, Listing> {
  const listings: Record<ProsperitySymbol, Listing> = {};

  for (const [symbol, product, denomination] of compressed) {
    listings[symbol] = {
      symbol,
      product,
      denomination,
    };
  }

  return listings;
}

function decompressOrderDepths(
  compressed: Record<ProsperitySymbol, CompressedOrderDepth>,
): Record<ProsperitySymbol, OrderDepth> {
  const orderDepths: Record<ProsperitySymbol, OrderDepth> = {};

  for (const [symbol, [buyOrders, sellOrders]] of Object.entries(compressed)) {
    orderDepths[symbol] = {
      buyOrders,
      sellOrders,
    };
  }

  return orderDepths;
}

function decompressTrades(compressed: CompressedTrade[]): Record<ProsperitySymbol, Trade[]> {
  const trades: Record<ProsperitySymbol, Trade[]> = {};

  for (const [symbol, price, quantity, buyer, seller, timestamp] of compressed) {
    if (trades[symbol] === undefined) {
      trades[symbol] = [];
    }

    trades[symbol].push({
      symbol,
      price,
      quantity,
      buyer,
      seller,
      timestamp,
    });
  }

  return trades;
}

function decompressObservations(compressed: CompressedObservations): Observation {
  const conversionObservations: Record<Product, ConversionObservation> = {};

  for (const [
    product,
    [bidPrice, askPrice, transportFees, exportTariff, importTariff, sugarPrice, sunlightIndex],
  ] of Object.entries(compressed[1])) {
    conversionObservations[product] = {
      bidPrice,
      askPrice,
      transportFees,
      exportTariff,
      importTariff,
      sugarPrice,
      sunlightIndex,
    };
  }

  return {
    plainValueObservations: compressed[0],
    conversionObservations,
  };
}

function decompressState(compressed: CompressedTradingState): TradingState {
  return {
    timestamp: compressed[0],
    traderData: compressed[1],
    listings: decompressListings(compressed[2]),
    orderDepths: decompressOrderDepths(compressed[3]),
    ownTrades: decompressTrades(compressed[4]),
    marketTrades: decompressTrades(compressed[5]),
    position: compressed[6],
    observations: decompressObservations(compressed[7]),
  };
}

function decompressOrders(compressed: CompressedOrder[]): Record<ProsperitySymbol, Order[]> {
  const orders: Record<ProsperitySymbol, Order[]> = {};

  for (const [symbol, price, quantity] of compressed) {
    if (orders[symbol] === undefined) {
      orders[symbol] = [];
    }

    orders[symbol].push({
      symbol,
      price,
      quantity,
    });
  }

  return orders;
}

function decompressDataRow(compressed: CompressedAlgorithmDataRow, sandboxLogs: string): AlgorithmDataRow {
  return {
    state: decompressState(compressed[0]),
    orders: decompressOrders(compressed[1]),
    conversions: compressed[2],
    traderData: compressed[3],
    algorithmLogs: compressed[4],
    sandboxLogs,
  };
}

function parseCompressedDataRow(compressed: string, sandboxLogs: string): AlgorithmDataRow {
  try {
    return decompressDataRow(JSON.parse(compressed), sandboxLogs.trim());
  } catch (err) {
    console.log(compressed);
    console.error(err);

    throw new AlgorithmParseError(
      (
        <>
          <Text>Logs are in invalid format. Could not parse the following row:</Text>
          <Text>{compressed}</Text>
        </>
      ),
    );
  }
}

function getAlgorithmData(logLines: string[]): AlgorithmDataRow[] {
  const headerIndex = logLines.indexOf('Sandbox logs:');
  if (headerIndex === -1) {
    return [];
  }

  const rows: AlgorithmDataRow[] = [];
  let nextSandboxLogs = '';

  const sandboxLogPrefix = '  "sandboxLog": ';
  const lambdaLogPrefix = '  "lambdaLog": ';

  for (let i = headerIndex + 1; i < logLines.length; i++) {
    const line = logLines[i];
    if (line.endsWith(':')) {
      break;
    }

    if (line.startsWith(sandboxLogPrefix)) {
      nextSandboxLogs = JSON.parse(line.substring(sandboxLogPrefix.length, line.length - 1)).trim();

      if (nextSandboxLogs.startsWith('Conversion request')) {
        const lastRow = rows[rows.length - 1];
        lastRow.sandboxLogs += (lastRow.sandboxLogs.length > 0 ? '\n' : '') + nextSandboxLogs;

        nextSandboxLogs = '';
      }

      continue;
    }

    if (!line.startsWith(lambdaLogPrefix) || line === '  "lambdaLog": "",') {
      continue;
    }

    const start = line.indexOf('[[');
    const end = line.lastIndexOf(']') + 1;

    try {
      const compressed = JSON.parse('"' + line.substring(start, end) + '"');
      rows.push(parseCompressedDataRow(compressed, nextSandboxLogs));
    } catch {
      throw new AlgorithmParseError(
        (
          <>
            <Text>Logs are in invalid format. Could not parse the following line:</Text>
            <Text>{line}</Text>
          </>
        ),
      );
    }
  }

  return rows;
}

function isProsperity4LogFile(value: unknown): value is Prosperity4LogFile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAlgorithmDataFromProsperity4Logs(logEntries: Prosperity4LogEntry[]): AlgorithmDataRow[] {
  const rows: AlgorithmDataRow[] = [];

  for (const entry of logEntries) {
    if (typeof entry.lambdaLog !== 'string' || entry.lambdaLog.trim() === '') {
      continue;
    }

    rows.push(parseCompressedDataRow(entry.lambdaLog, entry.sandboxLog || ''));
  }

  return rows;
}

function parseTradeHistory(entries: Prosperity4TradeHistoryEntry[] | undefined): Trade[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter(
      entry =>
        typeof entry.symbol === 'string' &&
        typeof entry.price === 'number' &&
        typeof entry.quantity === 'number' &&
        typeof entry.timestamp === 'number',
    )
    .map(entry => ({
      symbol: entry.symbol!,
      price: entry.price!,
      quantity: entry.quantity!,
      buyer: entry.buyer || '',
      seller: entry.seller || '',
      timestamp: entry.timestamp!,
    }));
}

function getAlgorithmFromProsperity4LogFile(
  logFile: Prosperity4LogFile,
  summary?: AlgorithmSummary,
  sourceLogFileName?: string,
): Algorithm {
  const activityLogs =
    typeof logFile.activitiesLog === 'string' ? parseActivityLogLines(logFile.activitiesLog.trim().split(/\r?\n/)) : [];

  if (!Array.isArray(logFile.logs)) {
    throw new AlgorithmParseError(
      (
        <Text>
          This file only contains summary data. Please upload the Prosperity 4 exported <code>.log</code> file that
          includes per-timestamp logs.
        </Text>
      ),
    );
  }

  const data = getAlgorithmDataFromProsperity4Logs(logFile.logs);

  if (activityLogs.length === 0 || data.length === 0) {
    throw new AlgorithmParseError(
      /* prettier-ignore */
      <Text>Logs are in invalid format.</Text>,
    );
  }

  return {
    summary,
    sourceLogFileName,
    activityLogs,
    data,
    marketTradeHistory: parseTradeHistory(logFile.tradeHistory),
  };
}

export function parseAlgorithmLogs(logs: string, summary?: AlgorithmSummary, sourceLogFileName?: string): Algorithm {
  const resolvedSourceLogFileName = sourceLogFileName || summary?.fileName;

  try {
    const parsedLogs = JSON.parse(logs);
    if (isProsperity4LogFile(parsedLogs) && typeof parsedLogs.activitiesLog === 'string') {
      return getAlgorithmFromProsperity4LogFile(parsedLogs, summary, resolvedSourceLogFileName);
    }
  } catch {
    // Fall back to the legacy text log parser below.
  }

  const logLines = logs.trim().split(/\r?\n/);

  const activityLogs = getActivityLogs(logLines);
  const data = getAlgorithmData(logLines);

  if (activityLogs.length === 0 && data.length === 0) {
    throw new AlgorithmParseError(
      (
        <Text>
          Logs are empty, either something went wrong with your submission or your backtester logs in a different format
          than Prosperity&apos;s submission environment.
        </Text>
      ),
    );
  }

  if (activityLogs.length === 0 || data.length === 0) {
    throw new AlgorithmParseError(
      /* prettier-ignore */
      <Text>Logs are in invalid format.</Text>,
    );
  }

  return {
    summary,
    sourceLogFileName: resolvedSourceLogFileName,
    activityLogs,
    data,
    marketTradeHistory: [],
  };
}

export async function getAlgorithmLogsUrl(algorithmId: string): Promise<string> {
  const urlResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/submission/logs/${algorithmId}`,
  );

  return urlResponse.data;
}

function downloadFile(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = new URL(url).pathname.split('/').pop()!;
  link.target = '_blank';
  link.rel = 'noreferrer';

  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadAlgorithmLogs(algorithmId: string): Promise<void> {
  const logsUrl = await getAlgorithmLogsUrl(algorithmId);
  downloadFile(logsUrl);
}

export async function downloadAlgorithmResults(algorithmId: string): Promise<void> {
  const detailsResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/results/tutorial/${algorithmId}`,
  );

  downloadFile(detailsResponse.data.algo.summary.activitiesLog);
}

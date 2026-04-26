import { Table } from '@mantine/core';
import { ReactNode } from 'react';
import { ProsperitySymbol, Trade } from '../../models.ts';
import { getAskColor, getBidColor } from '../../utils/colors.ts';
import { formatNumber } from '../../utils/format.ts';
import { SimpleTable } from './SimpleTable.tsx';

export interface TradesTableProps {
  trades: Record<ProsperitySymbol, Trade[]>;
  buyerFilter?: string;
  sellerFilter?: string;
}

function extractBuyerId(buyer: string): string {
  const match = buyer.match(/\d+$/);
  return match ? match[0] : '';
}

function extractSellerId(seller: string): string {
  const match = seller.match(/\d+$/);
  return match ? match[0] : '';
}

function matchesFilter(value: string, filter: string): boolean {
  if (filter.trim().length === 0) {
    return true;
  }

  return value.includes(filter);
}

export function TradesTable({ trades, buyerFilter = '', sellerFilter = '' }: TradesTableProps): ReactNode {
  const rows: ReactNode[] = [];
  for (const symbol of Object.keys(trades).sort((a, b) => a.localeCompare(b))) {
    for (let i = 0; i < trades[symbol].length; i++) {
      const trade = trades[symbol][i];

      const buyerId = extractBuyerId(trade.buyer);
      const sellerId = extractSellerId(trade.seller);

      if (!matchesFilter(buyerId, buyerFilter) || !matchesFilter(sellerId, sellerFilter)) {
        continue;
      }

      let color: string;
      if (trade.buyer === 'SUBMISSION') {
        color = getBidColor(0.1);
      } else if (trade.seller === 'SUBMISSION') {
        color = getAskColor(0.1);
      } else {
        color = 'transparent';
      }

      rows.push(
        <Table.Tr key={`${symbol}-${i}`} style={{ backgroundColor: color }}>
          <Table.Td>{trade.symbol}</Table.Td>
          <Table.Td>{trade.buyer}</Table.Td>
          <Table.Td>{trade.seller}</Table.Td>
          <Table.Td>{formatNumber(trade.price)}</Table.Td>
          <Table.Td>{formatNumber(trade.quantity)}</Table.Td>
          <Table.Td>{formatNumber(trade.timestamp)}</Table.Td>
        </Table.Tr>,
      );
    }
  }

  return (
    <SimpleTable label="trades" columns={['Symbol', 'Buyer', 'Seller', 'Price', 'Quantity', 'Timestamp']} rows={rows} />
  );
}

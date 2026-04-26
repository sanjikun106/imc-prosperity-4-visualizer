import { Stack, Table, TextInput } from '@mantine/core';
import { ReactNode, useState } from 'react';
import { ProsperitySymbol, Trade } from '../../models.ts';
import { getAskColor, getBidColor } from '../../utils/colors.ts';
import { formatNumber } from '../../utils/format.ts';
import { SimpleTable } from './SimpleTable.tsx';

export interface TradesTableProps {
  trades: Record<ProsperitySymbol, Trade[]>;
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

export function TradesTable({ trades }: TradesTableProps): ReactNode {
  const [buyerFilter, setBuyerFilter] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');

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
    <>
      <Stack gap="xs" mb="md">
        <TextInput
          label="Filter by Buyer"
          placeholder="e.g. 14"
          value={buyerFilter}
          onChange={event => setBuyerFilter(event.currentTarget.value)}
        />
        <TextInput
          label="Filter by Seller"
          placeholder="e.g. 38"
          value={sellerFilter}
          onChange={event => setSellerFilter(event.currentTarget.value)}
        />
      </Stack>
      <SimpleTable
        label="trades"
        columns={['Symbol', 'Buyer', 'Seller', 'Price', 'Quantity', 'Timestamp']}
        rows={rows}
      />
    </>
  );
}

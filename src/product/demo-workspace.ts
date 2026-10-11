import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const cartSource = `export interface Item { price: number; quantity: number }
export function total(items: Item[], discount = 0): number {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal + discount;
}
`;
export async function createDemoWorkspace(directory: string, variant = 0): Promise<string> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'cart.ts'), cartSource, 'utf8');
  const price = [12, 19.99, 5, 100, 0.25][variant % 5] ?? 12;
  const quantity = [3, 2, 7, 4, 8][variant % 5] ?? 3;
  const discount = [0.1, 0.2, 0.5, 0.25, 0.15][variant % 5] ?? 0.1;
  const expected = Math.round(price * quantity * (1 - discount) * 100) / 100;
  await writeFile(path.join(directory, 'cart.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from './cart.ts';
test('quantity: includes every item', () => assert.equal(total([{ price: ${price}, quantity: ${quantity} }]), ${price * quantity}));
test('discount: reduces the subtotal', () => assert.equal(total([{ price: ${price}, quantity: ${quantity} }], ${discount}), ${expected}));
test('empty cart', () => assert.equal(total([]), 0));
`, 'utf8');
  return directory;
}

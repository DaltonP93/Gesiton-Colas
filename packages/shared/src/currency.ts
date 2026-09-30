/* Monedas y montos (se guardan en la unidad mínima: guaraníes, centavos…). */

export const CURRENCIES = ['PYG', 'USD', 'ARS', 'BRL', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Decimales de cada moneda (los montos se guardan en la unidad mínima: guaraníes, centavos…). */
export const CURRENCY_DECIMALS: Record<Currency, number> = { PYG: 0, USD: 2, ARS: 2, BRL: 2, EUR: 2 };

export const toMinor = (major: number, currency: Currency) => Math.round(major * 10 ** CURRENCY_DECIMALS[currency]);
export const fromMinor = (minor: number, currency: Currency) => minor / 10 ** CURRENCY_DECIMALS[currency];

/** «Gs. 50.000», «US$ 12,50». */
export function formatMoney(minor: number, currency: Currency, locale = 'es-PY'): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const value = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(fromMinor(minor, currency));
  const symbol: Record<Currency, string> = { PYG: 'Gs.', USD: 'US$', ARS: 'AR$', BRL: 'R$', EUR: '€' };
  return `${symbol[currency]} ${value}`;
}

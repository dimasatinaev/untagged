/**
 * Currency-aware money formatting, shared by every surface that shows amounts
 * (dashboard, service breakdown, explorer, Markdown report).
 *
 * - Known single currency -> Intl currency formatting ("€1,234.56")
 * - No currency column     -> plain amounts, no symbol, with a disclosure note
 * - Mixed currencies       -> the UI must never reach this formatter; the
 *                             report is refused upstream
 */

export interface MoneyContext {
  /** normalized code (e.g. "USD") or null when no currency was provided */
  currency: string | null;
  fmt: (n: number) => string;
}

function isLikelyCode(c: string): boolean {
  return /^[A-Z]{3}$/.test(c);
}

export function makeMoneyContext(currencies: string[]): MoneyContext {
  const currency = currencies.length === 1 ? currencies[0] : null;

  if (currency && isLikelyCode(currency)) {
    let nf: Intl.NumberFormat;
    try {
      nf = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return plainContext(currency);
    }
    const small = nf.format(0.01);
    return {
      currency,
      fmt: (n: number) => {
        if (n !== 0 && Math.abs(n) < 0.01) return `<${small}`;
        return nf.format(n);
      },
    };
  }

  return plainContext(currency);
}

function plainContext(currency: string | null): MoneyContext {
  // unknown/absent currency: show bare amounts — a wrong symbol is worse
  const suffix = currency ? ` ${currency}` : '';
  return {
    currency,
    fmt: (n: number) => {
      if (n !== 0 && Math.abs(n) < 0.01) return `<0.01${suffix}`;
      return (
        n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix
      );
    },
  };
}

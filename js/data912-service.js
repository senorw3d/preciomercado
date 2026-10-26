/**
 * DATA912 LIVE MARKET DATA SERVICE (OPEN ARGENTINE FINANCIAL FEED)
 * Free, real-time public market quotes for Argentine Corporate Bonds (ONs),
 * Sovereign Bonds, and FX (Dólar MEP & CCL).
 * Powered by https://data912.com
 */

export class Data912Service {
  constructor() {
    this.corpEndpoint = 'https://data912.com/live/arg_corp';
    this.bondsEndpoint = 'https://data912.com/live/arg_bonds';
    this.lastSync = null;
    this.quotesMap = new Map();
    this.isSyncing = false;
    this.autoRefreshTimer = null;
  }

  /**
   * Fetches real-time quotes for Argentine Corporate Bonds (ONs)
   */
  async fetchCorporateBondsQuotes() {
    try {
      const response = await fetch(this.corpEndpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Data912 error HTTP ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        try {
          localStorage.setItem('cached_arg_corp_quotes', JSON.stringify(data));
        } catch (_) {}
        return data;
      }
      return [];
    } catch (err) {
      console.warn('[Data912] Fallback to cached corporate quotes:', err.message);
      try {
        const cached = localStorage.getItem('cached_arg_corp_quotes');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
  }

  /**
   * Fetches real-time quotes for Argentine Sovereign Bonds
   */
  async fetchSovereignBondsQuotes() {
    try {
      const response = await fetch(this.bondsEndpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Data912 error HTTP ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        try {
          localStorage.setItem('cached_arg_sov_quotes', JSON.stringify(data));
        } catch (_) {}
        return data;
      }
      return [];
    } catch (err) {
      console.warn('[Data912] Fallback to cached sovereign quotes:', err.message);
      try {
        const cached = localStorage.getItem('cached_arg_sov_quotes');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
  }

  /**
   * Fetches benchmark FX rates (MEP and CCL) from DolarApi & Data912
   */
  async fetchBenchmarkFx() {
    let mep = 1545.0;
    let ccl = 1560.0;
    let oficial = 1010.0;

    try {
      const res = await fetch('https://dolarapi.com/v1/dolares');
      if (res.ok) {
        const rates = await res.json();
        const mepObj = rates.find(r => r.casa === 'bolsa');
        const cclObj = rates.find(r => r.casa === 'contadoconliqui');
        const ofiObj = rates.find(r => r.casa === 'oficial');
        if (mepObj?.venta) mep = mepObj.venta;
        if (cclObj?.venta) ccl = cclObj.venta;
        if (ofiObj?.venta) oficial = ofiObj.venta;
      }
    } catch (e) {
      console.warn('[Data912] Fallback to default FX rates:', e.message);
    }

    return { mep, ccl, oficial };
  }

  /**
   * Merges real-time Data912 quotes into target bonds dataset
   * @param {Array} bonds 
   * @param {Array} corpQuotes 
   * @param {Array} sovQuotes 
   * @returns {{ updatedCount: number, totalQuotes: number, timestamp: string }}
   */
  applyQuotesToBonds(bonds, corpQuotes = [], sovQuotes = []) {
    const quoteMap = new Map();

    // Populate lookup map by symbol
    corpQuotes.forEach(q => {
      if (q && q.symbol) quoteMap.set(q.symbol.toUpperCase().trim(), q);
    });
    sovQuotes.forEach(q => {
      if (q && q.symbol) quoteMap.set(q.symbol.toUpperCase().trim(), q);
    });

    this.quotesMap = quoteMap;
    let updatedCount = 0;

    const tradingDate = this.lastTradingDate || new Date().toISOString().split('T')[0];

    bonds.forEach(bond => {
      const t = (bond.ticker || '').toUpperCase().trim();
      if (!t) return;

      // 1. Direct match: e.g. "YM34D", "TLCMD", "YMCXD"
      let quote = quoteMap.get(t);

      // 2. If not found, match with suffix based on currency / instrument group
      if (!quote) {
        if (bond.instrumentGroup === 'Hard USD' || bond.instrumentGroup === 'USD MEP' || bond.instrumentGroup === 'USD Cable' || bond.currency === 'USD') {
          if (bond.paymentCurrency === 'Dólar Cable' || bond.law === 'Nueva York') {
            quote = quoteMap.get(`${t}C`) || quoteMap.get(`${t}D`);
          } else {
            quote = quoteMap.get(`${t}D`) || quoteMap.get(`${t}C`);
          }
        } else if (bond.currency === 'ARS') {
          quote = quoteMap.get(`${t}O`) || quoteMap.get(t);
        }
      }

      // 3. Fallback: try stripping trailing D or C or O if base is needed
      if (!quote && (t.endsWith('D') || t.endsWith('C') || t.endsWith('O'))) {
        const base = t.slice(0, -1);
        quote = quoteMap.get(base);
      }

      // Also capture quotes for companion species (MEP, Cable, Pesos)
      const baseTicker = t.replace(/[CDO]$/, '');
      const mepSym = (bond.tickerMEP || `${baseTicker}D`).toUpperCase();
      const cableSym = (bond.tickerCable || `${baseTicker}C`).toUpperCase();
      const pesosSym = (bond.tickerPesos || `${baseTicker}O`).toUpperCase();

      if (quoteMap.has(mepSym)) {
        const qMep = quoteMap.get(mepSym);
        if (typeof qMep.c === 'number' && qMep.c > 0) bond.priceMEP = qMep.c;
        if (typeof qMep.v === 'number' && qMep.v > 0) bond.volumeMEP = qMep.v;
        if (typeof qMep.q_op === 'number' && qMep.q_op > 0) bond.tradesMEP = qMep.q_op;
      }
      if (quoteMap.has(cableSym)) {
        const qCable = quoteMap.get(cableSym);
        if (typeof qCable.c === 'number' && qCable.c > 0) bond.priceCable = qCable.c;
        if (typeof qCable.v === 'number' && qCable.v > 0) bond.volumeCable = qCable.v;
        if (typeof qCable.q_op === 'number' && qCable.q_op > 0) bond.tradesCable = qCable.q_op;
      }
      if (quoteMap.has(pesosSym)) {
        const qPesos = quoteMap.get(pesosSym);
        if (typeof qPesos.c === 'number' && qPesos.c > 0) bond.pricePesos = qPesos.c;
        if (typeof qPesos.v === 'number' && qPesos.v > 0) bond.volumePesos = qPesos.v;
        if (typeof qPesos.q_op === 'number' && qPesos.q_op > 0) bond.tradesPesos = qPesos.q_op;
      }

      if (quote && typeof quote.c === 'number' && quote.c > 0) {
        // MANDATORY ARGENTINE MARKET RULE:
        // In Argentine BYMA / MAE market data, all bond prices quote DIRTY (con cupón corrido incluido).
        // quote.c is STRICTLY the DIRTY traded market price per 100 nominals.
        const marketPrice = quote.c;
        
        bond.dirtyPrice = Number(marketPrice.toFixed(2));
        bond.lastTradePrice = bond.dirtyPrice;
        bond.pctChange = typeof quote.pct_change === 'number' ? quote.pct_change : 0;
        if (typeof quote.v === 'number' && quote.v > 0) {
          bond.volume = quote.v;
        }
        if (typeof quote.q_op === 'number' && quote.q_op > 0) {
          bond.tradesCount = quote.q_op;
        }
        bond.pxBid = quote.px_bid || bond.pxBid || 0;
        bond.pxAsk = quote.px_ask || bond.pxAsk || 0;
        bond.qBid = quote.q_bid || bond.qBid || 0;
        bond.qAsk = quote.q_ask || bond.qAsk || 0;
        bond.isLive = true;
        bond.quoteDate = tradingDate;
        bond.lastUpdated = new Date().toISOString();

        updatedCount++;
      }
    });

    this.lastSync = new Date();
    return {
      updatedCount,
      totalQuotes: quoteMap.size,
      timestamp: this.lastSync.toLocaleTimeString(),
      tradingDate
    };
  }
}

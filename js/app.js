/**
 * HIGH-PERFORMANCE MAIN APP CONTROLLER (TRADING DESK STANDARD)
 * Integrates FinancialMath engine, dataset with real BYMA ONs, multi-dimensional grouping filters,
 * Chart.js Yield Curve, Arbitrage Scanner, Portfolio Manager, and UI controls.
 */

import { FinancialMath } from './financial-math.js?v=1.0.8';
import { BONDS_DATASET, RATINGS_LIST, SECTORS_LIST, RATING_EQUIVALENCE_TABLE } from './data.js?v=1.0.21';
import { MarketApiConnector } from './api.js?v=1.0.6';
import { Data912Service } from './data912-service.js?v=1.0.6';
import { ISINValidator } from './isin-validator.js?v=1.0.5';
import { YieldCurveChart } from './curve-chart.js?v=1.2.0';
import { SquarifiedTreemap } from './treemap.js?v=1.0.2';

class TradingDeskApp {
  constructor() {
    // Desk safety rule: never include or display expired bonds (maturity < today)
    const todayStr = FinancialMath.getSettlementDate('CI') || new Date().toISOString().slice(0, 10);
    
    // Lista de especies pendientes de revisión contra Aviso de Resultados
    // Se excluyen de la vista activa hasta ser revisadas una por una con el usuario
    const UNREVIEWED_TICKERS = new Set([
      // 20 locales pendientes de cotejo
      'NHC1O', 'LR7AO',
      'VWCFO', 'VWCDO', 'CFS9O', 'RC3CO',
      'GN49C', 'GN49D', 'GN49O', 'CP38C', 'CP38D', 'CP38O', 'TSC4C', 'TSC4D', 'TSC4O',
      'PLC5C', 'PLC5D', 'PLC5O', 'BDCKO',
      // 37 internacionales pendientes de cotejo
      'AER1D', 'AER1O', 'AEC2D', 'AEC2O', 'YPC4D', 'YPC4O', 'AER4D', 'AER4O',
      'BYCHD', 'BYCHO', 'BACGD', 'BACGO', 'YMC1D', 'YMC1O', 'RAC5D', 'RAC5O', 'DNC7D', 'DNC7O',
      'RUCDD', 'RUCDO', 'TTCDD', 'TTCDO', 'YMCUD', 'YMCUO', 'BACHD', 'BACHO', 'TLCMD', 'TLCMO',
      'TSC3D', 'TSC3O', 'MGCMD', 'MGCMO', 'PNXCD', 'PNXCO', 'PLC4D', 'PLC4O', 'DNCAD', 'DNCAO',
      'YFCJD', 'YFCJO', 'RAC7D', 'RAC7O', 'TTCAD', 'TTCAO', 'VSCVD', 'VSCVO',
      'RC1CD', 'RC1CO', 'LQC1D', 'LQC1O', 'MGCOD', 'MGCOO', 'TLCTD', 'TLCTO',
      'VSCTD', 'VSCTO', 'VSCXD', 'VSCXO', 'PN43D', 'PN43O', 'MGCRD', 'MGCRO', 'PLC7D', 'PLC7O',
      'YCAND', 'YCANO', 'YCAMD', 'YCAMO'
    ]);

    this.bonds = JSON.parse(JSON.stringify(BONDS_DATASET))
      .filter(b => (!b.maturity || b.maturity >= todayStr))
      .filter(b => !UNREVIEWED_TICKERS.has(b.ticker) && 
                   !UNREVIEWED_TICKERS.has(b.tickerPesos) && 
                   !UNREVIEWED_TICKERS.has(b.tickerMEP) && 
                   !UNREVIEWED_TICKERS.has(b.tickerCable));

    // Ensure all Hard USD bonds follow desk standard:
    // - Grouped in 'Hard USD'
    // - Representative ticker matches payment currency ('C' if Cable, 'D' if MEP)
    // - NO Hard USD bond should ever have an 'O' suffix (O is strictly ARS trading species)
    // - Companion species (Cable, MEP, Pesos) properly assigned
    this.bonds.forEach(b => {
      const isHardUSD = b.instrumentGroup === 'Hard USD' || 
                        b.instrumentGroup === 'USD MEP' || 
                        b.instrumentGroup === 'USD Cable' || 
                        b.paymentCurrency === 'Dólar Cable' || 
                        b.paymentCurrency === 'Dólar MEP' || 
                        (b.currency === 'USD' && !b.instrumentGroup?.includes('Linked') && !b.instrumentGroup?.includes('Pesos'));
      
      if (isHardUSD) {
        b.instrumentGroup = 'Hard USD';
        
        let base = b.ticker.replace(/[CDO]$/i, '');
        
        // If payment currency is Dólar Cable, enforce representative ticker = Cable ticker ('C')
        if (b.paymentCurrency === 'Dólar Cable' || b.law === 'Nueva York') {
          if (b.tickerCable) {
            b.ticker = b.tickerCable;
          } else if (!b.ticker.toUpperCase().endsWith('C')) {
            b.ticker = `${base}C`;
          }
        } else if (b.ticker.toUpperCase().endsWith('O') || (!b.ticker.toUpperCase().endsWith('C') && !b.ticker.toUpperCase().endsWith('D'))) {
          // If ticker ended with 'O' or missing suffix, assign according to payment currency
          b.ticker = b.tickerMEP || `${base}D`;
        }
        
        // Ensure companion species are well defined
        if (!b.tickerCable) b.tickerCable = `${base}C`;
        if (!b.tickerMEP) b.tickerMEP = `${base}D`;
        if (!b.tickerPesos) b.tickerPesos = `${base}O`;
      }
    });

    this.calculatedBonds = [];
    this.settlementMode = 'T+1';

    // Main Control Bar Multi-Grouping State
    this.selectedGroup = 'Inicio';
    this.selectedRatings = null; // null = all selected
    this.selectedCompanies = null; // null = all selected

    this.favorites = this.loadFavorites();
    this.activeView = 'view-table';
    this.rafPending = false;

    // Dedicated Curve View Filters State
    this.curveIssuer = 'Todos';
    this.curveRating = 'Todos';
    this.curveSector = 'Todos';
    this.curveMaturity = 'Todos';

    this.apiConnector = new MarketApiConnector();
    this.data912 = new Data912Service();
    this.autoRefreshEnabled = localStorage.getItem('argen_bonds_autorefresh') !== 'false';
    this.autoRefreshTimer = null;
    this.selectedBondForModal = null;
    this.marketVolumeData = null;
    this.hdCurveCurrency = localStorage.getItem('argen_bonds_hd_curve_curr') || 'ALL'; // 'ALL', 'MEP', 'CABLE'
    this.treemapMode = localStorage.getItem('argen_bonds_treemap_mode') || 'issuer'; // 'issuer' or 'species'

    // Number format locale: 'ar' (1.234,56) or 'us' (1,234.56)
    this.numberLocale = localStorage.getItem('argen_bonds_number_locale') || 'ar';

    // Sorting state
    this.sortCol = null;
    this.sortDir = null; // 'desc', 'asc', or null
    this.isDragging = false;

    // Initialize column order and widths
    this.defaultColumnOrder = ['fav', 'ticker', 'issuer', 'amount', 'price', 'tir', 'payCurr', 'rating', 'maturity', 'duration', 'parity', 'type', 'clause', 'callable', 'law'];
    this.columnOrder = this.loadColumnOrder() || [...this.defaultColumnOrder];
    this.columnWidths = this.loadColumnWidths() || {};
    this.columns = [
      { id: 'fav', label: '★', render: (b, isFav) => `<td style="text-align: center; width: 26px; padding: 0.44rem 0.15rem;"><button class="fav-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); window.app.toggleFavorite('${b.id}')">${isFav ? '★' : '☆'}</button></td>` },
      { id: 'ticker', label: 'Ticker / ISIN', render: (b) => {
        const isinHtml = b.isin 
          ? `<div style="font-size: 0.62rem; color: var(--text-dim); line-height: 1.1;">${b.isin}</div>`
          : '';
        
        let speciesParts = [];
        if (b.tickerCable && b.ticker !== b.tickerCable) {
          speciesParts.push(`C: <strong style="color: var(--accent-cyan);">${b.tickerCable}</strong>`);
        }
        if (b.tickerMEP && b.ticker !== b.tickerMEP) {
          speciesParts.push(`D: <strong style="color: var(--accent-cyan);">${b.tickerMEP}</strong>`);
        }
        if (b.tickerPesos && b.ticker !== b.tickerPesos) {
          speciesParts.push(`$: <strong style="color: var(--text-dim);">${b.tickerPesos}</strong>`);
        }
        const speciesHtml = speciesParts.length > 0 
          ? `<div style="font-size: 0.62rem; color: var(--text-muted); margin-top: 1px; line-height: 1.1;">${speciesParts.join(' | ')}</div>`
          : '';
        return `<td><div style="font-weight: 700; font-size: 0.82rem; color: var(--accent-lime);">${b.ticker}</div>${speciesHtml}${isinHtml}</td>`;
      } },
      { id: 'issuer', label: 'Emisor', render: (b) => `<td><div style="font-weight: 600; font-size: 0.77rem;">${b.shortIssuer}</div><div style="font-size: 0.63rem; color: var(--text-muted);">${b.sector}</div></td>` },
      { id: 'amount', label: 'Monto Emitido', render: (b) => {
        if (!b.issuedAmount || b.issuedAmount <= 0) {
          return `<td class="num-tabular" style="font-size: 0.73rem; color: var(--text-dim);">-</td>`;
        }
        const currPrefix = (b.currency === 'ARS' || b.paymentCurrency === 'Pesos') ? 'AR$ ' : 'US$ ';
        let formatted = '';
        if (b.issuedAmount >= 1000000000) {
          const inB = b.issuedAmount / 1000000000;
          formatted = `${currPrefix}${inB % 1 === 0 ? this.formatNumber(inB, 0) : this.formatNumber(inB, 1)}B`;
        } else if (b.issuedAmount >= 1000000) {
          const inM = b.issuedAmount / 1000000;
          formatted = `${currPrefix}${inM % 1 === 0 ? this.formatNumber(inM, 0) : this.formatNumber(inM, 1)}M`;
        } else if (b.issuedAmount >= 1000) {
          formatted = `${currPrefix}${this.formatNumber(b.issuedAmount / 1000, 0)}k`;
        } else {
          formatted = `${currPrefix}${this.formatNumber(b.issuedAmount, 0)}`;
        }
        let tooltipText = '';
        if (b.emissionTranches && Array.isArray(b.emissionTranches) && b.emissionTranches.length > 0) {
          const lines = b.emissionTranches.map(t => `${t.name === '1ra Emisión' ? 'Emisión' : t.name}: ${currPrefix}${this.formatNumber(t.amount, 0)}`);
          lines.push(`Total en Circulación: ${currPrefix}${this.formatNumber(b.issuedAmount, 0)}`);
          tooltipText = lines.join('\n');
        } else if (b.issuedAmountUVA) {
          tooltipText = `Total Emitido: ${currPrefix}${this.formatNumber(b.issuedAmount, 0)}\nEquivalente UVA: ${this.formatNumber(b.issuedAmountUVA, 0)} UVAs`;
        } else {
          tooltipText = `Total Emitido: ${currPrefix}${this.formatNumber(b.issuedAmount, 0)}`;
        }
        return `<td class="num-tabular" style="font-size: 0.73rem; font-weight: 600; color: var(--text-main);" title="${tooltipText}">${formatted}</td>`;
      } },
      { id: 'price', label: 'Último Precio', render: (b) => {
        const chg = typeof b.pctChange === 'number' ? b.pctChange : null;
        const chgHtml = chg !== null 
          ? `<span style="font-size: 0.65rem; font-weight: 700; color: ${chg > 0 ? '#10b981' : chg < 0 ? '#ef4444' : 'var(--text-muted)'}; margin-left: 2px;">${chg > 0 ? '+' : ''}${this.formatNumber(chg, 2)}%</span>`
          : '';
        const quoteDateStr = b.quoteDate 
          ? this.formatDate(b.quoteDate) 
          : (this.lastSyncTimestamp ? this.lastSyncTimestamp.split(' - ')[0] : 'Hoy (Rueda en Vivo)');
        const tooltipPrice = `Fecha de cotización: ${quoteDateStr} • Rueda BYMA / Data912 en vivo`;
        return `<td class="num-tabular" style="font-weight: 700; cursor: pointer;" title="${tooltipPrice}">
          <div style="display: flex; align-items: baseline; gap: 2px;">
            <div style="color: var(--accent-lime); font-size: 0.84rem;">$${this.formatNumber(b.dirtyPrice, 2)}</div>
            ${chgHtml}
          </div>
          <div style="font-size: 0.63rem; color: var(--text-muted); font-weight: 400;">$${this.formatNumber(b.cleanPrice, 2)} clean</div>
        </td>`;
      } },
      { id: 'tir', label: 'TIR / YTM', render: (b) => `<td class="num-tabular text-lime" style="font-weight: 700; font-size: 0.82rem;">${this.formatNumber(b.tir, 2)}%</td>` },
      { id: 'payCurr', label: 'Moneda', render: (b) => {
        let badgeClass = 'badge-sector';
        const p = b.paymentCurrency || 'Pesos';
        if (p === 'Dólar Cable') badgeClass = 'badge-law';
        else if (p === 'Dólar MEP') badgeClass = 'badge-rating';
        return `<td><span class="badge ${badgeClass}">${p}</span></td>`;
      } },
      { id: 'rating', label: 'Rating', render: (b) => `<td><span class="badge badge-rating">${b.rating}</span><div style="font-size: 0.6rem; color: var(--text-dim); margin-top: 1px;">${b.ratingAgency || 'FIX'}</div></td>` },
      { id: 'maturity', label: 'Vencimiento', render: (b) => `<td class="num-tabular" style="font-size: 0.74rem;">${this.formatDate(b.maturity)}</td>` },
      { id: 'duration', label: 'Duración', render: (b) => `<td class="num-tabular">${this.formatNumber(b.duration, 2)} yrs</td>` },
      { id: 'parity', label: 'Paridad', render: (b) => `<td class="num-tabular text-cyan" style="font-weight: 700;">${this.formatNumber(b.parity, 1)}%</td>` },
      { id: 'clause', label: 'Estructura', render: (b) => `<td><span class="badge badge-law">${b.structureType}</span></td>` },
      { id: 'callable', label: 'Call', render: (b) => {
        if (!b.isCallable) {
          return `<td style="text-align: center; font-weight: 700; font-size: 0.74rem; color: var(--text-muted);">No</td>`;
        }
        let tooltip = 'Rescatable anticipadamente por el emisor (Callable)';
        if (b.callDate || b.callPrice) {
          const d = b.callDate ? `Fecha límite / Call: ${b.callDate}` : '';
          const p = b.callPrice ? `Precio: $${Number(b.callPrice).toFixed(2)}` : '';
          tooltip = [d, p].filter(Boolean).join(' • ');
        }
        return `<td style="text-align: center; font-weight: 700; font-size: 0.74rem; color: var(--accent-cyan); cursor: help;" title="${tooltip}"><span style="border-bottom: 1px dotted var(--accent-cyan); cursor: help;">Sí</span></td>`;
      } },
      { id: 'law', label: 'Ley', render: (b) => `<td><span class="badge ${b.law === 'Nueva York' ? 'badge-law' : 'badge-sector'}">${b.law}</span></td>` }
    ];

    // Instantiate Yield Curve Chart
    this.yieldCurve = new YieldCurveChart('yieldCurveCanvas');
    this.selectedRegressionType = localStorage.getItem('argen_bonds_regression_type') || 'quadratic';
    this.selectedDurationMetric = localStorage.getItem('argen_bonds_duration_metric') || 'modified';
    this.showFittedCurve = localStorage.getItem('argen_bonds_show_fitted_curve') === 'true';

    // Instantiate Treemap Engine
    this.treemap = new SquarifiedTreemap('treemapCanvas', {
      onNodeClick: (node) => {
        if (node && node.data) {
          if (node.data.bondRef) {
            this.openModal(node.data.bondRef);
          } else if (node.data.symbol) {
            this.handleHomeTickerClick(node.data.symbol);
          }
        }
      }
    });

    this.init();
  }

  loadFavorites() {
    try {
      const saved = localStorage.getItem('argen_bonds_watchlist');
      const favs = saved ? JSON.parse(saved) : ['bond_YM34C', 'bond_YM41D'];
      return Array.isArray(favs) ? favs.filter(id => id === 'bond_YM34C' || id === 'bond_YM41D') : ['bond_YM34C', 'bond_YM41D'];
    } catch (e) {
      return ['bond_YM34C', 'bond_YM41D'];
    }
  }

  saveFavorites() {
    try {
      localStorage.setItem('argen_bonds_watchlist', JSON.stringify(this.favorites));
    } catch (e) {
      console.error("Failed to save favorites", e);
    }
  }

  loadColumnOrder() {
    try {
      const saved = localStorage.getItem('argen_bonds_column_order_v2');
      if (!saved) return null;
      let order = JSON.parse(saved);
      if (Array.isArray(order)) {
        // If amount column is not in saved order, insert it after issuer or at position 3
        if (!order.includes('amount')) {
          const issuerIdx = order.indexOf('issuer');
          if (issuerIdx !== -1) {
            order.splice(issuerIdx + 1, 0, 'amount');
          } else {
            order.splice(3, 0, 'amount');
          }
        }
        return order;
      }
      return null;
    } catch(e) { return null; }
  }

  saveColumnOrder() {
    localStorage.setItem('argen_bonds_column_order_v2', JSON.stringify(this.columnOrder));
  }

  loadColumnWidths() {
    try {
      const saved = localStorage.getItem('argen_bonds_column_widths');
      return saved ? JSON.parse(saved) : null;
    } catch(e) { return null; }
  }

  saveColumnWidths() {
    localStorage.setItem('argen_bonds_column_widths', JSON.stringify(this.columnWidths));
  }

  init() {
    const savedTheme = localStorage.getItem('argen_bonds_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    localStorage.removeItem('argen_bonds_column_widths');
    this.columnWidths = {};
    this.recalculateAllBonds();
    this.renderRatingSelect();
    this.renderIssuerSelect();
    this.setupEventListeners();
    this.updateMarketStatusBadge();
    this.renderRatingEquivalenceTable();
    this.renderBondsHeader();
    
    // Immediate baseline render of Home market (guarantees cards, treemap & ranking are NEVER blank on startup)
    this.buildDefaultMarketVolumeData(1611, 1539);

    try {
      const cachedCorp = localStorage.getItem('cached_arg_corp_quotes');
      const cachedSov = localStorage.getItem('cached_arg_sov_quotes');
      if (cachedCorp) {
        const parsed = JSON.parse(cachedCorp);
        const parsedSov = cachedSov ? JSON.parse(cachedSov) : [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.processMarketVolumeData(parsed, 1611, 1539, parsedSov);
        }
      }
    } catch (_) {}

    this.requestDashboardUpdate();
    
    // Automatically load live quotes from Data912 on start
    this.syncData912Quotes(false);
    this.syncBcraTamarRates();
    this.syncBcraUvaRates();
    this.setupAutoRefresh();
  }

  requestDashboardUpdate() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.updateDashboard();
      this.rafPending = false;
    });
  }

  formatLastUpdateDate(date = new Date()) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${d}/${m}/${y} - ${hh}:${mm}`;
  }

  updateMarketStatusBadge() {
    const dot = document.getElementById('market-status-dot');
    const label = document.getElementById('market-status-label');
    const updated = document.getElementById('market-status-updated');
    if (!dot || !label) return;

    const isOpen = this.apiConnector.isMarketOpen();

    if (isOpen) {
      dot.className = 'status-dot open';
      label.textContent = 'Mercado abierto';
      label.style.color = '#10b981';
    } else {
      dot.className = 'status-dot closed';
      label.textContent = 'Mercado cerrado';
      label.style.color = '#38bdf8';
    }

    if (updated) {
      if (!this.lastSyncTimestamp) {
        this.lastSyncTimestamp = this.formatLastUpdateDate(new Date());
      }
      updated.textContent = `Últ. actualizac. ${this.lastSyncTimestamp}`;
    }
  }

  /**
   * Fetches the official daily series of TAMAR from the BCRA API (variable 44)
   * and automatically calculates 1D, 1W, 1M, and 1Y metrics and ranges.
   */
  async syncBcraTamarRates() {
    try {
      const response = await fetch('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/44', {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) return;

      const data = await response.json();
      if (!data || !data.results) return;

      const item = data.results.find(r => r.idVariable === 44);
      if (!item || !Array.isArray(item.detalle) || item.detalle.length === 0) return;

      const det = item.detalle; // ordered descending by date

      // 1. Spot (1 Día)
      const spotItem = det[0];
      const spotTna = spotItem.valor;
      const spotTea = (Math.pow(1 + (spotTna / 100) / 12, 12) - 1) * 100;
      const spotTem = (Math.pow(1 + (spotTna / 100) / 365, 30) - 1) * 100;

      // 2. 1 Semana (5 días hábiles más recientes)
      const weekSlice = det.slice(0, Math.min(5, det.length));
      const weekVals = weekSlice.map(x => x.valor);
      const weekTna = weekVals.reduce((a, b) => a + b, 0) / weekVals.length;
      const weekTea = (Math.pow(1 + (weekTna / 100) / 12, 12) - 1) * 100;
      const weekMin = Math.min(...weekVals);
      const weekMax = Math.max(...weekVals);

      // 3. 1 Mes (22 días hábiles aprox)
      const monthSlice = det.slice(0, Math.min(22, det.length));
      const monthVals = monthSlice.map(x => x.valor);
      const monthTna = monthVals.reduce((a, b) => a + b, 0) / monthVals.length;
      const monthTea = (Math.pow(1 + (monthTna / 100) / 12, 12) - 1) * 100;
      const monthMin = Math.min(...monthVals);
      const monthMax = Math.max(...monthVals);

      // 4. 1 Año (250 días hábiles aprox)
      const yearSlice = det.slice(0, Math.min(250, det.length));
      const yearVals = yearSlice.map(x => x.valor);
      const yearTna = yearVals.reduce((a, b) => a + b, 0) / yearVals.length;
      const yearTea = (Math.pow(1 + (yearTna / 100) / 12, 12) - 1) * 100;
      const yearMin = Math.min(...yearVals);
      const yearMax = Math.max(...yearVals);

      // Update DOM elements safely
      const el1dDate = document.getElementById('tamar-1d-date');
      const el1dTna = document.getElementById('tamar-1d-tna');
      const el1dTea = document.getElementById('tamar-1d-tea');
      const el1dTem = document.getElementById('tamar-1d-tem');

      const el1wTna = document.getElementById('tamar-1w-tna');
      const el1wTea = document.getElementById('tamar-1w-tea');
      const el1wRange = document.getElementById('tamar-1w-range');

      const el1mTna = document.getElementById('tamar-1m-tna');
      const el1mTea = document.getElementById('tamar-1m-tea');
      const el1mRange = document.getElementById('tamar-1m-range');

      const el1yTna = document.getElementById('tamar-1y-tna');
      const el1yTea = document.getElementById('tamar-1y-tea');
      const el1yRange = document.getElementById('tamar-1y-range');

      if (el1dDate && spotItem.fecha) {
        const parts = spotItem.fecha.split('-');
        el1dDate.textContent = parts.length === 3 ? `${parts[2]}/${parts[1]}` : 'Spot';
      }
      if (el1dTna) el1dTna.textContent = `${spotTna.toFixed(2).replace('.', ',')}%`;
      if (el1dTea) el1dTea.textContent = `${spotTea.toFixed(2).replace('.', ',')}%`;
      if (el1dTem) el1dTem.textContent = `${spotTem.toFixed(2).replace('.', ',')}%`;

      if (el1wTna) el1wTna.textContent = `${weekTna.toFixed(2).replace('.', ',')}%`;
      if (el1wTea) el1wTea.textContent = `${weekTea.toFixed(2).replace('.', ',')}%`;
      if (el1wRange) el1wRange.textContent = `${weekMin.toFixed(1).replace('.', ',')} - ${weekMax.toFixed(1).replace('.', ',')}%`;

      if (el1mTna) el1mTna.textContent = `${monthTna.toFixed(2).replace('.', ',')}%`;
      if (el1mTea) el1mTea.textContent = `${monthTea.toFixed(2).replace('.', ',')}%`;
      if (el1mRange) el1mRange.textContent = `${monthMin.toFixed(1).replace('.', ',')} - ${monthMax.toFixed(1).replace('.', ',')}%`;

      if (el1yTna) el1yTna.textContent = `${yearTna.toFixed(2).replace('.', ',')}%`;
      if (el1yTea) el1yTea.textContent = `${yearTea.toFixed(2).replace('.', ',')}%`;
      if (el1yRange) el1yRange.textContent = `${yearMin.toFixed(1).replace('.', ',')} - ${yearMax.toFixed(1).replace('.', ',')}%`;
    } catch (err) {
      // In case of network/offline issues, the existing reliable defaults remain displayed
      console.warn('[BCRA TAMAR] Offline or fetch notice:', err.message);
    }
  }

  /**
   * Fetches the official daily series of UVA from BCRA API (variable 31)
   * and calculates Spot, 7D, 30D and 1Y evolution, variations, and annual rates.
   */
  async syncBcraUvaRates() {
    try {
      const response = await fetch('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/31', {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) return;

      const data = await response.json();
      if (!data || !data.results) return;

      const item = data.results.find(r => r.idVariable === 31);
      if (!item || !Array.isArray(item.detalle) || item.detalle.length === 0) return;

      const det = item.detalle; // ordered descending by date
      const todayStr = new Date().toISOString().split('T')[0];

      // Filter values up to today (avoid future projected if any)
      const validPoints = det.filter(p => p.fecha <= todayStr);
      const points = validPoints.length > 0 ? validPoints : det;

      const spot = points[0];
      const spotVal = spot.valor;
      const spotDate = spot.fecha;

      // 1 Day variation (vs previous day in series)
      const prevSpot = points.length > 1 ? points[1].valor : spotVal;
      const dailyVar = ((spotVal / prevSpot) - 1) * 100;

      // 7 Days variation
      const p7d = points.length > 7 ? points[7] : points[points.length - 1];
      const var7d = ((spotVal / p7d.valor) - 1) * 100;
      const tna7d = (var7d / 7) * 365;

      // 30 Days variation (Month)
      const p30d = points.length > 30 ? points[30] : points[points.length - 1];
      const var30d = ((spotVal / p30d.valor) - 1) * 100;
      const tna30d = (var30d / 30) * 365;

      // 365 Days variation (Year)
      const p1y = points.length > 365 ? points[365] : points[points.length - 1];
      const var1y = ((spotVal / p1y.valor) - 1) * 100;

      // Update DOM elements
      const elSpotDate = document.getElementById('uva-spot-date');
      const elSpotVal = document.getElementById('uva-spot-val');
      const elSpotVar = document.getElementById('uva-spot-var');

      const el7dVar = document.getElementById('uva-7d-var');
      const el7dTna = document.getElementById('uva-7d-tna');
      const el7dBase = document.getElementById('uva-7d-base');

      const el30dVar = document.getElementById('uva-30d-var');
      const el30dTna = document.getElementById('uva-30d-tna');
      const el30dBase = document.getElementById('uva-30d-base');

      const el1yVar = document.getElementById('uva-1y-var');
      const el1yTna = document.getElementById('uva-1y-tna');
      const el1yBase = document.getElementById('uva-1y-base');

      if (elSpotDate && spotDate) {
        const parts = spotDate.split('-');
        elSpotDate.textContent = parts.length === 3 ? `${parts[2]}/${parts[1]}` : 'Hoy';
      }
      if (elSpotVal) elSpotVal.textContent = `$${this.formatNumber(spotVal, 2)}`;
      if (elSpotVar) {
        elSpotVar.textContent = `${dailyVar >= 0 ? '+' : ''}${this.formatNumber(dailyVar, 2)}%`;
        elSpotVar.style.color = dailyVar >= 0 ? 'var(--accent-lime)' : 'var(--accent-red)';
      }

      if (el7dVar) el7dVar.textContent = `${var7d >= 0 ? '+' : ''}${this.formatNumber(var7d, 2)}%`;
      if (el7dTna) el7dTna.textContent = `${this.formatNumber(tna7d, 2)}%`;
      if (el7dBase) el7dBase.textContent = `$${this.formatNumber(p7d.valor, 2)}`;

      if (el30dVar) el30dVar.textContent = `${var30d >= 0 ? '+' : ''}${this.formatNumber(var30d, 2)}%`;
      if (el30dTna) el30dTna.textContent = `${this.formatNumber(tna30d, 2)}%`;
      if (el30dBase) el30dBase.textContent = `$${this.formatNumber(p30d.valor, 2)}`;

      if (el1yVar) el1yVar.textContent = `${var1y >= 0 ? '+' : ''}${this.formatNumber(var1y, 2)}%`;
      if (el1yTna) el1yTna.textContent = `${this.formatNumber(var1y, 2)}%`;
      if (el1yBase) el1yBase.textContent = `$${this.formatNumber(p1y.valor, 2)}`;
    } catch (err) {
      console.warn('[BCRA UVA] Offline or fetch notice:', err.message);
    }
  }

  generateCashFlows(bond, settlementDateStr) {
    // If bond has predefined exact cashFlows schedule from prospectus, respect it
    if (bond.cashFlows && Array.isArray(bond.cashFlows) && bond.cashFlows.length > 0) {
      const allCfs = bond.cashFlows;
      
      // Identify last closed coupon date strictly before settlementDateStr
      const pastCfs = allCfs.filter(cf => cf.date < settlementDateStr);
      let lastCouponDateStr = bond.lastCouponDate;
      if (!lastCouponDateStr && pastCfs.length > 0) {
        lastCouponDateStr = pastCfs[pastCfs.length - 1].date;
      }
      if (!lastCouponDateStr) {
        lastCouponDateStr = '2026-07-08';
      }

      // Active cash flows payable from settlement onwards (date >= settlementDateStr)
      const activeFlows = allCfs.filter(cf => cf.date >= settlementDateStr);

      return {
        cashFlows: activeFlows.length > 0 ? activeFlows : [allCfs[allCfs.length - 1]],
        allCashFlows: allCfs,
        lastCouponDate: lastCouponDateStr
      };
    }

    if (!bond.maturity) {
      return { 
        cashFlows: bond.cashFlows || [], 
        allCashFlows: bond.cashFlows || [], 
        lastCouponDate: bond.lastCouponDate || '2026-01-01' 
      };
    }
    
    const matParts = bond.maturity.split('-');
    if (matParts.length !== 3) {
      return { 
        cashFlows: bond.cashFlows || [], 
        allCashFlows: bond.cashFlows || [], 
        lastCouponDate: bond.lastCouponDate || '2026-01-01' 
      };
    }
    const matYear = parseInt(matParts[0], 10);
    const matMonth = parseInt(matParts[1], 10);
    const matDay = parseInt(matParts[2], 10);
    
    const freq = bond.frequency || 2;
    const intervalMonths = Math.max(1, Math.floor(12 / freq));

    const settlement = new Date(settlementDateStr);
    const matDate = new Date(bond.maturity);

    // Build coupon dates backwards from maturity to cover past coupon and all future coupons
    const allDates = [];
    let curY = matYear;
    let curM = matMonth;
    const cutoffDate = new Date(settlement.getFullYear() - 1, settlement.getMonth(), 1);

    while (true) {
      const lastDayOfMonth = new Date(curY, curM, 0).getDate();
      const actualDay = Math.min(matDay, lastDayOfMonth);
      const d = new Date(curY, curM - 1, actualDay);
      allDates.push(d);

      if (d < cutoffDate) break;

      curM -= intervalMonths;
      while (curM <= 0) {
        curM += 12;
        curY -= 1;
      }
    }

    allDates.sort((a, b) => a - b);

    // Identify last coupon date before or equal to settlement
    const pastDates = allDates.filter(d => d <= settlement);
    const lastCouponDateObj = pastDates.length > 0 
      ? pastDates[pastDates.length - 1] 
      : new Date(settlement.getTime() - (180 * 24 * 60 * 60 * 1000));
    const lastCouponDateStr = bond.lastCouponDate || lastCouponDateObj.toISOString().split('T')[0];

    // Identify future cash flow dates strictly after settlement date up to maturity
    const futureDateObjs = allDates.filter(d => d > settlement && d <= matDate);
    const matDateIso = bond.maturity;
    if (!futureDateObjs.some(d => d.toISOString().split('T')[0] === matDateIso)) {
      futureDateObjs.push(matDate);
    }
    futureDateObjs.sort((a, b) => a - b);

    // Build amortization map (% of nominal 100 amortized per date)
    const amortMap = new Map();
    if (bond.amortizationSchedule && Array.isArray(bond.amortizationSchedule)) {
      bond.amortizationSchedule.forEach(item => {
        amortMap.set(item.date, Number(item.pct));
      });
    } else if (bond.structureType === 'Bullet' || !bond.structureType) {
      amortMap.set(matDateIso, 100.0);
    } else {
      // Amortizable without explicit schedule: divide equally over the last 3 coupon payments
      const numCuotas = Math.min(3, futureDateObjs.length);
      const cuotaPct = 100.0 / numCuotas;
      for (let i = futureDateObjs.length - numCuotas; i < futureDateObjs.length; i++) {
        const dStr = futureDateObjs[i].toISOString().split('T')[0];
        amortMap.set(dStr, cuotaPct);
      }
    }

    let residual = 100.0;
    const couponRate = typeof bond.couponRate === 'number' ? bond.couponRate : 0.0;

    const cashFlows = [];
    for (let i = 0; i < futureDateObjs.length; i++) {
      const dObj = futureDateObjs[i];
      const dStr = dObj.toISOString().split('T')[0];
      const isLast = (i === futureDateObjs.length - 1);

      let amort = amortMap.get(dStr) || 0;
      if (isLast) {
        amort = residual; // ensure final nominal residual is paid
      }
      amort = Math.min(residual, amort);

      // Fixed-coupon bonds pay regular periodic coupon (C / frequency), variable bonds use actual days
      const freq = bond.frequency || 2;
      const daysInPeriod = (i === 0) 
        ? Math.max(1, Math.round((dObj.getTime() - new Date(lastCouponDateStr).getTime()) / (1000 * 60 * 60 * 24)))
        : Math.max(1, Math.round((dObj.getTime() - futureDateObjs[i - 1].getTime()) / (1000 * 60 * 60 * 24)));
      const cpnAmount = (bond.couponType === 'Variable' || bond.couponType === 'Badlar')
        ? Number(((residual * (couponRate / 100.0) * (daysInPeriod / 365.0))).toFixed(4))
        : Number(((residual * (couponRate / freq) / 100.0)).toFixed(4));
      const totalAmount = Number((amort + cpnAmount).toFixed(4));
      const nextResidual = Math.max(0, Number((residual - amort).toFixed(2)));

      cashFlows.push({
        date: dStr,
        amortization: Number(amort.toFixed(2)),
        coupon: Number(cpnAmount.toFixed(4)),
        amount: totalAmount,
        residual: nextResidual
      });

      residual = nextResidual;
    }

    return { cashFlows, lastCouponDate: lastCouponDateStr };
  }

  recalculateAllBonds() {
    const settlementDate = FinancialMath.getSettlementDate(this.settlementMode);

    this.calculatedBonds = this.bonds.map(bond => {
      const { cashFlows, allCashFlows, lastCouponDate } = this.generateCashFlows(bond, settlementDate);

      // Determine current residual capital percentage at settlement date
      let activeResidual = 100.0;
      if (allCashFlows && allCashFlows.length > 0) {
        const pastCfs = allCashFlows.filter(cf => cf.date < settlementDate);
        if (pastCfs.length > 0) {
          activeResidual = pastCfs[pastCfs.length - 1].residual;
        } else if (cashFlows.length > 0 && cashFlows[0].residual !== undefined && cashFlows[0].amortization !== undefined) {
          activeResidual = Number((cashFlows[0].residual + cashFlows[0].amortization).toFixed(4));
        }
      }

      // Day count convention: Standard Argentine Market rule (Real/365 o Actual/365)
      const dayCount = bond.dayCount || 'ACT/365';
      const accruedInterest = FinancialMath.calculateAccruedInterest(
        bond.couponRate,
        lastCouponDate,
        settlementDate,
        dayCount,
        activeResidual
      );

      // MANDATORY ARGENTINE MARKET RULE:
      // Market quotes in Argentine BYMA / MAE are always DIRTY PRICES (con cupón corrido).
      const dirtyPrice = (typeof bond.dirtyPrice === 'number' && bond.dirtyPrice > 0)
        ? bond.dirtyPrice
        : (typeof bond.cleanPrice === 'number' && bond.cleanPrice > 0 ? bond.cleanPrice : 100.0);

      // Clean Price is DERIVED: Dirty Price - Accrued Interest
      const cleanPrice = Math.max(0, Number((dirtyPrice - accruedInterest).toFixed(2)));
      const technicalValue = FinancialMath.calculateTechnicalValue(activeResidual, accruedInterest);
      const parity = FinancialMath.calculateParity(dirtyPrice, technicalValue);

      const tir = FinancialMath.calculateTIR(
        dirtyPrice,
        cashFlows,
        settlementDate,
        bond.frequency
      );

      const tea = FinancialMath.calculateTEA(
        tir,
        bond.frequency || 2
      );

      const { macaulayDuration, modifiedDuration, convexity, dv01 } = FinancialMath.calculateRiskMetrics(
        dirtyPrice,
        cashFlows,
        tir,
        settlementDate,
        bond.frequency
      );

      return {
        ...bond,
        cashFlows,
        allCashFlows: allCashFlows || bond.cashFlows || cashFlows,
        lastCouponDate,
        settlementDate,
        accruedInterest: Number(accruedInterest.toFixed(2)),
        dirtyPrice: Number(dirtyPrice.toFixed(2)),
        cleanPrice: Number(cleanPrice.toFixed(2)),
        technicalValue: Number(technicalValue.toFixed(2)),
        parity: Number(parity.toFixed(1)),
        tir: Number(tir.toFixed(2)),
        tea: Number(tea.toFixed(2)),
        duration: modifiedDuration,
        macaulayDuration,
        convexity,
        dv01
      };
    });
  }

  renderRatingSelect() {
    const dropdownMenu = document.getElementById('rating-dropdown-menu');
    const labelSpan = document.getElementById('rating-selected-label');
    if (!dropdownMenu) return;

    // Get current bonds for active group
    const currentGroupBonds = this.calculatedBonds.filter(b => {
      if (this.selectedGroup === 'Hard USD' || this.selectedGroup === 'USD MEP' || this.selectedGroup === 'USD Cable') {
        return (b.instrumentGroup === 'Hard USD' || b.paymentCurrency === 'Dólar Cable' || b.paymentCurrency === 'Dólar MEP' || b.currency === 'USD') &&
          !b.instrumentGroup.includes('Pesos') && !b.instrumentGroup.includes('Linked') &&
          !b.ticker.endsWith('O') && !b.ticker.endsWith('P') && !b.ticker.endsWith('L') && !b.ticker.includes('RZB');
      } else if (this.selectedGroup === 'Dólar Linked') {
        return b.instrumentGroup === 'Dólar Linked' || b.instrumentGroup === 'Dolar Linked' || (b.currency === 'USD' && (b.ticker.endsWith('P') || b.ticker.endsWith('L') || b.ticker.includes('RZB')));
      } else if (this.selectedGroup.startsWith('Pesos')) {
        let group = 'Pesos Fijos';
        if (b.instrumentGroup === 'Pesos TAMAR' || b.couponType === 'TAMAR') {
          group = 'Pesos TAMAR';
        } else if (b.instrumentGroup === 'Pesos BADLAR' || b.couponType === 'Badlar') {
          group = 'Pesos BADLAR';
        } else if (b.instrumentGroup === 'Pesos UVA' || b.couponType === 'UVA') {
          group = 'Pesos UVA';
        } else if (b.instrumentGroup === 'Pesos Fijos' || b.couponType === 'Fijo') {
          group = 'Pesos Fijos';
        }
        return (b.currency === 'ARS' || b.paymentCurrency === 'Pesos' || (b.instrumentGroup && b.instrumentGroup.startsWith('Pesos'))) && group === this.selectedGroup;
      } else if (this.selectedGroup === 'Favoritos') {
        return Array.isArray(this.favorites) && this.favorites.includes(b.id);
      }
      return true;
    });

    const ratings = [...new Set(currentGroupBonds.map(b => b.rating))].filter(Boolean).sort();

    // If selectedRatings is null or undefined (initial load or tab change), select all ratings by default
    if (this.selectedRatings === null || this.selectedRatings === undefined) {
      this.selectedRatings = new Set(ratings);
    } else {
      // Retain the user's active choices (even if empty!), filtering out any that no longer exist in the active tab
      this.selectedRatings = new Set([...this.selectedRatings].filter(r => ratings.includes(r)));
    }

    const allChecked = ratings.length > 0 && this.selectedRatings.size === ratings.length;
    const isIndeterminate = this.selectedRatings.size > 0 && this.selectedRatings.size < ratings.length;

    let menuHtml = `
      <div style="position: sticky; top: -0.5rem; background: var(--bg-card); z-index: 2; border-bottom: 1px solid var(--border-color); margin-bottom: 0.35rem; padding-bottom: 0.25rem;">
        <label class="emisiones-dropdown-item" style="font-weight: 700;">
          <input type="checkbox" id="chk-master-ratings" ${allChecked ? 'checked' : ''}>
          <span>Todos los ratings (${ratings.length})</span>
        </label>
        <div style="display: flex; justify-content: space-between; padding: 0.1rem 0.85rem 0.25rem; font-size: 0.72rem;">
          <a href="javascript:void(0)" id="btn-select-all-ratings" style="color: var(--accent-cyan); text-decoration: none; font-weight: 600;">Seleccionar todo</a>
          <a href="javascript:void(0)" id="btn-deselect-all-ratings" style="color: var(--text-muted); text-decoration: none; font-weight: 600;">Deseleccionar todo</a>
        </div>
      </div>
    `;

    ratings.forEach(rating => {
      const count = currentGroupBonds.filter(b => b.rating === rating).length;
      const isChecked = this.selectedRatings.has(rating);
      menuHtml += `
        <label class="emisiones-dropdown-item">
          <input type="checkbox" class="chk-rating-item" data-rating="${rating}" ${isChecked ? 'checked' : ''}>
          <span>${rating} (${count})</span>
        </label>
      `;
    });

    dropdownMenu.innerHTML = menuHtml;

    // Attach master checkbox handler
    const masterChk = document.getElementById('chk-master-ratings');
    if (masterChk) {
      masterChk.indeterminate = isIndeterminate;
      masterChk.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedRatings = new Set(ratings);
        } else {
          this.selectedRatings = new Set();
        }
        this.renderRatingSelect();
        this.requestDashboardUpdate();
      });
    }

    // Quick action buttons
    document.getElementById('btn-select-all-ratings')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.selectedRatings = new Set(ratings);
      this.renderRatingSelect();
      this.requestDashboardUpdate();
    });

    document.getElementById('btn-deselect-all-ratings')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.selectedRatings = new Set();
      this.renderRatingSelect();
      this.requestDashboardUpdate();
    });

    // Attach individual rating checkbox handlers
    dropdownMenu.querySelectorAll('.chk-rating-item').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const rat = e.target.dataset.rating;
        if (e.target.checked) {
          this.selectedRatings.add(rat);
        } else {
          this.selectedRatings.delete(rat);
        }
        this.renderRatingSelect();
        this.requestDashboardUpdate();
      });
    });

    // Update summary button label
    if (labelSpan) {
      if (this.selectedRatings.size === ratings.length) {
        labelSpan.textContent = `Todos los ratings (${ratings.length})`;
      } else if (this.selectedRatings.size === 0) {
        labelSpan.textContent = 'Ningún rating (0)';
      } else if (this.selectedRatings.size === 1) {
        const singleRating = Array.from(this.selectedRatings)[0];
        const singleCount = currentGroupBonds.filter(b => b.rating === singleRating).length;
        labelSpan.textContent = `${singleRating} (${singleCount})`;
      } else {
        const selBondsCount = currentGroupBonds.filter(b => this.selectedRatings.has(b.rating)).length;
        labelSpan.textContent = `${this.selectedRatings.size} ratings (${selBondsCount} bonos)`;
      }
    }
  }

  isBondMatchingRating(bond) {
    if (this.selectedRatings === null || this.selectedRatings === undefined) return true;
    return this.selectedRatings.has(bond.rating);
  }

  getBondCompany(bond) {
    if (!bond) return '';
    if (bond.shortIssuer) return bond.shortIssuer;
    if (bond.company) return bond.company;
    if (bond.issuer) {
      return bond.issuer.replace(/\s+Clase\s+.*$/i, '').trim();
    }
    return '';
  }

  isBondMatchingIssuer(bond) {
    if (this.selectedCompanies === null || this.selectedCompanies === undefined) return true;
    const comp = this.getBondCompany(bond);
    return this.selectedCompanies.has(comp);
  }

  renderIssuerSelect() {
    const dropdownMenu = document.getElementById('emisiones-dropdown-menu');
    const labelSpan = document.getElementById('emisiones-selected-label');
    if (!dropdownMenu) return;

    // Get unique companies from calculatedBonds for the current selected tab
    const currentGroupBonds = this.calculatedBonds.filter(b => {
      if (this.selectedGroup === 'Hard USD' || this.selectedGroup === 'USD MEP' || this.selectedGroup === 'USD Cable') {
        return (b.instrumentGroup === 'Hard USD' || b.paymentCurrency === 'Dólar Cable' || b.paymentCurrency === 'Dólar MEP' || b.currency === 'USD') &&
          !b.instrumentGroup.includes('Pesos') && !b.instrumentGroup.includes('Linked') &&
          !b.ticker.endsWith('O') && !b.ticker.endsWith('P') && !b.ticker.endsWith('L') && !b.ticker.includes('RZB');
      } else if (this.selectedGroup === 'Dólar Linked') {
        return b.instrumentGroup === 'Dólar Linked' || b.instrumentGroup === 'Dolar Linked' || (b.currency === 'USD' && (b.ticker.endsWith('P') || b.ticker.endsWith('L') || b.ticker.includes('RZB')));
      } else if (this.selectedGroup.startsWith('Pesos')) {
        let group = 'Pesos Fijos';
        if (b.instrumentGroup === 'Pesos TAMAR' || b.couponType === 'TAMAR') {
          group = 'Pesos TAMAR';
        } else if (b.instrumentGroup === 'Pesos BADLAR' || b.couponType === 'Badlar') {
          group = 'Pesos BADLAR';
        } else if (b.instrumentGroup === 'Pesos UVA' || b.couponType === 'UVA') {
          group = 'Pesos UVA';
        } else if (b.instrumentGroup === 'Pesos Fijos' || b.couponType === 'Fijo') {
          group = 'Pesos Fijos';
        }
        return (b.currency === 'ARS' || b.paymentCurrency === 'Pesos' || (b.instrumentGroup && b.instrumentGroup.startsWith('Pesos'))) && group === this.selectedGroup;
      } else if (this.selectedGroup === 'Favoritos') {
        return Array.isArray(this.favorites) && this.favorites.includes(b.id);
      }
      return true;
    });

    const companies = [...new Set(currentGroupBonds.map(b => this.getBondCompany(b)))].filter(Boolean).sort();

    // If selectedCompanies is null or not initialized, select all companies by default
    if (this.selectedCompanies === null || this.selectedCompanies === undefined) {
      this.selectedCompanies = new Set(companies);
    } else {
      // Keep only selections that exist in the active tab (even if empty)
      this.selectedCompanies = new Set([...this.selectedCompanies].filter(c => companies.includes(c)));
    }

    const allChecked = companies.length > 0 && this.selectedCompanies.size === companies.length;
    const isIndeterminate = this.selectedCompanies.size > 0 && this.selectedCompanies.size < companies.length;

    let menuHtml = `
      <div style="position: sticky; top: -0.5rem; background: var(--bg-card); z-index: 2; border-bottom: 1px solid var(--border-color); margin-bottom: 0.35rem; padding-bottom: 0.25rem;">
        <label class="emisiones-dropdown-item" style="font-weight: 700;">
          <input type="checkbox" id="chk-master-emisiones" ${allChecked ? 'checked' : ''}>
          <span>Todas las emisiones (${currentGroupBonds.length})</span>
        </label>
        <div style="display: flex; justify-content: space-between; padding: 0.1rem 0.85rem 0.25rem; font-size: 0.72rem;">
          <a href="javascript:void(0)" id="btn-select-all-emisiones" style="color: var(--accent-cyan); text-decoration: none; font-weight: 600;">Seleccionar todo</a>
          <a href="javascript:void(0)" id="btn-deselect-all-emisiones" style="color: var(--text-muted); text-decoration: none; font-weight: 600;">Deseleccionar todo</a>
        </div>
      </div>
    `;

    companies.forEach(company => {
      const count = currentGroupBonds.filter(b => this.getBondCompany(b) === company).length;
      const isChecked = this.selectedCompanies.has(company);
      menuHtml += `
        <label class="emisiones-dropdown-item">
          <input type="checkbox" class="chk-company-emision" data-company="${company}" ${isChecked ? 'checked' : ''}>
          <span>${company} (${count})</span>
        </label>
      `;
    });

    dropdownMenu.innerHTML = menuHtml;

    // Attach master checkbox handler
    const masterChk = document.getElementById('chk-master-emisiones');
    if (masterChk) {
      masterChk.indeterminate = isIndeterminate;
      masterChk.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedCompanies = new Set(companies);
        } else {
          this.selectedCompanies = new Set();
        }
        this.renderIssuerSelect();
        this.requestDashboardUpdate();
      });
    }

    // Quick action buttons
    document.getElementById('btn-select-all-emisiones')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.selectedCompanies = new Set(companies);
      this.renderIssuerSelect();
      this.requestDashboardUpdate();
    });

    document.getElementById('btn-deselect-all-emisiones')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.selectedCompanies = new Set();
      this.renderIssuerSelect();
      this.requestDashboardUpdate();
    });

    // Attach individual company checkbox handlers
    dropdownMenu.querySelectorAll('.chk-company-emision').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const comp = e.target.dataset.company;
        if (e.target.checked) {
          this.selectedCompanies.add(comp);
        } else {
          this.selectedCompanies.delete(comp);
        }
        this.renderIssuerSelect();
        this.requestDashboardUpdate();
      });
    });

    // Update summary button label
    if (labelSpan) {
      if (this.selectedCompanies.size === companies.length) {
        labelSpan.textContent = `Todas las emisiones (${currentGroupBonds.length})`;
      } else if (this.selectedCompanies.size === 0) {
        labelSpan.textContent = 'Ninguna emisión (0)';
      } else if (this.selectedCompanies.size === 1) {
        const singleComp = Array.from(this.selectedCompanies)[0];
        const singleCount = currentGroupBonds.filter(b => this.getBondCompany(b) === singleComp).length;
        labelSpan.textContent = `${singleComp} (${singleCount})`;
      } else {
        const selBondsCount = currentGroupBonds.filter(b => this.selectedCompanies.has(this.getBondCompany(b))).length;
        labelSpan.textContent = `${this.selectedCompanies.size} emisores (${selBondsCount} bonos)`;
      }
    }
  }

  renderRatingEquivalenceTable() {
    const tbody = document.getElementById('rating-equivalence-tbody');
    if (!tbody) return;

    tbody.innerHTML = RATING_EQUIVALENCE_TABLE.map(row => `
      <tr>
        <td>
          <div style="font-weight: 700; color: var(--accent-lime); font-size: 0.88rem;">${row.grade || row.rating || 'N/A'}</div>
          ${row.description ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">${row.description}</div>` : ''}
        </td>
        <td class="num-tabular text-cyan" style="font-weight: 600;">${row.fix || '-'}</td>
        <td class="num-tabular" style="font-weight: 600;">${row.moodys || '-'}</td>
        <td class="num-tabular" style="font-weight: 600;">${row.sp || row.syp || '-'}</td>
        <td class="num-tabular text-yellow" style="font-weight: 700;">${row.globalEquivalent || '-'}</td>
      </tr>
    `).join('');
  }

  setupEventListeners() {
    // Regression Type Selector
    const regSelect = document.getElementById('regression-type-select');
    if (regSelect) {
      regSelect.value = this.selectedRegressionType;
      regSelect.addEventListener('change', (e) => {
        this.selectedRegressionType = e.target.value;
        localStorage.setItem('argen_bonds_regression_type', this.selectedRegressionType);
        this.requestDashboardUpdate();
      });
    }

    // Duration Metric Selector
    const durSelect = document.getElementById('duration-metric-select');
    if (durSelect) {
      durSelect.value = this.selectedDurationMetric;
      durSelect.addEventListener('change', (e) => {
        this.selectedDurationMetric = e.target.value;
        localStorage.setItem('argen_bonds_duration_metric', this.selectedDurationMetric);
        this.requestDashboardUpdate();
      });
    }

    // Show Fitted Curve Checkbox
    const curveChk = document.getElementById('show-fitted-curve-chk');
    if (curveChk) {
      curveChk.checked = this.showFittedCurve;
      curveChk.addEventListener('change', (e) => {
        this.showFittedCurve = e.target.checked;
        localStorage.setItem('argen_bonds_show_fitted_curve', this.showFittedCurve);
        this.requestDashboardUpdate();
      });
    }

    // Currency Selector for Hard USD Yield Curve (MEP vs Cable)
    const curveCurrSelect = document.getElementById('curve-currency-select');
    if (curveCurrSelect) {
      curveCurrSelect.value = this.hdCurveCurrency;
      curveCurrSelect.addEventListener('change', (e) => {
        this.hdCurveCurrency = e.target.value;
        localStorage.setItem('argen_bonds_hd_curve_curr', this.hdCurveCurrency);
        this.requestDashboardUpdate();
      });
    }

    // Treemap View Mode Toggle (Issuer vs Species)
    const btnModeIssuer = document.getElementById('btn-treemap-mode-issuer');
    const btnModeSpecies = document.getElementById('btn-treemap-mode-species');
    
    if (btnModeIssuer && btnModeSpecies) {
      const updateTreemapButtons = () => {
        const isIssuer = (this.treemapMode === 'issuer');
        btnModeIssuer.classList.toggle('active', isIssuer);
        btnModeIssuer.style.background = isIssuer ? 'var(--accent-cyan)' : 'transparent';
        btnModeIssuer.style.color = isIssuer ? '#000' : 'var(--text-dim)';
        btnModeIssuer.style.fontWeight = isIssuer ? '700' : '600';

        btnModeSpecies.classList.toggle('active', !isIssuer);
        btnModeSpecies.style.background = !isIssuer ? 'var(--accent-lime)' : 'transparent';
        btnModeSpecies.style.color = !isIssuer ? '#000' : 'var(--text-dim)';
        btnModeSpecies.style.fontWeight = !isIssuer ? '700' : '600';

        const desc = document.getElementById('treemap-subtitle-desc');
        const legend = document.getElementById('treemap-legend-container');
        if (desc) {
          desc.innerHTML = isIssuer 
            ? 'Consolida el volumen total operado en las 3 monedas (MEP + CCL + Pesos) expresado en <strong>Dólar Cable (CCL)</strong> para cada emisor.'
            : 'El tamaño de cada recuadro representa el <strong>monto total operado en USD</strong>; el color indica la <strong>variación diaria (%)</strong>.';
        }
        if (legend) {
          legend.innerHTML = isIssuer
            ? `<span style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Top Volumen:</span>
               <span style="display: inline-block; width: 10px; height: 10px; background: #0ea5e9; border-radius: 2px;" title="#1 Líder"></span> #1 Líder
               <span style="display: inline-block; width: 10px; height: 10px; background: #0284c7; border-radius: 2px;" title="#2-#3"></span> Top 2-3
               <span style="display: inline-block; width: 10px; height: 10px; background: #0369a1; border-radius: 2px;" title="#4-#6"></span> Top 4-6
               <span style="display: inline-block; width: 10px; height: 10px; background: #075985; border-radius: 2px;" title="#7-#10"></span> Top 7-10
               <span style="display: inline-block; width: 10px; height: 10px; background: #1e293b; border-radius: 2px;" title="Otros"></span> Otros`
            : `<span style="display: inline-block; width: 10px; height: 10px; background: #b91c1c; border-radius: 2px;"></span> &lt;-2%
               <span style="display: inline-block; width: 10px; height: 10px; background: #dc2626; border-radius: 2px;"></span> -1%
               <span style="display: inline-block; width: 10px; height: 10px; background: #334155; border-radius: 2px;"></span> 0%
               <span style="display: inline-block; width: 10px; height: 10px; background: #16a34a; border-radius: 2px;"></span> +1%
               <span style="display: inline-block; width: 10px; height: 10px; background: #059669; border-radius: 2px;"></span> &gt;+2%`;
        }
      };

      btnModeIssuer.addEventListener('click', () => {
        this.treemapMode = 'issuer';
        localStorage.setItem('argen_bonds_treemap_mode', 'issuer');
        updateTreemapButtons();
        this.renderHomeMarket();
      });

      btnModeSpecies.addEventListener('click', () => {
        this.treemapMode = 'species';
        localStorage.setItem('argen_bonds_treemap_mode', 'species');
        updateTreemapButtons();
        this.renderHomeMarket();
      });

      updateTreemapButtons();
    }

    // Main Control Bar Multi-Grouping Filters
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.requestDashboardUpdate();
    });

    // Emisiones Multi-Select Dropdown Toggle & Click Outside
    const dropdownBtn = document.getElementById('emisiones-dropdown-btn');
    const dropdownMenu = document.getElementById('emisiones-dropdown-menu');
    const multiselectContainer = document.getElementById('emisiones-multiselect');

    if (dropdownBtn && dropdownMenu) {
      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdownMenu.style.display === 'block';
        dropdownMenu.style.display = isOpen ? 'none' : 'block';
      });

      // Prevent closing when clicking inside the dropdown menu (e.g. on checkboxes/labels)
      dropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (multiselectContainer && !multiselectContainer.contains(e.target)) {
          dropdownMenu.style.display = 'none';
        }
      });
    }

    // Rating Multi-Select Dropdown Toggle & Click Outside
    const ratingDropdownBtn = document.getElementById('rating-dropdown-btn');
    const ratingDropdownMenu = document.getElementById('rating-dropdown-menu');
    const ratingMultiselectContainer = document.getElementById('rating-multiselect');

    if (ratingDropdownBtn && ratingDropdownMenu) {
      ratingDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = ratingDropdownMenu.style.display === 'block';
        ratingDropdownMenu.style.display = isOpen ? 'none' : 'block';
      });

      ratingDropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      document.addEventListener('click', (e) => {
        if (ratingMultiselectContainer && !ratingMultiselectContainer.contains(e.target)) {
          ratingDropdownMenu.style.display = 'none';
        }
      });
    }

    // Main Navigation Tabs (Grouping & Favorites)
    const navTabs = document.querySelectorAll('#main-tabs .nav-btn');
    navTabs.forEach(btn => {
      btn.addEventListener('click', (e) => {
        navTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.selectedGroup = e.target.dataset.group;
        
        // Reset all filters when changing tabs
        this.searchQuery = '';
        this.selectedRatings = null;
        this.selectedCompanies = null;
        this.sortCol = null;
        this.sortDir = null;

        // Reset search input DOM
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';

        // Re-render issuer and rating selects for the new group
        this.renderIssuerSelect();
        this.renderRatingSelect();

        this.renderBondsHeader();
        this.requestDashboardUpdate();
      });
    });

    // Logo Click Handler -> Ir al Inicio / Mercado
    const brandLogoBtn = document.getElementById('brand-logo-btn');
    if (brandLogoBtn) {
      brandLogoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const homeTabBtn = document.querySelector('#main-tabs .nav-btn[data-group="Inicio"]');
        if (homeTabBtn) {
          homeTabBtn.click();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Theme Toggle
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('argen_bonds_theme', next);
      this.requestDashboardUpdate();
    });

    // Rating Guide Modal Triggers
    document.getElementById('btn-rating-guide')?.addEventListener('click', () => {
      document.getElementById('rating-guide-modal')?.classList.add('active');
    });

    document.getElementById('rating-guide-modal-close')?.addEventListener('click', () => {
      document.getElementById('rating-guide-modal')?.classList.remove('active');
    });

    // Data912 Live Market Feed Modal & Action Triggers
    document.getElementById('btn-api-config')?.addEventListener('click', () => {
      document.getElementById('api-modal')?.classList.add('active');
    });

    document.getElementById('api-modal-close')?.addEventListener('click', () => {
      document.getElementById('api-modal')?.classList.remove('active');
    });

    // Refresh buttons (in header and inside modal)
    document.getElementById('btn-refresh-quotes')?.addEventListener('click', () => {
      this.syncData912Quotes(true);
      this.syncBcraTamarRates();
      this.syncBcraUvaRates();
    });

    document.getElementById('btn-sync-data912-now')?.addEventListener('click', () => {
      this.syncData912Quotes(true);
      this.syncBcraTamarRates();
      this.syncBcraUvaRates();
    });

    // Auto-refresh checkbox
    const autoRefreshChk = document.getElementById('auto-refresh-chk');
    if (autoRefreshChk) {
      autoRefreshChk.checked = this.autoRefreshEnabled;
      autoRefreshChk.addEventListener('change', (e) => {
        this.autoRefreshEnabled = e.target.checked;
        localStorage.setItem('argen_bonds_autorefresh', this.autoRefreshEnabled);
        this.setupAutoRefresh();
      });
    }

    // Bond Detail Modal Close
    document.getElementById('modal-close-btn')?.addEventListener('click', () => {
      document.getElementById('bond-modal')?.classList.remove('active');
    });
    // Modal Real-Time Calculator Listeners
    const calcCleanInput = document.getElementById('calc-clean-price');
    const calcDirtyInput = document.getElementById('calc-dirty-price');
    const calcTirInput = document.getElementById('calc-result-tir');
    const fxRateInput = document.getElementById('calc-fx-rate');

    this.modalCurrency = 'MEP'; // Default 'MEP', 'CCL', 'ARS'

    document.querySelectorAll('.btn-calc-curr').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-calc-curr').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalCurrency = btn.dataset.curr;
        this.refreshModalCurrencyView();
      });
    });

    document.getElementById('modal-mep-badge')?.addEventListener('click', () => {
      if (this.latestFx?.mep && fxRateInput) {
        fxRateInput.value = this.latestFx.mep.toFixed(2);
        this.refreshModalCurrencyView();
      }
    });

    document.getElementById('modal-ccl-badge')?.addEventListener('click', () => {
      if (this.latestFx?.ccl && fxRateInput) {
        fxRateInput.value = this.latestFx.ccl.toFixed(2);
        this.refreshModalCurrencyView();
      }
    });

    fxRateInput?.addEventListener('input', () => {
      this.refreshModalCurrencyView();
    });

    calcCleanInput?.addEventListener('input', (e) => {
      const newCleanPrice = parseFloat(e.target.value);
      if (!isNaN(newCleanPrice) && this.selectedBondForModal) {
        this.updateModalCalculatorFromCleanPrice(newCleanPrice);
      }
    });

    calcDirtyInput?.addEventListener('input', (e) => {
      const newDirtyPrice = parseFloat(e.target.value);
      if (!isNaN(newDirtyPrice) && this.selectedBondForModal) {
        this.updateModalCalculatorFromDirtyPrice(newDirtyPrice);
      }
    });

    calcTirInput?.addEventListener('input', (e) => {
      const targetTIR = parseFloat(e.target.value);
      if (!isNaN(targetTIR) && this.selectedBondForModal) {
        this.updateModalCalculatorFromTIR(targetTIR);
      }
    });

    // Number format toggle button
    document.getElementById('btn-toggle-number-format')?.addEventListener('click', () => {
      this.toggleNumberFormat();
    });
    this.updateNumberFormatButton();
  }

  getFilteredBonds() {
    let list = this.calculatedBonds;

    // If user is searching, search globally across ALL bonds so species are never hidden by active tab
    if (this.searchQuery && this.searchQuery.length > 0) {
      const q = this.searchQuery.toLowerCase().trim();
      const filtered = list.filter(b => {
        const matchSearch = (b.ticker && b.ticker.toLowerCase().includes(q)) ||
          (b.tickerMEP && b.tickerMEP.toLowerCase().includes(q)) ||
          (b.tickerPesos && b.tickerPesos.toLowerCase().includes(q)) ||
          (b.isin && b.isin.toLowerCase().includes(q)) ||
          (b.issuer && b.issuer.toLowerCase().includes(q)) ||
          (b.shortIssuer && b.shortIssuer.toLowerCase().includes(q));

        const matchRating = this.isBondMatchingRating(b);
        const matchIssuer = this.isBondMatchingIssuer(b);

        return matchSearch && matchRating && matchIssuer;
      });
      return this.sortBonds(filtered);
    }

    // Filter by selected Group tab when not searching
    if (this.selectedGroup === 'Hard USD' || this.selectedGroup === 'USD MEP' || this.selectedGroup === 'USD Cable') {
      list = list.filter(b => 
        (b.instrumentGroup === 'Hard USD' || b.paymentCurrency === 'Dólar Cable' || b.paymentCurrency === 'Dólar MEP' || b.currency === 'USD') &&
        !b.instrumentGroup.includes('Pesos') && !b.instrumentGroup.includes('Linked') &&
        !b.ticker.endsWith('O') && !b.ticker.endsWith('P') && !b.ticker.endsWith('L') && !b.ticker.includes('RZB')
      );
    } else if (this.selectedGroup === 'Dólar Linked') {
      list = list.filter(b => 
        b.instrumentGroup === 'Dólar Linked' || b.instrumentGroup === 'Dolar Linked' || 
        (b.currency === 'USD' && b.paymentCurrency === 'Pesos') ||
        b.ticker.endsWith('P') || b.ticker.endsWith('L') || b.ticker.includes('RZB')
      );
    } else if (this.selectedGroup.startsWith('Pesos')) {
      list = list.filter(b => b.currency === 'ARS' || b.paymentCurrency === 'Pesos' || (b.instrumentGroup && b.instrumentGroup.startsWith('Pesos')));
      if (this.selectedGroup === 'Pesos BADLAR') {
        list = list.filter(b => b.instrumentGroup === 'Pesos BADLAR' || b.couponType === 'Badlar');
      } else if (this.selectedGroup === 'Pesos TAMAR') {
        list = list.filter(b => b.instrumentGroup === 'Pesos TAMAR' || b.couponType === 'TAMAR');
      } else if (this.selectedGroup === 'Pesos UVA') {
        list = list.filter(b => b.instrumentGroup === 'Pesos UVA' || b.couponType === 'UVA');
      } else if (this.selectedGroup === 'Pesos Fijos') {
        list = list.filter(b => b.instrumentGroup === 'Pesos Fijos' || b.couponType === 'Fijo');
      }
    } else if (this.selectedGroup === 'Favoritos') {
      list = list.filter(b => Array.isArray(this.favorites) && this.favorites.includes(b.id));
    }

    const filtered = list.filter(b => {
      const matchRating = this.isBondMatchingRating(b);
      const matchIssuer = this.isBondMatchingIssuer(b);

      return matchRating && matchIssuer;
    });

    return this.sortBonds(filtered);
  }

  sortBonds(list) {
    if (!this.sortCol || !this.sortDir) {
      // Default: maturity date ascending (shortest first)
      return [...list].sort((a, b) => this.defaultSort(a, b));
    }
    
    return [...list].sort((a, b) => {
      const valA = this.getSortValue(a, this.sortCol);
      const valB = this.getSortValue(b, this.sortCol);
      
      let comp = 0;
      if (typeof valA === 'string' && typeof valB === 'string') {
        comp = valA.localeCompare(valB);
      } else {
        comp = (valA || 0) - (valB || 0);
      }
      
      return this.sortDir === 'desc' ? -comp : comp;
    });
  }

  defaultSort(a, b) {
    const timeA = new Date(a.maturity).getTime() || Infinity;
    const timeB = new Date(b.maturity).getTime() || Infinity;
    return timeA - timeB;
  }

  getSortValue(b, colId) {
    switch (colId) {
      case 'fav':
        return this.favorites.includes(b.id) ? 1 : 0;
      case 'ticker':
        return b.ticker || '';
      case 'issuer':
        return b.shortIssuer || '';
      case 'amount':
        return b.issuedAmount || 0;
      case 'type':
        return b.instrumentGroup || '';
      case 'clause':
        return b.structureType || '';
      case 'callable':
        return b.isCallable ? 1 : 0;
      case 'rating': {
        const ratingScores = {
          'AAA': 10, 'AA+': 9, 'AA': 8, 'AA-': 7, 'A+': 6, 'A': 5, 'A-': 4,
          'BBB+': 3, 'BBB': 2, 'S/C': 0
        };
        const r = (b.rating || '').replace(/\s+/g, '');
        for (const [key, score] of Object.entries(ratingScores)) {
          if (r.includes(key)) return score;
        }
        return 0;
      }
      case 'law':
        return b.law || '';
      case 'maturity':
        return new Date(b.maturity).getTime() || 0;
      case 'tir':
        return b.tir || 0;
      case 'duration':
        return b.duration || 0;
      case 'parity':
        return b.parity || 0;
      case 'price':
        return b.cleanPrice || 0;
      case 'payCurr':
      case 'currency':
        return b.paymentCurrency || b.currency || '';
      default:
        return 0;
    }
  }

  handleHeaderClick(colId) {
    if (this.sortCol === colId) {
      if (this.sortDir === 'desc') {
        this.sortDir = 'asc';
      } else if (this.sortDir === 'asc') {
        this.sortCol = null;
        this.sortDir = null;
      }
    } else {
      this.sortCol = colId;
      this.sortDir = 'desc';
    }
    
    // Rerender headers to update indicators (▲ / ▼)
    this.renderBondsHeader();
    this.requestDashboardUpdate();
  }

  buildDefaultMarketVolumeData(cclRate = 1611, mepRate = 1539) {
    const mepToCable = (53.75 / 56.26); // Canje AL30C / AL30D = 0.9553857 (Canje +4.67%)
    let mepUSD = 0, mepNom = 0, mepOps = 0;
    let cclUSD = 0, cclNom = 0, cclOps = 0;
    let arsARS = 0, arsNom = 0, arsOps = 0;
    let totalOps = 0;

    const allTraded = [];
    const issuerAggMap = new Map();

    const aggregateIssuer = (issuerName, sectorName, item, cableUSD, rawMonto, currencyType, ops) => {
      if (!issuerAggMap.has(issuerName)) {
        issuerAggMap.set(issuerName, {
          name: issuerName,
          sector: sectorName,
          cableUSD: 0,
          mepUSD: 0,
          cclUSD: 0,
          arsARS: 0,
          ops: 0,
          speciesCount: 0,
          bonds: []
        });
      }
      const agg = issuerAggMap.get(issuerName);
      agg.cableUSD += cableUSD;
      agg.ops += ops;
      agg.speciesCount += 1;
      agg.bonds.push(item);
      if (currencyType === 'MEP') agg.mepUSD += rawMonto;
      else if (currencyType === 'CCL') agg.cclUSD += rawMonto;
      else agg.arsARS += rawMonto;
    };

    for (const b of this.bonds) {
      const issuerName = b.shortIssuer || b.company || (b.issuer ? b.issuer.replace(/\s+Clase\s+.*$/i, '').trim() : 'Corporativo');
      const sectorName = b.sector || 'Corporativos';

      // 1. Especie MEP (D)
      if (b.tickerMEP && (b.volumeMEP || b.volume)) {
        const v = b.volumeMEP || b.volume || 15000;
        const c = b.priceMEP || b.dirtyPrice || 100;
        const ops = b.tradesMEP || b.tradesCount || 6;
        const rawMonto = (v * c) / 100;
        const cableUSD = rawMonto * mepToCable;
        mepUSD += rawMonto;
        mepNom += v;
        mepOps += ops;
        totalOps += ops;
        const item = {
          symbol: b.tickerMEP,
          px: c,
          vol: v,
          usdVal: rawMonto,
          cableUSD: cableUSD,
          ops: ops,
          chg: 0.15,
          issuer: issuerName,
          sector: sectorName,
          currencyType: 'MEP',
          bondRef: b
        };
        allTraded.push(item);
        aggregateIssuer(issuerName, sectorName, item, cableUSD, rawMonto, 'MEP', ops);
      }

      // 2. Especie Cable (C)
      if (b.tickerCable && (b.volumeCable || b.volume)) {
        const v = b.volumeCable || Math.round((b.volume || 15000) * 0.25);
        const c = b.priceCable || b.dirtyPrice || 100;
        const ops = b.tradesCable || Math.round((b.tradesCount || 6) * 0.25) || 2;
        const rawMonto = (v * c) / 100;
        const cableUSD = rawMonto;
        cclUSD += rawMonto;
        cclNom += v;
        cclOps += ops;
        totalOps += ops;
        const item = {
          symbol: b.tickerCable,
          px: c,
          vol: v,
          usdVal: rawMonto,
          cableUSD: cableUSD,
          ops: ops,
          chg: 0.1,
          issuer: issuerName,
          sector: sectorName,
          currencyType: 'CCL',
          bondRef: b
        };
        allTraded.push(item);
        aggregateIssuer(issuerName, sectorName, item, cableUSD, rawMonto, 'CCL', ops);
      }

      // 3. Especie Pesos (O / sin letra)
      if (b.tickerPesos && (b.volumePesos || b.volume)) {
        const v = b.volumePesos || Math.round((b.volume || 15000) * 0.3);
        const c = b.pricePesos || ((b.dirtyPrice || 100) * cclRate);
        const ops = b.tradesPesos || Math.round((b.tradesCount || 6) * 0.3) || 3;
        const rawMonto = (v * c) / 100;
        const usdVal = rawMonto / cclRate;
        const cableUSD = rawMonto / cclRate;
        arsARS += rawMonto;
        arsNom += v;
        arsOps += ops;
        totalOps += ops;
        const item = {
          symbol: b.tickerPesos,
          px: c,
          vol: v,
          usdVal: usdVal,
          cableUSD: cableUSD,
          ops: ops,
          chg: 0.25,
          issuer: issuerName,
          sector: sectorName,
          currencyType: 'ARS',
          bondRef: b
        };
        allTraded.push(item);
        aggregateIssuer(issuerName, sectorName, item, cableUSD, rawMonto, 'ARS', ops);
      }
    }

    const arsUSD = arsARS / cclRate;
    const mepCableUSD = mepUSD * mepToCable;
    // Total consolidado de las 3 monedas expresado en Cable:
    const totalUSD = mepCableUSD + cclUSD + arsUSD;

    allTraded.sort((a, b) => b.cableUSD - a.cableUSD);

    const issuerList = Array.from(issuerAggMap.values())
      .filter(iss => iss.cableUSD > 0)
      .sort((a, b) => b.cableUSD - a.cableUSD);

    const totalCableMarket = issuerList.reduce((acc, i) => acc + i.cableUSD, 0);

    issuerList.forEach((iss, index) => {
      iss.rank = index + 1;
      iss.sharePct = totalCableMarket > 0 ? ((iss.cableUSD / totalCableMarket) * 100) : 0;
    });

    this.marketVolumeData = {
      cclRate,
      mepRate,
      canjeRatio: mepToCable,
      canjePct: ((1 / mepToCable) - 1) * 100,
      mepUSD, mepNom, mepOps, mepCableUSD,
      cclUSD, cclNom, cclOps,
      arsARS, arsUSD, arsNom, arsOps,
      totalUSD, totalOps,
      totalCableMarket,
      speciesCount: allTraded.length,
      topList: allTraded.slice(0, 10),
      issuerList,
      allTraded
    };
  }

  processMarketVolumeData(corpQuotes, cclRate = 1611, mepRate = null, sovQuotes = []) {
    if (!Array.isArray(corpQuotes) || corpQuotes.length === 0) {
      if (!this.marketVolumeData) this.buildDefaultMarketVolumeData(cclRate, mepRate);
      return;
    }

    // Dynamic canje calculation from benchmark AL30 / GD30 live quotes
    let mepToCable = null;
    if (Array.isArray(sovQuotes) && sovQuotes.length > 0) {
      const al30c = sovQuotes.find(q => q.symbol === 'AL30C')?.c;
      const al30d = sovQuotes.find(q => q.symbol === 'AL30D')?.c;
      if (al30c > 0 && al30d > 0) {
        mepToCable = al30c / al30d;
      } else {
        const gd30c = sovQuotes.find(q => q.symbol === 'GD30C')?.c;
        const gd30d = sovQuotes.find(q => q.symbol === 'GD30D')?.c;
        if (gd30c > 0 && gd30d > 0) {
          mepToCable = gd30c / gd30d;
        }
      }
    }
    // Fallback: AL30 benchmark closing ratio (53.75 / 56.26) = 0.9553857 (Canje +4.67%)
    if (!mepToCable || mepToCable <= 0) {
      mepToCable = (mepRate && cclRate) ? (mepRate / cclRate) : (53.75 / 56.26);
    }

    // Create fast lookup map for bonds in dataset
    const bondMap = new Map();
    this.bonds.forEach(b => {
      if (b.ticker) bondMap.set(b.ticker.toUpperCase(), b);
      if (b.tickerMEP) bondMap.set(b.tickerMEP.toUpperCase(), b);
      if (b.tickerCable) bondMap.set(b.tickerCable.toUpperCase(), b);
      if (b.tickerPesos) bondMap.set(b.tickerPesos.toUpperCase(), b);
    });

    // Known issuer mappings for high-volume tickers
    const knownIssuers = {
      'YM4': 'YPF S.A.', 'YM3': 'YPF S.A.', 'YMC': 'YPF S.A.', 'YFC': 'YPF Luz',
      'VSC': 'Vista Energy', 'PFC': 'Profertil', 'NZC': 'Banco Nación', 'ICC': 'ICBC',
      'T66': 'Tarjeta Naranja', 'BF3': 'BBVA', 'DHS': 'Credicuotas', 'BPC': 'Supervielle',
      'OLC': 'Oldelval', 'NHC': 'NBCH', 'LR7': 'Richmond', 'CS5': 'Cresud',
      'VWC': 'Volkswagen', 'CFS': 'CFN S.A.', 'RC3': 'Arcor', 'CAC': 'Capex',
      'CIC': 'CNH Industrial', 'GN4': 'Genneia', 'CP3': 'CGC', 'TSC': 'TGS',
      'HBC': 'Banco Hipotecario', 'PLC': 'Pluspetrol', 'BDC': 'BACS', 'BVC': 'BST',
      'HJC': 'John Deere', 'OTS': 'Otamérica', 'AFC': 'Banco Comafi', 'BGC': 'Banco Patagonia',
      'DNC': 'Edenor', 'PVC': 'Banco Provincia', 'BYC': 'Banco Galicia', 'SIC': 'Sidersa',
      'AER': 'AA2000', 'MIC': 'Mirgor', 'VBC': 'Banco de Valores', 'SXC': 'Mercado Pago',
      'BAC': 'Banco Macro', 'MGC': 'Pampa Energía', 'TLC': 'Telecom', 'TTC': 'Tecpetrol',
      'IRC': 'IRSA', 'STC': 'San Miguel', 'MR4': 'MSU Energy', 'PN3': 'Pan American Energy',
      'NPC': 'Central Puerto', 'WNC': 'Newsan', 'MCC': 'Pecom Energía'
    };

    let mepUSD = 0, mepNom = 0, mepOps = 0;
    let cclUSD = 0, cclNom = 0, cclOps = 0;
    let arsARS = 0, arsNom = 0, arsOps = 0;
    let totalOps = 0;

    const allTraded = [];
    const issuerAggMap = new Map();

    for (const q of corpQuotes) {
      const sym = (q.symbol || '').toUpperCase().trim();
      let v = Number(q.v) || 0;
      const c = Number(q.c) || 0;
      let ops = Number(q.q_op) || 0;
      if (c <= 0) continue;

      // Identify bond metadata
      const bondRef = bondMap.get(sym);

      // ROBUST FALLBACK CONTROL: When Data912 or BYMA does not report nominal volume (v <= 0 or off-market hours)
      if (v <= 0) {
        if (bondRef) {
          if (sym.endsWith('D')) {
            v = bondRef.volumeMEP || bondRef.volume || (ops > 0 ? ops * 3500 : 15000);
            ops = ops || bondRef.tradesMEP || bondRef.tradesCount || 5;
          } else if (sym.endsWith('C')) {
            v = bondRef.volumeCable || (bondRef.volume ? Math.round(bondRef.volume * 0.25) : (ops > 0 ? ops * 2500 : 10000));
            ops = ops || bondRef.tradesCable || Math.round((bondRef.tradesCount || 5) * 0.25) || 2;
          } else {
            v = bondRef.volumePesos || (bondRef.volume ? Math.round((bondRef.volume * 1560) / (c > 100 ? (c / 100) : 1500)) : (ops > 0 ? ops * 500000 : 15000));
            ops = ops || bondRef.tradesPesos || Math.round((bondRef.tradesCount || 5) * 0.3) || 3;
          }
        } else if (ops > 0) {
          if (sym.endsWith('D') || sym.endsWith('C')) {
            v = ops * 3500;
          } else {
            v = Math.round((ops * 2500000 * 100) / c);
          }
        }
      }

      if (v <= 0) continue;

      const rawMonto = (v * c) / 100;
      totalOps += ops;

      let usdVal = rawMonto;
      let cableUSD = 0; // Everything converted/arbitraged to Cable USD
      let currencyType = 'MEP';

      if (sym.endsWith('D')) {
        mepUSD += rawMonto;
        mepNom += v;
        mepOps += ops;
        usdVal = rawMonto;
        cableUSD = rawMonto * mepToCable; // MEP converted to Cable
        currencyType = 'MEP';
      } else if (sym.endsWith('C')) {
        cclUSD += rawMonto;
        cclNom += v;
        cclOps += ops;
        usdVal = rawMonto;
        cableUSD = rawMonto; // Already Cable
        currencyType = 'CCL';
      } else {
        arsARS += rawMonto;
        arsNom += v;
        arsOps += ops;
        usdVal = rawMonto / cclRate;
        cableUSD = rawMonto / cclRate; // ARS converted to Cable at CCL rate
        currencyType = 'ARS';
      }

      const prefix3 = sym.slice(0, 3);
      const issuerName = bondRef 
        ? (bondRef.shortIssuer || bondRef.issuer) 
        : (knownIssuers[prefix3] || sym);
      
      const sectorName = bondRef 
        ? (bondRef.sector || 'Corporativo') 
        : (issuerName.includes('YPF') || issuerName.includes('Vista') || issuerName.includes('Pampa') || issuerName.includes('Pan American') || issuerName.includes('Pluspetrol') || issuerName.includes('Central Puerto') || issuerName.includes('Capex') || issuerName.includes('Genneia') || issuerName.includes('Pecom') ? 'Energía & Petróleo' :
           issuerName.includes('Banco') || issuerName.includes('Galicia') || issuerName.includes('BBVA') || issuerName.includes('Macro') ? 'Bancos & Finanzas' : 'Corporativos');

      const tradedObj = {
        symbol: sym,
        px: c,
        vol: v,
        usdVal: usdVal,
        cableUSD: cableUSD,
        ops: ops,
        chg: Number(q.pct_change) || 0,
        issuer: issuerName,
        sector: sectorName,
        currencyType: currencyType,
        bondRef: bondRef || null
      };

      allTraded.push(tradedObj);

      // Aggregate by Issuer for "Por Emisor (Cable USD)" Treemap
      if (!issuerAggMap.has(issuerName)) {
        issuerAggMap.set(issuerName, {
          name: issuerName,
          sector: sectorName,
          cableUSD: 0,
          mepUSD: 0,
          cclUSD: 0,
          arsARS: 0,
          ops: 0,
          speciesCount: 0,
          bonds: []
        });
      }
      const agg = issuerAggMap.get(issuerName);
      agg.cableUSD += cableUSD;
      agg.ops += ops;
      agg.speciesCount += 1;
      agg.bonds.push(tradedObj);
      if (currencyType === 'MEP') agg.mepUSD += rawMonto;
      else if (currencyType === 'CCL') agg.cclUSD += rawMonto;
      else agg.arsARS += rawMonto;
    }

    if (allTraded.length === 0) {
      this.buildDefaultMarketVolumeData(cclRate, mepRate);
      return;
    }

    const arsUSD = arsARS / cclRate;
    const mepCableUSD = mepUSD * mepToCable;
    // Total de las 3 monedas expresado en Cable:
    const totalUSD = mepCableUSD + cclUSD + arsUSD;

    // Sort species descending by Cable USD traded amount
    allTraded.sort((a, b) => b.cableUSD - a.cableUSD);

    // Build Issuer ranking list sorted descending by total Cable USD
    const issuerList = Array.from(issuerAggMap.values())
      .filter(iss => iss.cableUSD > 0)
      .sort((a, b) => b.cableUSD - a.cableUSD);

    const totalCableMarket = issuerList.reduce((acc, i) => acc + i.cableUSD, 0);

    issuerList.forEach((iss, index) => {
      iss.rank = index + 1;
      iss.sharePct = totalCableMarket > 0 ? ((iss.cableUSD / totalCableMarket) * 100) : 0;
    });

    this.marketVolumeData = {
      cclRate,
      mepRate,
      canjeRatio: mepToCable,
      canjePct: ((1 / mepToCable) - 1) * 100,
      mepUSD, mepNom, mepOps, mepCableUSD,
      cclUSD, cclNom, cclOps,
      arsARS, arsUSD, arsNom, arsOps,
      totalUSD, totalOps,
      totalCableMarket,
      speciesCount: allTraded.length,
      topList: allTraded.slice(0, 10),
      issuerList,
      allTraded
    };
  }

  renderHomeMarket() {
    if (!this.marketVolumeData) {
      this.buildDefaultMarketVolumeData(1560, 1520);
    }
    const d = this.marketVolumeData;
    if (!d) return;

    // Helper formatters
    const fmtMillions = (n) => {
      if (!n || isNaN(n)) return '0.0M';
      if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
      return Math.round(n).toLocaleString('es-AR');
    };

    // 1. MEP Card (Headline in Cable USD, footer in MEP original)
    const mepValEl = document.getElementById('home-vol-mep-val');
    const mepTradesEl = document.getElementById('home-mep-trades');
    const mepNomEl = document.getElementById('home-mep-nom');
    const mepCable = d.mepCableUSD || (d.mepUSD * (d.canjeRatio || (53.75 / 56.26)));
    if (mepValEl) mepValEl.textContent = `US$ ${fmtMillions(mepCable)}`;
    if (mepTradesEl) mepTradesEl.textContent = `${d.mepOps.toLocaleString('es-AR')} ops`;
    if (mepNomEl) mepNomEl.textContent = `US$ ${fmtMillions(d.mepUSD)} MEP`;

    // 2. CCL Card (Already Cable USD, footer with nominals)
    const cclValEl = document.getElementById('home-vol-ccl-val');
    const cclTradesEl = document.getElementById('home-ccl-trades');
    const cclNomEl = document.getElementById('home-ccl-nom');
    if (cclValEl) cclValEl.textContent = `US$ ${fmtMillions(d.cclUSD)}`;
    if (cclTradesEl) cclTradesEl.textContent = `${d.cclOps.toLocaleString('es-AR')} ops`;
    if (cclNomEl) cclNomEl.textContent = `${fmtMillions(d.cclNom)} nom`;

    // 3. ARS Card (Headline in Cable USD, footer in Pesos original)
    const arsValEl = document.getElementById('home-vol-ars-val');
    const arsTradesEl = document.getElementById('home-ars-trades');
    const arsUsdEqEl = document.getElementById('home-ars-usd-equiv');
    if (arsValEl) arsValEl.textContent = `US$ ${fmtMillions(d.arsUSD)}`;
    if (arsTradesEl) arsTradesEl.textContent = `${d.arsOps.toLocaleString('es-AR')} ops`;
    if (arsUsdEqEl) arsUsdEqEl.textContent = `$ ${fmtMillions(d.arsARS)} ARS`;

    // 4. Total Consolidado Card
    const totValEl = document.getElementById('home-vol-total-val');
    const totTradesEl = document.getElementById('home-total-trades-badge');
    const totCountEl = document.getElementById('home-total-species-count');
    const cclRefEl = document.getElementById('home-ccl-ref');
    if (totValEl) totValEl.textContent = `US$ ${fmtMillions(d.totalUSD)}`;
    if (totTradesEl) totTradesEl.textContent = `${d.totalOps.toLocaleString('es-AR')} trades`;
    if (totCountEl) totCountEl.textContent = `${d.speciesCount} ONs operadas`;
    if (cclRefEl) cclRefEl.textContent = `$${Math.round(d.cclRate).toLocaleString('es-AR')}`;

    // Liquidity Distribution Bar (all converted to Cable USD)
    const pctMEP = d.totalUSD > 0 ? ((mepCable / d.totalUSD) * 100) : 0;
    const pctCCL = d.totalUSD > 0 ? ((d.cclUSD / d.totalUSD) * 100) : 0;
    const pctARS = d.totalUSD > 0 ? ((d.arsUSD / d.totalUSD) * 100) : 0;

    const barMep = document.getElementById('bar-dist-mep');
    const barCcl = document.getElementById('bar-dist-ccl');
    const barArs = document.getElementById('bar-dist-ars');
    if (barMep) barMep.style.width = `${pctMEP.toFixed(1)}%`;
    if (barCcl) barCcl.style.width = `${pctCCL.toFixed(1)}%`;
    if (barArs) barArs.style.width = `${pctARS.toFixed(1)}%`;

    const lblMep = document.getElementById('pct-mep-label');
    const lblCcl = document.getElementById('pct-ccl-label');
    const lblArs = document.getElementById('pct-ars-label');
    if (lblMep) lblMep.textContent = `${pctMEP.toFixed(1)}% (US$ ${fmtMillions(mepCable)})`;
    if (lblCcl) lblCcl.textContent = `${pctCCL.toFixed(1)}% (US$ ${fmtMillions(d.cclUSD)})`;
    if (lblArs) lblArs.textContent = `${pctARS.toFixed(1)}% (US$ ${fmtMillions(d.arsUSD)})`;

    // Render Top 10 Ranking
    const rankContainer = document.getElementById('home-top-ranking-list');
    if (rankContainer && Array.isArray(d.topList)) {
      rankContainer.innerHTML = d.topList.map((item, idx) => {
        const chgClass = item.chg > 0 ? 'text-green' : item.chg < 0 ? 'text-red' : 'text-slate';
        const chgSign = item.chg > 0 ? '+' : '';
        const chgColor = item.chg > 0 ? '#10b981' : item.chg < 0 ? '#ef4444' : '#94a3b8';
        const currBadge = item.symbol.endsWith('D') ? 'badge-mep' : item.symbol.endsWith('C') ? 'badge-ccl' : 'badge-ars';
        const currLabel = item.symbol.endsWith('D') ? 'MEP' : item.symbol.endsWith('C') ? 'CCL' : 'ARS';
        
        return `
          <div class="top-ranking-row" style="display: flex; align-items: center; justify-content: space-between; padding: 0.48rem 0.65rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onclick="window.app.handleHomeTickerClick('${item.symbol}')">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span class="top-ranking-idx" style="font-size: 0.75rem; font-weight: 800; color: var(--accent-lime); width: 18px; font-family: var(--font-mono);">${idx + 1}.</span>
              <div>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                  <strong class="top-ranking-ticker" style="font-size: 0.88rem; font-family: var(--font-mono);">${item.symbol}</strong>
                  <span style="font-size: 0.62rem; padding: 1px 4px; border-radius: 3px; font-weight: 700; background: ${item.symbol.endsWith('D') ? 'rgba(16,185,129,0.15)' : item.symbol.endsWith('C') ? 'rgba(56,189,248,0.15)' : 'rgba(245,158,11,0.15)'}; color: ${item.symbol.endsWith('D') ? '#10b981' : item.symbol.endsWith('C') ? '#0284c7' : '#d97706'};">${currLabel}</span>
                </div>
                <div style="font-size: 0.68rem; color: var(--text-dim); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.issuer}</div>
              </div>
            </div>
            <div style="text-align: right; font-family: var(--font-mono);">
              <div class="top-ranking-monto" style="font-size: 0.82rem; font-weight: 800; color: var(--accent-lime);">US$ ${fmtMillions(item.usdVal)}</div>
              <div style="font-size: 0.68rem; color: ${chgColor}; font-weight: 600;">${chgSign}${item.chg.toFixed(2)}% • ${item.ops} ops</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Prepare Treemap Layout (Por Emisor con Cable USD vs Por Especie & % Var)
    if (this.treemap) {
      const parent = this.treemap.canvas?.parentElement;
      if (parent && parent.clientWidth > 0 && (!this.treemap.cssWidth || this.treemap.cssWidth !== parent.clientWidth)) {
        this.treemap.resize();
      }

      if (this.treemapMode === 'issuer') {
        // --- 🏢 MODO POR EMISOR: CABLE CONSOLIDADO (MEP + CCL + ARS -> CABLE) ---
        // Blue/Cyan institutional color palette highlighting market liquidity leaders
        const getIssuerColor = (rank) => {
          if (rank === 1) return '#0ea5e9'; // Bright Cyan / Sky Blue (Market Leader)
          if (rank <= 3) return '#0284c7';  // Blue
          if (rank <= 6) return '#0369a1';  // Medium Blue
          if (rank <= 10) return '#075985'; // Deep Ocean Blue
          if (rank <= 15) return '#0c4a6e'; // Navy
          return '#1e293b';                // Slate
        };

        const rawIssuers = (d.issuerList || []).filter(iss => iss.cableUSD > 0);
        const TOP_LIMIT = 28; // Keep top 28 issuers clean, group remaining into Resto
        const primaryIssuers = rawIssuers.slice(0, TOP_LIMIT);
        const restIssuers = rawIssuers.slice(TOP_LIMIT);

        const issuerItems = primaryIssuers.map(iss => {
          return {
            symbol: iss.name,
            name: iss.name,
            value: iss.cableUSD,
            cableUSD: iss.cableUSD,
            mepUSD: iss.mepUSD,
            cclUSD: iss.cclUSD,
            arsARS: iss.arsARS,
            ops: iss.ops,
            speciesCount: iss.speciesCount,
            sector: iss.sector,
            rank: iss.rank,
            sharePct: iss.sharePct,
            subLabel: `US$ ${fmtMillions(iss.cableUSD)}`,
            color: getIssuerColor(iss.rank),
            isIssuerSummary: true
          };
        });

        if (restIssuers.length > 0) {
          const restCableUSD = restIssuers.reduce((sum, i) => sum + i.cableUSD, 0);
          const restMepUSD = restIssuers.reduce((sum, i) => sum + (i.mepUSD || 0), 0);
          const restCclUSD = restIssuers.reduce((sum, i) => sum + (i.cclUSD || 0), 0);
          const restArsARS = restIssuers.reduce((sum, i) => sum + (i.arsARS || 0), 0);
          const restOps = restIssuers.reduce((sum, i) => sum + (i.ops || 0), 0);
          const restSpeciesCount = restIssuers.reduce((sum, i) => sum + (i.speciesCount || 0), 0);
          const totalCableMarket = d.totalCableMarket || 1;
          const restSharePct = (restCableUSD / totalCableMarket) * 100;

          issuerItems.push({
            symbol: 'Resto',
            name: `Resto (${restIssuers.length} emisores)`,
            value: restCableUSD,
            cableUSD: restCableUSD,
            mepUSD: restMepUSD,
            cclUSD: restCclUSD,
            arsARS: restArsARS,
            ops: restOps,
            speciesCount: restSpeciesCount,
            sector: 'Diversos Emisores',
            rank: `${TOP_LIMIT + 1}-${rawIssuers.length}`,
            sharePct: restSharePct,
            subLabel: `US$ ${fmtMillions(restCableUSD)}`,
            color: '#1e293b',
            isIssuerSummary: true
          });
        }

        this.treemap.render(issuerItems);
      } else {
        // --- 📊 MODO POR ESPECIE & % VARIACIÓN DIARIA ---
        const issuerGroups = new Map();
        d.allTraded.forEach(item => {
          if (!issuerGroups.has(item.issuer)) {
            issuerGroups.set(item.issuer, []);
          }
          issuerGroups.get(item.issuer).push(item);
        });

        const rawCategories = [];
        issuerGroups.forEach((items, issuerName) => {
          const catTotal = items.reduce((sum, i) => sum + i.cableUSD, 0);
          if (catTotal > 0) {
            rawCategories.push({
              name: issuerName,
              value: catTotal,
              rawItems: items
            });
          }
        });

        rawCategories.sort((a, b) => b.value - a.value);

        // Agrupar emisores menores (fuera del top 20 o con volumen < US$ 10.000) en un bloque 'Resto'
        const TOP_CAT_LIMIT = 20;
        const mainCategories = rawCategories.slice(0, TOP_CAT_LIMIT).filter(c => c.value >= 10000);
        const overflowCategories = rawCategories.slice(mainCategories.length);

        const categories = mainCategories.map(cat => {
          // Dentro de cada emisor principal, ordenar especies y agrupar colas diminutas (< US$ 2.000 o más allá del top 8)
          const sortedItems = [...cat.rawItems].sort((a, b) => b.cableUSD - a.cableUSD);
          const topSpecies = sortedItems.slice(0, 8).filter(i => i.cableUSD >= 2000);
          const restSpecies = sortedItems.slice(topSpecies.length);

          const children = topSpecies.map(i => ({
            symbol: i.symbol,
            name: i.issuer,
            value: i.cableUSD,
            cableUSD: i.cableUSD,
            usdVal: i.usdVal,
            px: i.px,
            vol: i.vol,
            ops: i.ops,
            chg: i.chg,
            subLabel: (i.chg > 0 ? `+${i.chg.toFixed(2)}%` : `${(i.chg || 0).toFixed(2)}%`),
            bondRef: i.bondRef,
            maturity: i.bondRef?.maturity || '',
            isIssuerSummary: false
          }));

          if (restSpecies.length > 0) {
            const restVal = restSpecies.reduce((s, i) => s + i.cableUSD, 0);
            const restVol = restSpecies.reduce((s, i) => s + (i.vol || 0), 0);
            const restOps = restSpecies.reduce((s, i) => s + (i.ops || 0), 0);
            // Promedio ponderado de variación
            const weightedChg = restVal > 0 ? restSpecies.reduce((s, i) => s + (i.chg || 0) * i.cableUSD, 0) / restVal : 0;
            children.push({
              symbol: 'Otras',
              name: `${cat.name} (${restSpecies.length} ONs)`,
              value: restVal,
              cableUSD: restVal,
              usdVal: restVal,
              px: 0,
              vol: restVol,
              ops: restOps,
              chg: weightedChg,
              subLabel: (weightedChg > 0 ? `+${weightedChg.toFixed(2)}%` : `${weightedChg.toFixed(2)}%`),
              isIssuerSummary: false
            });
          }

          return {
            name: cat.name,
            value: cat.value,
            children
          };
        });

        // Si existen emisores menores fuera de los principales, agruparlos en un macro-bloque "Resto de Emisores"
        if (overflowCategories.length > 0) {
          const allOverflowItems = overflowCategories.flatMap(c => c.rawItems);
          const overflowTotal = allOverflowItems.reduce((s, i) => s + i.cableUSD, 0);
          
          if (overflowTotal > 0) {
            // Ordenar y tomar los más relevantes de este grupo o resumir
            const sortedOverflow = [...allOverflowItems].sort((a, b) => b.cableUSD - a.cableUSD);
            const topOverflow = sortedOverflow.slice(0, 10).filter(i => i.cableUSD >= 2000);
            const tailOverflow = sortedOverflow.slice(topOverflow.length);

            const overflowChildren = topOverflow.map(i => ({
              symbol: i.symbol,
              name: i.issuer,
              value: i.cableUSD,
              cableUSD: i.cableUSD,
              usdVal: i.usdVal,
              px: i.px,
              vol: i.vol,
              ops: i.ops,
              chg: i.chg,
              subLabel: (i.chg > 0 ? `+${i.chg.toFixed(2)}%` : `${(i.chg || 0).toFixed(2)}%`),
              bondRef: i.bondRef,
              maturity: i.bondRef?.maturity || '',
              isIssuerSummary: false
            }));

            if (tailOverflow.length > 0) {
              const tailVal = tailOverflow.reduce((s, i) => s + i.cableUSD, 0);
              const tailVol = tailOverflow.reduce((s, i) => s + (i.vol || 0), 0);
              const tailOps = tailOverflow.reduce((s, i) => s + (i.ops || 0), 0);
              const tailChg = tailVal > 0 ? tailOverflow.reduce((s, i) => s + (i.chg || 0) * i.cableUSD, 0) / tailVal : 0;
              overflowChildren.push({
                symbol: 'Resto',
                name: `Otras ${tailOverflow.length} especies menores`,
                value: tailVal,
                cableUSD: tailVal,
                usdVal: tailVal,
                px: 0,
                vol: tailVol,
                ops: tailOps,
                chg: tailChg,
                subLabel: (tailChg > 0 ? `+${tailChg.toFixed(2)}%` : `${tailChg.toFixed(2)}%`),
                isIssuerSummary: false
              });
            }

            categories.push({
              name: `Resto (${overflowCategories.length} emisores)`,
              value: overflowTotal,
              children: overflowChildren
            });
          }
        }

        this.treemap.render(categories);
      }
    }
  }

  handleHomeTickerClick(symbolOrIssuer) {
    if (!symbolOrIssuer) return;
    const cleanQuery = symbolOrIssuer.trim();
    if (cleanQuery === 'Resto' || cleanQuery === 'Otras') return;
    const cleanUpper = cleanQuery.toUpperCase();

    // 1. Try finding individual bond
    const bond = this.bonds.find(b => 
      b.ticker?.toUpperCase() === cleanUpper ||
      b.tickerMEP?.toUpperCase() === cleanUpper ||
      b.tickerCable?.toUpperCase() === cleanUpper ||
      b.tickerPesos?.toUpperCase() === cleanUpper
    );
    if (bond) {
      this.openModal(bond);
      return;
    }

    // 2. If it is an Issuer name (clicked in issuer mode), switch to Hard USD and search this issuer
    const matchingBonds = this.bonds.filter(b => 
      (b.shortIssuer && b.shortIssuer.toLowerCase().includes(cleanQuery.toLowerCase())) ||
      (b.issuer && b.issuer.toLowerCase().includes(cleanQuery.toLowerCase()))
    );

    if (matchingBonds.length > 0) {
      // Switch active tab to Hard USD
      const navTabs = document.querySelectorAll('#main-tabs .nav-btn');
      navTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.group === 'Hard USD');
      });
      this.selectedGroup = 'Hard USD';

      // Set global search input
      this.searchQuery = cleanQuery.toLowerCase();
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = cleanQuery;

      this.renderIssuerSelect();
      this.renderRatingSelect();
      this.renderBondsHeader();
      this.requestDashboardUpdate();
    }
  }

  updateDashboard() {
    const isHome = (this.selectedGroup === 'Inicio');

    // Section containers
    const homeSection = document.getElementById('view-home-market');
    const searchSection = document.getElementById('search-bar-section');
    const filtersSection = document.querySelector('.filters-card-section');
    const curveSection = document.getElementById('view-chart-container');
    const tableSection = document.getElementById('view-table');

    if (isHome) {
      if (homeSection) homeSection.style.display = 'block';
      if (searchSection) searchSection.style.display = 'none';
      if (filtersSection) filtersSection.style.display = 'none';
      if (curveSection) curveSection.style.display = 'none';
      if (tableSection) tableSection.style.display = 'none';

      // Hide TAMAR & UVA reference sections in Home
      const tamarSection = document.getElementById('tamar-reference-section');
      if (tamarSection) tamarSection.style.display = 'none';
      const uvaSection = document.getElementById('uva-reference-section');
      if (uvaSection) uvaSection.style.display = 'none';

      this.renderHomeMarket();
      return;
    }

    // Non-Home views: show table and curve
    if (homeSection) homeSection.style.display = 'none';
    if (searchSection) searchSection.style.display = 'block';
    if (filtersSection) filtersSection.style.display = 'block';
    if (curveSection) curveSection.style.display = 'block';
    if (tableSection) tableSection.style.display = 'block';

    const filteredBonds = this.getFilteredBonds();
    this.renderBondsTable(filteredBonds);

    // Toggle benchmark cards visibility
    const tamarSection = document.getElementById('tamar-reference-section');
    if (tamarSection) {
      tamarSection.style.display = (this.selectedGroup === 'Pesos TAMAR') ? 'block' : 'none';
    }

    const uvaSection = document.getElementById('uva-reference-section');
    if (uvaSection) {
      uvaSection.style.display = (this.selectedGroup === 'Pesos UVA') ? 'block' : 'none';
    }
    
    // Toggle HD Currency filter container in curve controls (visible only in Hard USD tab)
    const curveCurrContainer = document.getElementById('curve-currency-filter-container');
    const isHardUsdTab = (this.selectedGroup === 'Hard USD');
    if (curveCurrContainer) {
      curveCurrContainer.style.display = isHardUsdTab ? 'flex' : 'none';
    }
    const curveCurrSelect = document.getElementById('curve-currency-select');
    if (curveCurrSelect) {
      curveCurrSelect.value = this.hdCurveCurrency || 'ALL';
    }
    const durSelect = document.getElementById('duration-metric-select');
    if (durSelect) {
      durSelect.value = this.selectedDurationMetric || 'modified';
    }

    // Determine bonds to render in Yield Curve (respects HD currency filter if in Hard USD tab)
    let curveBonds = filteredBonds;
    if (isHardUsdTab && this.hdCurveCurrency && this.hdCurveCurrency !== 'ALL') {
      curveBonds = filteredBonds.filter(b => {
        const isCable = b.paymentCurrency === 'Dólar Cable' || b.law === 'Nueva York' || (b.ticker && b.ticker.endsWith('C')) || b.instrumentGroup === 'USD Cable';
        if (this.hdCurveCurrency === 'CABLE') return isCable;
        if (this.hdCurveCurrency === 'MEP') return !isCable;
        return true;
      });
    }
    
    // Render the yield curve chart with the filtered bonds list
    if (this.yieldCurve) {
      this.yieldCurve.render(
        curveBonds,
        (bond) => {
          this.openModal(bond);
        },
        this.selectedRegressionType,
        this.selectedDurationMetric,
        this.showFittedCurve,
        this.selectedGroup === 'Favoritos',
        isHardUsdTab ? this.hdCurveCurrency : 'ALL'
      );
    }
  }

  renderBondsHeader() {
    const thead = document.querySelector('.bonds-table thead');
    if (!thead) return;

    thead.innerHTML = `
      <tr>
        ${this.columnOrder.map((colId, index) => {
          const col = this.columns.find(c => c.id === colId);
          if (!col) return '';
          const draggable = colId !== 'fav' ? 'draggable="true"' : '';
          const widthStyle = this.columnWidths[colId] ? `style="width: ${this.columnWidths[colId]}px; min-width: ${this.columnWidths[colId]}px;"` : '';
          
          let sortIndicator = '';
          if (this.sortCol === colId) {
            sortIndicator = this.sortDir === 'desc' ? ' ▼' : ' ▲';
          }
          
          return `
            <th id="th-${colId}" data-col="${colId}" data-index="${index}" ${draggable} ${widthStyle} class="${colId === 'fav' ? 'fav-th' : ''} ${this.sortCol === colId ? 'sorted-th' : ''}">
              <div class="th-content">
                <span class="th-label" style="pointer-events: none;">${col.label}${sortIndicator}</span>
                ${colId !== 'fav' ? '<span class="drag-indicator">⋮⋮</span>' : ''}
              </div>
              ${colId !== 'fav' ? '<div class="resize-handle"></div>' : ''}
            </th>
          `;
        }).join('')}
      </tr>
    `;

    this.setupHeaderEvents();
  }

  setupHeaderEvents() {
    const headers = document.querySelectorAll('.bonds-table th');
    
    // 1. Resizing logic
    headers.forEach(th => {
      const handle = th.querySelector('.resize-handle');
      if (!handle) return;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const colId = th.dataset.col;
        const startX = e.pageX;
        const startWidth = th.offsetWidth;
        
        handle.classList.add('resizing');
        
        const onMouseMove = (moveEvt) => {
          const newWidth = Math.max(5, startWidth + (moveEvt.pageX - startX));
          th.style.width = `${newWidth}px`;
          th.style.minWidth = `${newWidth}px`;
          this.columnWidths[colId] = newWidth;
        };
        
        const onMouseUp = () => {
          handle.classList.remove('resizing');
          this.saveColumnWidths();
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };
        
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    });

    // 2. Drag & Drop logic for reordering
    let draggedColId = null;

    headers.forEach(th => {
      if (th.getAttribute('draggable') !== 'true') return;

      th.addEventListener('dragstart', (e) => {
        this.isDragging = true;
        draggedColId = th.dataset.col;
        th.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedColId);
      });

      th.addEventListener('dragover', (e) => {
        e.preventDefault();
        const targetTh = e.target.closest('th');
        if (targetTh && targetTh.dataset.col !== draggedColId && targetTh.dataset.col !== 'fav') {
          targetTh.classList.add('drag-over');
        }
      });

      th.addEventListener('dragleave', (e) => {
        const targetTh = e.target.closest('th');
        if (targetTh) {
          targetTh.classList.remove('drag-over');
        }
      });

      th.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetTh = e.target.closest('th');
        if (targetTh) {
          targetTh.classList.remove('drag-over');
          const targetColId = targetTh.dataset.col;
          
          if (draggedColId && targetColId && draggedColId !== targetColId && targetColId !== 'fav') {
            const dragIdx = this.columnOrder.indexOf(draggedColId);
            const targetIdx = this.columnOrder.indexOf(targetColId);
            
            // Reorder in columnOrder array
            this.columnOrder.splice(dragIdx, 1);
            this.columnOrder.splice(targetIdx, 0, draggedColId);
            
            this.saveColumnOrder();
            this.renderBondsHeader();
            this.requestDashboardUpdate();
          }
        }
      });

      th.addEventListener('dragend', () => {
        th.classList.remove('dragging');
        headers.forEach(h => h.classList.remove('drag-over'));
        setTimeout(() => {
          this.isDragging = false;
        }, 50);
      });
    });

    // 3. Sorting logic on click
    headers.forEach(th => {
      th.addEventListener('click', (e) => {
        // If clicked on resize handle or drag indicator, do not sort
        if (e.target.classList.contains('resize-handle') || e.target.classList.contains('drag-indicator')) {
          return;
        }
        if (this.isDragging) return;
        const colId = th.dataset.col;
        this.handleHeaderClick(colId);
      });
    });
  }

  renderBondsTable(bondsList) {
    const tbody = document.getElementById('bonds-table-body');
    if (!tbody) return;

    if (bondsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${this.columnOrder.length}" style="text-align: center; color: var(--text-dim); padding: 2rem;">No se encontraron especies con los filtros seleccionados</td></tr>`;
      return;
    }

    tbody.innerHTML = bondsList.map(b => {
      const isFav = this.favorites.includes(b.id);
      
      const cellsHtml = this.columnOrder.map(colId => {
        const col = this.columns.find(c => c.id === colId);
        if (!col) return '';
        return col.render(b, isFav);
      }).join('');

      return `
        <tr id="row-${b.id}" data-id="${b.id}">
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.dataset.id;
        const bond = this.calculatedBonds.find(b => b.id === id);
        if (bond) this.openModal(bond);
      });
    });
  }

  formatNumber(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    const num = Number(val);
    const locale = (this.numberLocale === 'us') ? 'en-US' : 'es-AR';
    return num.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  toggleNumberFormat() {
    this.numberLocale = (this.numberLocale === 'ar') ? 'us' : 'ar';
    localStorage.setItem('argen_bonds_number_locale', this.numberLocale);
    this.updateNumberFormatButton();
    this.requestDashboardUpdate();
    if (this.selectedBondForModal) {
      this.refreshModalCurrencyView();
    }
  }

  updateNumberFormatButton() {
    const btn = document.getElementById('btn-toggle-number-format');
    if (!btn) return;
    if (this.numberLocale === 'ar') {
      btn.textContent = '1.234,56';
      btn.title = 'Formato numérico actual: Argentina (1.234,56). Clic para cambiar a Internacional (1,234.56)';
    } else {
      btn.textContent = '1,234.56';
      btn.title = 'Formato numérico actual: Internacional (1,234.56). Clic para cambiar a Argentina (1.234,56)';
    }
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  toggleFavorite(bondId) {
    if (this.favorites.includes(bondId)) {
      this.favorites = this.favorites.filter(id => id !== bondId);
    } else {
      this.favorites.push(bondId);
    }
    this.saveFavorites();
    this.requestDashboardUpdate();
  }

  getFxRate() {
    const fxInput = document.getElementById('calc-fx-rate');
    return (fxInput && parseFloat(fxInput.value) > 0) ? parseFloat(fxInput.value) : 1280.0;
  }

  showPaymentCurrencyHint(curr) {
    const wrap = document.querySelector('.calc-currency-selector');
    if (!wrap) return;
    wrap.style.position = 'relative';
    wrap.querySelector('.pay-curr-bubble')?.remove();
    clearTimeout(this._payHintTimer);
    const labels = { MEP: 'MEP', CCL: 'CABLE', ARS: 'PESOS' };
    const bubble = document.createElement('div');
    bubble.className = 'pay-curr-bubble';
    bubble.setAttribute('role', 'status');
    bubble.textContent = `ESTA ESPECIE PAGA ${labels[curr] || curr}`;
    wrap.appendChild(bubble);
    // Position after the modal is laid out
    setTimeout(() => {
      const btn = wrap.querySelector(`.btn-calc-curr[data-curr="${curr}"]`);
      if (btn) bubble.style.left = (btn.offsetLeft + btn.offsetWidth / 2) + 'px';
      bubble.classList.add('show');
    }, 60);
    this._payHintTimer = setTimeout(() => {
      bubble.classList.remove('show');
      setTimeout(() => bubble.remove(), 400);
    }, 3060);
  }

  openModal(bond) {
    this.selectedBondForModal = bond;

    // Auto-select currency based on bond classification
    if (bond.paymentCurrency === 'Dólar Cable' || bond.instrumentGroup === 'USD Cable' || bond.ticker.endsWith('C')) {
      this.modalCurrency = 'CCL';
    } else if (bond.paymentCurrency === 'Pesos' || bond.currency === 'ARS') {
      this.modalCurrency = 'ARS';
    } else {
      this.modalCurrency = 'MEP';
    }

    document.querySelectorAll('.btn-calc-curr').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.curr === this.modalCurrency);
    });
    this.showPaymentCurrencyHint(this.modalCurrency);

    const isinStatus = bond.isin || 'S/D';
    let amountStr = '';
    const currPrefix = (bond.currency === 'ARS' || bond.paymentCurrency === 'Pesos') ? 'AR$ ' : 'US$ ';
    if (bond.emissionTranches && Array.isArray(bond.emissionTranches) && bond.emissionTranches.length > 0) {
      const tranchesStr = bond.emissionTranches.map(t => `${t.name === '1ra Emisión' ? 'Emisión' : t.name}: ${currPrefix}${this.formatNumber(t.amount, 0)}`).join(', ');
      amountStr = ` • Emisión: ${currPrefix}${this.formatNumber(bond.issuedAmount, 0)} (${tranchesStr})`;
    } else if (bond.issuedAmount) {
      amountStr = ` • Emisión: ${currPrefix}${this.formatNumber(bond.issuedAmount, 0)}`;
    }

    const vtoDateStr = bond.maturity ? ` • Venc: ${this.formatDate(bond.maturity)}` : '';
    document.getElementById('modal-bond-ticker').textContent = `${bond.ticker} - ${bond.issuer}${vtoDateStr}`;
    const callStr = bond.isCallable ? (bond.callDate ? ` • Call: ${bond.callDate}${bond.callPrice ? ` @ $${bond.callPrice}` : ''}` : ' (Callable)') : '';
    document.getElementById('modal-bond-isin').textContent = `ISIN: ${isinStatus} • Ley: ${bond.law} • Pago: ${bond.paymentCurrency} • Especie: ${bond.instrumentGroup} • Estructura: ${bond.structureType}${callStr} • Rating: ${bond.rating} (${bond.ratingAgency || 'FIX'})${amountStr}`;

    const flowHeader = document.getElementById('modal-flow-curr-header');
    if (flowHeader) {
      flowHeader.textContent = `Flujo Total (${bond.paymentCurrency})`;
    }

    this.refreshModalCurrencyView();

    // Update settlement mode indicator
    const settlEl = document.getElementById('modal-market-settlement');
    const lastLbl = document.getElementById('modal-market-last-lbl');
    if (settlEl) {
      const isCI = this.settlementMode === 'T+0';
      const settlDate = FinancialMath.getSettlementDate(this.settlementMode);
      settlEl.textContent = `Liquida: ${this.formatDate(settlDate)}`;
      if (lastLbl) {
        lastLbl.textContent = isCI ? 'Precio CI' : 'Precio T+1';
      }
    }

    document.getElementById('bond-modal')?.classList.add('active');
  }

  refreshModalCurrencyView() {
    const bond = this.selectedBondForModal;
    if (!bond) return;

    const isArsBond = (bond.currency === 'ARS' || bond.paymentCurrency === 'Pesos');
    const curr = this.modalCurrency || (isArsBond ? 'ARS' : 'MEP');
    const fxRate = this.getFxRate();
    const mult = isArsBond ? 1.0 : ((curr === 'ARS') ? fxRate : 1.0);
    const currSymbol = (curr === 'ARS') ? 'ARS $' : '$';
    const currLabel = (curr === 'MEP') ? 'MEP' : (curr === 'CCL') ? 'Cable' : 'ARS';

    document.getElementById('lbl-clean-price').textContent = `Precio Limpio (${currLabel}) ✍`;
    document.getElementById('lbl-accrued-interest').textContent = `Interés Corrido (${currLabel})`;
    document.getElementById('lbl-dirty-price').textContent = `Precio Sucio (${currLabel}) ✍`;

    // Determine active ticker and quote for the chosen currency
    let activeTicker = bond.ticker;
    let tickerQuote = null;
    if (curr === 'MEP') {
      activeTicker = bond.tickerMEP || (bond.ticker.endsWith('C') ? bond.ticker.slice(0, -1) + 'D' : bond.ticker);
    } else if (curr === 'CCL') {
      activeTicker = bond.tickerCable || (bond.ticker.endsWith('D') ? bond.ticker.slice(0, -1) + 'C' : bond.ticker);
    } else if (curr === 'ARS') {
      activeTicker = bond.tickerPesos || bond.ticker.replace(/[CD]$/, 'O');
    }

    if (this.data912?.quotesMap) {
      tickerQuote = this.data912.quotesMap.get(activeTicker.toUpperCase()) || this.data912.quotesMap.get(bond.ticker.toUpperCase());
    }

    const accruedVal = bond.accruedInterest * mult;

    // MANDATORY ARGENTINE MARKET RULE:
    // In BYMA / MAE, traded market prices are ALWAYS DIRTY PRICES (con cupón corrido).
    let dirtyVal = bond.dirtyPrice;
    if (isArsBond) {
      dirtyVal = (typeof bond.pricePesos === 'number' && bond.pricePesos > 0) ? bond.pricePesos : bond.dirtyPrice;
    } else if (curr === 'MEP' && typeof bond.priceMEP === 'number') {
      dirtyVal = bond.priceMEP;
    } else if (curr === 'CCL' && typeof bond.priceCable === 'number') {
      dirtyVal = bond.priceCable;
    } else if (curr === 'ARS') {
      // Data912 peso prices (YM34O, etc.) are already per 100 VN in ARS. No division needed.
      dirtyVal = (typeof bond.pricePesos === 'number' && bond.pricePesos > 1000) 
        ? bond.pricePesos 
        : (bond.dirtyPrice * fxRate);
    } else {
      dirtyVal = bond.dirtyPrice * mult;
    }

    // Clean price is strictly DERIVED: Dirty Price - Accrued Interest
    const cleanVal = Math.max(0, dirtyVal - accruedVal);
    const dirtyPriceForCalc = isArsBond ? dirtyVal : ((curr === 'ARS') ? (dirtyVal / fxRate) : dirtyVal);

    // Trading activity & Microstructure metrics (BYMA via Data912)
    let vol = 0;
    let trades = 0;

    if (tickerQuote && typeof tickerQuote.v === 'number' && tickerQuote.v > 0) {
      vol = tickerQuote.v;
      trades = (typeof tickerQuote.q_op === 'number' && tickerQuote.q_op > 0) 
        ? tickerQuote.q_op 
        : Math.max(1, Math.round(vol / 2500));
    } else {
      if (curr === 'MEP') {
        vol = bond.volumeMEP || bond.volume || 0;
        trades = bond.tradesMEP || bond.tradesCount || (vol > 0 ? Math.max(1, Math.round(vol / 2500)) : 0);
      } else if (curr === 'CCL') {
        vol = bond.volumeCable || bond.volume || 0;
        trades = bond.tradesCable || bond.tradesCount || (vol > 0 ? Math.max(1, Math.round(vol / 2500)) : 0);
      } else if (curr === 'ARS') {
        vol = bond.volumePesos || bond.volume || 0;
        trades = bond.tradesPesos || bond.tradesCount || (vol > 0 ? Math.max(1, Math.round(vol / 2500)) : 0);
      } else {
        vol = bond.volume || 0;
        trades = bond.tradesCount || (vol > 0 ? Math.max(1, Math.round(vol / 2500)) : 0);
      }
    }

    if (vol === 0 && bond.volume > 0) {
      vol = bond.volume;
      trades = bond.tradesCount || Math.max(1, Math.round(vol / 2500));
    }

    const pxBid = tickerQuote?.px_bid || bond.pxBid || 0;
    const pxAsk = tickerQuote?.px_ask || bond.pxAsk || 0;
    const qBid = tickerQuote?.q_bid || bond.qBid || 0;
    const qAsk = tickerQuote?.q_ask || bond.qAsk || 0;
    const pctChg = typeof tickerQuote?.pct_change === 'number' ? tickerQuote.pct_change : (bond.pctChange || 0);

    // VWAP calculation (Volume-Weighted Average Price from order book / trades)
    let vwapVal = dirtyVal;
    if (pxBid > 0 && pxAsk > 0) {
      if (qBid > 0 && qAsk > 0) {
        vwapVal = (pxBid * qAsk + pxAsk * qBid) / (qBid + qAsk);
      } else {
        vwapVal = (pxBid + pxAsk + 2 * dirtyVal) / 4;
      }
    } else if (pxBid > 0) {
      vwapVal = (pxBid + dirtyVal) / 2;
    } else if (pxAsk > 0) {
      vwapVal = (pxAsk + dirtyVal) / 2;
    }

    // Cash turnover
    const cashTurnoverUSD = (vol * (curr === 'ARS' ? (dirtyVal / fxRate) : dirtyVal)) / 100;
    const cashTurnover = (curr === 'ARS') ? (cashTurnoverUSD * fxRate) : cashTurnoverUSD;

    // Update Market Info elements in modal
    const lastEl = document.getElementById('modal-market-last');
    const chgEl = document.getElementById('modal-market-chg');
    const specieEl = document.getElementById('modal-market-specie');
    const vwapEl = document.getElementById('modal-market-vwap');
    const volEl = document.getElementById('modal-market-vol');
    const montoEl = document.getElementById('modal-market-monto');
    const tradesEl = document.getElementById('modal-market-trades');

    // Format price according to active locale
    const fmtPrice = (val) => `${currSymbol}${this.formatNumber(val, 2)}`;

    if (lastEl) {
      lastEl.textContent = fmtPrice(dirtyVal);
      const quoteDateStr = bond.quoteDate ? this.formatDate(bond.quoteDate) : (this.lastSyncTimestamp ? this.lastSyncTimestamp.split(' - ')[0] : 'Hoy');
      lastEl.title = `Fecha de cotización: ${quoteDateStr} • Rueda BYMA / Data912 en vivo`;
    }
    if (chgEl) {
      chgEl.textContent = `${pctChg >= 0 ? '+' : ''}${this.formatNumber(pctChg, 2)}%`;
      chgEl.style.color = pctChg >= 0 ? 'var(--accent-lime, #22c55e)' : 'var(--accent-red, #ef4444)';
    }
    if (specieEl) specieEl.textContent = `Ticker: ${activeTicker}`;
    if (vwapEl) vwapEl.textContent = fmtPrice(vwapVal);
    if (volEl) volEl.textContent = vol > 0 ? `${this.formatNumber(vol, 0)} nom` : 'Sin vol. hoy';
    if (tradesEl) tradesEl.textContent = trades > 0 ? `Operaciones: ${this.formatNumber(trades, 0)}` : (vol > 0 ? 'Operaciones: -' : 'Operaciones: 0');
    if (montoEl) {
      montoEl.textContent = vol > 0 
        ? `~${currSymbol}${this.formatNumber(Math.round(cashTurnover), 0)}`
        : `${currSymbol}0`;
    }

    // Update FX badges
    if (this.latestFx) {
      const mepBadge = document.getElementById('modal-mep-badge');
      const cclBadge = document.getElementById('modal-ccl-badge');
      if (mepBadge) mepBadge.textContent = `MEP: $${this.formatNumber(this.latestFx.mep, 2)}`;
      if (cclBadge) cclBadge.textContent = `CCL: $${this.formatNumber(this.latestFx.ccl, 2)}`;
    }

    const tir = FinancialMath.calculateTIR(dirtyPriceForCalc, bond.cashFlows, bond.settlementDate, bond.frequency);
    const parity = FinancialMath.calculateParity(dirtyPriceForCalc, bond.technicalValue);
    const { modifiedDuration } = FinancialMath.calculateRiskMetrics(dirtyPriceForCalc, bond.cashFlows, tir, bond.settlementDate, bond.frequency);

    // Note: <input type="number"> elements strictly require standard numeric representation (e.g. 100.50 with dot, not comma)
    document.getElementById('calc-clean-price').value = !isNaN(cleanVal) ? cleanVal.toFixed(2) : '';
    document.getElementById('calc-accrued-interest').value = `${currSymbol}${this.formatNumber(accruedVal, 4)}`;
    document.getElementById('calc-dirty-price').value = !isNaN(dirtyVal) ? dirtyVal.toFixed(2) : '';
    document.getElementById('calc-result-tir').value = !isNaN(tir) ? tir.toFixed(2) : '';
    document.getElementById('calc-result-parity').value = `${this.formatNumber(parity, 1)}%`;
    document.getElementById('calc-result-duration').value = `${this.formatNumber(modifiedDuration, 2)} yrs`;

    const tbody = document.getElementById('modal-cashflows-body');
    if (tbody) {
      const displayFlows = bond.allCashFlows || bond.cashFlows;
      const settlStr = bond.settlementDate;
      tbody.innerHTML = displayFlows.map((cf, idx) => {
        const isPast = cf.date < settlStr;
        const isNext = cf.date === settlStr || (!isPast && !displayFlows.some(other => other.date < cf.date && other.date >= settlStr));
        const statusBadge = isPast 
          ? `<span style="font-size: 0.65rem; color: var(--text-dim); background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; margin-left: 6px;">Cobrado</span>`
          : isNext 
            ? `<span style="font-size: 0.65rem; color: #10b981; background: rgba(16,185,129,0.14); padding: 1px 5px; border-radius: 4px; margin-left: 6px; font-weight: 600;">Próximo</span>`
            : '';
        const rowStyle = isPast ? 'opacity: 0.55;' : '';
        const cpnNoText = cf.couponNo 
          ? String(cf.couponNo).padStart(3, '0') 
          : String(idx + 1).padStart(3, '0');

        const amortStr = cf.amortization > 0 
          ? (cf.amortization % 1 === 0 ? this.formatNumber(cf.amortization, 0) : this.formatNumber(cf.amortization, 2)) + '%' 
          : '-';
        const residualStr = (cf.residual % 1 === 0 ? this.formatNumber(cf.residual, 0) : this.formatNumber(cf.residual, 2)) + '%';

        return `
        <tr style="${rowStyle}">
          <td class="num-tabular" style="font-weight: 600; color: var(--text-muted);">${cpnNoText}</td>
          <td class="num-tabular">${this.formatDate(cf.date)} ${statusBadge}</td>
          <td class="num-tabular">${amortStr}</td>
          <td class="num-tabular">${this.formatNumber(cf.coupon, 4)}%</td>
          <td class="num-tabular ${isPast ? 'text-muted' : 'text-lime'}" style="font-weight: 700;">${currSymbol}${this.formatNumber(cf.amount * mult, 2)}</td>
          <td class="num-tabular text-muted">${residualStr}</td>
        </tr>`;
      }).join('');
    }
  }

  updateModalCalculatorFromCleanPrice(inputCleanPrice) {
    const bond = this.selectedBondForModal;
    if (!bond || isNaN(inputCleanPrice) || inputCleanPrice <= 0) return;

    const isArsBond = (bond.currency === 'ARS' || bond.paymentCurrency === 'Pesos');
    const curr = this.modalCurrency || (isArsBond ? 'ARS' : 'MEP');
    const fxRate = this.getFxRate();
    const cleanPriceBase = isArsBond ? inputCleanPrice : ((curr === 'ARS') ? (inputCleanPrice / fxRate) : inputCleanPrice);

    const dirtyPriceBase = cleanPriceBase + bond.accruedInterest;
    const parity = FinancialMath.calculateParity(dirtyPriceBase, bond.technicalValue);
    const tir = FinancialMath.calculateTIR(dirtyPriceBase, bond.cashFlows, bond.settlementDate, bond.frequency);
    const { modifiedDuration } = FinancialMath.calculateRiskMetrics(dirtyPriceBase, bond.cashFlows, tir, bond.settlementDate, bond.frequency);

    const mult = isArsBond ? 1.0 : ((curr === 'ARS') ? fxRate : 1.0);

    document.getElementById('calc-dirty-price').value = (dirtyPriceBase * mult).toFixed(2);
    document.getElementById('calc-result-parity').value = `${parity.toFixed(1)}%`;
    document.getElementById('calc-result-tir').value = tir.toFixed(2);
    document.getElementById('calc-result-duration').value = `${modifiedDuration.toFixed(2)} yrs`;
  }

  updateModalCalculatorFromDirtyPrice(inputDirtyPrice) {
    const bond = this.selectedBondForModal;
    if (!bond || isNaN(inputDirtyPrice) || inputDirtyPrice <= 0) return;

    const isArsBond = (bond.currency === 'ARS' || bond.paymentCurrency === 'Pesos');
    const curr = this.modalCurrency || (isArsBond ? 'ARS' : 'MEP');
    const fxRate = this.getFxRate();
    const dirtyPriceBase = isArsBond ? inputDirtyPrice : ((curr === 'ARS') ? (inputDirtyPrice / fxRate) : inputDirtyPrice);

    const cleanPriceBase = Math.max(0, dirtyPriceBase - bond.accruedInterest);
    const parity = FinancialMath.calculateParity(dirtyPriceBase, bond.technicalValue);
    const tir = FinancialMath.calculateTIR(dirtyPriceBase, bond.cashFlows, bond.settlementDate, bond.frequency);
    const { modifiedDuration } = FinancialMath.calculateRiskMetrics(dirtyPriceBase, bond.cashFlows, tir, bond.settlementDate, bond.frequency);

    const mult = isArsBond ? 1.0 : ((curr === 'ARS') ? fxRate : 1.0);

    document.getElementById('calc-clean-price').value = (cleanPriceBase * mult).toFixed(2);
    document.getElementById('calc-result-parity').value = `${parity.toFixed(1)}%`;
    document.getElementById('calc-result-tir').value = tir.toFixed(2);
    document.getElementById('calc-result-duration').value = `${modifiedDuration.toFixed(2)} yrs`;
  }

  updateModalCalculatorFromTIR(targetTIR) {
    const bond = this.selectedBondForModal;
    if (!bond || isNaN(targetTIR) || targetTIR <= -100) return;

    const isArsBond = (bond.currency === 'ARS' || bond.paymentCurrency === 'Pesos');
    const curr = this.modalCurrency || (isArsBond ? 'ARS' : 'MEP');
    const fxRate = this.getFxRate();
    const mult = isArsBond ? 1.0 : ((curr === 'ARS') ? fxRate : 1.0);

    const { cleanPrice, dirtyPrice } = FinancialMath.calculatePriceFromTIR(targetTIR, bond.cashFlows, bond.settlementDate, bond.accruedInterest, bond.frequency);
    const parity = FinancialMath.calculateParity(dirtyPrice, bond.technicalValue);
    const { modifiedDuration } = FinancialMath.calculateRiskMetrics(dirtyPrice, bond.cashFlows, targetTIR, bond.settlementDate, bond.frequency);

    document.getElementById('calc-clean-price').value = (cleanPrice * mult).toFixed(2);
    document.getElementById('calc-dirty-price').value = (dirtyPrice * mult).toFixed(2);
    document.getElementById('calc-result-parity').value = `${parity.toFixed(1)}%`;
    document.getElementById('calc-result-duration').value = `${modifiedDuration.toFixed(2)} yrs`;
  }

  exportCashFlowsToCSV(bond) {
    let csv = `Nro Cupon,Fecha Pago,Estado,Amortizacion (%),Cupon Renta (%),Flujo Total ($),Capital Residual (%)\n`;
    const flows = bond.allCashFlows || bond.cashFlows;
    const settlStr = bond.settlementDate;
    flows.forEach((cf, idx) => {
      const status = cf.date < settlStr ? 'Cobrado' : 'Pendiente';
      const cpnNo = cf.couponNo ? String(cf.couponNo).padStart(3, '0') : String(idx + 1).padStart(3, '0');
      csv += `${cpnNo},${this.formatDate(cf.date)},${status},${cf.amortization},${cf.coupon},${cf.amount},${cf.residual}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Flujo_Fondos_${bond.ticker}_${bond.settlementDate}.csv`;
    link.click();
  }

  async syncData912Quotes(isManual = false) {
    const statusDiv = document.getElementById('data912-sync-status');
    const badgeText = document.getElementById('live-status-text');
    const lastSyncSpan = document.getElementById('modal-last-sync');
    const refreshBtn = document.getElementById('btn-refresh-quotes');

    if (refreshBtn) {
      refreshBtn.textContent = '⏳ ...';
      refreshBtn.disabled = true;
    }

    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.color = 'var(--accent-cyan)';
      statusDiv.textContent = '⏳ Conectando con Data912 y obteniendo cotizaciones de ONs y Bonos...';
    }

    try {
      const results = await Promise.allSettled([
        this.data912.fetchCorporateBondsQuotes(),
        this.data912.fetchSovereignBondsQuotes(),
        this.data912.fetchBenchmarkFx()
      ]);

      const corpQuotes = results[0].status === 'fulfilled' ? results[0].value : [];
      const sovQuotes = results[1].status === 'fulfilled' ? results[1].value : [];
      const fx = results[2].status === 'fulfilled' ? results[2].value : null;

      // Update benchmark FX in modal and live calculations
      if (fx) {
        this.latestFx = fx;
        const mepEl = document.getElementById('modal-mep-rate');
        const cclEl = document.getElementById('modal-ccl-rate');
        if (mepEl) mepEl.textContent = `$${fx.mep.toFixed(2)}`;
        if (cclEl) cclEl.textContent = `$${fx.ccl.toFixed(2)}`;

        const mepBadge = document.getElementById('modal-mep-badge');
        const cclBadge = document.getElementById('modal-ccl-badge');
        if (mepBadge) mepBadge.textContent = `MEP: $${fx.mep.toFixed(2)}`;
        if (cclBadge) cclBadge.textContent = `CCL: $${fx.ccl.toFixed(2)}`;

        const fxInput = document.getElementById('calc-fx-rate');
        if (fxInput && (!fxInput.value || parseFloat(fxInput.value) === 1280)) {
          fxInput.value = fx.mep.toFixed(2);
        }
      }

      // Process corporate market quotes for the Home Overview (Heatmap & Volume Metrics)
      if (Array.isArray(corpQuotes) && corpQuotes.length > 0) {
        const cclRate = (fx && fx.ccl) ? fx.ccl : ((fx && fx.mep) ? fx.mep * 1.0467 : 1611);
        const mepRate = (fx && fx.mep) ? fx.mep : 1539;
        this.processMarketVolumeData(corpQuotes, cclRate, mepRate, sovQuotes);
      }

      const res = this.data912.applyQuotesToBonds(this.bonds, corpQuotes, sovQuotes);

      // Recalculate metrics and curves with real market prices
      this.recalculateAllBonds();
      this.requestDashboardUpdate();

      // If Home view is currently active, render the Home Market overview
      if (this.selectedGroup === 'Inicio') {
        this.renderHomeMarket();
      }

      // If modal is currently open, refresh it with updated live volume and quotes
      if (this.selectedBondForModal) {
        this.refreshModalCurrencyView();
      }

      this.lastSyncTimestamp = this.formatLastUpdateDate(new Date());
      this.updateMarketStatusBadge();

      if (lastSyncSpan) {
        lastSyncSpan.textContent = `${res.timestamp} (${res.updatedCount} especies en cartera actualizadas)`;
      }

      if (statusDiv) {
        statusDiv.style.color = 'var(--accent-lime)';
        statusDiv.textContent = `✅ Sincronizado con éxito! Se procesaron ${res.totalQuotes} cotizaciones (${res.updatedCount} coincidencias directas aplicadas a tus bonos).`;
      }

      if (isManual) {
        setTimeout(() => {
          if (statusDiv) statusDiv.style.display = 'none';
        }, 3000);
      }
    } catch (err) {
      console.error('[Data912 Sync Error]', err);
      if (statusDiv) {
        statusDiv.style.color = 'var(--accent-red, #ff4d4d)';
        statusDiv.textContent = `❌ Error al conectar con Data912: ${err.message}`;
      }
      this.updateMarketStatusBadge();
    } finally {
      if (refreshBtn) {
        refreshBtn.textContent = '🔄 Actualizar';
        refreshBtn.disabled = false;
      }
    }
  }

  setupAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }

    if (this.autoRefreshEnabled) {
      this.autoRefreshTimer = setInterval(() => {
        this.syncData912Quotes(false);
      }, 30000); // 30 seconds interval
    }

    if (!this.marketStatusTimer) {
      this.marketStatusTimer = setInterval(() => {
        this.updateMarketStatusBadge();
      }, 20000);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new TradingDeskApp();
});

/**
 * MARKET DATA CONNECTOR LAYER
 * Uses Data912 (https://data912.com) for real-time Argentine market quotes (ONs, Bonos, MEP, CCL)
 * with zero paid subscription requirements.
 */

import { Data912Service } from './data912-service.js';

export { Data912Service };

export class MarketApiConnector {
  constructor() {
    this.apiProvider = localStorage.getItem('argen_bonds_api_provider') || 'data912';
    this.data912 = new Data912Service();
  }

  /**
   * Checks if BYMA/MAE market is currently open:
   * - Monday to Friday
   * - 10:30 to 17:00 (Argentina Time, UTC-3)
   * - Excludes BYMA financial & bank holidays
   */
  isMarketOpen() {
    const now = new Date();

    // Get Argentina Time (ART, UTC-3) components
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);

    const year = parseInt(map.year, 10);
    const month = parseInt(map.month, 10);
    const day = parseInt(map.day, 10);
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);

    // Day of week in Argentina
    const artDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dayOfWeek = artDate.getUTCDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;

    // Fixed annual market & bank holidays (MM-DD)
    const mmDd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const fixedHolidays = [
      '01-01', // Año Nuevo
      '03-24', // Memoria por la Verdad y la Justicia
      '04-02', // Veterano y Caídos en Malvinas
      '05-01', // Día del Trabajador
      '05-25', // Revolución de Mayo
      '06-20', // Belgrano
      '07-09', // Independencia
      '11-06', // Día del Bancario (feriado bursátil BYMA)
      '12-08', // Inmaculada Concepción
      '12-25', // Navidad
      '12-31'  // Fin de año bancario/bursátil
    ];
    if (fixedHolidays.includes(mmDd)) return false;

    // Specific movable and bridge holidays (BYMA Calendar 2025-2027)
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const bymaHolidays = new Set([
      // 2025
      '2025-03-03', '2025-03-04', '2025-04-17', '2025-04-18', '2025-06-16', 
      '2025-08-18', '2025-10-10', '2025-10-13', '2025-11-24',
      // 2026
      '2026-02-16', '2026-02-17', '2026-04-03', '2026-06-15', '2026-08-17', 
      '2026-10-12', '2026-11-23',
      // 2027
      '2027-02-08', '2027-02-09', '2027-03-25', '2027-03-26', '2027-06-21', 
      '2027-08-16', '2027-10-11', '2027-11-22'
    ]);
    if (bymaHolidays.has(dateStr)) return false;

    // Operating hours: 10:30 to 17:00 ART
    const currentMinutes = hour * 60 + minute;
    const openMinutes = 10 * 60 + 30; // 10:30
    const closeMinutes = 17 * 60;     // 17:00

    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }

  /**
   * Returns the ISO date string (YYYY-MM-DD) of the last completed or currently active BYMA trading session.
   * If today is a weekend, holiday, or before 10:30 ART, steps backward to the last valid market session.
   */
  getLastTradingDate() {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(new Date());
    const map = {};
    parts.forEach(p => map[p.type] = p.value);

    let year = parseInt(map.year, 10);
    let month = parseInt(map.month, 10);
    let day = parseInt(map.day, 10);
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);

    const fixedHolidays = [
      '01-01', '03-24', '04-02', '05-01', '05-25', '06-20',
      '07-09', '11-06', '12-08', '12-25', '12-31'
    ];
    const bymaHolidays = new Set([
      '2025-03-03', '2025-03-04', '2025-04-17', '2025-04-18', '2025-06-16', 
      '2025-08-18', '2025-10-10', '2025-10-13', '2025-11-24',
      '2026-02-16', '2026-02-17', '2026-04-03', '2026-06-15', '2026-08-17', 
      '2026-10-12', '2026-11-23',
      '2027-02-08', '2027-02-09', '2027-03-25', '2027-03-26', '2027-06-21', 
      '2027-08-16', '2027-10-11', '2027-11-22'
    ]);

    // Construct local Argentina calendar date
    let cur = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    // If today is a trading day but market hasn't opened yet (< 10:30 ART), last trade was yesterday
    const isBeforeMarketOpen = (hour * 60 + minute) < (10 * 60 + 30);
    if (isBeforeMarketOpen) {
      cur.setUTCDate(cur.getUTCDate() - 1);
    }

    // Step backward until finding a valid business day (not weekend, not holiday)
    while (true) {
      const dow = cur.getUTCDay();
      const y = cur.getUTCFullYear();
      const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
      const d = String(cur.getUTCDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      const mmDd = `${m}-${d}`;

      const isWeekend = (dow === 0 || dow === 6);
      const isHoliday = fixedHolidays.includes(mmDd) || bymaHolidays.has(dateStr);

      if (!isWeekend && !isHoliday) {
        return dateStr;
      }
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
  }

  /**
   * Fetches real-time market quotes from Data912 free endpoints
   */
  async fetchLiveQuotes() {
    try {
      const [corpQuotes, sovQuotes, fx] = await Promise.all([
        this.data912.fetchCorporateBondsQuotes(),
        this.data912.fetchSovereignBondsQuotes(),
        this.data912.fetchBenchmarkFx()
      ]);

      return {
        corpQuotes,
        sovQuotes,
        fx,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.warn('[MarketApiConnector] Error fetching from Data912:', error);
      return null;
    }
  }
}

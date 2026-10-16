/**
 * FIXED INCOME PORTFOLIO MANAGER
 * Manages custom portfolios, calculates weighted TIR and Duration, 
 * and aggregates consolidated monthly cash flows.
 */

export class PortfolioManager {
  constructor(storageKey = 'argen_bonds_portfolio') {
    this.storageKey = storageKey;
    this.portfolioItems = this.load();
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.portfolioItems));
    } catch (e) {
      console.error("Failed to save portfolio to localStorage", e);
    }
  }

  /**
   * Add or update bond in portfolio
   * @param {string} bondId 
   * @param {number} nominals - Total nominal amount held (e.g. 1000)
   */
  addBond(bondId, nominals) {
    const existing = this.portfolioItems.find(item => item.bondId === bondId);
    if (existing) {
      existing.nominals += nominals;
    } else {
      this.portfolioItems.push({ bondId, nominals });
    }
    this.save();
  }

  removeBond(bondId) {
    this.portfolioItems = this.portfolioItems.filter(item => item.bondId !== bondId);
    this.save();
  }

  clear() {
    this.portfolioItems = [];
    this.save();
  }

  /**
   * Calculates metrics for the portfolio given computed bond data
   * @param {Array} calculatedBonds 
   */
  calculatePortfolioSummary(calculatedBonds) {
    const itemsWithData = [];
    let totalInvestedDirty = 0;
    let weightedTIRSum = 0;
    let weightedDurationSum = 0;

    for (let item of this.portfolioItems) {
      const bond = calculatedBonds.find(b => b.id === item.bondId);
      if (bond) {
        const dirtyMarketValue = (item.nominals / 100) * bond.dirtyPrice;
        totalInvestedDirty += dirtyMarketValue;
        itemsWithData.push({
          ...item,
          bond,
          dirtyMarketValue
        });
      }
    }

    if (totalInvestedDirty > 0) {
      for (let item of itemsWithData) {
        const weight = item.dirtyMarketValue / totalInvestedDirty;
        weightedTIRSum += item.bond.tir * weight;
        weightedDurationSum += item.bond.duration * weight;
      }
    }

    // Consolidated Monthly Cash Flows Timeline
    const monthlyFlows = {};
    for (let item of itemsWithData) {
      const scale = item.nominals / 100;
      for (let cf of item.bond.cashFlows) {
        const monthKey = cf.date.substring(0, 7); // 'YYYY-MM'
        if (!monthlyFlows[monthKey]) {
          monthlyFlows[monthKey] = 0;
        }
        monthlyFlows[monthKey] += cf.amount * scale;
      }
    }

    return {
      items: itemsWithData,
      totalInvestedDirty: Number(totalInvestedDirty.toFixed(2)),
      weightedTIR: Number(weightedTIRSum.toFixed(2)),
      weightedDuration: Number(weightedDurationSum.toFixed(2)),
      monthlyFlows
    };
  }
}

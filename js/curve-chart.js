/**
 * YIELD CURVE SCATTER CHART & POLYNOMIAL FITTING ENGINE WITH HIGH CONTRAST THEMING
 * Renders Modified Duration (x-axis) vs TIR % (y-axis) with Chart.js
 * Draws Ticker Labels directly next to each point on the chart canvas with theme-aware contrast.
 */

export class YieldCurveChart {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.chart = null;
  }

  fitQuadraticCurve(points) {
    if (points.length < 3) return null;

    let n = points.length;
    let sumX = 0, sumY = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
    let sumXY = 0, sumX2Y = 0;

    for (let p of points) {
      let x = p.x;
      let y = p.y;
      sumX += x;
      sumY += y;
      sumX2 += x * x;
      sumX3 += x * x * x;
      sumX4 += x * x * x * x;
      sumXY += x * y;
      sumX2Y += x * x * y;
    }

    const det = (matrix) => {
      return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
             matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
             matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
    };

    const A = [
      [n, sumX, sumX2],
      [sumX, sumX2, sumX3],
      [sumX2, sumX3, sumX4]
    ];

    const D = det(A);
    if (Math.abs(D) < 1e-9) return null;

    const Ac = [
      [sumY, sumX, sumX2],
      [sumXY, sumX2, sumX3],
      [sumX2Y, sumX3, sumX4]
    ];

    const Ab = [
      [n, sumY, sumX2],
      [sumX, sumXY, sumX3],
      [sumX2, sumX2Y, sumX4]
    ];

    const Aa = [
      [n, sumX, sumY],
      [sumX, sumX2, sumY],
      [sumX2, sumX3, sumX2Y]
    ];

    const c = det(Ac) / D;
    const b = det(Ab) / D;
    const a = det(Aa) / D;

    return (x) => a * x * x + b * x + c;
  }

  fitLinear(points) {
    if (points.length < 2) return null;
    let n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let p of points) {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumXX += p.x * p.x;
    }
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-9) return null;
    let slope = (n * sumXY - sumX * sumY) / denom;
    let intercept = (sumY - slope * sumX) / n;
    return (x) => slope * x + intercept;
  }

  fitLogarithmic(points) {
    let validPoints = points.filter(p => p.x > 0);
    if (validPoints.length < 2) return null;
    let n = validPoints.length;
    let sumLnX = 0, sumY = 0, sumLnXY = 0, sumLnXLnX = 0;
    for (let p of validPoints) {
      let lnX = Math.log(p.x);
      sumLnX += lnX;
      sumY += p.y;
      sumLnXY += lnX * p.y;
      sumLnXLnX += lnX * lnX;
    }
    const denom = n * sumLnXLnX - sumLnX * sumLnX;
    if (Math.abs(denom) < 1e-9) return null;
    let a = (n * sumLnXY - sumLnX * sumY) / denom;
    let b = (sumY - a * sumLnX) / n;
    return (x) => x > 0 ? a * Math.log(x) + b : 0;
  }

  fitExponential(points) {
    let validPoints = points.filter(p => p.y > 0);
    if (validPoints.length < 2) return null;
    let n = validPoints.length;
    let sumX = 0, sumLnY = 0, sumXLnY = 0, sumXX = 0;
    for (let p of validPoints) {
      let lnY = Math.log(p.y);
      sumX += p.x;
      sumLnY += lnY;
      sumXLnY += p.x * lnY;
      sumXX += p.x * p.x;
    }
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-9) return null;
    let b = (n * sumXLnY - sumX * sumLnY) / denom;
    let lnA = (sumLnY - b * sumX) / n;
    let a = Math.exp(lnA);
    return (x) => a * Math.exp(b * x);
  }

  render(bonds, onSelectBond, regressionType = 'quadratic', durationMetric = 'modified', showFittedCurve = false, isFavoritesTab = false, hdCurveCurrency = 'ALL') {
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) return;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLight = currentTheme === 'light';

    // Theme Colors
    const axisTextColor    = isLight ? '#071126'              : '#BDD8E9';       // Ice Powder Blue for axis labels
    const tickTextColor    = isLight ? '#0f172a'              : '#7BBDE8';       // Sky Blue for tick marks
    const gridLineColor    = isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(73, 118, 159, 0.22)';
    const fittedLineColor  = isLight ? '#0a2540'              : '#7BBDE8';       // Sky Blue for fitted curve
    const pointLabelColor  = isLight ? '#475569'              : '#BDD8E9';       // Ice Powder Blue for ticker labels
    const pointOutlineColor = isLight ? '#ffffff'             : '#001D39';       // Deep Navy as point border

    // Currency Colors for Strict Single-Color-Per-Currency Rule
    const colorPesos = isLight ? '#059669' : '#10b981'; // Emerald Green
    const colorMep   = isLight ? '#0284c7' : '#38bdf8'; // Cyan / Sky Blue (Dólar MEP)
    const colorCable = isLight ? '#0d9488' : '#1de9b6'; // Verde Agua / Aqua (Dólar Cable)

    const isMacaulay = durationMetric === 'macaulay' || durationMetric === 'duration';
    const isMaturity = durationMetric === 'maturity';
    const isTEA = durationMetric === 'tea';
    const isYTM = durationMetric === 'ytm';

    let xLabel = 'Duración Modificada';
    let yLabel = 'Rendimiento YTM (%)';

    if (isMacaulay) {
      xLabel = 'Duración';
      yLabel = 'Rendimiento YTM (%)';
    } else if (isMaturity) {
      xLabel = 'FECHA DE VENCIMIENTO';
      yLabel = 'Rendimiento YTM (%)';
    } else if (isTEA) {
      xLabel = 'Tasa Efectiva Anual - TEA (%)';
      yLabel = 'Duración Modificada';
    } else if (isYTM) {
      xLabel = 'Rendimiento YTM (%)';
      yLabel = 'Duración Modificada';
    }

    const parseMaturityDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split('T')[0].split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        const dt = new Date(y, m, d);
        return isNaN(dt.getTime()) ? null : dt.getTime();
      }
      const dt = new Date(dateStr);
      return isNaN(dt.getTime()) ? null : dt.getTime();
    };

    const points = bonds
      .filter(b => {
        if (!b.tir || b.tir <= 0 || b.tir >= 100) return false;
        if (isMaturity) {
          return parseMaturityDate(b.maturity) !== null;
        }
        if (isMacaulay) {
          return (b.macaulayDuration > 0 || b.duration > 0);
        }
        if (isTEA) {
          const teaVal = b.tea || ((Math.pow(1 + (b.tir / 100) / (b.frequency || 2), (b.frequency || 2)) - 1) * 100);
          return teaVal > 0 && b.duration > 0;
        }
        if (isYTM) {
          return b.duration > 0 && b.tir > 0;
        }
        return b.duration > 0;
      })
      .map(b => {
        let xVal = b.duration;
        let yVal = b.tir;

        const teaVal = b.tea || ((Math.pow(1 + (b.tir / 100) / (b.frequency || 2), (b.frequency || 2)) - 1) * 100);

        if (isMacaulay) {
          xVal = b.macaulayDuration || b.duration;
          yVal = b.tir;
        } else if (isMaturity) {
          xVal = parseMaturityDate(b.maturity);
          yVal = b.tir;
        } else if (isTEA) {
          xVal = teaVal;
          yVal = b.duration;
        } else if (isYTM) {
          xVal = b.tir;
          yVal = b.duration;
        }

        // Determine currency category
        const isPesos = b.currency === 'ARS' || b.paymentCurrency === 'Pesos' || (b.instrumentGroup && b.instrumentGroup.includes('Pesos'));
        let isCable = b.ticker?.endsWith('C') || b.paymentCurrency === 'Dólar Cable' || b.instrumentGroup === 'USD Cable' || b.law === 'Nueva York';
        let isMep   = !isPesos && !isCable;

        if (hdCurveCurrency === 'CABLE') {
          isCable = true;
          isMep = false;
        } else if (hdCurveCurrency === 'MEP') {
          isCable = false;
          isMep = true;
        }

        let category = 'USD MEP';
        if (isPesos) category = 'Pesos';
        else if (isCable) category = 'Dólar Cable';

        return {
          x: xVal,
          y: yVal,
          ticker: b.ticker,
          issuer: b.shortIssuer,
          rating: b.rating,
          parity: b.parity,
          maturity: b.maturity,
          duration: b.duration,
          macaulayDuration: b.macaulayDuration,
          tir: b.tir,
          tea: teaVal,
          dirtyPrice: b.dirtyPrice,
          cleanPrice: b.cleanPrice,
          pctChange: b.pctChange,
          quoteDate: b.quoteDate,
          paymentCurrency: b.paymentCurrency,
          currency: b.currency,
          bondObj: b,
          category,
          isPesos,
          isCable,
          isMep
        };
      });

    // Sort points by X for clean rendering
    points.sort((a, b) => a.x - b.x);

    if (points.length === 0) {
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
      return;
    }

    const hasPesos = points.some(p => p.isPesos);
    const hasUsd   = points.some(p => !p.isPesos);
    const useDualAxes = isFavoritesTab && hasPesos && hasUsd;

    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    
    // Normalization factor for regression
    const normFactor = isMaturity ? (86400000 * 365.25) : 1;
    const normBase = isMaturity ? minX : 0;

    const normPoints = points.map(p => ({
      x: (p.x - normBase) / normFactor,
      y: p.y
    }));

    let curveFunc = null;
    if (regressionType === 'linear') {
      curveFunc = this.fitLinear(normPoints);
    } else if (regressionType === 'logarithmic') {
      curveFunc = this.fitLogarithmic(normPoints);
    } else if (regressionType === 'exponential') {
      curveFunc = this.fitExponential(normPoints);
    } else {
      curveFunc = this.fitQuadraticCurve(normPoints);
    }

    const fittedLinePoints = [];
    if (!useDualAxes && curveFunc && maxX > minX) {
      const step = (maxX - minX) / 30;
      for (let x = minX; x <= maxX + step * 0.1; x += step) {
        const xNorm = (x - normBase) / normFactor;
        const valY = curveFunc(xNorm);
        if (!isNaN(valY) && isFinite(valY)) {
          fittedLinePoints.push({
            x: isMaturity ? Math.round(x) : Number(x.toFixed(2)),
            y: Number(valY.toFixed(2))
          });
        }
      }
    }

    if (this.chart) {
      this.chart.destroy();
    }

    // High-Contrast Theme-Aware Canvas Plugin for Ticker Labels
    const pointLabelsPlugin = {
      id: 'pointLabelsPlugin',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '700 8.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        chart.data.datasets.forEach((ds, dsIndex) => {
          if (ds.type === 'line') return;
          const meta = chart.getDatasetMeta(dsIndex);
          if (meta && meta.data) {
            meta.data.forEach((element, index) => {
              const dataPoint = ds.data[index];
              if (dataPoint && dataPoint.ticker) {
                if (element.x >= chart.chartArea.left && element.x <= chart.chartArea.right &&
                    element.y >= chart.chartArea.top && element.y <= chart.chartArea.bottom) {
                  // Strict Single-Color-Per-Currency Rule: ticker text color matches its currency exactly
                  const labelColor = dataPoint.isPesos ? colorPesos : (dataPoint.isCable ? colorCable : colorMep);
                  
                  // High contrast outline to guarantee readability against any background/points
                  ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(5, 12, 25, 0.95)';
                  ctx.lineWidth = 3;
                  ctx.strokeText(dataPoint.ticker, element.x, element.y - 6);

                  ctx.fillStyle = labelColor;
                  ctx.fillText(dataPoint.ticker, element.x, element.y - 6);
                }
              }
            });
          }
        });
        ctx.restore();
      }
    };

    let datasets = [];

    const pointsMep = points.filter(p => p.isMep);
    const pointsCable = points.filter(p => p.isCable);
    const pointsPesos = points.filter(p => p.isPesos);

    if (useDualAxes) {
      // 3 Datasets: Dólar MEP (Left), Dólar Cable (Left), Pesos (Right)
      if (pointsMep.length > 0) {
        datasets.push({
          label: 'Dólar MEP (Eje Izq.)',
          data: pointsMep,
          yAxisID: 'y',
          backgroundColor: colorMep,
          borderColor: isLight ? '#ffffff' : '#001D39',
          borderWidth: 1.5,
          pointRadius: 8,
          pointHoverRadius: 12
        });
      }

      if (pointsCable.length > 0) {
        datasets.push({
          label: 'Dólar Cable (Eje Izq.)',
          data: pointsCable,
          yAxisID: 'y',
          backgroundColor: colorCable,
          borderColor: isLight ? '#ffffff' : '#001D39',
          borderWidth: 1.5,
          pointRadius: 8,
          pointHoverRadius: 12
        });
      }

      if (pointsPesos.length > 0) {
        datasets.push({
          label: 'Pesos (Eje Der.)',
          data: pointsPesos,
          yAxisID: 'yPesos',
          backgroundColor: colorPesos,
          borderColor: isLight ? '#ffffff' : '#001D39',
          borderWidth: 1.5,
          pointRadius: 8,
          pointHoverRadius: 12
        });
      }
    } else {
      // Standard Single Y-Axis: STRICT RULE - All points of a currency share 100% the exact same color!
      const hasMep = pointsMep.length > 0;
      const hasCable = pointsCable.length > 0;
      const hasPesosOnly = pointsPesos.length > 0 && !hasMep && !hasCable;

      if (hasPesosOnly) {
        // Pure Pesos Tab
        datasets.push({
          label: 'Obligaciones Negociables (Pesos)',
          data: pointsPesos,
          yAxisID: 'y',
          backgroundColor: colorPesos,
          borderColor: isLight ? '#ffffff' : '#001D39',
          borderWidth: 1.5,
          pointRadius: 8,
          pointHoverRadius: 12
        });
      } else if (hasMep && !hasCable) {
        // Pure MEP selection: All points are 100% colorMep!
        datasets.push({
          label: 'Obligaciones Negociables (Dólar MEP)',
          data: pointsMep,
          yAxisID: 'y',
          backgroundColor: colorMep,
          borderColor: isLight ? '#ffffff' : '#001D39',
          borderWidth: 1.5,
          pointRadius: 8,
          pointHoverRadius: 12
        });
      } else if (hasCable && !hasMep) {
        // Pure Cable selection: All points are 100% colorCable!
        datasets.push({
          label: 'Obligaciones Negociables (Dólar CABLE)',
          data: pointsCable,
          yAxisID: 'y',
          backgroundColor: colorCable,
          borderColor: isLight ? '#ffffff' : '#001D39',
          borderWidth: 1.5,
          pointRadius: 8,
          pointHoverRadius: 12
        });
      } else {
        // Mixed currency view (e.g. "Todas (MEP + Cable)")
        // Separate datasets so MEP points are strictly colorMep and Cable points are strictly colorCable!
        if (hasMep) {
          datasets.push({
            label: 'Dólar MEP (D)',
            data: pointsMep,
            yAxisID: 'y',
            backgroundColor: colorMep,
            borderColor: isLight ? '#ffffff' : '#001D39',
            borderWidth: 1.5,
            pointRadius: 8,
            pointHoverRadius: 12
          });
        }
        if (hasCable) {
          datasets.push({
            label: 'Dólar Cable (C)',
            data: pointsCable,
            yAxisID: 'y',
            backgroundColor: colorCable,
            borderColor: isLight ? '#ffffff' : '#001D39',
            borderWidth: 1.5,
            pointRadius: 8,
            pointHoverRadius: 12
          });
        }
        if (pointsPesos.length > 0) {
          datasets.push({
            label: 'Pesos (ARS)',
            data: pointsPesos,
            yAxisID: 'y',
            backgroundColor: colorPesos,
            borderColor: isLight ? '#ffffff' : '#001D39',
            borderWidth: 1.5,
            pointRadius: 8,
            pointHoverRadius: 12
          });
        }
      }

      if (showFittedCurve && fittedLinePoints.length > 0) {
        datasets.push({
          label: 'Curva Teórica Ajustada (Fitted Curve)',
          data: fittedLinePoints,
          type: 'line',
          yAxisID: 'y',
          borderColor: fittedLineColor,
          borderWidth: 3,
          borderDash: [4, 4],
          fill: false,
          pointRadius: 0,
          tension: 0.4
        });
      }
    }

    const scalesConfig = {
      x: {
        title: {
          display: true,
          text: xLabel,
          color: axisTextColor,
          font: { family: 'Inter, sans-serif', weight: 'bold' }
        },
        grid: {
          drawOnChartArea: false,
          drawTicks: true,
          color: gridLineColor
        },
        border: {
          display: true,
          color: isLight ? 'rgba(15, 23, 42, 0.25)' : 'rgba(73, 118, 159, 0.4)'
        },
        ticks: {
          color: tickTextColor,
          font: { family: 'JetBrains Mono, monospace', weight: 'bold' },
          callback: function(val) {
            if (isMaturity) {
              const d = new Date(val);
              if (isNaN(d.getTime())) return '';
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const yr = d.getFullYear();
              return `${m}/${yr}`;
            }
            if (isTEA || isYTM) {
              return typeof val === 'number' ? `${val % 1 === 0 ? val : val.toFixed(1)}%` : val;
            }
            return typeof val === 'number' ? (val % 1 === 0 ? val : val.toFixed(1)) : val;
          }
        }
      },
      y: {
        position: 'left',
        title: {
          display: true,
          text: useDualAxes ? 'Rendimiento USD (MEP / Cable) %' : yLabel,
          color: useDualAxes ? '#38bdf8' : axisTextColor,
          font: { family: 'Inter, sans-serif', weight: 'bold' }
        },
        grid: {
          drawOnChartArea: false,
          drawTicks: true,
          color: gridLineColor
        },
        border: {
          display: true,
          color: useDualAxes ? '#38bdf8' : (isLight ? 'rgba(15, 23, 42, 0.25)' : 'rgba(73, 118, 159, 0.4)')
        },
        ticks: {
          color: useDualAxes ? '#38bdf8' : tickTextColor,
          font: { family: 'JetBrains Mono, monospace', weight: 'bold' },
          callback: function(val) {
            if (typeof val === 'number') {
              return `${val % 1 === 0 ? val : val.toFixed(1)}${(isTEA || isYTM) ? 'a' : '%'}`;
            }
            return val;
          }
        }
      }
    };

    // If dual axes is enabled, add Right Y-Axis for Pesos
    if (useDualAxes) {
      scalesConfig.yPesos = {
        position: 'right',
        title: {
          display: true,
          text: 'Rendimiento Pesos (TIR %) — Eje Derecho',
          color: colorPesos,
          font: { family: 'Inter, sans-serif', weight: 'bold' }
        },
        grid: {
          drawOnChartArea: false,
          drawTicks: true,
          color: gridLineColor
        },
        border: {
          display: true,
          color: colorPesos
        },
        ticks: {
          color: colorPesos,
          font: { family: 'JetBrains Mono, monospace', weight: 'bold' },
          callback: function(val) {
            if (typeof val === 'number') {
              return `${val % 1 === 0 ? val : val.toFixed(1)}%`;
            }
            return val;
          }
        }
      };
    }

    const ctx = canvas.getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: datasets
      },
      plugins: [pointLabelsPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const el = elements[0];
            const datasetIndex = el.datasetIndex;
            const ds = datasets[datasetIndex];
            if (ds && ds.type !== 'line') {
              const selectedPoint = ds.data[el.index];
              if (selectedPoint && onSelectBond) {
                onSelectBond(selectedPoint.bondObj);
              }
            }
          }
        },
        plugins: {
          legend: {
            onClick: () => {},
            onHover: (e) => {
              if (e.native && e.native.target) {
                e.native.target.style.cursor = 'default';
              }
            },
            labels: {
              color: axisTextColor,
              font: { family: 'Inter, sans-serif', size: 12, weight: 'bold' }
            }
          },
          tooltip: {
            backgroundColor: isLight ? '#071126' : '#0A4174',
            titleColor: isLight ? '#ffee00' : '#BDD8E9',
            bodyColor: isLight ? '#ffffff' : '#e8f4fd',
            borderColor: isLight ? '#0a2540' : '#7BBDE8',
            borderWidth: 1.5,
            titleFont: { family: 'Inter, sans-serif', weight: 'bold' },
            bodyFont: { family: 'Roboto Mono, monospace' },
            callbacks: {
              title: (items) => {
                const p = items[0].raw;
                return p.ticker ? `${p.ticker} - ${p.issuer}` : 'Curva Ajustada';
              },
              label: (item) => {
                const p = item.raw;
                if (!p.ticker) {
                  return (isTEA || isYTM) ? `Duración Estimada: ${p.y.toFixed(2)} años` : `Rendimiento Estimado: ${p.y.toFixed(2)}%`;
                }
                const lines = [];
                const dirtyPrice = p.dirtyPrice ?? p.bondObj?.dirtyPrice;
                const cleanPrice = p.cleanPrice ?? p.bondObj?.cleanPrice;
                const pctChange = p.pctChange ?? p.bondObj?.pctChange;

                if (p.category) {
                  lines.push(`Moneda / Segmento: ${p.category}`);
                }
                if (dirtyPrice !== undefined && dirtyPrice !== null) {
                  const chg = typeof pctChange === 'number' ? ` (${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}%)` : '';
                  const qDate = p.quoteDate ?? p.bondObj?.quoteDate;
                  let dateStr = '';
                  if (qDate) {
                    const dParts = qDate.split('T')[0].split('-');
                    if (dParts.length === 3) {
                      const yy = dParts[0].length === 4 ? dParts[0].slice(-2) : dParts[0];
                      dateStr = ` ${dParts[2]}/${dParts[1]}/${yy}`;
                    }
                  } else {
                    const today = new Date();
                    const dd = String(today.getDate()).padStart(2, '0');
                    const mm = String(today.getMonth() + 1).padStart(2, '0');
                    const yy = String(today.getFullYear()).slice(-2);
                    dateStr = ` ${dd}/${mm}/${yy}`;
                  }
                  lines.push(`Último Precio: $${Number(dirtyPrice).toFixed(2)}${chg}${dateStr}`);
                  if (cleanPrice !== undefined && cleanPrice !== null && Math.abs(cleanPrice - dirtyPrice) > 0.001) {
                    lines.push(`Precio Clean: $${Number(cleanPrice).toFixed(2)}`);
                  }
                }
                if (p.maturity) {
                  const parts = p.maturity.split('T')[0].split('-');
                  const matFmt = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : p.maturity;
                  lines.push(`Vencimiento: ${matFmt}`);
                }
                if (p.tea) {
                  lines.push(`Tasa Efectiva Anual (TEA): ${p.tea.toFixed(2)}%`);
                }
                lines.push(`Rendimiento YTM / TIR (%): ${(p.tir ?? (isTEA || isYTM ? p.x : p.y)).toFixed(2)}%`);
                lines.push(`Duración: ${(p.duration ?? (isTEA || isYTM ? p.y : p.x)).toFixed(2)} años`);
                if (p.macaulayDuration) {
                  lines.push(`Duración Macaulay: ${p.macaulayDuration.toFixed(2)} años`);
                }
                if (p.parity !== undefined && p.parity !== null) {
                  lines.push(`Paridad: ${Number(p.parity).toFixed(1)}%`);
                }
                if (p.rating) {
                  lines.push(`Rating: ${p.rating}`);
                }
                return lines;
              }
            }
          }
        },
        scales: scalesConfig
      }
    });
  }
}

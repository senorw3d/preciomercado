/**
 * Treemap Layout Engine (Squarified Algorithm)
 * High-performance, zero-dependency Finviz-style interactive treemap renderer.
 */

export class SquarifiedTreemap {
  constructor(canvasId, options = {}) {
    this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.options = Object.assign({
      padding: 3,
      headerHeight: 24,
      onNodeClick: null,
      tooltipEl: null
    }, options);

    this.nodes = [];
    this.hoveredNode = null;
    this.tooltipEl = this.options.tooltipEl || document.getElementById('treemap-tooltip');

    this.setupListeners();
  }

  setupListeners() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
      this.handleMouseMove(x, y, e.clientX, e.clientY);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredNode = null;
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
      this.draw();
    });

    this.canvas.addEventListener('click', (e) => {
      if (this.hoveredNode && typeof this.options.onNodeClick === 'function') {
        this.options.onNodeClick(this.hoveredNode);
      }
    });

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight || 540;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.scale(dpr, dpr);
    this.cssWidth = w;
    this.cssHeight = h;

    if (this.lastData) {
      this.render(this.lastData);
    }
  }

  drawEmptyState(msg = 'Cargando cotizaciones y mapa de mercado...') {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.cssWidth || 800;
    const h = this.cssHeight || 540;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#090e17';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#64748b';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
  }

  render(categories) {
    this.lastData = categories;
    if (!this.canvas) return;

    const parent = this.canvas.parentElement;
    if (parent && parent.clientWidth > 0 && (!this.cssWidth || this.cssWidth !== parent.clientWidth)) {
      this.resize();
    } else if (!this.cssWidth || !this.cssHeight) {
      this.resize();
    }

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      this.drawEmptyState('Sin operaciones registradas para los filtros seleccionados');
      return;
    }

    const w = this.cssWidth || this.canvas.width;
    const h = this.cssHeight || this.canvas.height;
    this.nodes = [];

    // Support both hierarchical categories with children AND flat list of items
    const hasChildren = categories.some(c => Array.isArray(c.children) && c.children.length > 0);

    if (hasChildren) {
      // Top-level layout for categories
      const validCats = categories.filter(c => c.value > 0);
      const totalVal = validCats.reduce((acc, c) => acc + c.value, 0);
      if (totalVal <= 0) {
        this.drawEmptyState('Sin volumen de operaciones registrado');
        return;
      }

      // Distribute category containers across canvas
      const catRects = this.squarify(validCats, { x: 2, y: 2, w: w - 4, h: h - 4 }, totalVal);

      catRects.forEach(catRect => {
        const cat = catRect.data;
        const headerH = this.options.headerHeight;
        const contentRect = {
          x: catRect.x + 3,
          y: catRect.y + headerH,
          w: Math.max(0, catRect.w - 6),
          h: Math.max(0, catRect.h - headerH - 3)
        };

        // Header node for category label
        this.nodes.push({
          isHeader: true,
          category: cat.name,
          rect: { x: catRect.x, y: catRect.y, w: catRect.w, h: headerH }
        });

        // Nodes inside category
        const validItems = (cat.children || []).filter(item => item.value > 0);
        const catTotal = validItems.reduce((acc, i) => acc + i.value, 0);

        if (catTotal > 0 && contentRect.w > 10 && contentRect.h > 10) {
          const itemRects = this.squarify(validItems, contentRect, catTotal);
          itemRects.forEach(ir => {
            this.nodes.push({
              isHeader: false,
              data: ir.data,
              rect: ir,
              category: cat.name
            });
          });
        }
      });
    } else {
      // Flat list of items (e.g. Issuers directly filling the entire canvas)
      const validItems = categories.filter(c => c.value > 0);
      const totalVal = validItems.reduce((acc, c) => acc + c.value, 0);
      if (totalVal <= 0) {
        this.drawEmptyState('Sin volumen de operaciones registrado');
        return;
      }

      const itemRects = this.squarify(validItems, { x: 3, y: 3, w: w - 6, h: h - 6 }, totalVal);
      itemRects.forEach(ir => {
        this.nodes.push({
          isHeader: false,
          data: ir.data,
          rect: ir,
          category: ir.data.name || ir.data.symbol || ''
        });
      });
    }

    this.draw();
  }

  squarify(children, rect, totalValue) {
    if (!children.length) return [];
    const results = [];
    const row = [];
    let currentRect = { ...rect };

    const items = [...children].sort((a, b) => b.value - a.value);

    let remainingItems = [...items];
    let remainingVal = totalValue;

    while (remainingItems.length > 0) {
      const isHorizontal = currentRect.w < currentRect.h;
      const length = isHorizontal ? currentRect.w : currentRect.h;

      let rowItems = [];
      let rowVal = 0;

      while (remainingItems.length > 0) {
        const item = remainingItems[0];
        const testRow = [...rowItems, item];
        const testVal = rowVal + item.value;

        if (rowItems.length === 0 || this.worstAspectRatio(testRow, testVal, length, totalValue, rect) <= this.worstAspectRatio(rowItems, rowVal, length, totalValue, rect)) {
          rowItems.push(remainingItems.shift());
          rowVal = testVal;
        } else {
          break;
        }
      }

      // Layout this row
      const rowFraction = rowVal / remainingVal;
      const rowThickness = Math.max(1, (isHorizontal ? currentRect.h : currentRect.w) * rowFraction);

      let offset = 0;
      rowItems.forEach(item => {
        const itemFraction = item.value / rowVal;
        const itemLength = Math.max(1, length * itemFraction);

        if (isHorizontal) {
          results.push({
            x: currentRect.x + offset,
            y: currentRect.y,
            w: Math.max(1, itemLength - 2),
            h: Math.max(1, rowThickness - 2),
            data: item
          });
          offset += itemLength;
        } else {
          results.push({
            x: currentRect.x,
            y: currentRect.y + offset,
            w: Math.max(1, rowThickness - 2),
            h: Math.max(1, itemLength - 2),
            data: item
          });
          offset += itemLength;
        }
      });

      // Update remaining rect
      if (isHorizontal) {
        currentRect.y += rowThickness;
        currentRect.h = Math.max(0, currentRect.h - rowThickness);
      } else {
        currentRect.x += rowThickness;
        currentRect.w = Math.max(0, currentRect.w - rowThickness);
      }
      remainingVal -= rowVal;
    }

    return results;
  }

  worstAspectRatio(row, rowVal, length, totalVal, fullRect) {
    if (!row.length || length === 0 || rowVal === 0) return Infinity;
    const totalArea = fullRect.w * fullRect.h;
    const rowArea = (rowVal / totalVal) * totalArea;
    const thickness = rowArea / length;
    if (thickness === 0) return Infinity;

    let worst = 0;
    row.forEach(item => {
      const itemArea = (item.value / totalVal) * totalArea;
      const itemLength = itemArea / thickness;
      const aspect = Math.max(thickness / itemLength, itemLength / thickness);
      if (aspect > worst) worst = aspect;
    });
    return worst;
  }

  getColorForChange(chg) {
    if (chg === undefined || chg === null || isNaN(chg) || chg === 0) {
      return '#334155'; // Neutral Slate
    }
    if (chg > 0) {
      if (chg >= 2.0) return '#059669'; // Deep Green
      if (chg >= 1.0) return '#10b981'; // Green
      if (chg >= 0.5) return '#16a34a';
      return '#15803d'; // Mild Green
    } else {
      if (chg <= -2.0) return '#b91c1c'; // Deep Red
      if (chg <= -1.0) return '#dc2626'; // Red
      if (chg <= -0.5) return '#e11d48';
      return '#be123c'; // Mild Red
    }
  }

  draw() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.cssWidth || 800;
    const h = this.cssHeight || 540;

    ctx.clearRect(0, 0, w, h);

    // Draw background
    ctx.fillStyle = '#090e17';
    ctx.fillRect(0, 0, w, h);

    // Render nodes
    this.nodes.forEach(node => {
      const r = node.rect;
      if (!r || r.w <= 0 || r.h <= 0) return;

      if (node.isHeader) {
        // Category Header (Finviz Sector Header)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(r.x, r.y, r.w, r.h);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = node.category.toUpperCase();
        ctx.fillText(label, r.x + 8, r.y + (r.h / 2));

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      } else {
        const item = node.data;
        const isHover = (this.hoveredNode === node);
        const bgColor = item.color || this.getColorForChange(item.chg);

        ctx.fillStyle = isHover ? '#38bdf8' : bgColor;
        ctx.fillRect(r.x, r.y, r.w, r.h);

        // Border
        ctx.strokeStyle = isHover ? '#facc15' : '#090e17';
        ctx.lineWidth = isHover ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        // Labels inside box (Issuer/Ticker name on top, Monto/Var on bottom)
        if (r.w >= 36 && r.h >= 24) {
          ctx.fillStyle = isHover ? '#090e17' : '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const primaryLabel = item.symbol || item.name || '';
          const fontSize = Math.min(16, Math.max(9, Math.floor(Math.min(r.w / (primaryLabel.length > 8 ? 6.5 : 4.8), r.h / 3))));
          ctx.font = `800 ${fontSize}px "JetBrains Mono", monospace`;

          const centerY = r.y + (r.h / 2);
          
          let subText = '';
          if (item.subLabel) {
            subText = item.subLabel;
          } else if (item.chg !== undefined) {
            subText = (item.chg > 0 ? `+${item.chg.toFixed(2)}%` : `${(item.chg || 0).toFixed(2)}%`);
          }

          if (r.h >= 45 && r.w >= 50 && subText) {
            // Two lines
            ctx.fillText(primaryLabel, r.x + (r.w / 2), centerY - (fontSize * 0.65));
            ctx.font = `700 ${Math.max(8, fontSize - 2)}px "JetBrains Mono", monospace`;
            ctx.fillStyle = isHover ? '#090e17' : 'rgba(250, 204, 21, 0.95)';
            ctx.fillText(subText, r.x + (r.w / 2), centerY + (fontSize * 0.75));
          } else {
            // Single line
            ctx.fillText(primaryLabel, r.x + (r.w / 2), centerY);
          }
        }
      }
    });
  }

  handleMouseMove(x, y, clientX, clientY) {
    let hit = null;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (node.isHeader) continue;
      const r = node.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        hit = node;
        break;
      }
    }

    if (hit !== this.hoveredNode) {
      this.hoveredNode = hit;
      this.draw();
    }

    if (this.hoveredNode && this.tooltipEl) {
      const item = this.hoveredNode.data;

      if (item.isIssuerSummary) {
        // Tooltip for Issuer Summary (Consolidado al Cable)
        this.tooltipEl.innerHTML = `
          <div style="font-weight: 800; font-size: 0.98rem; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <span>🏢 ${item.name}</span>
            <span style="color: #facc15; font-family: var(--font-mono); font-size: 0.82rem; font-weight: 700;">#${item.rank || ''}</span>
          </div>
          <div style="font-size: 0.76rem; color: #cbd5e1; margin-top: 3px; font-weight: 500;">${item.sector || 'Corporativo'} • ${item.speciesCount || 1} ONs activas</div>
          <div style="border-top: 1px solid rgba(56, 189, 248, 0.25); margin: 6px 0; padding-top: 6px; font-size: 0.78rem; font-family: var(--font-mono); display: grid; grid-template-columns: 1.25fr 1fr; gap: 5px;">
            <div style="color: #93c5fd; font-weight: 600;">Total Operado Cable:</div>
            <div style="text-align: right; color: #facc15; font-weight: 800;">US$ ${Math.round(item.cableUSD).toLocaleString('es-AR')}</div>
            <div style="color: #93c5fd; font-weight: 600;">Cuota de Mercado:</div>
            <div style="text-align: right; color: #ffffff; font-weight: 700;">${item.sharePct ? item.sharePct.toFixed(1) + '%' : '--'}</div>
            <div style="color: #93c5fd; font-weight: 600;">Operaciones Totales:</div>
            <div style="text-align: right; color: #ffffff; font-weight: 700;">${(item.ops || 0).toLocaleString('es-AR')} ops</div>
            <div style="color: #93c5fd; font-weight: 600;">Desglose x Moneda:</div>
            <div style="text-align: right; color: #e2e8f0; font-size: 0.72rem; font-weight: 500;">MEP + CCL + Pesos</div>
          </div>
          <div style="margin-top: 5px; font-size: 0.72rem; color: #cbd5e1; border-top: 1px dashed rgba(255,255,255,0.15); padding-top: 4px; font-family: var(--font-mono);">
            MEP: <span style="color:#fff;">US$ ${Math.round(item.mepUSD || 0).toLocaleString('es-AR')}</span> | CCL: <span style="color:#fff;">US$ ${Math.round(item.cclUSD || 0).toLocaleString('es-AR')}</span> | ARS: <span style="color:#fff;">$ ${Math.round((item.arsARS || 0) / 1e6).toLocaleString('es-AR')}M</span>
          </div>
        `;
      } else {
        // Standard Tooltip for Individual ON
        const chgColor = (item.chg > 0) ? '#10b981' : (item.chg < 0) ? '#ef4444' : '#e2e8f0';
        const chgSign = item.chg > 0 ? '+' : '';
        
        let vtoFormatted = '';
        const rawMaturity = item.maturity || item.bondRef?.maturity;
        if (rawMaturity) {
          const parts = rawMaturity.split('T')[0].split('-');
          if (parts.length === 3) {
            // DD/MM/AA (e.g. 08/04/38)
            vtoFormatted = `${parts[2]}/${parts[1]}/${parts[0].slice(-2)}`;
          }
        }

        this.tooltipEl.innerHTML = `
          <div style="font-weight: 800; font-size: 1rem; color: #38bdf8; display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem;">
            <div style="display: flex; align-items: baseline; gap: 0.45rem;">
              <span style="letter-spacing: 0.5px;">${item.symbol}</span>
              ${vtoFormatted ? `<span style="font-size: 0.75rem; color: #ffffff; font-weight: 600; font-family: var(--font-mono); background: rgba(56, 189, 248, 0.2); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.4);">${vtoFormatted}</span>` : ''}
            </div>
            <span style="color: ${chgColor}; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700;">${chgSign}${Number(item.chg || 0).toFixed(2)}%</span>
          </div>
          <div style="font-size: 0.8rem; color: #ffffff; margin-top: 3px; font-weight: 500;">${item.name || item.issuer || item.category || ''}</div>
          <div style="border-top: 1px solid rgba(56, 189, 248, 0.25); margin: 7px 0; padding-top: 7px; font-size: 0.78rem; font-family: var(--font-mono); display: grid; grid-template-columns: 1.15fr 1fr; gap: 5px;">
            <div style="color: #93c5fd; font-weight: 600;">Monto Cable USD:</div>
            <div style="text-align: right; color: #ffffff; font-weight: 800;">US$ ${Math.round(item.cableUSD || item.usdVal || 0).toLocaleString('es-AR')}</div>
            <div style="color: #93c5fd; font-weight: 600;">Último Precio:</div>
            <div style="text-align: right; color: #ffffff; font-weight: 700;">$${Number(item.px || 0).toFixed(2)}</div>
            <div style="color: #93c5fd; font-weight: 600;">Volumen Nom:</div>
            <div style="text-align: right; color: #ffffff; font-weight: 700;">${(item.vol || 0).toLocaleString('es-AR')}</div>
            <div style="color: #93c5fd; font-weight: 600;">Operaciones:</div>
            <div style="text-align: right; color: #ffffff; font-weight: 700;">${(item.ops || 0).toLocaleString('es-AR')} ops</div>
          </div>
        `;
      }

      this.tooltipEl.style.display = 'block';
      const tipW = this.tooltipEl.offsetWidth || 220;
      const tipH = this.tooltipEl.offsetHeight || 120;
      
      let left = clientX + 15;
      let top = clientY + 15;
      if (left + tipW > window.innerWidth - 20) left = clientX - tipW - 15;
      if (top + tipH > window.innerHeight - 20) top = clientY - tipH - 15;

      this.tooltipEl.style.left = `${left}px`;
      this.tooltipEl.style.top = `${top}px`;
    } else if (this.tooltipEl) {
      this.tooltipEl.style.display = 'none';
    }
  }
}

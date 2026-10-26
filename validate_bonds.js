// validate_bonds.js
// Linter Financiero Estricto previo a Deploy / Modificación de Emisiones
// Reglas: .agents/rules/argentine_fixed_income_conventions.md (Secciones 6, 9 y 10)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Iniciando Linter Financiero de Emisiones...');

let hasErrors = false;
const errorLog = [];

function addError(ticker, field, msg) {
  hasErrors = true;
  errorLog.push(`❌ [${ticker || 'SIN_TICKER'}] Campo '${field}': ${msg}`);
}

function addWarning(ticker, field, msg) {
  console.warn(`⚠️ [${ticker || 'SIN_TICKER'}] Advertencia en '${field}': ${msg}`);
}

// 1. Validar archivo de fichas canónicas si existe (emisiones.json)
const emisionesPath = path.join(__dirname, 'emisiones.json');
if (fs.existsSync(emisionesPath)) {
  try {
    const rawContent = fs.readFileSync(emisionesPath, 'utf8');
    const rawObjects = JSON.parse(rawContent);

    if (!Array.isArray(rawObjects)) {
      console.error('❌ Error: emisiones.json debe ser un array de objetos.');
      process.exit(1);
    }

    console.log(`📋 Verificando ${rawObjects.length} fichas en emisiones.json...`);

    // Validar orden de propiedades crudo (las claves de evidencia DEBEN ser las primeras del objeto)
    rawObjects.forEach((item, idx) => {
      const t = item.ticker || `Item[${idx}]`;
      const keys = Object.keys(item);
      const firstKey = keys[0];
      const validFirstKeys = ['evidencia_textual', '_evidencia_prospecto', '_evidencia_literal_cnv'];
      if (!validFirstKeys.includes(firstKey)) {
        addError(t, 'orden_propiedades', `La primera propiedad DEBE ser una de [${validFirstKeys.join(', ')}], pero se encontró '${firstKey}'.`);
      }
    });

    rawObjects.forEach((item, idx) => {
      const t = item.ticker || `Item[${idx}]`;

      // Regla Anti-Alucinación: Evidencia textual
      const hasOldEvidence = typeof item.evidencia_textual === 'string' && item.evidencia_textual.length > 0;
      const hasNewEvidence = typeof item._evidencia_prospecto === 'string' && typeof item._evidencia_resultados === 'string';
      const hasLiteralEvidence = typeof item._evidencia_literal_cnv === 'string';

      if (!hasOldEvidence && !hasNewEvidence && !hasLiteralEvidence) {
        addError(t, 'evidencia_textual', 'Falta evidencia textual literal de respaldo (ej. _evidencia_prospecto / _evidencia_resultados o evidencia_textual).');
      }

      if (item._evidencia_literal_cnv === 'SIN_DOCUMENTO_OFICIAL_EN_CONTEXTO' || item.evidencia_textual?.includes('FALTA_AVISO_RESULTADOS')) {
        addError(t, 'evidencia_textual', 'Falta el documento oficial en contexto. Debe suministrarse antes de aprobar el alta.');
      }

      // Fechas
      if (!item.fecha_emision || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha_emision)) {
        addError(t, 'fecha_emision', `Formato inválido (${item.fecha_emision}). Debe ser YYYY-MM-DD.`);
      }
      if (!item.fecha_vencimiento || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha_vencimiento)) {
        addError(t, 'fecha_vencimiento', `Formato inválido (${item.fecha_vencimiento}). Debe ser YYYY-MM-DD.`);
      }
      if (item.fecha_emision && item.fecha_vencimiento && item.fecha_emision >= item.fecha_vencimiento) {
        addError(t, 'fechas', `Fecha de emisión (${item.fecha_emision}) debe ser anterior a vencimiento (${item.fecha_vencimiento}).`);
      }

      // Tipo de amortización
      if (item.tipo_amortizacion === 'Bullet') {
        if (!Array.isArray(item.cronograma_amortizacion) || item.cronograma_amortizacion.length !== 1) {
          addError(t, 'cronograma_amortizacion', `Estructura Bullet debe tener un cronograma con exactamente 1 cuota al 100%.`);
        } else {
          const c = item.cronograma_amortizacion[0];
          if (c.porcentaje !== 100 && c.porcentaje !== 100.0) {
            addError(t, 'cronograma_amortizacion', `Estructura Bullet debe amortizar el 100%, valor actual: ${c.porcentaje}%.`);
          }
          if (c.fecha !== item.fecha_vencimiento) {
            addError(t, 'cronograma_amortizacion', `Fecha de amortización (${c.fecha}) no coincide con fecha_vencimiento (${item.fecha_vencimiento}).`);
          }
        }
      } else if (item.tipo_amortizacion === 'Amortizable') {
        if (!Array.isArray(item.cronograma_amortizacion) || item.cronograma_amortizacion.length === 0) {
          addError(t, 'cronograma_amortizacion', `Debe incluir el array de cuotas de amortización.`);
        } else {
          const totalPct = item.cronograma_amortizacion.reduce((sum, c) => sum + (Number(c.porcentaje) || 0), 0);
          if (Math.abs(totalPct - 100) > 0.01) {
            addError(t, 'cronograma_amortizacion', `La suma de cuotas de amortización debe ser 100%, suma actual: ${totalPct}%.`);
          }
          const lastCuota = item.cronograma_amortizacion[item.cronograma_amortizacion.length - 1];
          if (lastCuota.fecha !== item.fecha_vencimiento) {
            addError(t, 'cronograma_amortizacion', `La última cuota (${lastCuota.fecha}) no coincide con fecha_vencimiento (${item.fecha_vencimiento}).`);
          }
        }
      } else {
        addError(t, 'tipo_amortizacion', `Valor no admitido: ${item.tipo_amortizacion}. Debe ser 'Bullet' o 'Amortizable'.`);
      }

      // Tasas Fijas vs Variables
      if (item.tasa_fija_anual !== null && item.tasa_fija_anual !== undefined) {
        if (typeof item.tasa_fija_anual !== 'number' || item.tasa_fija_anual < 0 || item.tasa_fija_anual > 1) {
          addError(t, 'tasa_fija_anual', `Debe ser número decimal entre 0 y 1 (ej: 0.0569 para 5.69% o 0 para cupón cero). Valor: ${item.tasa_fija_anual}`);
        }
      } else {
        // Es tasa variable o sin tasa fija
        if (!item.tasa_referencia || typeof item.tasa_referencia !== 'string') {
          addError(t, 'tasa_referencia', `Al no tener tasa fija, DEBE definirse tasa_referencia explícita ('TAMAR' | 'BADLAR').`);
        }
        if (typeof item.margen_tasa_variable !== 'number') {
          addError(t, 'margen_tasa_variable', `Al ser tasa variable, DEBE definirse margen_tasa_variable como decimal (ej: 0.0495).`);
        }
      }

      // Base de cálculo
      const basesValidas = ['Actual/365', 'ACT/365', '30/360', 'Actual/Actual'];
      if (!basesValidas.includes(item.base_calculo)) {
        addError(t, 'base_calculo', `Base no válida (${item.base_calculo}). Permitidas: ${basesValidas.join(', ')}`);
      }
    });

  } catch (err) {
    console.error('❌ Error fatal al parsear emisiones.json:', err.message);
    process.exit(1);
  }
} else {
  addWarning('GLOBAL', 'emisiones.json', 'No se encontró el archivo emisiones.json en el directorio raíz.');
}

// 2. Validar dataset activo en js/data.js
try {
  const { BONDS_DATASET } = await import('./js/data.js');
  console.log(`📊 Validando ${BONDS_DATASET.length} instrumentos en js/data.js...`);

  BONDS_DATASET.forEach(b => {
    const t = b.ticker || b.id;

    // Verificar Bullet vs CashFlows
    if (b.structureType === 'Bullet') {
      const amortFlows = (b.cashFlows || []).filter(cf => cf.amortization > 0);
      if (amortFlows.length !== 1) {
        addError(t, 'cashFlows', `Estructura Bullet debe tener exactamente 1 amortización final. Encontradas: ${amortFlows.length}`);
      } else if (amortFlows[0].date !== b.maturity) {
        addError(t, 'cashFlows', `Fecha de amortización final (${amortFlows[0].date}) no coincide con maturity (${b.maturity}).`);
      }
    }

    // Verificar que instrumentos variables tengan especificado el spread
    if (b.couponType === 'Variable' || b.instrumentGroup?.includes('BADLAR') || b.instrumentGroup?.includes('TAMAR')) {
      if (b.couponRate === undefined || b.couponRate === null) {
        addError(t, 'couponRate', `Instrumento variable sin couponRate inicial de proyección.`);
      }
    }
  });

} catch (err) {
  console.error('❌ Error al importar js/data.js:', err.message);
  process.exit(1);
}

// 3. Resultado final
if (hasErrors) {
  console.error('\n🚫 EL LINTER FINANCIERO DETECTÓ ERRORES BLOQUEANTES:');
  errorLog.forEach(e => console.error(e));
  console.error('\n⛔ Se cancela cualquier despliegue hasta subsanar las inconsistencias.');
  process.exit(1);
} else {
  console.log('\n✅ VALIDACIÓN FINANCIERA EXITOSA: Todas las emisiones cumplen con las reglas del protocolo.');
  process.exit(0);
}

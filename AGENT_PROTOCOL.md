# PROTOCOLO ESTRICTO DE INGENIERÍA FINANCIERA Y ALTA DE ONs

Este proyecto calcula flujos de fondos (Cash Flows), TIR/YTM, Paridad, Interés Corrido y Duration de Obligaciones Negociables (ONs) del mercado argentino (CNV / BYMA / MAE). Cualquier dato inventado corrompe matemáticamente la calculadora en producción.

## REGLA 1: PROHIBICIÓN DE REFERENCIA CIRCULAR (ANTI-LOOP)
- Los datos que ya existen dentro de `app.js` o archivos `.json` locales NO son fuente de verdad. 
- Está TERMINANTEMENTE PROHIBIDO leer los datos ya hardcodeados en el código para "verificar" o "corregir" una emisión.

## REGLA 2: PROHIBICIÓN DE FALSIFICAR EVIDENCIA (ANTI-CHAMUYO)
- NUNCA inventes resúmenes con formato de terminal (ej. prohibido escribir cosas como `"Registro BYMA R4: ON CLASE... | ISIN... | Emisión..."`).
- El campo `_evidencia_literal_cnv` debe contener ÚNICAMENTE un copy-paste textual extraído de un PDF oficial ("Aviso de Resultados" o "Suplemento de Prospecto") provisto en el chat o leído mediante una herramienta web verificable en el turno actual.
- Si no tenés el texto literal del Aviso de Resultados frente a vos, debés asignar `"_evidencia_literal_cnv": "SIN_DOCUMENTO_OFICIAL_EN_CONTEXTO"`, frenar la edición del código y pedirle el documento al usuario.

## REGLA 3: ORDEN DE PROPIEDADES OBLIGATORIO (CHAIN-OF-THOUGHT)
Al dar de alta o modificar una ON en el código, las propiedades de auditoría DEBEN escribirse PRIMERO que los datos numéricos. Nunca al final del objeto:

```json
{
  "_evidencia_prospecto": "Cita literal del Suplemento (amortización, base, ley y moneda)",
  "_evidencia_resultados": "Cita literal del Aviso de Resultados (monto adjudicado, tasa de corte / margen y fechas exactas)",
  "_fuente_verificada": true,
  "ticker": "RC7CO",
  "ticker_mep": "RC7CD",
  "ticker_ccl": "RC7CC",
  "isin": "AR0939227226",
  "emisor": "ARCOR S.A.I.C.",
  "clase_serie": "Clase 7",
  "moneda_emision": "USD",
  "moneda_pago": "USD_CCL",
  "ley": "Argentina",
  "fecha_emision": "YYYY-MM-DD",
  "fecha_vencimiento": "YYYY-MM-DD",
  "tipo_tasa": "FIJA | TAMAR | BADLAR | SOFR",
  "tasa_fija_anual": 0.0569,
  "margen_sobre_variable": null,
  "frecuencia_interes_meses": 6,
  "base_calculo": "30/360",
  "tipo_amortizacion": "Bullet",
  "cronograma_amortizacion": [
    { "fecha": "YYYY-MM-DD", "porcentaje": 100.0 }
  ]
}
```

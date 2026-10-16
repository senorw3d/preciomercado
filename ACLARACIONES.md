# ACLARACIONES METODOLÓGICAS - MERCADO Y VOLUMEN OPERADO

Este documento detalla la metodología financiera de consolidación de volumen negociado en la plataforma **PrecioMercado**:

---

## 1. Moneda de Consolidación: Dólar Cable (CCL)
El mercado corporativo argentino (Obligaciones Negociables) negocia en tres segmentos de liquidación distintos:
1. **Dólar MEP (Especie D)**: Liquidación en cuentas locales en dólares (Comitente / MEP).
2. **Dólar Cable (Especie C)**: Liquidación en cuentas en el exterior / divisas (CCL).
3. **Pesos Argentinos (Especie O / Local)**: Liquidación en pesos en el sistema financiero local.

Para sumar y expresar el volumen de las tres monedas en una única cifra homogénea y comparable en la tarjeta de **Volumen Total del Día**, todo se consolida en **Dólar Cable (USD)**.

---

## 2. Conversión de Dólar MEP (D) a Dólar Cable (C) vía Ratio de Canje
Para reflejar con rigor el arbitraje real de mercado entre la plaza local y la del exterior, el volumen en **Dólar MEP** se ajusta por el **Costo de Canje**:

$$\text{Ratio de Canje} = \frac{\text{Cotización AL30C}}{\text{Cotización AL30D}} \quad \left(\text{o fallback } \frac{\text{GD30C}}{\text{GD30D}}\right)$$

$$\text{Monto MEP (expresado en Cable USD)} = \text{Monto MEP} \times \text{Ratio de Canje}$$

* **Referencia al Cierre**:
  * AL30C: **US$ 53,75**
  * AL30D: **US$ 56,26**
  * Ratio = $\frac{53,75}{56,26} \approx \mathbf{0,9554}$ (Canje implícito de **+4,67%**).
  * Por cada **US$ 100.000 negociados en MEP**, se computan **US$ 95.539 en Dólar Cable**.

---

## 3. Conversión de Pesos (O) a Dólar Cable vía CCL
El volumen operado en pesos se convierte a Dólar Cable dividiendo directamente por el tipo de cambio del **Contado con Liquidación (CCL)** del día:

$$\text{Monto en Pesos (expresado en Cable USD)} = \frac{\text{Monto en Pesos (ARS)}}{\text{Tipo de Cambio CCL}}$$

* **Referencia al Cierre**:
  * Cotización CCL = **$ 1.611,16**

---

## 4. Volumen Total Consolidado
El valor reflejado en la tarjeta principal representa la suma exacta de los tres componentes expresados en **Dólar Cable**:

$$\text{Volumen Total (USD Cable)} = \left(\text{Monto MEP} \times \text{Ratio Canje}\right) + \text{Monto Cable} + \left(\frac{\text{Monto Pesos}}{\text{TC CCL}}\right)$$

---

## 5. Distribución de Liquidez
La barra de distribución de liquidez del panel principal utiliza estos mismos valores homogéneos en Dólar Cable, garantizando que los porcentajes representen la participación real en divisas de cada segmento sobre el 100% del mercado.

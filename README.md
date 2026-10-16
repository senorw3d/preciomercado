# PrecioMercado • Fixed Income Analytics & Real-Time Pricing 📊🇦🇷

> **Plataforma web de analítica financiera, cálculo de rendimientos (TIR/YTM), duración modificada y curvas de rendimiento para bonos soberanos y Obligaciones Negociables (ONs) del mercado de capitales argentino (BYMA).**

🔗 **Aplicación en Vivo:** [preciomercado.web.app](https://preciomercado.web.app)  
👤 **Autor:** Valentín ([@senorw3d](https://github.com/senorw3d))

---

## 🎯 Descripción General

**PrecioMercado** es una suite de herramientas de análisis cuantitativo diseñada para inversores, analistas y profesionales del mercado financiero. Procesa y estructura el universo completo de instrumentos de renta fija argentina (especialmente Obligaciones Negociables corporativas en Hard Dollar MEP/CCL, UVA y Pesos), permitiendo:

1. **Cotización y Rueda BYMA en Vivo:** Integración en tiempo real de precios T+1 / Contado Inmediato (CI), volumen nominal, monto operado y VWAP.
2. **Calculadora Financiera en Tiempo Real:** 
   - Proyección dinámica de flujos de fondos (cupones de interés fijos, variables Badlar/TamAR, amortizaciones parciales y esquemas bullet).
   - Cálculo instantáneo de **Tasa Interna de Retorno (TIR / YTM)** mediante algoritmos numéricos optimizados.
   - **Modified Duration (MD)**, Paridad Técnica, Valor Residual y Devengamiento de Intereses.
3. **Curvas Soberanas y Corporativas:** Modelado y visualización de curvas de rendimiento agrupadas por moneda, emisor y calificación crediticia.
4. **Treemap de Mercado:** Mapa visual interactivo del volumen y distribución del mercado secundario corporativo.
5. **Matriz de Calendario de Liquidación:** Respeto estricto de feriados bursátiles y convenciones de liquidación de BYMA (T+1 hábil).

---

## 📐 Modelos Matemáticos y Metodología Financiera

### 1. Tasa Interna de Retorno (TIR / YTM)
El cálculo de la TIR se realiza resolviendo la ecuación de valor presente neto igualada al precio sucio (*dirty price*) del mercado más los gastos/comisiones:

$$P_{dirty} = \sum_{i=1}^{n} \frac{CF_i}{(1 + y)^{\frac{t_i - t_{settlement}}{365}}}$$

- **Algoritmo:** Implementación de **Newton-Raphson** con derivadas analíticas continuas y control de convergencia para asegurar precisión sub-milisegundo en el navegador.

### 2. Duración Modificada (Modified Duration)
Mide la sensibilidad del precio del bono ante variaciones en la tasa de interés:

$$D_{Macaulay} = \frac{1}{P_{dirty}} \sum_{i=1}^{n} \frac{t_i \cdot CF_i}{(1 + y)^{t_i}}$$

$$D_{Modified} = \frac{D_{Macaulay}}{1 + \frac{y}{f}}$$

### 3. Convenciones Bursátiles de BYMA
- **Días de Liquidación:** Avance automático de fines de semana y feriados oficiales del mercado de capitales argentino para el plazo estándar T+1 y Contado Inmediato.
- **Intereses Corridos (Accrued Interest):** Cálculo diario pro-rata según la base de convención de cada prospecto de emisión (Actual/365 o 30/360).

---

## 🛠️ Arquitectura Técnica (*Zero-Backend*)

La arquitectura está construida bajo un enfoque de **Client-Side High-Performance Computing**:
- **Core:** JavaScript Vanilla (ES6+) modularizado, sin dependencias pesadas de frameworks, garantizando una carga instantánea y fluidez en 60 FPS.
- **Visualización:** Chart.js para curvas de rendimiento y renderizado interactivo en Canvas HTML5.
- **Diseño & UI:** Vanilla CSS moderno con estética Glassmorphism, paleta HSL oscura inspirada en terminales financieras profesionales (Bloomberg / Refinitiv) y diseño responsive.
- **Fuentes de Datos en Vivo:**
  - Cotizaciones bursátiles BYMA vía API Data912.
  - Tipos de cambio financieros (Dólar MEP, CCL, Oficial) vía DolarApi.
- **Infraestructura de Despliegue:** Firebase Hosting con entrega global a través de CDN edge y caché optimizado.

---

## 📂 Estructura del Repositorio

```text
├── index.html              # Estructura principal y componentes de la UI
├── css/
│   └── styles.css          # Sistema de diseño, Glassmorphism, tokens y responsive
├── js/
│   ├── app.js              # Controlador principal, eventos del DOM y orquestación
│   ├── financial-math.js   # Motores de cálculo: TIR, Duración, Flujos y BYMA Calendar
│   ├── data.js             # Base estructurada de instrumentos (ONs, prospectos, flujos)
│   ├── curve-chart.js      # Gráficos de curvas de rendimiento
│   └── treemap.js          # Visualización de treemap de volumen y capitalización
├── assets/                 # Logotipos, íconos y recursos estáticos
├── firebase.json           # Configuración de hosting y headers de seguridad
└── README.md               # Documentación técnica
```

---

## 🚀 Ejecución en Entorno Local

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/senorw3d/preciomercado.git
   cd preciomercado
   ```

2. Abrir con cualquier servidor estático local (por ejemplo con Python o Node):
   ```bash
   # Opción con Python:
   python -m http.server 8000

   # O con Node.js:
   npx http-server -p 8000
   ```

3. Ingresar en el navegador a `http://localhost:8000`.

---

## 📄 Licencia

Este proyecto es de código abierto y se distribuye bajo los términos de la Licencia **MIT**. Consulta el archivo `LICENSE` para más detalles.

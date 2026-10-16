/**
 * BYMA Custody Instruments API Service
 * Implements Homologación and Producción endpoints with OAuth2 Bearer Auth & Async UUID Polling.
 */
export class BymaCustodyApi {
  constructor(env = 'homologacion') {
    this.setEnvironment(env);
  }

  setEnvironment(env) {
    this.env = env;
    if (env === 'produccion') {
      this.baseUrl = 'https://api.byma.com.ar/custody-instruments/v1';
    } else {
      this.baseUrl = 'https://hs-api.byma.com.ar/custody-instruments/v1';
    }
  }

  /**
   * Helper method to perform requests handling the 409 UUID async polling required by BYMA API.
   */
  async requestWithUuidPolling(url, accessToken, extraHeaders = {}) {
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json, text/csv, */*',
      ...extraHeaders
    };

    try {
      let response = await fetch(url, { method: 'GET', headers });
      
      // If 409 Conflict with UUID or response contains uuid
      if (response.status === 409 || response.ok) {
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          // If already plain text / CSV data
          return this.parseResponseData(text);
        }

        if (data && data.uuid) {
          const uuid = data.uuid;
          console.log(`[BYMA API] Response async pending. Polling UUID: ${uuid}`);
          
          // Wait 1.5 seconds before sending request with X-UUID
          await new Promise(res => setTimeout(res, 1500));
          
          const uuidHeaders = {
            ...headers,
            'X-UUID': uuid
          };

          const pollResponse = await fetch(url, { method: 'GET', headers: uuidHeaders });
          const pollText = await pollResponse.text();
          return this.parseResponseData(pollText);
        } else {
          return data;
        }
      } else {
        throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.error('[BYMA API] Error in request:', err);
      throw err;
    }
  }

  parseResponseData(rawText) {
    if (!rawText) return [];
    rawText = rawText.trim();
    if (rawText.startsWith('[') || rawText.startsWith('{')) {
      try {
        return JSON.parse(rawText);
      } catch (e) {}
    }
    // Parse CSV separated by semicolon ;
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(';').map(h => h.trim());
    const result = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(';');
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = values[idx] !== undefined ? values[idx].trim() : '';
      });
      result.push(obj);
    }
    return result;
  }

  /**
   * GET /asset-classes.csv/
   * List of asset classes in custody
   */
  async getAssetClasses(accessToken) {
    const url = `${this.baseUrl}/asset-classes.csv/`;
    return await this.requestWithUuidPolling(url, accessToken);
  }

  /**
   * GET /standard.csv/?assetClassName={assetClassName}&cvsaIdentifier={cvsaIdentifier}
   * List of standardized instruments
   */
  async getStandardInstruments(assetClassName = 'ACCIONES', cvsaIdentifier = '', accessToken = '') {
    let url = `${this.baseUrl}/standard.csv/?assetClassName=${encodeURIComponent(assetClassName)}`;
    if (cvsaIdentifier) {
      url += `&cvsaIdentifier=${encodeURIComponent(cvsaIdentifier)}`;
    }
    return await this.requestWithUuidPolling(url, accessToken);
  }

  /**
   * GET /non-standard.csv/?assetClassName={assetClassName}&cvsaIdentifier={cvsaIdentifier}
   * List of non-standardized instruments
   */
  async getNonStandardInstruments(assetClassName = 'Cheques Pago Diferido - No Standard', cvsaIdentifier = '', accessToken = '') {
    let url = `${this.baseUrl}/non-standard.csv/?assetClassName=${encodeURIComponent(assetClassName)}`;
    if (cvsaIdentifier) {
      url += `&cvsaIdentifier=${encodeURIComponent(cvsaIdentifier)}`;
    }
    return await this.requestWithUuidPolling(url, accessToken);
  }

  /**
   * Transform BYMA instrument response to application bond schema
   */
  transformToBondSchema(bymaItem) {
    return {
      id: `byma_${bymaItem.identInstrument || bymaItem.cvsaIdentifier}`,
      ticker: bymaItem.cvsaIdentifier || bymaItem.instrumentLongName || 'BYMA_TICKER',
      isin: bymaItem.isin || 'N/A',
      issuer: bymaItem.issuerName || 'Emisor BYMA',
      shortIssuer: bymaItem.issuerName ? bymaItem.issuerName.split(' ')[0] : 'BYMA',
      rating: 'AA(arg)',
      ratingAgency: 'FIX (Fitch)',
      type: bymaItem.assetClassName || 'ON',
      instrumentGroup: (bymaItem.currency === 'ARS') ? 'Pesos Fijos' : 'USD MEP',
      currency: bymaItem.currency || 'USD',
      paymentCurrency: bymaItem.paymentCurrency || 'USD',
      law: 'Argentina',
      isCallable: false,
      structureType: 'Amortizable',
      couponType: 'Fijo',
      sector: 'Mercado de Capitales',
      maturity: bymaItem.maturityDate ? bymaItem.maturityDate.split(' ')[0] : '2028-12-31',
      lastCouponDate: '2026-01-15',
      couponRate: 8.0,
      frequency: 2,
      cleanPrice: 100.0,
      volume30d: '500K'
    };
  }
}

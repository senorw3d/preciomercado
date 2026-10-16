/**
 * ISO 6166 ISIN (International Securities Identification Number) VALIDATOR ENGINE
 * Implements strict ISO 6166 standard specification and the Luhn Modulo 10 
 * Double-Add-Double checksum algorithm used by National Numbering Agencies (Caja de Valores CVSA, CUSIP, ANNA).
 */

export class ISINValidator {
  /**
   * Validates an ISIN string according to ISO 6166.
   * @param {string} isin 
   * @returns {{ isValid: boolean, isin: string, error?: string, country?: string, nsin?: string, calculatedCheckDigit?: number }}
   */
  static validate(isin) {
    if (!isin || typeof isin !== 'string') {
      return { isValid: false, isin: '', error: 'ISIN nulo o no proporcionado' };
    }

    const clean = isin.toUpperCase().trim().replace(/[\s\-_]/g, '');

    // 1. Length check: Exactly 12 alphanumeric characters
    if (clean.length !== 12) {
      return {
        isValid: false,
        isin: clean,
        error: `Longitud inválida (${clean.length}/12 caracteres). Debe contener exactamente 12 caracteres.`
      };
    }

    // 2. Format check: 2 letters (country code) + 9 alphanumerics (NSIN) + 1 digit (checksum)
    const regex = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
    if (!regex.test(clean)) {
      return {
        isValid: false,
        isin: clean,
        error: 'Estructura inválida. Debe ser: 2 letras de país (ej. AR, US, XS) + 9 caracteres alfanuméricos + 1 dígito de control.'
      };
    }

    const country = clean.slice(0, 2);
    const nsin = clean.slice(2, 11);
    const checkDigit = parseInt(clean[11], 10);

    // 3. Mathematical Luhn Modulo 10 Checksum calculation
    const calculatedCheckDigit = this.calculateCheckDigit(clean.slice(0, 11));

    if (calculatedCheckDigit !== checkDigit) {
      return {
        isValid: false,
        isin: clean,
        country,
        nsin,
        calculatedCheckDigit,
        error: `Dígito verificador incorrecto. El ISIN tiene '${checkDigit}' pero el algoritmo ISO 6166 calcula '${calculatedCheckDigit}'.`
      };
    }

    return {
      isValid: true,
      isin: clean,
      country,
      nsin,
      calculatedCheckDigit
    };
  }

  /**
   * Computes the ISO 6166 check digit for the first 11 characters of an ISIN.
   * Algorithm:
   * 1. Convert each letter to two digits based on its alphabetical position (A=10, B=11, ..., Z=35).
   * 2. Double every second digit from right to left.
   * 3. Sum the individual digits of each resulting product (e.g. 14 -> 1 + 4 = 5).
   * 4. Subtract the sum modulo 10 from 10. If result is 10, check digit is 0.
   * @param {string} first11Chars 
   * @returns {number} 0-9
   */
  static calculateCheckDigit(first11Chars) {
    if (!first11Chars || first11Chars.length < 11) return -1;

    let digitsStr = '';
    for (let i = 0; i < 11; i++) {
      const char = first11Chars[i].toUpperCase();
      const code = char.charCodeAt(0);
      if (code >= 65 && code <= 90) { // 'A'-'Z'
        digitsStr += (code - 55).toString(); // A=10, B=11...
      } else if (code >= 48 && code <= 57) { // '0'-'9'
        digitsStr += char;
      } else {
        return -1;
      }
    }

    let sum = 0;
    let doubleIt = true; // Rightmost converted digit is doubled

    for (let i = digitsStr.length - 1; i >= 0; i--) {
      let digit = parseInt(digitsStr[i], 10);
      if (doubleIt) {
        digit *= 2;
        if (digit > 9) {
          digit = Math.floor(digit / 10) + (digit % 10);
        }
      }
      sum += digit;
      doubleIt = !doubleIt;
    }

    return (10 - (sum % 10)) % 10;
  }

  /**
   * Audits an entire collection of bonds and returns an audit report.
   * @param {Array} bonds 
   * @returns {{ total: number, validCount: number, invalidCount: number, emptyCount: number, issues: Array }}
   */
  static auditBondsDataset(bonds) {
    let validCount = 0;
    let invalidCount = 0;
    let emptyCount = 0;
    const issues = [];

    bonds.forEach((bond, index) => {
      const isin = bond.isin;
      if (!isin || isin.trim() === '') {
        emptyCount++;
        issues.push({
          index,
          ticker: bond.ticker,
          issuer: bond.issuer,
          isin: '',
          type: 'EMPTY',
          message: 'Sin código ISIN asignado'
        });
      } else {
        const result = this.validate(isin);
        if (result.isValid) {
          validCount++;
        } else {
          invalidCount++;
          issues.push({
            index,
            ticker: bond.ticker,
            issuer: bond.issuer,
            isin,
            type: 'CHECKSUM_FAILED',
            message: result.error
          });
        }
      }
    });

    return {
      total: bonds.length,
      validCount,
      invalidCount,
      emptyCount,
      issues
    };
  }
}

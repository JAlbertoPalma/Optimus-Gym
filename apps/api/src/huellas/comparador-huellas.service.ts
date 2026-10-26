import { Injectable } from '@nestjs/common';

// Valores configurables desde el .env. Son funciones (y no constantes) para leer el .env
// en el momento de usarlas. Se usan en clientes.service.ts:
//  - CALIDAD_MINIMA: por debajo de este valor la huella se rechaza (FA-02)
//  - UMBRAL_DUPLICADO: a partir de este % de similitud se considera la misma huella (FA-05)
export const CALIDAD_MINIMA = () => Number(process.env.CALIDAD_MINIMA ?? 70);
export const UMBRAL_DUPLICADO = () => Number(process.env.UMBRAL_DUPLICADO ?? 95);

/**
 * SIMULADO. Compara dos plantillas byte a byte y devuelve similitud 0–100.
 * Se reemplazará por el SDK del lector biométrico (servicio de huella en localhost).
 */
// Ejemplo: si de 64 bytes coinciden 32 en la misma posición → similitud 50.
// Con la opción "repetida" de index.html se manda exactamente la misma plantilla → similitud 100.
@Injectable()
export class ComparadorHuellasService {
  similitud(a: Buffer, b: Buffer): number {
    const n = Math.max(a.length, b.length);
    if (n === 0) return 0;
    let iguales = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) iguales++;
    return (iguales / n) * 100;
  }
}

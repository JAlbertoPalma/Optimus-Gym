import { Injectable } from '@nestjs/common';

export const CALIDAD_MINIMA = () => Number(process.env.CALIDAD_MINIMA ?? 70);
export const UMBRAL_DUPLICADO = () => Number(process.env.UMBRAL_DUPLICADO ?? 95);

/**
 * SIMULADO. Compara dos plantillas byte a byte y devuelve similitud 0–100.
 * Se reemplazará por el SDK del lector biométrico (servicio de huella en localhost).
 */
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

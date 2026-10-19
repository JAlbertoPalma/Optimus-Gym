import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** AES-256-GCM. Resultado: datos cifrados + tag de autenticación (16 bytes) al final. */
@Injectable()
export class CifradoService {
  private clave(): Buffer {
    const hex = process.env.CLAVE_CIFRADO ?? '';
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('CLAVE_CIFRADO debe tener 64 caracteres hexadecimales');
    return Buffer.from(hex, 'hex');
  }
  cifrar(datos: Buffer): { cifrado: Buffer; iv: Buffer } {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.clave(), iv);
    const cifrado = Buffer.concat([c.update(datos), c.final(), c.getAuthTag()]);
    return { cifrado, iv };
  }
  descifrar(cifrado: Buffer, iv: Buffer): Buffer {
    const tag = cifrado.subarray(cifrado.length - 16);
    const d = createDecipheriv('aes-256-gcm', this.clave(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
  }
}

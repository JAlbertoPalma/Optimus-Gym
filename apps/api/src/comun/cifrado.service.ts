// CIFRADO de las plantillas de huella (RE-02). Lo usa clientes.service.ts:
//  - cifrar() antes de guardar una huella nueva
//  - descifrar() para comparar contra las huellas ya guardadas (FA-05)
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'; // módulo de criptografía de Node.js

/** AES-256-GCM. Resultado: datos cifrados + tag de autenticación (16 bytes) al final. */
// - AES-256: algoritmo de cifrado con clave de 256 bits (32 bytes = 64 caracteres hex).
// - GCM: modo que además genera un "tag" para detectar si los datos fueron alterados.
// - IV (vector de inicialización): valor aleatorio distinto en cada cifrado, para que dos huellas
//   iguales no produzcan el mismo resultado cifrado. No es secreto; se guarda junto a la plantilla.
@Injectable()
export class CifradoService {
  // Lee la clave de CLAVE_CIFRADO en el .env y la convierte de texto hexadecimal a bytes
  private clave(): Buffer {
    const hex = process.env.CLAVE_CIFRADO ?? '';
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('CLAVE_CIFRADO debe tener 64 caracteres hexadecimales');
    return Buffer.from(hex, 'hex');
  }

  cifrar(datos: Buffer): { cifrado: Buffer; iv: Buffer } {
    const iv = randomBytes(12); // 12 bytes es el tamaño recomendado para GCM
    const c = createCipheriv('aes-256-gcm', this.clave(), iv);
    // Resultado = datos cifrados + tag (16 bytes) pegado al final
    const cifrado = Buffer.concat([c.update(datos), c.final(), c.getAuthTag()]);
    return { cifrado, iv };
  }

  descifrar(cifrado: Buffer, iv: Buffer): Buffer {
    // Separa el tag (últimos 16 bytes) de los datos cifrados
    const tag = cifrado.subarray(cifrado.length - 16);
    const d = createDecipheriv('aes-256-gcm', this.clave(), iv);
    d.setAuthTag(tag); // si los datos fueron alterados, d.final() lanzará un error
    return Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
  }
}

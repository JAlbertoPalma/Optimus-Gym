// MANEJO DE ERRORES de toda la API. Se activa en main.ts con app.useGlobalFilters(new FiltroErrores()).
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

// Error "esperado" de una regla de negocio (dato inválido, duplicado, etc.).
// Los servicios lo lanzan con: throw new ErrorNegocio('CODIGO', 'Mensaje', estadoHttp, campos, extra)
//  - codigo: identificador fijo para que el frontend sepa qué pasó (ej. 'DUPLICADO')
//  - estado: código HTTP (422 = datos inválidos, 409 = conflicto/duplicado, 500 = error del servidor)
//  - campos: qué campo del formulario tiene el problema (index.html los muestra entre paréntesis)
//  - extra: información adicional que se agrega a la respuesta (ej. codigoExistente)
export class ErrorNegocio extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public estado = 400,
    public campos?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(mensaje);
  }
}

// @Catch() sin argumentos = atrapa CUALQUIER error que no se haya manejado en la app.
// Su trabajo es convertir el error en una respuesta JSON con el mismo formato siempre:
//   { codigo, mensaje, campos?, ...extra }  ← lo que lee mostrarMensaje() en index.html
@Catch()
export class FiltroErrores implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse(); // objeto de respuesta HTTP (Express)
    // 1) Nuestros errores de negocio: se responde con su estado y datos
    if (e instanceof ErrorNegocio) {
      return res.status(e.estado).json({ codigo: e.codigo, mensaje: e.message, campos: e.campos, ...e.extra });
    }
    // 2) Errores propios de NestJS (ej. 404 ruta no encontrada)
    if (e instanceof HttpException) {
      return res.status(e.getStatus()).json({ codigo: 'HTTP_' + e.getStatus(), mensaje: e.message });
    }
    // 3) Cualquier otro error inesperado: se imprime en la consola del servidor,
    //    pero al usuario solo se le da un mensaje genérico (no se exponen detalles internos)
    console.error(e);
    return res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' });
  }
}

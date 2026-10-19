import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

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

@Catch()
export class FiltroErrores implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof ErrorNegocio) {
      return res.status(e.estado).json({ codigo: e.codigo, mensaje: e.message, campos: e.campos, ...e.extra });
    }
    if (e instanceof HttpException) {
      return res.status(e.getStatus()).json({ codigo: 'HTTP_' + e.getStatus(), mensaje: e.message });
    }
    console.error(e);
    return res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' });
  }
}

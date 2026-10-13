/*
 * Documentación OpenAPI de la API. Se sirve en /api/docs (Swagger UI) y en
 * /api/docs.json. Si cambias una ruta, actualiza aquí su descripción.
 */
import { MODULES } from '../middlewares/auth.js'

const bearer = [{ bearerAuth: [] }]
const json = (schema, example) => ({ 'application/json': { schema, ...(example ? { example } : {}) } })
const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const msg = (description) => ({ description, content: json(ref('Message')) })

// Respuestas de error comunes
const e400 = msg('Datos inválidos (el mensaje explica qué falta)')
const e401 = msg('Sin sesión, sesión vencida o cuenta desactivada')
const e403 = msg('Sin permiso para este módulo o acción')
const e404 = msg('No encontrado')

export default {
  openapi: '3.0.3',
  info: {
    title: 'Órdenes de producción · API',
    version: '1.0.0',
    description: [
      'API del sistema de órdenes de producción (Láminas & Dobleces).',
      '',
      '**Cómo autenticarse en esta página**',
      '1. Ejecuta `POST /api/auth/login` con tu correo (o usuario) y contraseña.',
      '2. Copia el `token` de la respuesta.',
      '3. Pulsa **Authorize** (arriba a la derecha) y pégalo. Desde ahí todas las rutas usan tu sesión.',
      '',
      '**Primer arranque:** si la base de datos no tiene usuarios, crea el primer administrador con `POST /api/auth/setup`.',
      '',
      '**Roles y alcance**',
      '- `admin`: todo, en todas las sedes.',
      '- `supervisor`: ve, revisa y comenta las órdenes de **su sede**.',
      '- `operario`: registra órdenes y ve solo las suyas.',
      '',
      `**Módulos asignables:** ${MODULES.map(m => `\`${m}\``).join(', ')}. El admin los tiene todos.`,
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'Este servidor' }],
  tags: [
    { name: 'Sistema', description: 'Estado del servicio' },
    { name: 'Autenticación', description: 'Ingreso, primer admin y cuenta propia' },
    { name: 'Usuarios', description: 'Requiere el módulo `usuarios`. Quien no es admin solo gestiona operarios de su sede.' },
    { name: 'Sedes', description: 'Lectura para todos; crear/editar/eliminar requiere el módulo `sedes`.' },
    { name: 'Órdenes', description: 'Registro, consulta y revisión de órdenes de producción.' },
    { name: 'Observaciones', description: 'Retroalimentación del admin/supervisor al operario.' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de `POST /api/auth/login`' },
    },
    schemas: {
      Message: { type: 'object', properties: { message: { type: 'string' } }, example: { message: 'Descripción del resultado o del error' } },
      Role: { type: 'string', enum: ['admin', 'supervisor', 'operario'] },
      Module: { type: 'string', enum: MODULES },
      SessionUser: {
        type: 'object',
        properties: {
          id: { type: 'string' }, username: { type: 'string' }, email: { type: 'string', nullable: true },
          name: { type: 'string' }, role: ref('Role'), sede: { type: 'string', nullable: true },
          permissions: { type: 'array', items: ref('Module') },
          mustChangePassword: { type: 'boolean', description: 'true = debe cambiar la contraseña temporal' },
        },
      },
      Session: {
        type: 'object',
        properties: { token: { type: 'string', description: 'JWT para el header Authorization: Bearer …' }, user: ref('SessionUser') },
      },
      User: {
        allOf: [ref('SessionUser'), {
          type: 'object',
          properties: {
            active: { type: 'boolean' },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time', nullable: true },
          },
        }],
      },
      Sede: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'SEDE-001', description: 'Se genera solo' },
          name: { type: 'string', example: 'Central mezclas' },
          city: { type: 'string', example: 'Bogotá' },
          manager: { type: 'string', example: 'Juan Pérez' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string' }, code: { type: 'string', example: '23643268' },
          product: { type: 'string', description: 'Cliente', example: 'Ferretería El Tornillo' },
          sede: { type: 'string', example: 'SEDE-001' }, operator: { type: 'string' }, operatorId: { type: 'string', nullable: true },
          photos: { type: 'array', items: { type: 'string', example: '/uploads/orders/1730000000-123.jpg' } },
          photoUrl: { type: 'string', nullable: true },
          status: { type: 'string' }, priority: { type: 'string' }, line: { type: 'string' }, batch: { type: 'string' },
          quantity: { type: 'number' }, completed: { type: 'number' },
          scheduledAt: { type: 'string', format: 'date-time' }, scannedAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time' }, scanCount: { type: 'integer' },
          pendingReview: { type: 'boolean', description: 'true = el admin/supervisor aún no la revisa' },
        },
      },
      Feedback: {
        type: 'object',
        properties: {
          id: { type: 'string' }, orderCode: { type: 'string' }, sede: { type: 'string' },
          authorName: { type: 'string' }, recipientName: { type: 'string' }, comment: { type: 'string' },
          evidences: { type: 'array', items: { type: 'string' } },
          seenAt: { type: 'string', format: 'date-time', nullable: true },
          resolvedAt: { type: 'string', format: 'date-time', nullable: true, description: 'Cuándo el operario la marcó como corregida' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    /* ── Sistema ── */
    '/api/health': {
      get: { tags: ['Sistema'], summary: 'Estado del servicio', responses: { 200: { description: 'Funcionando', content: json({ type: 'object' }, { status: 'ok' }) } } },
    },

    /* ── Autenticación ── */
    '/api/auth/setup': {
      post: {
        tags: ['Autenticación'],
        summary: 'Crear el primer administrador',
        description: 'Solo funciona cuando **no existe ningún usuario**. Después queda bloqueada.',
        requestBody: {
          required: true,
          content: json({
            type: 'object', required: ['name', 'email', 'password'],
            properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } },
          }, { name: 'Daniel Fabra', email: 'admin@empresa.com', password: 'UnaClaveSegura123' }),
        },
        responses: {
          200: { description: 'Administrador creado', content: json({ type: 'object' }, { message: 'Admin creado correctamente', email: 'admin@empresa.com' }) },
          400: msg('Ya existe al menos un usuario, o faltan datos'),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión',
        description: 'Acepta correo o usuario (cuentas antiguas) en el campo `username` (o `email`).',
        requestBody: {
          required: true,
          content: json({
            type: 'object', required: ['username', 'password'],
            properties: { username: { type: 'string', description: 'Correo o usuario' }, password: { type: 'string' } },
          }, { username: 'admin@empresa.com', password: 'UnaClaveSegura123' }),
        },
        responses: { 200: { description: 'Sesión iniciada', content: json(ref('Session')) }, 400: e400, 401: msg('Credenciales incorrectas o cuenta desactivada') },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Autenticación'], security: bearer,
        summary: 'Cambiar mi contraseña',
        description: 'Si la contraseña es temporal (`mustChangePassword`), no se pide la actual. Devuelve un token nuevo.',
        requestBody: {
          required: true,
          content: json({
            type: 'object', required: ['newPassword'],
            properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } },
          }, { currentPassword: 'ClaveAnterior123', newPassword: 'ClaveNueva456' }),
        },
        responses: { 200: { description: 'Contraseña actualizada', content: json(ref('Session')) }, 400: e400, 401: e401 },
      },
    },
    '/api/auth/profile': {
      patch: {
        tags: ['Autenticación'], security: bearer,
        summary: 'Actualizar mi correo y/o contraseña',
        requestBody: {
          content: json({
            type: 'object',
            properties: { email: { type: 'string', format: 'email' }, currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } },
          }),
        },
        responses: { 200: { description: 'Perfil actualizado', content: json({ type: 'object', properties: { message: { type: 'string' }, user: ref('SessionUser') } }) }, 400: e400, 401: e401 },
      },
    },
    '/api/auth/modules': {
      get: { tags: ['Autenticación'], security: bearer, summary: 'Módulos asignables (solo admin)', responses: { 200: { description: 'Lista de claves', content: json({ type: 'array', items: ref('Module') }) }, 401: e401, 403: e403 } },
    },

    /* ── Usuarios ── */
    '/api/users': {
      get: { tags: ['Usuarios'], security: bearer, summary: 'Listar usuarios', responses: { 200: { description: 'Usuarios', content: json({ type: 'array', items: ref('User') }) }, 401: e401, 403: e403 } },
      post: {
        tags: ['Usuarios'], security: bearer,
        summary: 'Crear usuario',
        description: 'Sin `password` se genera una temporal y se devuelve **una sola vez** en `tempPassword`. En ambos casos el usuario debe cambiarla al ingresar. Operarios y supervisores requieren `sede`.',
        requestBody: {
          required: true,
          content: json({
            type: 'object', required: ['name', 'email', 'role'],
            properties: {
              name: { type: 'string' }, email: { type: 'string', format: 'email' }, role: ref('Role'),
              sede: { type: 'string', description: 'Código de sede (operario/supervisor)' },
              permissions: { type: 'array', items: ref('Module') },
              password: { type: 'string', minLength: 8, description: 'Opcional' },
            },
          }, { name: 'Carlos Rojas', email: 'carlos.rojas@empresa.com', role: 'operario', sede: 'SEDE-001', permissions: ['inicio', 'scanner', 'ordenes', 'observaciones', 'historial'] }),
        },
        responses: {
          201: { description: 'Usuario creado', content: json({ allOf: [ref('User'), { type: 'object', properties: { tempPassword: { type: 'string', description: 'Solo si no se envió password' } } }] }) },
          400: e400, 401: e401, 403: e403,
        },
      },
    },
    '/api/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: {
        tags: ['Usuarios'], security: bearer,
        summary: 'Editar usuario',
        description: 'Nombre, correo, rol, sede, módulos y estado (`active`). Nadie puede desactivarse a sí mismo.',
        requestBody: {
          content: json({
            type: 'object',
            properties: {
              name: { type: 'string' }, email: { type: 'string', format: 'email' }, role: ref('Role'), sede: { type: 'string' },
              permissions: { type: 'array', items: ref('Module') }, active: { type: 'boolean' },
            },
          }, { active: false }),
        },
        responses: { 200: { description: 'Usuario actualizado', content: json(ref('User')) }, 400: e400, 401: e401, 403: e403, 404: e404 },
      },
      delete: { tags: ['Usuarios'], security: bearer, summary: 'Eliminar usuario', responses: { 200: msg('Usuario eliminado'), 400: e400, 401: e401, 403: e403, 404: e404 } },
    },
    '/api/users/{id}/reset-password': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Usuarios'], security: bearer,
        summary: 'Restablecer contraseña',
        description: 'Genera una contraseña temporal nueva (en `tempPassword`); la anterior deja de funcionar.',
        responses: { 200: { description: 'Contraseña restablecida', content: json({ allOf: [ref('User'), { type: 'object', properties: { tempPassword: { type: 'string' } } }] }) }, 401: e401, 403: e403, 404: e404 },
      },
    },

    /* ── Sedes ── */
    '/api/sedes': {
      get: { tags: ['Sedes'], security: bearer, summary: 'Listar sedes', responses: { 200: { description: 'Sedes', content: json({ type: 'array', items: ref('Sede') }) }, 401: e401 } },
      post: {
        tags: ['Sedes'], security: bearer, summary: 'Crear sede',
        requestBody: { required: true, content: json({ type: 'object', required: ['name', 'city', 'manager'], properties: { name: { type: 'string' }, city: { type: 'string' }, manager: { type: 'string' } } }, { name: 'Central mezclas', city: 'Bogotá', manager: 'Juan Pérez' }) },
        responses: { 201: { description: 'Sede creada', content: json(ref('Sede')) }, 400: e400, 401: e401, 403: e403 },
      },
    },
    '/api/sedes/{code}': {
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string', example: 'SEDE-001' } }],
      patch: {
        tags: ['Sedes'], security: bearer, summary: 'Editar sede',
        requestBody: { content: json({ type: 'object', properties: { name: { type: 'string' }, city: { type: 'string' }, manager: { type: 'string' } } }) },
        responses: { 200: { description: 'Sede actualizada', content: json(ref('Sede')) }, 401: e401, 403: e403, 404: e404 },
      },
      delete: { tags: ['Sedes'], security: bearer, summary: 'Eliminar sede', responses: { 200: msg('Sede eliminada'), 401: e401, 403: e403, 404: e404 } },
    },

    /* ── Órdenes ── */
    '/api/orders': {
      get: {
        tags: ['Órdenes'], security: bearer,
        summary: 'Listar órdenes',
        description: 'Quien no es admin solo recibe las de su sede.',
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['today', 'history'] }, description: 'today = hoy (módulo ordenes) · history = días anteriores (módulo historial)' },
          { name: 'sede', in: 'query', schema: { type: 'string' }, description: 'Solo admin; `all` para todas' },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'priority', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Busca en código, cliente, lote, operador y línea' },
        ],
        responses: { 200: { description: 'Órdenes', content: json({ type: 'array', items: ref('Order') }) }, 401: e401, 403: e403 },
      },
      post: {
        tags: ['Órdenes'], security: bearer,
        summary: 'Registrar orden (scanner)',
        description: 'Módulo `scanner`. Si el código ya existe responde **409** con `code: DUPLICATE`; reenvía con `confirmDuplicate=true` para registrarla de nuevo. Quien no es admin registra en su propia sede.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object', required: ['code', 'product'],
                properties: {
                  code: { type: 'string', description: 'Código de la orden' },
                  product: { type: 'string', description: 'Cliente' },
                  sede: { type: 'string', description: 'Requerido solo para admin' },
                  operator: { type: 'string' },
                  confirmDuplicate: { type: 'boolean' },
                  photos: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Páginas escaneadas (hasta 10, 8 MB c/u)' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Orden registrada', content: json(ref('Order')) },
          200: { description: 'Orden existente registrada de nuevo (con confirmDuplicate)', content: json(ref('Order')) },
          400: e400, 401: e401, 403: e403,
          409: { description: 'Orden duplicada', content: json({ type: 'object', properties: { code: { type: 'string', example: 'DUPLICATE' }, message: { type: 'string' }, sameUser: { type: 'boolean' }, order: ref('Order') } }) },
        },
      },
    },
    '/api/orders/pending-review': {
      get: {
        tags: ['Órdenes'], security: bearer,
        summary: 'Órdenes pendientes de revisión',
        description: 'Admin (todas) o supervisor (su sede). Devuelve el total y las 30 más recientes.',
        responses: { 200: { description: 'Pendientes', content: json({ type: 'object', properties: { total: { type: 'integer' }, orders: { type: 'array', items: ref('Order') } } }) }, 401: e401, 403: e403 },
      },
      patch: {
        tags: ['Órdenes'], security: bearer, summary: 'Marcar todas como revisadas',
        responses: { 200: { description: 'Cantidad actualizada', content: json({ type: 'object' }, { updated: 3 }) }, 401: e401, 403: e403 },
      },
    },
    '/api/orders/{code}': {
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Órdenes'], security: bearer, summary: 'Detalle de una orden', responses: { 200: { description: 'Orden', content: json(ref('Order')) }, 401: e401, 403: e403, 404: e404 } },
      patch: {
        tags: ['Órdenes'], security: bearer, summary: 'Editar orden (solo admin)',
        requestBody: { content: json({ type: 'object', properties: { product: { type: 'string' }, sede: { type: 'string' }, operator: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' }, line: { type: 'string' }, batch: { type: 'string' }, quantity: { type: 'number' }, completed: { type: 'number' } } }) },
        responses: { 200: { description: 'Orden actualizada', content: json(ref('Order')) }, 401: e401, 403: e403, 404: e404 },
      },
      delete: { tags: ['Órdenes'], security: bearer, summary: 'Eliminar orden (solo admin)', responses: { 200: msg('Orden eliminada'), 401: e401, 403: e403, 404: e404 } },
    },
    '/api/orders/{code}/review': {
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { tags: ['Órdenes'], security: bearer, summary: 'Marcar una orden como revisada', description: 'Admin o supervisor (su sede).', responses: { 200: { description: 'Orden', content: json(ref('Order')) }, 401: e401, 403: e403, 404: e404 } },
    },
    '/api/orders/{code}/scan': {
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { tags: ['Órdenes'], security: bearer, summary: 'Registrar un escaneo', description: 'Módulo `scanner`. Suma 1 a `scanCount`.', responses: { 200: { description: 'Orden', content: json(ref('Order')) }, 401: e401, 403: e403, 404: e404 } },
    },

    /* ── Observaciones ── */
    '/api/orders/{code}/feedback': {
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Observaciones'], security: bearer, summary: 'Observaciones de una orden', responses: { 200: { description: 'Observaciones', content: json({ type: 'array', items: ref('Feedback') }) }, 401: e401, 403: e403, 404: e404 } },
      post: {
        tags: ['Observaciones'], security: bearer,
        summary: 'Enviar observación al operario',
        description: 'Admin o supervisor (su sede). Marca la orden como revisada.',
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', required: ['comment'], properties: { comment: { type: 'string' }, evidences: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Hasta 5 imágenes' } } } } },
        },
        responses: { 201: { description: 'Observación enviada', content: json({ allOf: [ref('Feedback'), { type: 'object', properties: { delivered: { type: 'boolean', description: 'false si no se encontró al operario destinatario' } } }] }) }, 400: e400, 401: e401, 403: e403, 404: e404 },
      },
    },
    '/api/feedback/mine': {
      get: {
        tags: ['Observaciones'], security: bearer,
        summary: 'Mis observaciones recibidas',
        description: 'Módulo `observaciones`. Incluye datos de la orden (`orderInfo`).',
        responses: { 200: { description: 'Observaciones', content: json({ type: 'object', properties: { unseen: { type: 'integer' }, items: { type: 'array', items: ref('Feedback') } } }) }, 401: e401, 403: e403 },
      },
    },
    '/api/feedback/{id}/seen': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { tags: ['Observaciones'], security: bearer, summary: 'Marcar como vista', responses: { 200: { description: 'Observación', content: json(ref('Feedback')) }, 401: e401, 403: e403, 404: e404 } },
    },
    '/api/feedback/{id}/resolve': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      patch: {
        tags: ['Observaciones'], security: bearer,
        summary: 'Marcar como corregida (o reabrir)',
        requestBody: { content: json({ type: 'object', properties: { resolved: { type: 'boolean', default: true } } }, { resolved: true }) },
        responses: { 200: { description: 'Observación', content: json(ref('Feedback')) }, 401: e401, 403: e403, 404: e404 },
      },
    },
  },
}

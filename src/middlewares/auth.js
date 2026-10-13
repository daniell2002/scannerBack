import jwt from 'jsonwebtoken'
import { forbidden } from '../helpers/response.js'
import User from '../models/User.js'

// Módulos asignables por usuario. Mismas claves que el frontend
// (scannerFrond/src/utils/modules.js) y la app móvil.
// El admin tiene acceso a todo sin necesidad de permisos.
export const MODULES = [
  'inicio', 'scanner', 'ordenes', 'observaciones', 'historial', 'estadisticas',
  'sedes', 'usuarios',
]

// Módulos que los operarios tenían incluidos antes de que fueran asignables
export const LEGACY_IMPLICIT_MODULES = ['inicio', 'observaciones']

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ message: 'No autorizado' })

  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ message: 'Token inválido o expirado' })
  }

  // Una cuenta desactivada o eliminada pierde el acceso de inmediato, aunque su token siga vigente
  const stillActive = await User.exists({ _id: req.user.id, active: { $ne: false } })
  if (!stillActive)
    return res.status(401).json({ message: 'Tu cuenta está desactivada. Contacta a un administrador.' })

  next()
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ message: 'Acceso solo para administradores' })
  next()
}

// El admin siempre pasa. El operario necesita tener el módulo en su array de permisos.
export function requireModule(module) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next()
    if (req.user?.permissions?.includes(module)) return next()
    return forbidden(res, `Sin acceso al módulo "${module}"`)
  }
}

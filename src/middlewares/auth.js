import jwt from 'jsonwebtoken'
import { forbidden } from '../helpers/response.js'

export const MODULES = ['ordenes', 'historial', 'scanner', 'reportes']

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ message: 'No autorizado' })

  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado' })
  }
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

import { Router } from 'express'
import mongoose from 'mongoose'
import AuditLog from '../models/AuditLog.js'
import User from '../models/User.js'
import { requireAuth, requireAdmin } from '../middlewares/auth.js'
import { ok, badRequest } from '../helpers/response.js'

const router = Router()

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// GET /api/audit — historial de actividad (solo admin), del más reciente al más antiguo.
// Filtros: entity, action, actorId, sede, q (texto), from / to, page, limit.
// from / to: instantes ISO calculados por el navegador con su zona horaria
// (to es exclusivo). Un AAAA-MM-DD suelto se interpreta en la hora del servidor.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { entity, action, actorId, sede, q, from, to } = req.query
  const page  = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const filter = {}

  if (entity && entity !== 'all') filter.entity = entity
  if (action && action !== 'all') filter.action = action
  if (sede   && sede   !== 'all') filter.sede   = sede
  if (actorId && actorId !== 'all') {
    if (!mongoose.isValidObjectId(actorId)) return badRequest(res, 'Usuario no válido')
    filter.actorId = actorId
  }
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  const fromDate = from && (isDay(from) ? new Date(`${from}T00:00:00`) : new Date(from))
  const toDate   = to && (isDay(to) ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000) : new Date(to))
  if ((fromDate && isNaN(fromDate)) || (toDate && isNaN(toDate))) return badRequest(res, 'Fecha no válida')
  if (fromDate || toDate) {
    filter.createdAt = {}
    if (fromDate) filter.createdAt.$gte = fromDate
    if (toDate)   filter.createdAt.$lt  = toDate
  }
  if (q?.trim()) {
    const rx = { $regex: escapeRegex(q.trim()), $options: 'i' }
    filter.$or = [{ label: rx }, { actorName: rx }, { entityId: rx }]
  }

  const [total, items, users, logActors] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    // Filtro "Usuario": todos los que pueden ingresar (los vendedores no hacen acciones)…
    User.find({ role: { $ne: 'vendedor' } }, 'name role sede active').sort('name').lean(),
    // …más los que ya no existen pero dejaron registros
    AuditLog.aggregate([
      { $match: { actorId: { $ne: null } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: '$actorId', name: { $last: '$actorName' }, role: { $last: '$actorRole' } } },
    ]),
  ])

  const known  = new Set(users.map(u => String(u._id)))
  const actors = [
    ...users.map(u => ({ id: u._id, name: u.name, role: u.role, sede: u.sede, active: u.active !== false })),
    ...logActors.filter(a => !known.has(String(a._id)))
      .map(a => ({ id: a._id, name: a.name, role: a.role, deleted: true })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'es'))

  ok(res, {
    total, page, limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    items: items.map(i => i.toAPI()),
    actors,
  })
})

export default router

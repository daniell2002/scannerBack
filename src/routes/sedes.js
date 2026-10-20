import { Router } from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { requireAuth, requireModule } from '../middlewares/auth.js'
import { ok, created, notFound, badRequest } from '../helpers/response.js'
import Sede from '../models/Sede.js'
import { audit, diff } from '../helpers/audit.js'

const router = Router()

// GET /api/sedes
router.get('/', requireAuth, async (_req, res) => {
  const sedes = await Sede.find().sort('name')
  ok(res, sedes)
})

// GET /api/sedes/coordinators — supervisores activos que pueden ser coordinadores
router.get('/coordinators', requireAuth, requireModule('sedes'), async (_req, res) => {
  const users = await User.find({ role: 'supervisor', active: { $ne: false } }, 'name email sede').sort('name')
  ok(res, users.map(u => ({ id: u._id, name: u.name, email: u.email, sede: u.sede })))
})

/*
 * Resuelve el coordinador del cuerpo de la petición:
 * - managerId: un supervisor activo (web). '' o null = sin coordinador.
 * - manager:   solo el nombre como texto (app móvil, clientes antiguos).
 * Devuelve { managerId, manager } o { error }.
 */
async function resolveManager(body) {
  if (body.managerId !== undefined) {
    if (!body.managerId) return { managerId: null, manager: '' }
    if (!mongoose.isValidObjectId(body.managerId)) return { error: 'Coordinador no válido' }
    const u = await User.findOne({ _id: body.managerId, role: 'supervisor', active: { $ne: false } }, 'name')
    if (!u) return { error: 'El coordinador debe ser un supervisor activo' }
    return { managerId: u._id, manager: u.name }
  }
  if (body.manager !== undefined) return { managerId: null, manager: String(body.manager).trim() }
  return {}
}

// Si se pidió, el coordinador pasa a pertenecer a esta sede
async function moveManagerToSede(body, sede, actor) {
  if (!sede.managerId || body.assignManagerToSede !== true) return
  const u = await User.findById(sede.managerId)
  if (!u || u.sede === sede.code) return
  const from = u.sede
  u.sede = sede.code
  await u.save()
  audit(actor, 'editar', 'usuario', { id: u._id, label: u.name, sede: sede.code, changes: { sede: { from, to: sede.code } } })
}

// genera el siguiente código secuencial SEDE-001, SEDE-002, ...
async function nextSedeCode() {
  const sedes = await Sede.find({ code: /^SEDE-\d+$/ }, 'code')
  const max = sedes.reduce((acc, s) => {
    const n = Number(s.code.split('-')[1])
    return n > acc ? n : acc
  }, 0)
  return `SEDE-${String(max + 1).padStart(3, '0')}`
}

// POST /api/sedes
router.post('/', requireAuth, requireModule('sedes'), async (req, res) => {
  const { name, city } = req.body
  if (!name?.trim() || !city?.trim())
    return badRequest(res, 'Nombre y ciudad son requeridos')
  const mgr = await resolveManager(req.body)
  if (mgr.error) return badRequest(res, mgr.error)
  const sede = await Sede.create({
    code: await nextSedeCode(),
    name: name.trim(),
    city: city.trim(),
    manager:   mgr.manager || '',
    managerId: mgr.managerId || null,
  })
  await moveManagerToSede(req.body, sede, req.user)
  audit(req.user, 'crear', 'sede', { id: sede.code, label: sede.name, sede: sede.code })
  created(res, sede)
})

// PATCH /api/sedes/:code
router.patch('/:code', requireAuth, requireModule('sedes'), async (req, res) => {
  const sede = await Sede.findOne({ code: req.params.code.toUpperCase() })
  if (!sede) return notFound(res, 'Sede no encontrada')
  const { name, city } = req.body
  const before = sede.toObject()
  const mgr = await resolveManager(req.body)
  if (mgr.error) return badRequest(res, mgr.error)
  if (name) sede.name = name.trim()
  if (city) sede.city = city.trim()
  if (mgr.manager !== undefined) { sede.manager = mgr.manager; sede.managerId = mgr.managerId }
  await sede.save()
  await moveManagerToSede(req.body, sede, req.user)
  audit(req.user, 'editar', 'sede', { id: sede.code, label: sede.name, sede: sede.code, changes: diff(before, sede, ['name', 'city', 'manager']) })
  ok(res, sede)
})

// DELETE /api/sedes/:code
router.delete('/:code', requireAuth, requireModule('sedes'), async (req, res) => {
  const sede = await Sede.findOneAndDelete({ code: req.params.code.toUpperCase() })
  if (!sede) return notFound(res, 'Sede no encontrada')
  audit(req.user, 'eliminar', 'sede', { id: sede.code, label: sede.name, sede: sede.code })
  ok(res, { message: 'Sede eliminada' })
})

export default router

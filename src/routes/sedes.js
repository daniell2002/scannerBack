import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middlewares/auth.js'
import { ok, created, notFound, badRequest } from '../helpers/response.js'
import Sede from '../models/Sede.js'

const router = Router()

// GET /api/sedes
router.get('/', requireAuth, async (_req, res) => {
  const sedes = await Sede.find().sort('name')
  ok(res, sedes)
})

// POST /api/sedes
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { code, name, city, manager, activeLines } = req.body
  if (!code?.trim() || !name?.trim() || !city?.trim() || !manager?.trim())
    return badRequest(res, 'Faltan campos requeridos')
  const exists = await Sede.findOne({ code: code.trim().toUpperCase() })
  if (exists) return badRequest(res, 'Ya existe una sede con ese código')
  const sede = await Sede.create({
    code: code.trim().toUpperCase(),
    name: name.trim(),
    city: city.trim(),
    manager: manager.trim(),
    activeLines: Number(activeLines) || 0,
  })
  created(res, sede)
})

// PATCH /api/sedes/:code
router.patch('/:code', requireAuth, requireAdmin, async (req, res) => {
  const sede = await Sede.findOne({ code: req.params.code.toUpperCase() })
  if (!sede) return notFound(res, 'Sede no encontrada')
  const { name, city, manager, activeLines } = req.body
  if (name)        sede.name        = name.trim()
  if (city)        sede.city        = city.trim()
  if (manager)     sede.manager     = manager.trim()
  if (activeLines !== undefined) sede.activeLines = Number(activeLines)
  await sede.save()
  ok(res, sede)
})

// DELETE /api/sedes/:code
router.delete('/:code', requireAuth, requireAdmin, async (req, res) => {
  const sede = await Sede.findOneAndDelete({ code: req.params.code.toUpperCase() })
  if (!sede) return notFound(res, 'Sede no encontrada')
  ok(res, { message: 'Sede eliminada' })
})

export default router

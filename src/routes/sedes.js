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
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, city, manager } = req.body
  if (!name?.trim() || !city?.trim() || !manager?.trim())
    return badRequest(res, 'Faltan campos requeridos')
  const sede = await Sede.create({
    code: await nextSedeCode(),
    name: name.trim(),
    city: city.trim(),
    manager: manager.trim(),
  })
  created(res, sede)
})

// PATCH /api/sedes/:code
router.patch('/:code', requireAuth, requireAdmin, async (req, res) => {
  const sede = await Sede.findOne({ code: req.params.code.toUpperCase() })
  if (!sede) return notFound(res, 'Sede no encontrada')
  const { name, city, manager } = req.body
  if (name)    sede.name    = name.trim()
  if (city)    sede.city    = city.trim()
  if (manager) sede.manager = manager.trim()
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

import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.js'
import { ok, created, notFound, forbidden, badRequest } from '../helpers/response.js'
import { startOfToday, startOfTomorrow } from '../helpers/date.js'
import Order from '../models/Order.js'

const router = Router()

// GET /api/orders
router.get('/', requireAuth, async (req, res) => {
  const { period, sede, status, priority, q } = req.query
  const filter = {}

  if (req.user.role === 'operario' && req.user.sede) {
    filter.sede = req.user.sede
  } else if (sede && sede !== 'all') {
    filter.sede = sede
  }

  if (period === 'today')   filter.scheduledAt = { $gte: startOfToday(), $lt: startOfTomorrow() }
  if (period === 'history') filter.scheduledAt = { $lt: startOfToday() }

  if (status   && status   !== 'all') filter.status   = status
  if (priority && priority !== 'all') filter.priority = priority

  if (q) filter.$or = [
    { code:     { $regex: q, $options: 'i' } },
    { product:  { $regex: q, $options: 'i' } },
    { batch:    { $regex: q, $options: 'i' } },
    { operator: { $regex: q, $options: 'i' } },
    { line:     { $regex: q, $options: 'i' } },
  ]

  const orders = await Order.find(filter).sort({ scheduledAt: -1 })
  ok(res, orders.map(o => o.toAPI()))
})

// GET /api/orders/:code
router.get('/:code', requireAuth, async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  if (req.user.role === 'operario' && order.sede !== req.user.sede)
    return forbidden(res, 'Sin acceso a esta orden')

  ok(res, order.toAPI())
})

// POST /api/orders — registrar desde scanner
router.post('/', requireAuth, async (req, res) => {
  const { code, product, sede, operator } = req.body
  if (!code?.trim()) return badRequest(res, 'Código requerido')

  if (req.user.role === 'operario' && !req.user.sede)
    return badRequest(res, 'El operario no tiene sede asignada. Contacta a un administrador.')

  const normCode = code.trim().toUpperCase()
  const sedeCode = req.user.role === 'operario' ? req.user.sede : (sede || 'BOG')
  const opName   = operator?.trim() || req.user.name || 'Sin asignar'

  const existing = await Order.findOne({ code: normCode })
  if (existing) {
    if (req.user.role === 'operario' && req.user.sede) {
      existing.sede = req.user.sede
    }
    existing.operator = opName
    existing.scheduledAt = new Date()
    existing.scannedAt = new Date()
    existing.scanCount += 1
    existing.updatedAt = new Date()
    await existing.save()
    return ok(res, existing.toAPI())
  }

  const order = await Order.create({
    code:        normCode,
    product:     product?.trim() || 'Sin nombre',
    batch:       `BT-${Date.now().toString().slice(-6)}`,
    sede:        sedeCode,
    operator:    opName,
    scheduledAt: new Date(),
    updatedAt:   new Date(),
    scannedAt:   new Date(),
    scanCount:   1,
  })

  created(res, order.toAPI())
})

// PATCH /api/orders/:code/scan — marcar como escaneada
router.patch('/:code/scan', requireAuth, async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  if (req.user.role === 'operario' && order.sede !== req.user.sede)
    return forbidden(res, 'Sin acceso a esta orden')

  order.scannedAt = new Date()
  order.scanCount += 1
  order.updatedAt = new Date()
  await order.save()

  ok(res, order.toAPI())
})

export default router

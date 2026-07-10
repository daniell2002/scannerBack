import { Router } from 'express'
import { requireAuth, requireAdmin, requireModule } from '../middlewares/auth.js'
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

  if (period === 'today') {
    if (req.user.role !== 'admin' && !req.user.permissions?.includes('ordenes'))
      return forbidden(res, 'Sin acceso al módulo "ordenes"')
    filter.scheduledAt = { $gte: startOfToday(), $lt: startOfTomorrow() }
  }

  if (period === 'history') {
    if (req.user.role !== 'admin' && !req.user.permissions?.includes('historial'))
      return forbidden(res, 'Sin acceso al módulo "historial"')
    filter.scheduledAt = { $lt: startOfToday() }
  }

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

// POST /api/orders — crear orden manualmente (admin) o registrar desde scanner
router.post('/', requireAuth, requireModule('scanner'), async (req, res) => {
  const { code, product, sede, operator, line, batch, quantity, priority } = req.body

  if (!code?.trim())    return badRequest(res, 'El código es requerido')
  if (!product?.trim()) return badRequest(res, 'El producto es requerido')

  if (req.user.role === 'operario' && !req.user.sede)
    return badRequest(res, 'El operario no tiene sede asignada. Contacta a un administrador.')

  if (req.user.role !== 'operario' && !sede)
    return badRequest(res, 'La sede es requerida')

  const normCode  = code.trim().toUpperCase()
  const sedeCode  = req.user.role === 'operario' ? req.user.sede : sede
  const opName    = operator?.trim() || req.user.name

  const existing = await Order.findOne({ code: normCode })
  if (existing) {
    if (req.user.role === 'operario') existing.sede = req.user.sede
    existing.operator    = opName
    existing.scheduledAt = new Date()
    existing.scannedAt   = new Date()
    existing.scanCount  += 1
    existing.updatedAt   = new Date()
    await existing.save()
    return ok(res, existing.toAPI())
  }

  const order = await Order.create({
    code:        normCode,
    product:     product.trim(),
    line:        line?.trim() || '',
    batch:       batch?.trim() || `BT-${Date.now().toString().slice(-6)}`,
    sede:        sedeCode,
    operator:    opName,
    quantity:    Number(quantity) || 0,
    priority:    priority || 'Media',
    scheduledAt: new Date(),
    updatedAt:   new Date(),
    scannedAt:   new Date(),
    scanCount:   1,
  })

  created(res, order.toAPI())
})

// PATCH /api/orders/:code — actualizar campos de la orden (solo admin)
router.patch('/:code', requireAuth, requireAdmin, async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  const { product, line, batch, status, priority, sede, quantity, completed, operator } = req.body
  const updates = {}

  if (product   !== undefined) updates.product   = product.trim()
  if (line      !== undefined) updates.line      = line.trim()
  if (batch     !== undefined) updates.batch     = batch.trim()
  if (status    !== undefined) updates.status    = status
  if (priority  !== undefined) updates.priority  = priority
  if (sede      !== undefined) updates.sede      = sede
  if (quantity  !== undefined) updates.quantity  = Number(quantity)
  if (completed !== undefined) updates.completed = Number(completed)
  if (operator  !== undefined) updates.operator  = operator.trim()

  updates.updatedAt = new Date()

  Object.assign(order, updates)
  await order.save()

  ok(res, order.toAPI())
})

// PATCH /api/orders/:code/scan — registrar escaneo
router.patch('/:code/scan', requireAuth, requireModule('scanner'), async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  if (req.user.role === 'operario' && order.sede !== req.user.sede)
    return forbidden(res, 'Sin acceso a esta orden')

  order.scannedAt  = new Date()
  order.scanCount += 1
  order.updatedAt  = new Date()
  await order.save()

  ok(res, order.toAPI())
})

// DELETE /api/orders/:code — eliminar orden (solo admin)
router.delete('/:code', requireAuth, requireAdmin, async (req, res) => {
  const order = await Order.findOneAndDelete({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')
  ok(res, { message: 'Orden eliminada' })
})

export default router

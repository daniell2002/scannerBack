import mongoose from 'mongoose'
import { Router } from 'express'
import { requireAuth, requireAdmin, requireModule, requireReviewer } from '../middlewares/auth.js'
import { uploadPhoto, uploadEvidence, discardUpload, MAX_ORDER_PHOTOS } from '../middlewares/upload.js'
import { ok, created, notFound, forbidden, badRequest } from '../helpers/response.js'
import { startOfToday, startOfTomorrow } from '../helpers/date.js'
import Order from '../models/Order.js'
import Feedback from '../models/Feedback.js'
import User from '../models/User.js'
import { audit, diff } from '../helpers/audit.js'
import { emit, toAdmins, toUser } from '../helpers/events.js'

const router = Router()

const EDITABLE = ['product', 'line', 'batch', 'status', 'priority', 'sede', 'quantity', 'completed', 'operator', 'attendedBy']

// Aviso en tiempo real a los administradores cuando llega una orden por revisar
const notifyAdmins = (order, rescan, { edited = false, by = '' } = {}) => {
  if (order.pendingReview) emit('order', { code: order.code, operator: by || order.operator, sede: order.sede, rescan, edited }, toAdmins)
}

/** 409 de código repetido con los datos de la orden existente. */
function duplicateResponse(res, existing, user) {
  const sameUser = existing.operatorId
    ? String(existing.operatorId) === String(user.id)
    : existing.operator === user.name
  return res.status(409).json({
    code:     'DUPLICATE',
    message:  sameUser
      ? `Ya registraste la orden ${existing.code} anteriormente. No se puede registrar de nuevo.`
      : `La orden ${existing.code} ya fue registrada por ${existing.operator}. No se puede registrar de nuevo.`,
    sameUser,
    order:    existing.toAPI(),
  })
}

// El supervisor solo actúa sobre las órdenes de su sede; el admin sobre todas
const sedeScope = (req) => req.user.role === 'admin' ? {} : { sede: req.user.sede }

/** Vendedor activo de la sede indicada, o null si no corresponde. */
const findVendor = (id, sede) =>
  mongoose.isValidObjectId(id)
    ? User.findOne({ _id: id, role: 'vendedor', sede, active: { $ne: false } }, 'name')
    : null

// GET /api/orders
router.get('/', requireAuth, async (req, res) => {
  const { period, sede, status, priority, q, attendedBy } = req.query
  const filter = {}

  if (req.user.role !== 'admin' && req.user.sede) {
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
  // Filtro por vendedor (id) que atendió la orden
  if (attendedBy && attendedBy !== 'all') {
    if (!mongoose.isValidObjectId(attendedBy)) return badRequest(res, 'Vendedor no válido')
    filter.attendedById = attendedBy
  }

  if (q) filter.$or = [
    { code:     { $regex: q, $options: 'i' } },
    { product:  { $regex: q, $options: 'i' } },
    { batch:    { $regex: q, $options: 'i' } },
    { operator: { $regex: q, $options: 'i' } },
    { attendedBy: { $regex: q, $options: 'i' } },
    { line:     { $regex: q, $options: 'i' } },
  ]

  const orders = await Order.find(filter).sort({ scheduledAt: -1 })
  ok(res, orders.map(o => o.toAPI()))
})

// GET /api/orders/pending-review — órdenes que llegaron y el admin no ha revisado
router.get('/pending-review', requireAuth, requireReviewer, async (req, res) => {
  const filter = { pendingReview: true, ...sedeScope(req) }
  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter).sort({ scannedAt: -1 }).limit(30),
  ])
  ok(res, { total, orders: orders.map(o => o.toAPI()) })
})

// PATCH /api/orders/pending-review — marcar todas como revisadas
router.patch('/pending-review', requireAuth, requireReviewer, async (req, res) => {
  const { modifiedCount } = await Order.updateMany({ pendingReview: true, ...sedeScope(req) }, { pendingReview: false })
  ok(res, { updated: modifiedCount })
})

// PATCH /api/orders/:code/review — marcar una orden como revisada
router.patch('/:code/review', requireAuth, requireReviewer, async (req, res) => {
  const order = await Order.findOneAndUpdate(
    { code: req.params.code.toUpperCase(), ...sedeScope(req) },
    { pendingReview: false },
    { new: true },
  )
  if (!order) return notFound(res, 'Orden no encontrada')
  ok(res, order.toAPI())
})

// GET /api/orders/:code
router.get('/:code', requireAuth, async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  if (req.user.role !== 'admin' && order.sede !== req.user.sede)
    return forbidden(res, 'Sin acceso a esta orden')

  ok(res, order.toAPI())
})

// POST /api/orders — crear orden manualmente (admin) o registrar desde scanner
// Fotos: 'photos' (varias, web y app actuales) o 'photo' (una, clientes antiguos)
const orderPhotos = uploadPhoto.fields([
  { name: 'photos', maxCount: MAX_ORDER_PHOTOS },
  { name: 'photo',  maxCount: 1 },
])

router.post('/', requireAuth, requireModule('scanner'), orderPhotos, async (req, res) => {
  const { code, product, sede, operator, line, batch, quantity, priority, attendedById } = req.body
  const files  = [...(req.files?.photos || []), ...(req.files?.photo || [])]
  const reject = (msg) => { files.forEach(discardUpload); return badRequest(res, msg) }

  if (!code?.trim())    return reject('El código es requerido')
  if (!product?.trim()) return reject('El cliente es requerido')
  if (!files.length)    return reject('Adjunta al menos una foto de la orden')

  if (req.user.role !== 'admin' && !req.user.sede)
    return reject('Tu usuario no tiene sede asignada. Contacta a un administrador.')

  if (req.user.role === 'admin' && !sede)
    return reject('La sede es requerida')

  const normCode = code.trim().toUpperCase()
  const sedeCode = req.user.role !== 'admin' ? req.user.sede : sede

  // "Atendido por": un vendedor activo de la sede donde se registra la orden
  if (!attendedById) return reject('Selecciona el vendedor que atendió la orden')
  const [vendor, existing] = await Promise.all([
    findVendor(attendedById, sedeCode),
    Order.findOne({ code: normCode }),
  ])
  if (!vendor) return reject('El vendedor seleccionado no existe, está inactivo o no pertenece a la sede')
  const opName   = operator?.trim() || req.user.name || 'Sin asignar'
  const photos   = files.map(f => `/uploads/orders/${f.filename}`)
  const photoUrl = photos[0]

  // Un código ya registrado no se vuelve a registrar: se responde quién y cuándo
  // lo registró. (Para corregirla, el admin la edita o la elimina.)
  if (existing) {
    files.forEach(discardUpload)
    return duplicateResponse(res, existing, req.user)
  }

  let order
  try {
    order = await Order.create({
      code:        normCode,
      product:     product.trim(),
      line:        line?.trim() || '',
      batch:       batch?.trim() || `BT-${Date.now().toString().slice(-6)}`,
      sede:        sedeCode,
      operator:    opName,
      operatorId:  req.user.id,
      attendedBy:   vendor.name,
      attendedById: vendor._id,
      quantity:    Number(quantity) || 0,
      priority:    priority || 'Media',
      photoUrl:    photoUrl || null,
      photos,
      scheduledAt: new Date(),
      updatedAt:   new Date(),
      scannedAt:   new Date(),
      scanCount:   1,
      pendingReview: req.user.role !== 'admin',
    })
  } catch (err) {
    // Dos registros del mismo código al mismo tiempo: el índice único frena al segundo
    if (err?.code !== 11000) throw err
    files.forEach(discardUpload)
    const winner = await Order.findOne({ code: normCode })
    if (!winner) throw err
    return duplicateResponse(res, winner, req.user)
  }
  audit(req.user, 'crear', 'orden', { id: order.code, label: order.code, sede: order.sede })
  notifyAdmins(order, false)

  created(res, order.toAPI())
})

// PATCH /api/orders/:code/correct — corregir una orden ya registrada.
// Permiso "editar_ordenes" (el supervisor, solo en su sede; el admin, en todas).
// multipart: code, product, attendedById, reason (obligatorio),
//            keepPhotos (JSON: fotos actuales que se conservan, en orden) y photos (nuevas).
// Queda en el historial de la orden (edits) y en el de actividad. Si corrige un
// supervisor, la orden vuelve a quedar pendiente de revisión y se avisa al admin.
router.patch('/:code/correct', requireAuth, requireModule('editar_ordenes'), orderPhotos, async (req, res) => {
  const files  = [...(req.files?.photos || []), ...(req.files?.photo || [])]
  const reject = (msg, fn = badRequest) => { files.forEach(discardUpload); return fn(res, msg) }

  const order = await Order.findOne({ code: req.params.code.toUpperCase(), ...sedeScope(req) })
  if (!order) return reject('Orden no encontrada', notFound)

  const reason = req.body.reason?.trim()
  if (!reason) return reject('Indica el motivo de la corrección')

  const updates = {}

  if (req.body.code !== undefined) {
    const newCode = req.body.code.trim().toUpperCase()
    if (!newCode) return reject('El código es requerido')
    if (newCode !== order.code) {
      const taken = await Order.findOne({ code: newCode })
      if (taken) { files.forEach(discardUpload); return duplicateResponse(res, taken, req.user) }
      updates.code = newCode
    }
  }

  if (req.body.product !== undefined) {
    if (!req.body.product.trim()) return reject('El cliente es requerido')
    updates.product = req.body.product.trim()
  }

  if (req.body.attendedById !== undefined && String(req.body.attendedById) !== String(order.attendedById)) {
    const vendor = await findVendor(req.body.attendedById, order.sede)
    if (!vendor) return reject('El vendedor seleccionado no existe, está inactivo o no pertenece a la sede')
    updates.attendedBy   = vendor.name
    updates.attendedById = vendor._id
  }

  // Fotos: las que se conservan (solo de esta orden) + las nuevas
  const current = order.photos?.length ? order.photos : (order.photoUrl ? [order.photoUrl] : [])
  let keep = current
  if (req.body.keepPhotos !== undefined) {
    try { keep = JSON.parse(req.body.keepPhotos) } catch { return reject('Lista de fotos no válida') }
    if (!Array.isArray(keep)) return reject('Lista de fotos no válida')
    keep = keep.filter(p => current.includes(p))
  }
  const photos = [...keep, ...files.map(f => `/uploads/orders/${f.filename}`)]
  if (!photos.length) return reject('La orden debe tener al menos una foto')
  if (photos.length > MAX_ORDER_PHOTOS) return reject(`Máximo ${MAX_ORDER_PHOTOS} fotos por orden`)
  if (JSON.stringify(photos) !== JSON.stringify(current)) {
    updates.photos   = photos
    updates.photoUrl = photos[0]
  }

  const before = order.toObject()
  before.photos = current
  const changes = diff(before, { ...before, ...updates }, ['code', 'product', 'attendedBy', 'photos'])
  if (!Object.keys(changes).length) return reject('No hay cambios para guardar')

  Object.assign(order, updates)
  order.updatedAt = new Date()
  order.edits.push({ byId: req.user.id, byName: req.user.name, byRole: req.user.role, reason, changes })
  // Lo que corrige un supervisor vuelve a revisión del admin
  if (req.user.role !== 'admin') order.pendingReview = true

  try {
    await order.save()
  } catch (err) {
    // Otro registro tomó el código nuevo al mismo tiempo
    if (err?.code !== 11000) throw err
    files.forEach(discardUpload)
    const winner = await Order.findOne({ code: updates.code })
    return winner ? duplicateResponse(res, winner, req.user) : badRequest(res, 'El código ya existe')
  }

  // Las observaciones guardan el código como texto: se mantienen al día
  if (updates.code) await Feedback.updateMany({ order: order._id }, { $set: { orderCode: order.code } })

  audit(req.user, 'corregir', 'orden', {
    id: order.code,
    label: updates.code ? `${before.code} → ${order.code}` : order.code,
    sede: order.sede,
    changes: { ...changes, reason: { from: null, to: reason } },
  })
  notifyAdmins(order, false, { edited: true, by: req.user.name })

  ok(res, order.toAPI())
})

// PATCH /api/orders/:code — actualizar campos de la orden (solo admin)
router.patch('/:code', requireAuth, requireAdmin, async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  const { product, line, batch, status, priority, sede, quantity, completed, operator, attendedById } = req.body
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
  if (attendedById !== undefined) {
    const vendor = await findVendor(attendedById, updates.sede ?? order.sede)
    if (!vendor) return badRequest(res, 'El vendedor seleccionado no existe, está inactivo o no pertenece a la sede')
    updates.attendedBy   = vendor.name
    updates.attendedById = vendor._id
  }

  updates.updatedAt = new Date()

  const before = order.toObject()
  Object.assign(order, updates)
  await order.save()
  audit(req.user, 'editar', 'orden', { id: order.code, label: order.code, sede: order.sede, changes: diff(before, order, EDITABLE) })

  ok(res, order.toAPI())
})

// PATCH /api/orders/:code/scan — registrar escaneo
router.patch('/:code/scan', requireAuth, requireModule('scanner'), async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  if (req.user.role !== 'admin' && order.sede !== req.user.sede)
    return forbidden(res, 'Sin acceso a esta orden')

  order.scannedAt  = new Date()
  order.scanCount += 1
  order.updatedAt  = new Date()
  await order.save()

  ok(res, order.toAPI())
})

// GET /api/orders/:code/feedback — retroalimentación de una orden
router.get('/:code/feedback', requireAuth, async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase() })
  if (!order) return notFound(res, 'Orden no encontrada')

  if (req.user.role !== 'admin' && order.sede !== req.user.sede)
    return forbidden(res, 'Sin acceso a esta orden')

  const items = await Feedback.find({ order: order._id }).sort({ createdAt: -1 })
  ok(res, items.map(f => f.toAPI()))
})

// POST /api/orders/:code/feedback — el admin deja comentario + evidencias a quien registró la orden
router.post('/:code/feedback', requireAuth, requireReviewer, uploadEvidence.array('evidences', 5), async (req, res) => {
  const order = await Order.findOne({ code: req.params.code.toUpperCase(), ...sedeScope(req) })
  if (!order) {
    req.files?.forEach(discardUpload)
    return notFound(res, 'Orden no encontrada')
  }

  const comment = req.body.comment?.trim()
  if (!comment) {
    req.files?.forEach(discardUpload)
    return badRequest(res, 'El comentario es requerido')
  }

  // Órdenes antiguas no tienen operatorId: se busca al supervisor por nombre.
  let recipientId = order.operatorId
  if (!recipientId) {
    const u = await User.findOne({ name: order.operator, role: 'supervisor' })
    recipientId = u?._id || null
  }

  const feedback = await Feedback.create({
    order:         order._id,
    orderCode:     order.code,
    sede:          order.sede,
    authorId:      req.user.id,
    authorName:    req.user.name,
    recipientId,
    recipientName: order.operator,
    comment,
    evidences:     (req.files || []).map(f => `/uploads/feedback/${f.filename}`),
  })
  audit(req.user, 'crear', 'observacion', { id: order.code, label: `${order.code} → ${order.operator}`, sede: order.sede })
  if (recipientId) emit('feedback', { orderCode: order.code, author: req.user.name }, toUser(recipientId))

  // Dejar retroalimentación implica que la orden ya fue revisada.
  if (order.pendingReview) {
    order.pendingReview = false
    await order.save()
  }

  created(res, { ...feedback.toAPI(), delivered: Boolean(recipientId) })
})

// DELETE /api/orders/:code — eliminar orden (solo admin)
// DELETE /api/orders/:code — eliminar una orden. Permiso "eliminar_ordenes"
// (el supervisor, solo en su sede; el admin, en todas). Body: { reason } obligatorio.
// Trazabilidad: en el historial de actividad queda una copia de los datos de la
// orden y el motivo. Las fotos no se borran del disco.
router.delete('/:code', requireAuth, requireModule('eliminar_ordenes'), async (req, res) => {
  const reason = req.body?.reason?.trim()
  if (!reason) return badRequest(res, 'Indica el motivo de la eliminación')

  const order = await Order.findOneAndDelete({ code: req.params.code.toUpperCase(), ...sedeScope(req) })
  if (!order) return notFound(res, 'Orden no encontrada')

  const photos = order.photos?.length ? order.photos : (order.photoUrl ? [order.photoUrl] : [])
  const removed = (v) => ({ from: v ?? null, to: null })
  audit(req.user, 'eliminar', 'orden', {
    id: order.code,
    label: `${order.code} · ${order.product}`,
    sede: order.sede,
    changes: {
      code:       removed(order.code),
      product:    removed(order.product),
      attendedBy: removed(order.attendedBy || null),
      operator:   removed(order.operator),
      photos:     removed(photos),
      reason:     { from: null, to: reason },
    },
  })
  ok(res, { message: 'Orden eliminada' })
})

export default router

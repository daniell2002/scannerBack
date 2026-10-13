import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.js'
import { ok, notFound } from '../helpers/response.js'
import Feedback from '../models/Feedback.js'
import Sede from '../models/Sede.js'

const router = Router()

// GET /api/feedback/mine — retroalimentación recibida por el usuario actual
router.get('/mine', requireAuth, async (req, res) => {
  const filter = { recipientId: req.user.id }
  const [unseen, items, sedes] = await Promise.all([
    Feedback.countDocuments({ ...filter, seenAt: null }),
    Feedback.find(filter).sort({ createdAt: -1 }).limit(30)
      .populate('order', 'product sede scannedAt scheduledAt'),
    Sede.find({}, 'code name'),
  ])
  const sedeName = Object.fromEntries(sedes.map(s => [s.code, s.name]))

  // Datos de la orden revisada, para que el operario sepa exactamente de cuál se trata
  ok(res, {
    unseen,
    items: items.map(f => ({
      ...f.toAPI(),
      orderInfo: f.order ? {
        client:       f.order.product,
        sedeName:     sedeName[f.order.sede] || f.order.sede,
        registeredAt: f.order.scannedAt || f.order.scheduledAt,
      } : null,
    })),
  })
})

// PATCH /api/feedback/:id/seen — el destinatario marca la retroalimentación como vista
router.patch('/:id/seen', requireAuth, async (req, res) => {
  const fb = await Feedback.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user.id },
    { $set: { seenAt: new Date() } },
    { new: true },
  ).catch(() => null)
  if (!fb) return notFound(res, 'Retroalimentación no encontrada')
  ok(res, fb.toAPI())
})

export default router

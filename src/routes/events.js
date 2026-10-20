import { Router } from 'express'
import User from '../models/User.js'
import { requireAuth } from '../middlewares/auth.js'
import { ok, unauth } from '../helpers/response.js'
import { createTicket, redeemTicket, addClient } from '../helpers/events.js'

const router = Router()

// POST /api/events/ticket — ticket de un solo uso para abrir la conexión
router.post('/ticket', requireAuth, (req, res) => {
  ok(res, { ticket: createTicket(req.user) })
})

// GET /api/events?ticket=… — conexión SSE que queda abierta
router.get('/', async (req, res) => {
  const user = redeemTicket(String(req.query.ticket || ''))
  if (!user) return unauth(res, 'Ticket inválido o vencido')

  // La cuenta pudo desactivarse entre el ticket y la conexión
  if (!await User.exists({ _id: user.id, active: { $ne: false } }))
    return unauth(res, 'Tu cuenta está desactivada. Contacta a un administrador.')

  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: entregar cada evento de inmediato
  })
  res.flushHeaders()
  // Si se corta, el navegador reintenta a los 5 s (pidiendo un ticket nuevo)
  res.write('retry: 5000\n\n')
  res.write('event: ready\ndata: {}\n\n')

  const remove = addClient(res, user)
  req.on('close', remove)
})

export default router

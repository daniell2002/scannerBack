import crypto from 'crypto'

/*
 * Notificaciones en tiempo real con Server-Sent Events (SSE).
 * Cada pestaña abierta mantiene una conexión en GET /api/events; el servidor
 * le envía avisos (orden nueva, observación nueva) sin que tenga que recargar.
 *
 * EventSource no permite enviar el header Authorization, así que la pestaña
 * pide primero un "ticket" de un solo uso con su token y conecta con él.
 */

const clients = new Set()   // { res, user: { id, role, sede } }
const tickets = new Map()   // ticket → { user, expires }

const TICKET_TTL_MS = 30_000

export function createTicket(user) {
  const ticket = crypto.randomBytes(24).toString('hex')
  tickets.set(ticket, { user: { id: String(user.id), role: user.role, sede: user.sede }, expires: Date.now() + TICKET_TTL_MS })
  return ticket
}

/** Consume el ticket: solo sirve una vez y por pocos segundos. */
export function redeemTicket(ticket) {
  const entry = tickets.get(ticket)
  tickets.delete(ticket)
  return entry && entry.expires > Date.now() ? entry.user : null
}

// Limpia tickets que nunca se usaron
setInterval(() => {
  const now = Date.now()
  for (const [t, e] of tickets) if (e.expires <= now) tickets.delete(t)
}, 60_000).unref()

export function addClient(res, user) {
  const client = { res, user }
  clients.add(client)
  return () => clients.delete(client)
}

/**
 * Envía un evento a las conexiones que cumplan `match(user)`.
 * Ej.: emit('order', data, u => u.role === 'admin')
 */
export function emit(type, data, match = () => true) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const c of clients) {
    if (!match(c.user)) continue
    try { c.res.write(payload) } catch { clients.delete(c) }
  }
}

// Comentario cada 25 s: evita que nginx o un proxy cierren la conexión inactiva
setInterval(() => {
  for (const c of clients) {
    try { c.res.write(': ping\n\n') } catch { clients.delete(c) }
  }
}, 25_000).unref()

export const toAdmins = (u) => u.role === 'admin'
export const toUser   = (id) => (u) => u.id === String(id)

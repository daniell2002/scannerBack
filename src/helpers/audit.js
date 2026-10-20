import AuditLog from '../models/AuditLog.js'

/**
 * Registra una acción en el historial de actividad. Nunca hace fallar la
 * petición: si no se puede guardar, solo se avisa en el log del servidor.
 *
 * @param actor  req.user, o un documento User (p. ej. en el login)
 */
export async function audit(actor, action, entity, { id = '', label = '', sede, changes = null } = {}) {
  try {
    await AuditLog.create({
      actorId:   actor?.id || actor?._id || null,
      actorName: actor?.name || 'Sistema',
      actorRole: actor?.role || '',
      sede:      sede !== undefined ? sede : actor?.sede ?? null,
      action,
      entity,
      entityId:  String(id || ''),
      label,
      changes:   changes && Object.keys(changes).length ? changes : null,
    })
  } catch (err) {
    console.error('No se pudo registrar la actividad:', err.message)
  }
}

/**
 * Compara los campos indicados entre el estado anterior y el nuevo y devuelve
 * solo los que cambiaron: { campo: { from, to } }.
 */
export function diff(before, after, fields) {
  const out = {}
  for (const f of fields) {
    const from = before?.[f] ?? null
    const to   = after?.[f] ?? null
    if (JSON.stringify(from) !== JSON.stringify(to)) out[f] = { from, to }
  }
  return out
}

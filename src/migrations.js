import User from './models/User.js'
import { LEGACY_IMPLICIT_MODULES } from './middlewares/auth.js'

/**
 * Inicio y Observaciones antes venían incluidos para todo operario; ahora son
 * permisos que el admin asigna. A los operarios existentes se les agregan una
 * sola vez para que no pierdan acceso. Es idempotente.
 */
export async function migratePermissions() {
  const legacy = { role: 'operario', permissionsVersion: { $ne: 2 } }
  const { modifiedCount } = await User.updateMany(legacy, {
    $addToSet: { permissions: { $each: LEGACY_IMPLICIT_MODULES } },
    $set: { permissionsVersion: 2 },
  })
  // Admins y demás usuarios antiguos: solo marcar la versión
  await User.updateMany({ permissionsVersion: { $ne: 2 } }, { $set: { permissionsVersion: 2 } })
  if (modifiedCount) console.log(`  Permisos migrados: ${modifiedCount} operario(s) con Inicio y Observaciones`)
}

/**
 * El rol "operario" se unificó con "supervisor": quien registraba órdenes ahora
 * es supervisor de su sede. Conserva sus módulos y su sede. Es idempotente.
 */
export async function migrateOperariosToSupervisor() {
  const { modifiedCount } = await User.updateMany({ role: 'operario' }, { $set: { role: 'supervisor' } })
  if (modifiedCount) console.log(`  Roles migrados: ${modifiedCount} operario(s) ahora son supervisores`)
}

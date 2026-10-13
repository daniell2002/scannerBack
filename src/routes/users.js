import { Router } from 'express'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import { MODULES, requireAuth, requireModule } from '../middlewares/auth.js'
import { ok, created, notFound, badRequest, forbidden } from '../helpers/response.js'
import {
  normalizeEmail, isValidEmail, emailTaken, usernameFromEmail,
  generateTempPassword, passwordError, publicUser,
} from '../helpers/users.js'

const router = Router()

// Solo se aceptan claves de módulo reales; descarta cualquier valor
// desconocido o mal escrito que llegue del cliente.
const sanitizePermissions = (permissions) =>
  Array.isArray(permissions)
    ? permissions.filter((p) => MODULES.includes(p))
    : []

const isSelf = (req) => String(req.user.id) === String(req.params.id)
const isAdminReq = (req) => req.user.role === 'admin'

/*
 * Delegación: quien tiene el módulo "usuarios" sin ser administrador solo
 * gestiona operarios de su propia sede y no puede otorgar módulos que él no
 * tiene. Así nadie puede darse (ni dar) más acceso del que ya tiene.
 */
function delegationError(req, { role, sede, permissions } = {}, target = null) {
  if (isAdminReq(req)) return null
  // Solo el admin crea o gestiona administradores y supervisores
  if ((role && role !== 'operario') || (target && target.role !== 'operario'))
    return 'Solo un administrador puede gestionar administradores y supervisores'
  if (target && target.sede !== req.user.sede)
    return 'Solo puedes gestionar operarios de tu sede'
  if (sede && sede !== req.user.sede)
    return 'Solo puedes asignar usuarios a tu propia sede'
  if (Array.isArray(permissions)) {
    const had = target?.permissions || []
    const added = permissions.filter(p => !had.includes(p))
    const notOwned = added.filter(p => !(req.user.permissions || []).includes(p))
    if (notOwned.length) return `No puedes otorgar módulos que no tienes: ${notOwned.join(', ')}`
  }
  return null
}

// GET /api/users
router.get('/', requireAuth, requireModule('usuarios'), async (_req, res) => {
  const users = await User.find().sort('name')
  ok(res, users.map(publicUser))
})

// POST /api/users — crea el usuario con su correo.
// Sin contraseña → se genera una temporal y se devuelve UNA sola vez (tempPassword).
// En ambos casos el usuario debe cambiarla en su primer ingreso.
router.post('/', requireAuth, requireModule('usuarios'), async (req, res) => {
  const { name, role, sede, permissions } = req.body
  const email    = normalizeEmail(req.body.email)
  const password = req.body.password?.trim()

  if (!name?.trim() || !role) return badRequest(res, 'Nombre y rol son requeridos')
  // Compatibilidad: clientes antiguos (app móvil) crean usuarios solo con "username"
  if (!email && !req.body.username?.trim()) return badRequest(res, 'El correo es requerido')
  if (email && !isValidEmail(email)) return badRequest(res, 'Ingresa un correo válido')
  if (email && await emailTaken(email)) return badRequest(res, 'Ya existe un usuario con ese correo')
  if (role !== 'admin' && !sede) return badRequest(res, 'El operario o supervisor debe tener una sede asignada')

  const delegErr = delegationError(req, { role, sede, permissions: sanitizePermissions(permissions) })
  if (delegErr) return forbidden(res, delegErr)

  if (password) {
    const pwdErr = passwordError(password)
    if (pwdErr) return badRequest(res, pwdErr)
  }

  const username = req.body.username?.trim().toLowerCase() || await usernameFromEmail(email)
  if (await User.exists({ username })) return badRequest(res, 'El nombre de usuario ya existe')

  const tempPassword = password || generateTempPassword()

  const user = await User.create({
    username,
    email:              email || null,
    passwordHash:       bcrypt.hashSync(tempPassword, 10),
    name:               name.trim(),
    role,
    sede:               role !== 'admin' ? (sede || null) : null,
    permissions:        sanitizePermissions(permissions),
    mustChangePassword: true,
  })

  created(res, { ...publicUser(user), tempPassword: password ? undefined : tempPassword })
})

// PATCH /api/users/:id — nombre, correo, rol, sede, permisos y estado
router.patch('/:id', requireAuth, requireModule('usuarios'), async (req, res) => {
  const { name, role, sede, password, permissions, active } = req.body

  if (role && role !== 'admin' && !sede)
    return badRequest(res, 'El operario o supervisor debe tener una sede asignada')
  if (isSelf(req) && (active === false || (isAdminReq(req) && role && role !== 'admin')))
    return badRequest(res, 'No puedes desactivar ni quitarte el rol de administrador a ti mismo')

  const target = await User.findById(req.params.id).catch(() => null)
  if (!target) return notFound(res, 'Usuario no encontrado')
  const delegErr = delegationError(req, { role, sede, permissions: Array.isArray(permissions) ? sanitizePermissions(permissions) : undefined }, target)
  if (delegErr) return forbidden(res, delegErr)

  const updates = {}
  if (name?.trim()) updates.name = name.trim()
  if (role)         updates.role = role
  if (role === 'admin') {
    updates.sede = null
  } else if (sede !== undefined) {
    updates.sede = sede || null
  }
  if (req.body.email !== undefined) {
    const email = normalizeEmail(req.body.email)
    if (!isValidEmail(email)) return badRequest(res, 'Ingresa un correo válido')
    if (await emailTaken(email, req.params.id)) return badRequest(res, 'Ya existe un usuario con ese correo')
    updates.email = email
  }
  // Compatibilidad con la app móvil, que aún envía la contraseña al editar
  if (password?.trim()) {
    const pwdErr = passwordError(password.trim())
    if (pwdErr) return badRequest(res, pwdErr)
    updates.passwordHash = bcrypt.hashSync(password.trim(), 10)
    updates.mustChangePassword = true
  }
  if (Array.isArray(permissions)) updates.permissions = sanitizePermissions(permissions)
  if (typeof active === 'boolean') updates.active = active

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  )
  if (!user) return notFound(res, 'Usuario no encontrado')

  ok(res, publicUser(user))
})

// POST /api/users/:id/reset-password — genera una contraseña temporal nueva
router.post('/:id/reset-password', requireAuth, requireModule('usuarios'), async (req, res) => {
  const target = await User.findById(req.params.id).catch(() => null)
  if (!target) return notFound(res, 'Usuario no encontrado')
  const delegErr = delegationError(req, {}, target)
  if (delegErr) return forbidden(res, delegErr)

  const tempPassword = generateTempPassword()
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { passwordHash: bcrypt.hashSync(tempPassword, 10), mustChangePassword: true } },
    { new: true }
  )
  if (!user) return notFound(res, 'Usuario no encontrado')

  ok(res, { ...publicUser(user), tempPassword })
})

// DELETE /api/users/:id
router.delete('/:id', requireAuth, requireModule('usuarios'), async (req, res) => {
  if (isSelf(req)) return badRequest(res, 'No puedes eliminar tu propia cuenta')
  const target = await User.findById(req.params.id).catch(() => null)
  if (!target) return notFound(res, 'Usuario no encontrado')
  const delegErr = delegationError(req, {}, target)
  if (delegErr) return forbidden(res, delegErr)

  await target.deleteOne()
  ok(res, { message: 'Usuario eliminado' })
})

export default router

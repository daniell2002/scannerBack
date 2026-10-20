import { Router } from 'express'
import bcrypt from 'bcryptjs'
import User, { ROLES } from '../models/User.js'
import Order from '../models/Order.js'
import Sede from '../models/Sede.js'
import { MODULES, requireAuth, requireModule } from '../middlewares/auth.js'
import { ok, created, notFound, badRequest, forbidden } from '../helpers/response.js'
import {
  normalizeEmail, isValidEmail, emailTaken, usernameFromEmail, usernameFromName,
  generateTempPassword, passwordError, publicUser, publicVendor,
} from '../helpers/users.js'
import { audit, diff } from '../helpers/audit.js'

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
 * gestiona los vendedores de su propia sede. Los vendedores no tienen módulos,
 * así que nadie puede darse (ni dar) más acceso del que ya tiene.
 */
function delegationError(req, { role, sede } = {}, target = null) {
  if (isAdminReq(req)) return null
  // Solo el admin crea o gestiona administradores y supervisores
  if ((role && role !== 'vendedor') || (target && target.role !== 'vendedor'))
    return 'Solo un administrador puede gestionar administradores y supervisores'
  if (target && target.sede !== req.user.sede)
    return 'Solo puedes gestionar vendedores de tu sede'
  if (sede && sede !== req.user.sede)
    return 'Solo puedes asignar vendedores a tu propia sede'
  return null
}

// GET /api/users
router.get('/', requireAuth, requireModule('usuarios'), async (_req, res) => {
  const users = await User.find().sort('name')
  ok(res, users.map(publicUser))
})

// GET /api/users/vendedores — opciones de "Atendido por" (y del filtro de órdenes).
// El supervisor solo ve los de su sede; el admin puede filtrar con ?sede=.
// ?all=true incluye los desactivados (para filtrar órdenes antiguas).
router.get('/vendedores', requireAuth, async (req, res) => {
  const filter = { role: 'vendedor' }
  if (!isAdminReq(req))        filter.sede = req.user.sede
  else if (req.query.sede && req.query.sede !== 'all') filter.sede = req.query.sede
  if (req.query.all !== 'true') filter.active = { $ne: false }

  const vendors = await User.find(filter, 'name sede active').sort('name')
  ok(res, vendors.map(publicVendor))
})

// POST /api/users — crea el usuario con su correo.
// Sin contraseña → se genera una temporal, se devuelve UNA sola vez (tempPassword)
// y el usuario debe cambiarla en su primer ingreso. Si el admin la escribe, queda definitiva.
// Un vendedor solo lleva nombre y sede: no tiene correo, contraseña ni módulos.
router.post('/', requireAuth, requireModule('usuarios'), async (req, res) => {
  const { name, role, sede, permissions } = req.body
  const isVendor = role === 'vendedor'
  const email    = normalizeEmail(req.body.email)
  const password = req.body.password?.trim()

  if (!name?.trim() || !role) return badRequest(res, 'Nombre y rol son requeridos')
  if (!ROLES.includes(role))  return badRequest(res, 'Rol no válido')
  // Compatibilidad: clientes antiguos (app móvil) crean usuarios solo con "username"
  if (!isVendor && !email && !req.body.username?.trim()) return badRequest(res, 'El correo es requerido')
  if (email && !isValidEmail(email)) return badRequest(res, 'Ingresa un correo válido')
  if (email && await emailTaken(email)) return badRequest(res, 'Ya existe un usuario con ese correo')
  if (role !== 'admin' && !sede) return badRequest(res, 'El supervisor o vendedor debe tener una sede asignada')

  const delegErr = delegationError(req, { role, sede })
  if (delegErr) return forbidden(res, delegErr)

  if (password && !isVendor) {
    const pwdErr = passwordError(password)
    if (pwdErr) return badRequest(res, pwdErr)
  }

  const username = isVendor
    ? await usernameFromName(name)
    : req.body.username?.trim().toLowerCase() || await usernameFromEmail(email)
  if (await User.exists({ username })) return badRequest(res, 'El nombre de usuario ya existe')

  // El vendedor recibe una contraseña aleatoria que nadie conoce; además el
  // login rechaza su rol, así que nunca puede ingresar.
  const tempPassword = isVendor ? generateTempPassword(32) : password || generateTempPassword()

  const user = await User.create({
    username,
    email:              email || null,
    passwordHash:       bcrypt.hashSync(tempPassword, 10),
    name:               name.trim(),
    role,
    sede:               role !== 'admin' ? (sede || null) : null,
    permissions:        isVendor ? [] : sanitizePermissions(permissions),
    mustChangePassword: !isVendor && !password,
  })
  audit(req.user, 'crear', 'usuario', { id: user._id, label: `${user.name} (${user.role})`, sede: user.sede })

  created(res, { ...publicUser(user), tempPassword: password || isVendor ? undefined : tempPassword })
})

// PATCH /api/users/:id — nombre, correo, rol, sede, permisos y estado
router.patch('/:id', requireAuth, requireModule('usuarios'), async (req, res) => {
  const { name, role, sede, password, permissions, active } = req.body

  if (role && !ROLES.includes(role)) return badRequest(res, 'Rol no válido')
  if (role && role !== 'admin' && !sede)
    return badRequest(res, 'El supervisor o vendedor debe tener una sede asignada')
  if (isSelf(req) && (active === false || (isAdminReq(req) && role && role !== 'admin')))
    return badRequest(res, 'No puedes desactivar ni quitarte el rol de administrador a ti mismo')

  const target = await User.findById(req.params.id).catch(() => null)
  if (!target) return notFound(res, 'Usuario no encontrado')
  const delegErr = delegationError(req, { role, sede }, target)
  if (delegErr) return forbidden(res, delegErr)

  // Un vendedor no tiene cuenta de acceso: no se convierte en usuario del sistema ni al revés
  const isVendor = target.role === 'vendedor'
  if (role && (role === 'vendedor') !== isVendor)
    return badRequest(res, isVendor
      ? 'Un vendedor no tiene acceso al sistema. Crea un usuario nuevo para darle acceso.'
      : 'Un usuario del sistema no puede pasar a vendedor. Crea el vendedor por separado.')

  const updates = {}
  if (name?.trim()) updates.name = name.trim()
  if (role)         updates.role = role
  if (role === 'admin') {
    updates.sede = null
  } else if (sede !== undefined) {
    updates.sede = sede || null
  }
  if (isVendor && req.body.email !== undefined && !req.body.email?.trim()) {
    updates.email = null // el correo del vendedor es opcional
  } else if (req.body.email !== undefined) {
    const email = normalizeEmail(req.body.email)
    if (!isValidEmail(email)) return badRequest(res, 'Ingresa un correo válido')
    if (await emailTaken(email, req.params.id)) return badRequest(res, 'Ya existe un usuario con ese correo')
    updates.email = email
  }
  // Compatibilidad con la app móvil, que aún envía la contraseña al editar
  if (password?.trim() && !isVendor) {
    const pwdErr = passwordError(password.trim())
    if (pwdErr) return badRequest(res, pwdErr)
    updates.passwordHash = bcrypt.hashSync(password.trim(), 10)
    updates.mustChangePassword = false
  }
  if (Array.isArray(permissions) && !isVendor) updates.permissions = sanitizePermissions(permissions)
  if (typeof active === 'boolean') updates.active = active

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  )
  if (!user) return notFound(res, 'Usuario no encontrado')
  const changes = diff(target, user, ['name', 'email', 'role', 'sede', 'permissions', 'active'])
  if (updates.passwordHash) changes.password = { from: '•••', to: 'nueva' }
  audit(req.user, 'editar', 'usuario', { id: user._id, label: user.name, sede: user.sede, changes })

  // Las órdenes guardan el nombre del vendedor: se mantiene al día si cambia
  if (isVendor && updates.name && updates.name !== target.name)
    await Order.updateMany({ attendedById: user._id }, { $set: { attendedBy: user.name } })

  // Coordinador de sede: si deja de ser supervisor se quita; si cambia el nombre, se actualiza
  if (target.role === 'supervisor' && user.role !== 'supervisor')
    await Sede.updateMany({ managerId: user._id }, { $set: { managerId: null, manager: '' } })
  else if (updates.name && updates.name !== target.name)
    await Sede.updateMany({ managerId: user._id }, { $set: { manager: user.name } })

  ok(res, publicUser(user))
})

// POST /api/users/:id/reset-password — genera una contraseña temporal nueva
router.post('/:id/reset-password', requireAuth, requireModule('usuarios'), async (req, res) => {
  const target = await User.findById(req.params.id).catch(() => null)
  if (!target) return notFound(res, 'Usuario no encontrado')
  if (target.role === 'vendedor') return badRequest(res, 'Los vendedores no tienen contraseña: no ingresan al sistema')
  const delegErr = delegationError(req, {}, target)
  if (delegErr) return forbidden(res, delegErr)

  const tempPassword = generateTempPassword()
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { passwordHash: bcrypt.hashSync(tempPassword, 10), mustChangePassword: true } },
    { new: true }
  )
  if (!user) return notFound(res, 'Usuario no encontrado')
  audit(req.user, 'restablecer', 'usuario', { id: user._id, label: user.name, sede: user.sede })

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
  await Sede.updateMany({ managerId: target._id }, { $set: { managerId: null, manager: '' } })
  audit(req.user, 'eliminar', 'usuario', { id: target._id, label: `${target.name} (${target.role})`, sede: target.sede })
  ok(res, { message: 'Usuario eliminado' })
})

export default router

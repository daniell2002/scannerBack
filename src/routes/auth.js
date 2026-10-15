import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { ok, badRequest, unauth } from '../helpers/response.js'
import { MODULES, requireAuth, requireAdmin } from '../middlewares/auth.js'
import {
  normalizeEmail, isValidEmail, emailTaken, usernameFromEmail, passwordError,
} from '../helpers/users.js'

const router = Router()

// Datos que viajan en el token y que usa el frontend
const sessionUser = (user) => ({
  id:                 user._id,
  username:           user.username,
  email:              user.email || null,
  name:               user.name,
  role:               user.role,
  sede:               user.sede,
  permissions:        user.permissions || [],
  mustChangePassword: !!user.mustChangePassword,
})

const signSession = (user) => {
  const payload = sessionUser(user)
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  })
  return { token, user: payload }
}

// POST /api/auth/setup — crea el primer admin; solo funciona si no hay usuarios
router.post('/setup', async (req, res) => {
  const count = await User.countDocuments()
  if (count > 0) return badRequest(res, 'Ya existe al menos un usuario en el sistema')

  const { password, name } = req.body
  const email = normalizeEmail(req.body.email)
  if (!name?.trim() || !isValidEmail(email))
    return badRequest(res, 'Nombre y correo válido son requeridos')
  const pwdErr = passwordError(password?.trim())
  if (pwdErr) return badRequest(res, pwdErr)

  const user = await User.create({
    username:     req.body.username?.trim().toLowerCase() || await usernameFromEmail(email),
    email,
    passwordHash: bcrypt.hashSync(password.trim(), 10),
    name:         name.trim(),
    role:         'admin',
    sede:         null,
  })

  ok(res, { message: 'Admin creado correctamente', email: user.email })
})

// GET /api/auth/modules — lista de módulos disponibles (solo admin)
router.get('/modules', requireAuth, requireAdmin, (_req, res) => {
  ok(res, MODULES)
})

// POST /api/auth/login — acepta correo o usuario (campo "username" o "email")
router.post('/login', async (req, res) => {
  const identifier = (req.body.email || req.body.username || '').trim().toLowerCase()
  const { password } = req.body
  if (!identifier || !password)
    return badRequest(res, 'Correo y contraseña requeridos')

  const user = await User.findOne(
    identifier.includes('@') ? { email: identifier } : { username: identifier }
  )
  // Los vendedores no tienen acceso al sistema
  if (!user || user.role === 'vendedor' || !bcrypt.compareSync(password, user.passwordHash))
    return unauth(res, 'Correo o contraseña incorrectos')

  if (user.active === false)
    return unauth(res, 'Tu cuenta está desactivada. Contacta a un administrador.')

  user.lastLoginAt = new Date()
  await user.save()

  ok(res, signSession(user))
})

// POST /api/auth/change-password — cambio de contraseña del propio usuario.
// Si tiene una contraseña temporal pendiente de cambio, no se pide la actual.
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  const user = await User.findById(req.user.id)
  if (!user) return badRequest(res, 'Usuario no encontrado')

  if (!user.mustChangePassword) {
    if (!currentPassword)
      return badRequest(res, 'Debes ingresar tu contraseña actual')
    if (!bcrypt.compareSync(currentPassword, user.passwordHash))
      return badRequest(res, 'La contraseña actual es incorrecta')
  }

  const pwdErr = passwordError(newPassword)
  if (pwdErr) return badRequest(res, pwdErr)
  if (bcrypt.compareSync(newPassword, user.passwordHash))
    return badRequest(res, 'La nueva contraseña debe ser diferente a la actual')

  user.passwordHash       = bcrypt.hashSync(newPassword, 10)
  user.mustChangePassword = false
  await user.save()

  ok(res, { message: 'Contraseña actualizada', ...signSession(user) })
})

// PATCH /api/auth/profile — el usuario actualiza su propio correo y/o contraseña
router.patch('/profile', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  const user = await User.findById(req.user.id)
  if (!user) return badRequest(res, 'Usuario no encontrado')

  if (req.body.email !== undefined) {
    const email = normalizeEmail(req.body.email)
    if (!isValidEmail(email)) return badRequest(res, 'Ingresa un correo válido')
    if (await emailTaken(email, user._id)) return badRequest(res, 'Ese correo ya está en uso')
    user.email = email
  }

  if (newPassword?.trim()) {
    if (!currentPassword?.trim())
      return badRequest(res, 'Debes enviar la contraseña actual para cambiarla')
    if (!bcrypt.compareSync(currentPassword.trim(), user.passwordHash))
      return badRequest(res, 'La contraseña actual es incorrecta')
    const pwdErr = passwordError(newPassword.trim())
    if (pwdErr) return badRequest(res, pwdErr)
    user.passwordHash       = bcrypt.hashSync(newPassword.trim(), 10)
    user.mustChangePassword = false
  }

  await user.save()

  ok(res, { message: 'Perfil actualizado', user: sessionUser(user) })
})

export default router

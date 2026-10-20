import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import User from '../models/User.js'
import { ok, badRequest, unauth } from '../helpers/response.js'
import { MODULES, requireAuth, requireAdmin } from '../middlewares/auth.js'
import {
  normalizeEmail, isValidEmail, emailConflict, usernameFromEmail, passwordError, normalizeUsername,
} from '../helpers/users.js'
import { audit } from '../helpers/audit.js'
import { mailEnabled, sendMail, resetPasswordMail } from '../helpers/mailer.js'

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

// POST /api/auth/login — con el nombre de usuario o con el correo (campo "username" o "email").
// Un correo compartido por varios supervisores no identifica a nadie: se pide el usuario.
router.post('/login', async (req, res) => {
  const identifier = (req.body.email || req.body.username || '').trim().toLowerCase()
  const { password } = req.body
  if (!identifier || !password)
    return badRequest(res, 'Usuario y contraseña requeridos')

  let user
  if (identifier.includes('@')) {
    const matches = await User.find({ email: identifier, role: { $ne: 'vendedor' } }).limit(2)
    if (matches.length > 1)
      return unauth(res, 'Ese correo lo comparten varias cuentas. Ingresa con tu nombre de usuario.')
    user = matches[0]
  } else {
    user = await User.findOne({ username: identifier })
  }
  // Los vendedores no tienen acceso al sistema
  if (!user || user.role === 'vendedor' || !bcrypt.compareSync(password, user.passwordHash))
    return unauth(res, 'Usuario o contraseña incorrectos')

  if (user.active === false)
    return unauth(res, 'Tu cuenta está desactivada. Contacta a un administrador.')

  user.lastLoginAt = new Date()
  await user.save()
  audit(user, 'ingresar', 'sesion', { id: user._id, label: user.email || user.username })

  ok(res, signSession(user))
})

// POST /api/auth/refresh — renueva el token de una sesión vigente.
// El frontend lo llama mientras el usuario está activo, así no lo saca a mitad
// del trabajo; requireAuth ya rechaza tokens vencidos y cuentas desactivadas.
router.post('/refresh', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id)
  if (!user) return unauth(res, 'Usuario no encontrado')
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
  audit(req.user, 'cambiar contraseña', 'usuario', { id: user._id, label: user.name })

  ok(res, { message: 'Contraseña actualizada', ...signSession(user) })
})

/* ── Recuperar contraseña por correo ─────────────────────────────── */

const RESET_MINUTES = 60
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex')

// Dirección pública de la web para armar el enlace del correo
function appUrl(req) {
  const fromEnv = process.env.APP_URL
    || (process.env.FRONTEND_URL || '').split(',').map(o => o.trim()).find(o => o.startsWith('https://'))
    || (process.env.FRONTEND_URL || '').split(',')[0]?.trim()
  return (fromEnv || req.get('origin') || 'http://localhost:5173').replace(/\/$/, '')
}

// POST /api/auth/forgot-password — envía un enlace para crear una contraseña nueva.
// Acepta el nombre de usuario o el correo ("identifier", o "email" en clientes antiguos).
// Si el correo lo comparten varias cuentas, llega un solo correo con un enlace por cuenta.
// Responde siempre lo mismo, exista o no la cuenta, para no revelar cuáles hay.
router.post('/forgot-password', async (req, res) => {
  const identifier = normalizeUsername(req.body.identifier || req.body.email)
  const generic = { message: 'Si la cuenta existe y tiene un correo registrado, te enviamos un enlace para restablecer la contraseña. Si no tiene correo, pide a un administrador que la restablezca.' }
  if (!identifier) return badRequest(res, 'Ingresa tu usuario o tu correo')
  if (identifier.includes('@') && !isValidEmail(identifier)) return badRequest(res, 'Ingresa un correo válido')

  const base = { active: { $ne: false }, role: { $ne: 'vendedor' } }
  const users = identifier.includes('@')
    ? await User.find({ ...base, email: identifier }).sort('name')
    : await User.find({ ...base, username: identifier, email: { $ne: null } })
  // Evita llenar el buzón: un enlace por cuenta y por minuto como máximo
  const due = users.filter(u => !u.resetRequestedAt || Date.now() - u.resetRequestedAt.getTime() >= 60_000)
  if (!due.length) return ok(res, generic)

  const accounts = []
  for (const user of due) {
    const token = crypto.randomBytes(32).toString('hex')
    user.resetTokenHash   = hashToken(token)
    user.resetExpiresAt   = new Date(Date.now() + RESET_MINUTES * 60_000)
    user.resetRequestedAt = new Date()
    await user.save()
    accounts.push({ user, name: user.name, username: user.username, link: `${appUrl(req)}/restablecer?token=${token}` })
  }
  const to = due[0].email

  if (!mailEnabled()) {
    // Sin SMTP: en desarrollo los enlaces se muestran en la consola para poder probar
    if (process.env.NODE_ENV !== 'production')
      console.log(`\n🔑 Recuperación de contraseña (${to}):\n${accounts.map(a => `   ${a.username}: ${a.link}`).join('\n')}\n`)
    else console.error('Recuperación de contraseña solicitada pero el correo (SMTP) no está configurado.')
    return ok(res, generic)
  }

  try {
    await sendMail({ to, ...resetPasswordMail({ accounts, minutes: RESET_MINUTES }) })
  } catch (err) {
    console.error('No se pudo enviar el correo de recuperación:', err.message)
    return res.status(502).json({ message: 'No fue posible enviar el correo. Intenta más tarde o contacta a un administrador.' })
  }
  accounts.forEach(a => audit(a.user, 'recuperar', 'usuario', { id: a.user._id, label: a.user.name }))
  ok(res, generic)
})

// POST /api/auth/reset-password — crea la contraseña nueva con el enlace del correo
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body
  if (!token) return badRequest(res, 'El enlace no es válido')

  const user = await User.findOne({
    resetTokenHash: hashToken(String(token)),
    resetExpiresAt: { $gt: new Date() },
    active: { $ne: false },
  })
  if (!user) return badRequest(res, 'El enlace venció o ya fue usado. Solicita uno nuevo.')

  const pwdErr = passwordError(newPassword?.trim())
  if (pwdErr) return badRequest(res, pwdErr)

  user.passwordHash       = bcrypt.hashSync(newPassword.trim(), 10)
  user.mustChangePassword = false
  user.resetTokenHash     = null
  user.resetExpiresAt     = null
  await user.save()
  audit(user, 'restablecer', 'usuario', { id: user._id, label: `${user.name} (por correo)` })

  ok(res, { message: 'Tu contraseña quedó actualizada. Ya puedes ingresar.' })
})

// PATCH /api/auth/profile — el usuario actualiza su propio correo y/o contraseña
router.patch('/profile', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  const user = await User.findById(req.user.id)
  if (!user) return badRequest(res, 'Usuario no encontrado')

  if (req.body.email !== undefined) {
    const email = normalizeEmail(req.body.email)
    if (!email && user.role === 'admin')
      return badRequest(res, 'El administrador necesita un correo para poder recuperar su contraseña')
    if (email && !isValidEmail(email)) return badRequest(res, 'Ingresa un correo válido')
    const conflict = await emailConflict(email, user.role, user._id)
    if (conflict) return badRequest(res, conflict)
    user.email = email || null
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
  if (newPassword?.trim()) audit(req.user, 'cambiar contraseña', 'usuario', { id: user._id, label: user.name })

  ok(res, { message: 'Perfil actualizado', user: sessionUser(user) })
})

export default router

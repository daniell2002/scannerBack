import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { ok, badRequest, unauth } from '../helpers/response.js'
import { MODULES, requireAuth, requireAdmin } from '../middlewares/auth.js'

const router = Router()

// POST /api/auth/setup — crea el primer admin; solo funciona si no hay usuarios
router.post('/setup', async (req, res) => {
  const count = await User.countDocuments()
  if (count > 0) return badRequest(res, 'Ya existe al menos un usuario en el sistema')

  const { username, password, name, email } = req.body
  if (!username?.trim() || !password?.trim() || !name?.trim())
    return badRequest(res, 'username, password y name son requeridos')

  const user = await User.create({
    username:     username.trim().toLowerCase(),
    email:        email?.trim().toLowerCase() || null,
    passwordHash: bcrypt.hashSync(password.trim(), 10),
    name:         name.trim(),
    role:         'admin',
    sede:         null,
  })

  ok(res, { message: 'Admin creado correctamente', username: user.username })
})

// GET /api/auth/modules — lista de módulos disponibles (solo admin)
router.get('/modules', requireAuth, requireAdmin, (_req, res) => {
  ok(res, MODULES)
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password)
    return badRequest(res, 'Usuario y contraseña requeridos')

  const user = await User.findOne({ username: username.trim().toLowerCase() })
  if (!user || !bcrypt.compareSync(password, user.passwordHash))
    return unauth(res, 'Usuario o contraseña incorrectos')

  const payload = {
    id:          user._id,
    username:    user.username,
    email:       user.email || null,
    name:        user.name,
    role:        user.role,
    sede:        user.sede,
    permissions: user.permissions || [],
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  })

  ok(res, { token, user: payload })
})

// PATCH /api/auth/profile — el usuario actualiza su propio email y/o contraseña
router.patch('/profile', requireAuth, async (req, res) => {
  const { email, currentPassword, newPassword } = req.body

  const user = await User.findById(req.user.id)
  if (!user) return badRequest(res, 'Usuario no encontrado')

  if (email !== undefined) {
    user.email = email.trim().toLowerCase() || null
  }

  if (newPassword?.trim()) {
    if (!currentPassword?.trim())
      return badRequest(res, 'Debes enviar la contraseña actual para cambiarla')
    if (!bcrypt.compareSync(currentPassword.trim(), user.passwordHash))
      return badRequest(res, 'La contraseña actual es incorrecta')
    user.passwordHash = bcrypt.hashSync(newPassword.trim(), 10)
  }

  await user.save()

  const updated = {
    id:          user._id,
    username:    user.username,
    email:       user.email || null,
    name:        user.name,
    role:        user.role,
    sede:        user.sede,
    permissions: user.permissions || [],
  }

  ok(res, { message: 'Perfil actualizado', user: updated })
})

export default router

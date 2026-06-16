import { Router } from 'express'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import { requireAuth, requireAdmin } from '../middlewares/auth.js'
import { ok, created, notFound, badRequest } from '../helpers/response.js'

const router = Router()

const safeUser = (u) => ({
  id:          u._id,
  username:    u.username,
  name:        u.name,
  role:        u.role,
  sede:        u.sede,
  permissions: u.permissions || [],
})

// GET /api/users
router.get('/', requireAuth, requireAdmin, async (_req, res) => {
  const users = await User.find().sort('username')
  ok(res, users.map(safeUser))
})

// POST /api/users
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role, sede, permissions } = req.body
  if (!username?.trim() || !password?.trim() || !name?.trim() || !role)
    return badRequest(res, 'Faltan campos requeridos')

  if (role === 'operario' && !sede)
    return badRequest(res, 'El operario debe tener una sede asignada')

  const exists = await User.findOne({ username: username.trim().toLowerCase() })
  if (exists) return badRequest(res, 'El nombre de usuario ya existe')

  const user = await User.create({
    username:     username.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password.trim(), 10),
    name:         name.trim(),
    role,
    sede:         role === 'operario' ? (sede || null) : null,
    permissions:  Array.isArray(permissions) ? permissions : [],
  })
  created(res, safeUser(user))
})

// PATCH /api/users/:id — actualizar nombre, rol, sede, contraseña y/o permisos
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, role, sede, password, permissions } = req.body

  if (role === 'operario' && !sede)
    return badRequest(res, 'El operario debe tener una sede asignada')

  const updates = {}
  if (name?.trim())    updates.name = name.trim()
  if (role)            updates.role = role
  if (role === 'admin') {
    updates.sede = null
  } else if (sede !== undefined) {
    updates.sede = sede || null
  }
  if (password?.trim()) {
    updates.passwordHash = bcrypt.hashSync(password.trim(), 10)
  }
  if (Array.isArray(permissions)) updates.permissions = permissions

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  )
  if (!user) return notFound(res, 'Usuario no encontrado')

  ok(res, safeUser(user))
})

// DELETE /api/users/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id)
  if (!user) return notFound(res, 'Usuario no encontrado')
  ok(res, { message: 'Usuario eliminado' })
})

export default router

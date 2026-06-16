import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { ok, badRequest, unauth } from '../helpers/response.js'

const router = Router()

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

export default router

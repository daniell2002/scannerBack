import crypto from 'crypto'
import User from '../models/User.js'

export const MIN_PASSWORD = 8

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const normalizeEmail = (email) => email?.trim().toLowerCase() || ''
export const isValidEmail   = (email) => EMAIL_RE.test(email)

/** ¿El correo ya lo usa otro usuario? */
export const emailTaken = (email, exceptId = null) =>
  User.exists({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })

/** Usuario interno a partir del correo: "juan.perez@x.com" → "juan.perez" (o "juan.perez2"…). */
export async function usernameFromEmail(email) {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'usuario'
  let candidate = base
  for (let n = 2; await User.exists({ username: candidate }); n++) candidate = `${base}${n}`
  return candidate
}

/** Usuario interno de un vendedor (no tiene correo): "María López" → "vendedor.maria.lopez". */
export async function usernameFromName(name) {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'vendedor'
  const base = `vendedor.${slug}`
  let candidate = base
  for (let n = 2; await User.exists({ username: candidate }); n++) candidate = `${base}${n}`
  return candidate
}

/** Contraseña temporal legible: sin caracteres ambiguos (0/O, 1/l/I). */
export function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length]
  return out
}

export const passwordError = (password) =>
  !password || password.length < MIN_PASSWORD
    ? `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`
    : null

/** Datos del vendedor para el select "Atendido por". */
export const publicVendor = (u) => ({
  id:     u._id,
  name:   u.name,
  sede:   u.sede,
  active: u.active !== false,
})

/** Datos públicos del usuario (sin hash). */
export const publicUser = (u) => ({
  id:                 u._id,
  username:           u.username,
  email:              u.email || null,
  name:               u.name,
  role:               u.role,
  sede:               u.sede,
  permissions:        u.permissions || [],
  active:             u.active !== false,
  mustChangePassword: !!u.mustChangePassword,
  lastLoginAt:        u.lastLoginAt || null,
  createdAt:          u.createdAt || null,
})

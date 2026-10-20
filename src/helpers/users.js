import crypto from 'crypto'
import User from '../models/User.js'

export const MIN_PASSWORD = 8

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const normalizeEmail = (email) => email?.trim().toLowerCase() || ''
export const isValidEmail   = (email) => EMAIL_RE.test(email)

/** ¿El correo ya lo usa otro usuario? */
export const emailTaken = (email, exceptId = null) =>
  User.exists({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })

/*
 * Varios supervisores pueden compartir un mismo correo (p. ej. el de la empresa):
 * cada uno se distingue por su nombre de usuario. El correo de un administrador,
 * en cambio, es solo suyo, para que siempre pueda ingresar y recuperar su cuenta.
 */
export async function emailConflict(email, role, exceptId = null) {
  if (!email) return null
  const others = { email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }
  if (role === 'admin')
    return await User.exists(others) ? 'Ese correo ya lo usa otra cuenta. El administrador necesita un correo propio.' : null
  return await User.exists({ ...others, role: 'admin' }) ? 'Ese correo pertenece a un administrador. Usa otro.' : null
}

/* ── Nombre de usuario (con él se ingresa al sistema) ── */

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/
export const normalizeUsername = (u) => String(u || '').trim().toLowerCase()

export function usernameError(username) {
  if (!username) return 'Ingresa el nombre de usuario'
  if (username.includes('@')) return 'El usuario no puede llevar @ (eso es un correo)'
  if (!USERNAME_RE.test(username))
    return 'El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios ni tildes'
  if (username.startsWith('vendedor.')) return 'Los usuarios que empiezan por "vendedor." están reservados'
  return null
}

export const usernameTaken = (username, exceptId = null) =>
  User.exists({ username, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })

/** Sugerencia libre a partir del nombre: "Laura Pérez" → "laura.perez" (o "laura.perez2"…). */
export async function usernameSuggestion(name) {
  const base = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 26) || 'usuario'
  let candidate = base.length >= 3 ? base : `${base}.usr`
  for (let n = 2; await User.exists({ username: candidate }); n++) candidate = `${base}${n}`
  return candidate
}

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

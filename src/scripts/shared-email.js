// Pone un mismo correo a los supervisores y les crea un usuario con el formato
// "nombre.apellido2026" para que ingresen con él (con un correo compartido ya
// no se puede ingresar por correo). El administrador no se modifica.
//
//   npm run shared-email -- correo@empresa.com                 → solo muestra el plan
//   npm run shared-email -- correo@empresa.com --aplicar       → aplica los cambios
//   … --incluir-vendedores   también pone el correo a los vendedores (solo contacto)
//   … --sufijo=2026          texto que se agrega al usuario (por defecto 2026)
//   … --mantener-usuarios    no cambia los usuarios, solo el correo
//
//   docker compose exec backend npm run shared-email -- correo@empresa.com
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../db.js'
import User from '../models/User.js'
import { normalizeEmail, isValidEmail } from '../helpers/users.js'
import { audit } from '../helpers/audit.js'

const args = process.argv.slice(2)
const email   = normalizeEmail(args.find(a => !a.startsWith('--')))
const apply   = args.includes('--aplicar')
const vendors = args.includes('--incluir-vendedores')
const keepUsernames = args.includes('--mantener-usuarios')
const suffix  = (args.find(a => a.startsWith('--sufijo='))?.split('=')[1] ?? '2026').toLowerCase()

const slug = (name) => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')

const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)

try {
  if (!isValidEmail(email)) {
    console.error('\nUso: npm run shared-email -- correo@empresa.com [--aplicar] [--incluir-vendedores] [--sufijo=2026] [--mantener-usuarios]\n')
    process.exitCode = 1
  } else {
    await connectDB()

    if (await User.exists({ role: 'admin', email })) {
      console.error(`\n${email} es el correo de un administrador: usa otro para los supervisores.\n`)
      process.exitCode = 1
    } else {
      const roles = vendors ? ['supervisor', 'vendedor'] : ['supervisor']
      const users = await User.find({ role: { $in: roles } }).sort({ role: 1, name: 1 })
      // Usuarios ya tomados por otros (para no repetir)
      const taken = new Set((await User.find({}, 'username')).map(u => u.username))

      const plan = users.map(u => {
        let username = u.username
        if (u.role === 'supervisor' && !keepUsernames) {
          const base = (slug(u.name) || 'usuario').slice(0, 30 - suffix.length - 1) + suffix
          if (base !== u.username) {
            taken.delete(u.username)
            username = base
            for (let i = 0; taken.has(username); i++) username = base + String.fromCharCode(98 + i) // b, c, d…
          }
          taken.add(username)
        }
        return { u, username, emailChange: u.email !== email, userChange: username !== u.username }
      })

      console.log(`\n${apply ? 'APLICANDO' : 'PLAN (no se cambia nada; agrega --aplicar para hacerlo)'} — correo: ${email}\n`)
      console.log(`${pad('Rol', 11)}${pad('Nombre', 28)}${pad('Usuario actual', 26)}${pad('Usuario nuevo', 26)}Correo actual`)
      console.log('-'.repeat(120))
      for (const p of plan) {
        console.log(`${pad(p.u.role, 11)}${pad(p.u.name, 28)}${pad(p.u.username, 26)}${pad(p.userChange ? p.username : '(igual)', 26)}${p.u.email || '(sin correo)'}${p.u.active === false ? '  [inactivo]' : ''}`)
      }
      const changes = plan.filter(p => p.emailChange || p.userChange)
      console.log(`\n${changes.length} de ${plan.length} cuentas cambian. El administrador no se modifica.`)

      if (apply && changes.length) {
        for (const p of changes) {
          const before = { email: p.u.email, username: p.u.username }
          p.u.email = email
          p.u.username = p.username
          await p.u.save()
          const diffs = {}
          if (p.emailChange) diffs.email = { from: before.email, to: email }
          if (p.userChange) diffs.username = { from: before.username, to: p.username }
          await audit(null, 'editar', 'usuario', { id: p.u._id, label: `${p.u.name} (desde el servidor)`, sede: p.u.sede, changes: diffs })
        }
        console.log('✅ Cambios aplicados. Comparte con cada supervisor su usuario nuevo: ya no podrán ingresar con el correo.\n')
      } else if (!apply) {
        console.log('Revisa la tabla y, si está bien, vuelve a ejecutar con --aplicar.\n')
      }
    }
  }
} catch (err) {
  console.error('Error:', err.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect().catch(() => {})
}

// Último recurso si un administrador olvida su contraseña y no puede usar
// "¿Olvidaste tu contraseña?" (sin correo configurado o sin otro admin).
// Se ejecuta en el servidor, así que solo lo puede usar quien tiene acceso a él:
//
//   npm run reset-password -- admin@empresa.com
//   docker compose exec backend npm run reset-password -- admin@empresa.com
//
// Genera una contraseña temporal, la muestra una sola vez y obliga a cambiarla
// en el siguiente ingreso. Sin argumento, lista los administradores.
import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { connectDB } from '../db.js'
import User from '../models/User.js'
import { generateTempPassword } from '../helpers/users.js'
import { audit } from '../helpers/audit.js'

const identifier = (process.argv[2] || '').trim().toLowerCase()

try {
  await connectDB()

  if (!identifier) {
    const admins = await User.find({ role: 'admin' }, 'name email username active').sort('name')
    console.log('\nUso: npm run reset-password -- <correo o usuario>\n')
    console.log('Administradores:')
    admins.forEach(a => console.log(`  - ${a.name} · ${a.email || a.username}${a.active === false ? ' (inactivo)' : ''}`))
    console.log()
  } else {
    const user = await User.findOne(identifier.includes('@') ? { email: identifier } : { username: identifier })
    if (!user || user.role === 'vendedor') {
      console.error(`\nNo existe un usuario con acceso al sistema con "${identifier}".\n`)
      process.exitCode = 1
    } else {
      const tempPassword = generateTempPassword()
      user.passwordHash       = bcrypt.hashSync(tempPassword, 10)
      user.mustChangePassword = true
      user.active             = true // si estaba desactivado, no podría ingresar
      user.resetTokenHash     = null
      user.resetExpiresAt     = null
      await user.save()
      await audit(null, 'restablecer', 'usuario', { id: user._id, label: `${user.name} (desde el servidor)`, sede: user.sede })

      console.log(`\n✅ Contraseña restablecida para ${user.name} (${user.email || user.username})`)
      console.log(`   Contraseña temporal: ${tempPassword}`)
      console.log('   Deberá cambiarla al ingresar.\n')
    }
  }
} catch (err) {
  console.error('Error:', err.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}

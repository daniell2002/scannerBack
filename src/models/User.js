import { Schema, model } from 'mongoose'

const userSchema = new Schema({
  // Identificador interno (se deriva del correo). Se mantiene por compatibilidad:
  // la app móvil y los usuarios antiguos todavía pueden ingresar con él.
  username:     { type: String, required: true, unique: true, lowercase: true },
  email:        { type: String, default: null, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name:         { type: String, required: true },
  role:         { type: String, enum: ['admin', 'operario'], required: true },
  sede:         { type: String, default: null },
  permissions:  { type: [String], default: [] },
  // 2 = Inicio y Observaciones ya son permisos explícitos (ver migrations.js)
  permissionsVersion: { type: Number, default: 2 },

  active:             { type: Boolean, default: true },
  // Contraseña temporal asignada por un admin: debe cambiarse en el siguiente ingreso
  mustChangePassword: { type: Boolean, default: false },
  lastLoginAt:        { type: Date, default: null },
  createdAt:          { type: Date, default: Date.now },
}, { versionKey: false })

userSchema.index({ email: 1 })

export default model('User', userSchema)

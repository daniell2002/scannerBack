import { Schema, model } from 'mongoose'

const sedeSchema = new Schema({
  code:    { type: String, required: true, unique: true, uppercase: true },
  name:    { type: String, required: true },
  city:    { type: String, required: true },
  // Coordinador: un supervisor del sistema. Se guarda también su nombre para
  // mostrarlo sin consultas extra (y por compatibilidad con la app móvil,
  // que todavía envía el nombre como texto).
  manager:   { type: String, default: '' },
  managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { versionKey: false })

export default model('Sede', sedeSchema)

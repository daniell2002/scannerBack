import { Schema, model } from 'mongoose'

// Registro de actividad: quién hizo qué, sobre qué y cuándo.
// Se guarda el nombre y rol del autor para que el registro siga siendo legible
// aunque el usuario se elimine después.
const auditSchema = new Schema({
  actorId:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, default: 'Sistema' },
  actorRole: { type: String, default: '' },
  sede:      { type: String, default: null },
  // crear | editar | eliminar | restablecer | ingresar | recuperar
  action:    { type: String, required: true },
  // orden | usuario | sede | observacion | sesion
  entity:    { type: String, required: true },
  entityId:  { type: String, default: '' },
  // Texto corto para la tabla, p. ej. "OP-1234" o "Juan Pérez"
  label:     { type: String, default: '' },
  // Campos que cambiaron: { campo: { from, to } }
  changes:   { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false })

auditSchema.index({ createdAt: -1 })
auditSchema.index({ entity: 1, createdAt: -1 })
auditSchema.index({ actorId: 1, createdAt: -1 })

auditSchema.methods.toAPI = function () {
  return {
    id:        this._id,
    actorId:   this.actorId,
    actorName: this.actorName,
    actorRole: this.actorRole,
    sede:      this.sede,
    action:    this.action,
    entity:    this.entity,
    entityId:  this.entityId,
    label:     this.label,
    changes:   this.changes,
    createdAt: this.createdAt,
  }
}

export default model('AuditLog', auditSchema)

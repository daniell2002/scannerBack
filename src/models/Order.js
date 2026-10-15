import { Schema, model } from 'mongoose'

const orderSchema = new Schema({
  code:        { type: String, required: true, unique: true, uppercase: true },
  product:     { type: String, required: true },
  line:        { type: String, default: '' },
  batch:       { type: String, required: true },
  status:      { type: String, enum: ['Pendiente', 'En proceso', 'Completada', 'Bloqueada'], default: 'Pendiente' },
  priority:    { type: String, enum: ['Alta', 'Media', 'Baja'], default: 'Media' },
  sede:        { type: String, required: true },
  quantity:    { type: Number, default: 0 },
  completed:   { type: Number, default: 0 },
  operator:    { type: String, default: 'Sin asignar' },
  operatorId:  { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // Vendedor que atendió al cliente; lo elige quien registra la orden
  attendedBy:   { type: String, default: '' },
  attendedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  photoUrl:   { type: String, default: null }, // primera foto (compatibilidad)
  photos:      { type: [String], default: [] },  // todas las fotos de la orden
  scheduledAt: { type: Date, required: true },
  updatedAt:   { type: Date, default: Date.now },
  scannedAt:   { type: Date, default: null },
  scanCount:   { type: Number, default: 0 },
  // true cuando un supervisor registra/re-escanea la orden y el admin aún no la revisa
  pendingReview: { type: Boolean, default: false },
}, { versionKey: false })

orderSchema.index({ attendedById: 1 })

// Helper para dar forma al JSON que espera el frontend
orderSchema.methods.toAPI = function () {
  return {
    id:          this._id,
    code:        this.code,
    product:     this.product,
    line:        this.line,
    batch:       this.batch,
    status:      this.status,
    priority:    this.priority,
    sede:        this.sede,
    quantity:    this.quantity,
    completed:   this.completed,
    operator:    this.operator,
    operatorId:  this.operatorId,
    attendedBy:   this.attendedBy || '',
    attendedById: this.attendedById,
    photoUrl:    this.photos?.[0] || this.photoUrl,
    // Órdenes antiguas solo tienen photoUrl
    photos:      this.photos?.length ? this.photos : (this.photoUrl ? [this.photoUrl] : []),
    scheduledAt: this.scheduledAt,
    updatedAt:   this.updatedAt,
    scannedAt:   this.scannedAt,
    scanCount:   this.scanCount,
    pendingReview: this.pendingReview,
  }
}

export default model('Order', orderSchema)

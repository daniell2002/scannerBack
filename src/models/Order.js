import { Schema, model } from 'mongoose'

const orderSchema = new Schema({
  code:        { type: String, required: true, unique: true, uppercase: true },
  product:     { type: String, required: true },
  line:        { type: String, default: 'L-01' },
  batch:       { type: String, required: true },
  status:      { type: String, enum: ['Pendiente', 'En proceso', 'Completada', 'Bloqueada'], default: 'Pendiente' },
  priority:    { type: String, enum: ['Alta', 'Media', 'Baja'], default: 'Media' },
  sede:        { type: String, required: true },
  quantity:    { type: Number, default: 0 },
  completed:   { type: Number, default: 0 },
  operator:    { type: String, default: 'Sin asignar' },
  photoUrl:    { type: String, default: null },
  scheduledAt: { type: Date, required: true },
  updatedAt:   { type: Date, default: Date.now },
  scannedAt:   { type: Date, default: null },
  scanCount:   { type: Number, default: 0 },
}, { versionKey: false })

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
    photoUrl:    this.photoUrl,
    scheduledAt: this.scheduledAt,
    updatedAt:   this.updatedAt,
    scannedAt:   this.scannedAt,
    scanCount:   this.scanCount,
  }
}

export default model('Order', orderSchema)

import { Schema, model } from 'mongoose'

// Retroalimentación del admin sobre una orden, dirigida al operario que la registró.
const feedbackSchema = new Schema({
  order:         { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  orderCode:     { type: String, required: true },
  sede:          { type: String, required: true },
  authorId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName:    { type: String, required: true },
  recipientId:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  recipientName: { type: String, default: '' },
  comment:       { type: String, required: true },
  evidences:     { type: [String], default: [] },
  seenAt:        { type: Date, default: null },
  // El operario indica que ya atendió la observación
  resolvedAt:    { type: Date, default: null },
  createdAt:     { type: Date, default: Date.now },
}, { versionKey: false })

feedbackSchema.index({ recipientId: 1, seenAt: 1, createdAt: -1 })
feedbackSchema.index({ order: 1, createdAt: -1 })

feedbackSchema.methods.toAPI = function () {
  return {
    id:            this._id,
    orderCode:     this.orderCode,
    sede:          this.sede,
    authorName:    this.authorName,
    recipientName: this.recipientName,
    comment:       this.comment,
    evidences:     this.evidences,
    seenAt:        this.seenAt,
    resolvedAt:    this.resolvedAt,
    createdAt:     this.createdAt,
  }
}

export default model('Feedback', feedbackSchema)

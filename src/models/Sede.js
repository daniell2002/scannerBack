import { Schema, model } from 'mongoose'

const sedeSchema = new Schema({
  code:        { type: String, required: true, unique: true, uppercase: true },
  name:        { type: String, required: true },
  city:        { type: String, required: true },
  manager:     { type: String, required: true },
  activeLines: { type: Number, default: 0 },
}, { versionKey: false })

export default model('Sede', sedeSchema)

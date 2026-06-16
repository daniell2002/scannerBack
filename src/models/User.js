import { Schema, model } from 'mongoose'

const userSchema = new Schema({
  username:     { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name:         { type: String, required: true },
  role:         { type: String, enum: ['admin', 'operario'], required: true },
  sede:         { type: String, default: null },
  permissions:  { type: [String], default: [] },
}, { versionKey: false })

export default model('User', userSchema)

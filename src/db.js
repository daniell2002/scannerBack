import mongoose from 'mongoose'

// Oculta usuario y contraseña de la URI para no exponerlos en los logs
export const maskUri = (uri = '') => uri.replace(/\/\/[^@/]+@/, '//***:***@')

export async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('  MongoDB conectado:', maskUri(process.env.MONGO_URI))
}

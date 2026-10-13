import 'dotenv/config'
import path from 'path'
import express from 'express'
import cors from 'cors'
import { connectDB }  from './db.js'
import { migratePermissions } from './migrations.js'
import authRoutes     from './routes/auth.js'
import sedesRoutes    from './routes/sedes.js'
import ordersRoutes   from './routes/orders.js'
import usersRoutes    from './routes/users.js'
import feedbackRoutes from './routes/feedback.js'

const app  = express()
const PORT = process.env.PORT || 3000

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : []
app.use(cors({
  origin: (origin, cb) => {
    // Permite peticiones sin origin (Postman, mobile nativo) y entornos locales comunes
    if (
      !origin ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
      allowedOrigins.includes(origin)
    ) {
      cb(null, true)
    } else {
      cb(new Error('CORS: origen no permitido'))
    }
  },
}))
app.use(express.json())
app.use('/uploads', express.static(path.resolve('uploads')))

app.use('/api/auth',   authRoutes)
app.use('/api/sedes',  sedesRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/users',  usersRoutes)
app.use('/api/feedback', feedbackRoutes)

app.get('/api/health', (_, res) => res.json({ status: 'ok' }))

app.use((_, res) => res.status(404).json({ message: 'Ruta no encontrada' }))
app.use((err, _req, res, _next) => {
  // Errores de subida de archivos (multer / filtro de imágenes) → 400 legible
  if (err?.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE'  ? 'Cada imagen debe pesar máximo 8 MB.'
              : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Se enviaron demasiadas imágenes (máx. 10 por orden y 5 por retroalimentación).'
              : 'No fue posible subir el archivo.'
    return res.status(400).json({ message: msg })
  }
  if (err?.message === 'El archivo debe ser una imagen.')
    return res.status(400).json({ message: err.message })

  console.error(err)
  res.status(500).json({ message: 'Error interno del servidor' })
})

connectDB()
  .then(migratePermissions)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Conexa API corriendo en http://localhost:${PORT}\n`)
    })
  })
  .catch(err => {
    console.error('Error conectando a MongoDB:', err.message)
    process.exit(1)
  })

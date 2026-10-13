import fs from 'fs'
import path from 'path'
import multer from 'multer'

export const MAX_ORDER_PHOTOS = 10

const UPLOADS_DIR  = path.resolve('uploads/orders')
const FEEDBACK_DIR = path.resolve('uploads/feedback')
fs.mkdirSync(UPLOADS_DIR,  { recursive: true })
fs.mkdirSync(FEEDBACK_DIR, { recursive: true })

const storageIn = (dir) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

const fileFilter = (_req, file, cb) => {
  if (!file.mimetype.startsWith('image/'))
    return cb(new Error('El archivo debe ser una imagen.'))
  cb(null, true)
}

export const uploadPhoto = multer({
  storage: storageIn(UPLOADS_DIR),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
})

// Evidencias de la retroalimentación del admin (hasta 5 imágenes)
export const uploadEvidence = multer({
  storage: storageIn(FEEDBACK_DIR),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
})

// Borra un archivo subido que no llegó a usarse (p. ej. orden duplicada rechazada)
export const discardUpload = (file) => {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {})
}

export { UPLOADS_DIR, FEEDBACK_DIR }

import fs from 'fs'
import path from 'path'
import multer from 'multer'

const UPLOADS_DIR = path.resolve('uploads/orders')
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
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
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
})

export { UPLOADS_DIR }

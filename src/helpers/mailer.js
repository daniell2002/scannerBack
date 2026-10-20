import nodemailer from 'nodemailer'

// Correo saliente (SMTP). Se configura con:
//   SMTP_HOST, SMTP_PORT (587 por defecto), SMTP_USER, SMTP_PASS
//   MAIL_FROM (opcional, p. ej. "Conexa <no-responder@empresa.com>")
// Con Gmail: SMTP_HOST=smtp.gmail.com y una "contraseña de aplicación" en SMTP_PASS.

export const mailEnabled = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER)

let transporter = null
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  }
  return transporter
}

export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) throw new Error('El envío de correos no está configurado (SMTP_HOST / SMTP_USER)')
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to, subject, text, html,
  })
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Correo con el enlace para crear una contraseña nueva. */
export function resetPasswordMail({ name, link, minutes }) {
  const text = [
    `Hola, ${name}.`,
    '',
    'Recibimos una solicitud para restablecer tu contraseña de Conexa.',
    `Abre este enlace para crear una nueva (vence en ${minutes} minutos):`,
    link,
    '',
    'Si no fuiste tú, ignora este correo: tu contraseña actual sigue funcionando.',
  ].join('\n')

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1e293b">
    <h2 style="margin:0 0 16px">Restablecer contraseña</h2>
    <p>Hola, <strong>${esc(name)}</strong>.</p>
    <p>Recibimos una solicitud para restablecer tu contraseña de Conexa.</p>
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="background:#2a78d6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">
        Crear contraseña nueva
      </a>
    </p>
    <p style="font-size:13px;color:#64748b">El enlace vence en ${minutes} minutos y solo se puede usar una vez.</p>
    <p style="font-size:13px;color:#64748b">Si no fuiste tú, ignora este correo: tu contraseña actual sigue funcionando.</p>
  </div>`

  return { subject: 'Restablecer tu contraseña de Conexa', text, html }
}

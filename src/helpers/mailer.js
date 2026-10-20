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

const button = (link, label) =>
  `<a href="${esc(link)}" style="display:inline-block;background:#2a78d6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(label)}</a>`

/**
 * Correo con el enlace para crear una contraseña nueva.
 * accounts: [{ name, username, link }]. Si el correo lo comparten varias cuentas,
 * lleva un enlace por cada una para que cada quien elija la suya.
 */
export function resetPasswordMail({ accounts, minutes }) {
  const many = accounts.length > 1
  const foot = [
    `Cada enlace vence en ${minutes} minutos y solo se puede usar una vez.`,
    'Si no fuiste tú, ignora este correo: la contraseña actual sigue funcionando.',
  ]

  const text = [
    many ? 'Hola.' : `Hola, ${accounts[0].name}.`,
    '',
    many
      ? 'Recibimos una solicitud para restablecer la contraseña de Conexa. Este correo lo usan varias cuentas: abre solo el enlace de la tuya.'
      : 'Recibimos una solicitud para restablecer tu contraseña de Conexa. Abre este enlace para crear una nueva:',
    '',
    ...accounts.flatMap(a => many ? [`${a.name} (usuario: ${a.username})`, a.link, ''] : [a.link, '']),
    ...foot,
  ].join('\n')

  const items = accounts.map(a => many
    ? `<tr><td style="padding:12px 0;border-top:1px solid #e2e8f0">
         <strong>${esc(a.name)}</strong><br><span style="font-size:13px;color:#64748b">Usuario: ${esc(a.username)}</span>
       </td><td style="padding:12px 0;border-top:1px solid #e2e8f0;text-align:right">${button(a.link, 'Crear contraseña')}</td></tr>`
    : `<p style="margin:24px 0">${button(a.link, 'Crear contraseña nueva')}</p>`).join('')

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1e293b">
    <h2 style="margin:0 0 16px">Restablecer contraseña</h2>
    <p>${many ? 'Hola.' : `Hola, <strong>${esc(accounts[0].name)}</strong>.`}</p>
    <p>${many
      ? 'Recibimos una solicitud para restablecer la contraseña de Conexa. Este correo lo usan varias cuentas: <strong>abre solo el enlace de la tuya</strong>.'
      : 'Recibimos una solicitud para restablecer tu contraseña de Conexa.'}</p>
    ${many ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">${items}</table>` : items}
    ${foot.map(f => `<p style="font-size:13px;color:#64748b">${f}</p>`).join('')}
  </div>`

  return { subject: 'Restablecer contraseña de Conexa', text, html }
}

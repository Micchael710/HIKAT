/**
 * HiKAT Email Delivery Service Abstraction, Resend Implementation & Mock
 */

export interface SentEmailRecord {
  to: string
  type: "verification" | "password_reset"
  token: string
  url: string
  subject: string
  timestamp: string
}

export interface EmailService {
  sendVerificationEmail(to: string, token: string, verificationUrl: string): Promise<void>
  sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void>
}

/**
 * Clean, lightweight HTML email template with HiKAT design language
 */
export function renderHikatEmail(params: {
  title: string
  description: string
  buttonText: string
  buttonUrl: string
  expiryNotice: string
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.title}</title>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #090d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto; background: linear-gradient(180deg, #131c24 0%, #0d1217 100%); border: 1.5px solid #233140; border-radius: 16px; padding: 36px 32px; box-shadow: 0 16px 48px rgba(0,0,0,0.65);">
    <!-- Brand Header -->
    <tr>
      <td align="center" style="padding-bottom: 24px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background: linear-gradient(135deg, #1c384e 0%, #0e1e2c 100%); border: 1.5px solid rgba(56, 189, 248, 0.4); border-radius: 12px; padding: 8px 20px;">
              <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 900; letter-spacing: 0.12em; color: #ffffff;">HiKAT</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Title -->
    <tr>
      <td style="padding-bottom: 12px;">
        <h1 style="margin: 0; font-size: 21px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.01em;">${params.title}</h1>
      </td>
    </tr>

    <!-- Description -->
    <tr>
      <td style="padding-bottom: 28px; font-size: 14.5px; line-height: 1.6; color: #c2d0dd; text-align: center;">
        ${params.description}
      </td>
    </tr>

    <!-- Bulletproof Button -->
    <tr>
      <td align="center" style="padding-bottom: 20px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td align="center" style="border-radius: 12px; background: #1c384e; border: 2px solid #38bdf8;">
              <a href="${params.buttonUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: linear-gradient(135deg, #1c384e 0%, #295372 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 10px; text-align: center; letter-spacing: 0.02em; line-height: 1.2;">
                ${params.buttonText}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Visible Fallback Link -->
    <tr>
      <td style="padding-bottom: 28px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding: 12px 16px; background: rgba(13, 18, 24, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; font-size: 12px; line-height: 1.5; color: #8899aa; text-align: center; word-break: break-all;">
              <span style="color: #c2d0dd;">Si el botón no funciona, abre este enlace:</span><br>
              <a href="${params.buttonUrl}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: underline; font-weight: 500; word-break: break-all;">
                ${params.buttonUrl}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Expiry & Security Disclaimer -->
    <tr>
      <td style="padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 12px; line-height: 1.6; color: #657788; text-align: center;">
        <span style="color: #8899aa; font-weight: 600;">${params.expiryNotice}</span><br>
        Si no solicitaste esta acción, puedes ignorar este correo de forma segura.
      </td>
    </tr>
  </table>
</body>
</html>`
}

export class ResendEmailService implements EmailService {
  constructor(
    private readonly apiKey: string,
    private readonly from: string = "HiKAT <noreply@mail.hikat.org>",
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) { }

  async sendVerificationEmail(to: string, token: string, verificationUrl: string): Promise<void> {
    const subject = "Verifica tu cuenta de HiKAT"
    const html = renderHikatEmail({
      title: "Verifica tu cuenta de HiKAT",
      description: "Gracias por unirte a HiKAT. Haz clic en el botón de abajo para verificar tu correo electrónico y comenzar a jugar.",
      buttonText: "Verificar cuenta",
      buttonUrl: verificationUrl,
      expiryNotice: "Este enlace expirará en 24 horas.",
    })
    await this.sendMail(to, subject, html)
  }

  async sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void> {
    const subject = "Restablece tu contraseña de HiKAT"
    const html = renderHikatEmail({
      title: "Restablece tu contraseña de HiKAT",
      description: "Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en HiKAT. Haz clic en el botón de abajo para continuar.",
      buttonText: "Restablecer contraseña",
      buttonUrl: resetUrl,
      expiryNotice: "Este enlace expirará en 30 minutos.",
    })
    await this.sendMail(to, subject, html)
  }

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    const res = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as { message?: string }
      const errDetail = errorData.message || `HTTP ${res.status}`
      throw new Error(`Resend email delivery failed: ${errDetail}`)
    }
  }
}

export class MockEmailService implements EmailService {
  private sent: SentEmailRecord[] = []

  async sendVerificationEmail(to: string, token: string, verificationUrl: string): Promise<void> {
    this.sent.push({
      to,
      type: "verification",
      token,
      url: verificationUrl,
      subject: "Verifica tu cuenta de HiKAT",
      timestamp: new Date().toISOString(),
    })
  }

  async sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void> {
    this.sent.push({
      to,
      type: "password_reset",
      token,
      url: resetUrl,
      subject: "Restablece tu contraseña de HiKAT",
      timestamp: new Date().toISOString(),
    })
  }

  getSentEmails(): SentEmailRecord[] {
    return [...this.sent]
  }

  getLastEmailFor(to: string): SentEmailRecord | undefined {
    return [...this.sent].reverse().find((e) => e.to.toLowerCase() === to.toLowerCase())
  }

  clear(): void {
    this.sent = []
  }
}

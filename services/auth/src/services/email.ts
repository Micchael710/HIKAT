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
<body style="margin: 0; padding: 24px; background-color: #090d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto; background: linear-gradient(180deg, #141d26 0%, #0d1218 100%); border: 1.5px solid #233140; border-radius: 16px; padding: 32px 28px; box-shadow: 0 16px 40px rgba(0,0,0,0.6);">
    <tr>
      <td align="center" style="padding-bottom: 24px;">
        <span style="font-size: 24px; font-weight: 800; letter-spacing: 0.05em; color: #ffffff;">HiKAT</span>
      </td>
    </tr>
    <tr>
      <td style="padding-bottom: 12px;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; text-align: center;">${params.title}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding-bottom: 28px; font-size: 14.5px; line-height: 1.6; color: #c2d0dd; text-align: center;">
        ${params.description}
      </td>
    </tr>
    <tr>
      <td align="center" style="padding-bottom: 28px;">
        <a href="${params.buttonUrl}" style="display: inline-block; background: #0284c7; color: #ffffff; font-size: 14.5px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 10px; text-align: center;">
          ${params.buttonText}
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top: 16px; border-top: 1px solid #1f2b37; font-size: 12px; line-height: 1.5; color: #657788; text-align: center;">
        ${params.expiryNotice}<br>
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
    private readonly fetcher: typeof fetch = fetch,
  ) {}

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

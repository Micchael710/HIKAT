import { HIKAT_LOGO_PNG_BASE64 } from "../assets/logo"

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
 * Clean, lightweight HTML email template replicating HiKAT Launcher Login card
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
<body style="margin: 0; padding: 0; background-color: #090d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif; color: #ffffff; -webkit-font-smoothing: antialiased; width: 100% !important; min-height: 100%;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" height="100%" style="background-color: #090d12; min-height: 100vh; padding: 40px 16px;">
    <tr>
      <td align="center" valign="middle">
        <!-- Main Card (matching Launcher Login) -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 440px; margin: 0 auto; background: linear-gradient(180deg, #141d26 0%, #0d1218 100%); border: 1.5px solid rgba(255, 255, 255, 0.1); border-radius: 20px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);">
          <tr>
            <td style="padding: 36px 30px; text-align: center;">
              <!-- Real HiKAT Logo via inline CID -->
              <div style="margin-bottom: 20px; text-align: center;">
                <img src="cid:hikat-logo" alt="HiKAT" width="160" style="display: block; margin: 0 auto; border: 0; outline: none; max-width: 160px; height: auto;" />
              </div>

              <!-- Title -->
              <h1 style="margin: 0 0 10px 0; font-size: 20px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.01em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif;">
                ${params.title}
              </h1>

              <!-- Short Description -->
              <p style="margin: 0 0 26px 0; font-size: 14px; line-height: 1.5; color: #8899aa; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif;">
                ${params.description}
              </p>

              <!-- Primary Button (matching .launcher-btn-primary) -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 12px; background: #1c384e; border: 2px solid rgba(130, 200, 230, 0.5);">
                    <a href="${params.buttonUrl}" target="_blank" rel="noopener noreferrer" style="display: block; background: linear-gradient(135deg, #1c384e 0%, #295372 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; text-decoration: none; padding: 13px 20px; border-radius: 10px; text-align: center; letter-spacing: 0.02em; line-height: 1.2;">
                      ${params.buttonText}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiration Notice -->
              <p style="margin: 24px 0 0 0; font-size: 12px; line-height: 1.4; color: #556677; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif;">
                ${params.expiryNotice}
              </p>
            </td>
          </tr>
        </table>
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
        attachments: [
          {
            filename: "logo-white.png",
            content: HIKAT_LOGO_PNG_BASE64,
            content_id: "hikat-logo",
          },
        ],
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

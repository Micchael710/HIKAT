/**
 * HiKAT Email Delivery Service Abstraction, Resend Implementation & Mock
 */

export type EmailLocale = "es" | "en" | "pt" | "fr"

export function sanitizeEmailLocale(locale?: string): EmailLocale {
  if (!locale) return "en"
  const l = locale.toLowerCase().trim()
  if (l === "es" || l === "en" || l === "pt" || l === "fr") {
    return l
  }
  return "en"
}

export const EMAIL_TRANSLATIONS: Record<
  EmailLocale,
  {
    verification: {
      subject: string
      title: string
      description: string
      buttonText: string
      expiryNotice: string
    }
    passwordReset: {
      subject: string
      title: string
      description: string
      buttonText: string
      expiryNotice: string
    }
  }
> = {
  es: {
    verification: {
      subject: "Verifica tu cuenta de HiKAT",
      title: "Verifica tu cuenta de HiKAT",
      description:
        "Gracias por unirte a HiKAT. Haz clic en el botón de abajo para verificar tu correo electrónico y comenzar a jugar.",
      buttonText: "Verificar cuenta",
      expiryNotice: "Este enlace expirará en 24 horas.",
    },
    passwordReset: {
      subject: "Restablece tu contraseña de HiKAT",
      title: "Restablece tu contraseña de HiKAT",
      description:
        "Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en HiKAT. Haz clic en el botón de abajo para continuar.",
      buttonText: "Restablecer contraseña",
      expiryNotice: "Este enlace expirará en 30 minutos.",
    },
  },
  en: {
    verification: {
      subject: "Verify your HiKAT account",
      title: "Verify your HiKAT account",
      description:
        "Thanks for joining HiKAT. Click the button below to verify your email address and start playing.",
      buttonText: "Verify account",
      expiryNotice: "This link will expire in 24 hours.",
    },
    passwordReset: {
      subject: "Reset your HiKAT password",
      title: "Reset your HiKAT password",
      description:
        "We received a request to reset the password for your HiKAT account. Click the button below to continue.",
      buttonText: "Reset password",
      expiryNotice: "This link will expire in 30 minutes.",
    },
  },
  pt: {
    verification: {
      subject: "Verifique sua conta do HiKAT",
      title: "Verifique sua conta do HiKAT",
      description:
        "Obrigado por se juntar ao HiKAT. Clique no botão abaixo para verificar seu e-mail e começar a jogar.",
      buttonText: "Verificar conta",
      expiryNotice: "Este link expirará em 24 horas.",
    },
    passwordReset: {
      subject: "Redefina sua senha do HiKAT",
      title: "Redefina sua senha do HiKAT",
      description:
        "Recebemos uma solicitação para redefinir a senha da sua conta no HiKAT. Clique no botão abaixo para continuar.",
      buttonText: "Redefinir senha",
      expiryNotice: "Este link expirará em 30 minutos.",
    },
  },
  fr: {
    verification: {
      subject: "Vérifiez votre compte HiKAT",
      title: "Vérifiez votre compte HiKAT",
      description:
        "Merci d'avoir rejoint HiKAT. Cliquez sur le bouton ci-dessous pour vérifier votre adresse e-mail et commencer à jouer.",
      buttonText: "Vérifier le compte",
      expiryNotice: "Ce lien expirera dans 24 heures.",
    },
    passwordReset: {
      subject: "Réinitialisez votre mot de passe HiKAT",
      title: "Réinitialisez votre mot de passe HiKAT",
      description:
        "Nous avons reçu une demande de réinitialisation du mot de passe de votre compte HiKAT. Cliquez sur le bouton ci-dessous pour continuer.",
      buttonText: "Réinitialiser le mot de passe",
      expiryNotice: "Ce lien expirera dans 30 minutes.",
    },
  },
}

export interface SentEmailRecord {
  to: string
  type: "verification" | "password_reset"
  token: string
  url: string
  subject: string
  timestamp: string
}

export interface EmailService {
  sendVerificationEmail(to: string, token: string, verificationUrl: string, locale?: string): Promise<void>
  sendPasswordResetEmail(to: string, token: string, resetUrl: string, locale?: string): Promise<void>
}

/**
 * Clean, lightweight HTML email template replicating HiKAT Launcher Login card
 * with natural height and ~60px padding.
 */
export function renderHikatEmail(params: {
  title: string
  description: string
  buttonText: string
  buttonUrl: string
  expiryNotice: string
  locale?: string
}): string {
  const lang = sanitizeEmailLocale(params.locale)
  let logoUrl = "/auth/logo.png"
  if (params.buttonUrl) {
    try {
      logoUrl = `${new URL(params.buttonUrl).origin}/auth/logo.png`
    } catch {
      logoUrl = "/auth/logo.png"
    }
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif; color: #ffffff; -webkit-font-smoothing: antialiased; width: 100% !important;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #090d12; width: 100%; margin: 0; padding: 60px 16px;">
    <tr>
      <td align="center" valign="top">
        <!-- Main Card (matching Launcher Login) -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 440px; margin: 0 auto; background: linear-gradient(180deg, #141d26 0%, #0d1218 100%); border: 1.5px solid rgba(255, 255, 255, 0.1); border-radius: 20px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);">
          <tr>
            <td style="padding: 36px 30px; text-align: center;">
              <!-- Real HiKAT Logo -->
              <div style="margin-bottom: 20px; text-align: center;">
                <img src="${logoUrl}" alt="HiKAT" width="160" style="display: block; margin: 0 auto; border: 0; outline: none; max-width: 160px; height: auto;" />
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

  async sendVerificationEmail(to: string, token: string, verificationUrl: string, locale?: string): Promise<void> {
    const lang = sanitizeEmailLocale(locale)
    const t = EMAIL_TRANSLATIONS[lang].verification
    const html = renderHikatEmail({
      title: t.title,
      description: t.description,
      buttonText: t.buttonText,
      buttonUrl: verificationUrl,
      expiryNotice: t.expiryNotice,
      locale: lang,
    })
    await this.sendMail(to, t.subject, html)
  }

  async sendPasswordResetEmail(to: string, token: string, resetUrl: string, locale?: string): Promise<void> {
    const lang = sanitizeEmailLocale(locale)
    const t = EMAIL_TRANSLATIONS[lang].passwordReset
    const html = renderHikatEmail({
      title: t.title,
      description: t.description,
      buttonText: t.buttonText,
      buttonUrl: resetUrl,
      expiryNotice: t.expiryNotice,
      locale: lang,
    })
    await this.sendMail(to, t.subject, html)
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

  async sendVerificationEmail(to: string, token: string, verificationUrl: string, locale?: string): Promise<void> {
    const lang = sanitizeEmailLocale(locale)
    const t = EMAIL_TRANSLATIONS[lang].verification
    this.sent.push({
      to,
      type: "verification",
      token,
      url: verificationUrl,
      subject: t.subject,
      timestamp: new Date().toISOString(),
    })
  }

  async sendPasswordResetEmail(to: string, token: string, resetUrl: string, locale?: string): Promise<void> {
    const lang = sanitizeEmailLocale(locale)
    const t = EMAIL_TRANSLATIONS[lang].passwordReset
    this.sent.push({
      to,
      type: "password_reset",
      token,
      url: resetUrl,
      subject: t.subject,
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

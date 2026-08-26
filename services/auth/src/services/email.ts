/**
 * HiKAT Email Delivery Service Abstraction & Mock
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
      subject: "Recuperación de contraseña de HiKAT",
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

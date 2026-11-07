// utils/sendEmail.js
const nodemailer = require('nodemailer');

let transporter = null;

const isEmailConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
};

/**
 * Send an email. When SMTP is not configured (local development), the email
 * is printed to the console instead so flows like password reset stay testable.
 * Returns true if the email was actually delivered to an SMTP server.
 */
const sendEmail = async ({ to, subject, text, html }) => {
  if (!isEmailConfigured()) {
    console.log('\n📧 [Email not sent – SMTP not configured]');
    console.log(`   To: ${to}\n   Subject: ${subject}\n   ${text}\n`);
    return false;
  }

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || `SyncWave <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html
  });
  return true;
};

module.exports = { sendEmail, isEmailConfigured };

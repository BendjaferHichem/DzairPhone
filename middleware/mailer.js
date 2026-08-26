const nodemailer = require('nodemailer');

let transporter;
let attempted = false;

function getTransporter() {
  if (attempted) return transporter;
  attempted = true;
  if (!process.env.SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

// Sends a 6-digit verification code to `toEmail`. If no SMTP server is
// configured (no SMTP_HOST in .env), the code is logged to the server
// console instead so the app is still usable during local development.
async function sendVerificationEmail(toEmail, code) {
  const t = getTransporter();
  const subject = 'Your DzairPhone verification code';
  const text = `Your DzairPhone verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto;">
      <h2 style="color:#178a4c;">DzairPhone</h2>
      <p>Your verification code is:</p>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color:#12141c;">${code}</p>
      <p style="color:#666; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>`;

  if (!t) {
    console.log(`\n[dev email, SMTP not configured] Verification code for ${toEmail}: ${code}`);
    console.log('Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in .env to send real emails.\n');
    return { delivered: false };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
    html,
  });
  return { delivered: true };
}

module.exports = { sendVerificationEmail };

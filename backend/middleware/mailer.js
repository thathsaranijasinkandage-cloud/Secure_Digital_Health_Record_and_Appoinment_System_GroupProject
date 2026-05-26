'use strict';
/**
 * middleware/mailer.js
 *
 * Sends OTP verification codes via SMTP (Gmail App Password by default).
 * Configure EMAIL_* variables in .env.
 *
 * For production use you can swap the transport for SendGrid, AWS SES, etc.
 * by changing createTransport() – the sendOtpEmail() interface stays the same.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const transport = nodemailer.createTransport({
  host   : process.env.EMAIL_HOST   || 'smtp.gmail.com',
  port   : Number(process.env.EMAIL_PORT) || 587,
  secure : false,                     // STARTTLS
  auth   : {
    user : process.env.EMAIL_USER,
    pass : process.env.EMAIL_PASS,   // Gmail App Password, NOT your account password
  },
});

/**
 * sendOtpEmail
 * @param {string} toEmail   - recipient email address
 * @param {string} toName    - recipient display name
 * @param {string} otp       - 6-digit OTP string
 * @returns {Promise<void>}
 */
async function sendOtpEmail(toEmail, toName, otp) {
  const mailOptions = {
    from    : process.env.EMAIL_FROM || '"MediX Health" <noreply@medix.app>',
    to      : toEmail,
    subject : 'Your MediX Login Verification Code',
    text    : `Hi ${toName},\n\nYour one-time login code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, please ignore this email.\n\n— MediX Health`,
    html    : `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e0e0e0;border-radius:8px;padding:32px">
        <h2 style="color:#1a73e8;margin-top:0">MediX Health</h2>
        <p>Hi <strong>${toName}</strong>,</p>
        <p>Use the code below to complete your login. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;
                    background:#f1f3f4;border-radius:6px;padding:16px;margin:24px 0">
          ${otp}
        </div>
        <p style="color:#666;font-size:13px">
          If you did not request this code, please ignore this email.<br>
          Never share this code with anyone.
        </p>
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
        <p style="color:#aaa;font-size:12px;text-align:center">© MediX Health</p>
      </div>`,
  };

  await transport.sendMail(mailOptions);
}

module.exports = { sendOtpEmail };

// mailer.js
const nodemailer = require('nodemailer');

// Set up nodemailer with your SMTP details
const transporter = nodemailer.createTransport({
  // ...your SMTP configuration...
});

const sendPasswordResetEmail = async (email, link) => {
  // Logic to send an email
  const mailOptions = {
    from: 'youremail@example.com',
    to: email,
    subject: 'Password Reset',
    html: `Password reset link: <a href="${link}">${link}</a>`, // Replace with your email template
  };
  await transporter.sendMail(mailOptions);
};

module.exports = {
  sendPasswordResetEmail
};

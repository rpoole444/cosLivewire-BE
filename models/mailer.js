// mailer.js
const nodemailer = require('nodemailer');

// Set up nodemailer with your SMTP details
let transporter = nodemailer.createTransport({
  service: 'gmail', // For Gmail, you can use other services or SMTP
  auth: {
    user: process.env.EMAIL_USERNAME, // Your email
    pass: process.env.EMAIL_PASSWORD, // Your email password
  },
});

const sendPasswordResetEmail = async (email, resetToken) => {
  const resetPasswordUrl = `http://localhost:3001/resetPasswordRouter/${resetToken}`;

  let mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: 'Password Reset Link',
    html: `<p>Please click on the following link to reset your password:</p><p><a href="${resetPasswordUrl}">${resetPasswordUrl}</a></p>`,
  };
  try{    
    await transporter.sendMail(mailOptions);
  } catch(e){
    console.error("Error Sending Email:", e);
    throw e;
  }
}
module.exports = {
  sendPasswordResetEmail
};

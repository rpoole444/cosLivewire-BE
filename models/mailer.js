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
  const resetPasswordUrl = `http://localhost:3000/resetPasswordRouter/${resetToken}`;
  const logoUrl = 'http://localhost:3000/alpine_groove_guide_icon.png'; // Update with your actual server URL

  let mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: 'Password Reset Link',
    html: `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <img src="${logoUrl}" alt="Your Logo" style="width: 100px; height: auto;"/>
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password. Please click on the following link to reset your password:</p>
        <p><a href="${resetPasswordUrl}">Reset Password</a></p>
        <p>If you did not request a password reset, please ignore this email.</p>
        <p>Best Regards,<br/>The Team</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (e) {
    console.error("Error Sending Email:", e);
    throw e;
  }
};

const sendRegistrationEmail = async (email, firstName, lastName) => {
  const logoUrl = 'http://localhost:3000/alpine_groove_guide_icon.png'; // Update with your actual server URL

  let mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: 'Registration Confirmation',
    html: `
      <div style="font-family: Arial, sans-serif; text-align: center;">
        <img src="${logoUrl}" alt="Your Logo" style="width: 100px; height: auto;"/>
        <h2>Welcome to Our Service, ${firstName} ${lastName}!</h2>
        <p>Thank you for registering. We are excited to have you on board.</p>
        <p>Enjoy exploring our platform and connecting with others. Let's Share Your Events!</p>
        <p>Best Regards,<br/>The Alpine Groove Guide Team</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (e) {
    console.error("Error Sending Email:", e);
    throw e;
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendRegistrationEmail
};

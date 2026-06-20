// mailer.js   (or mailer/index.js)
const nodemailer = require("nodemailer");
const path = require("path");
const fs   = require("fs");

// ---------- transporter ----------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD
  }
});

// ---------- helper: inline image ----------
const inlineImage = (filePath, cid) => ({
  filename: path.basename(filePath),
  path: filePath,            // absolute or relative to this file
  cid                         // <img src="cid:cid">
});

// logo lives in /public — adjust as needed
const LOGO_PATH = path.join(__dirname, "..", "public", "alpine_groove_guide_icon.png");

const DEFAULT_FRONTEND_BASE_URL = "http://localhost:3001";

const getFrontendBaseUrl = () => {
  const configuredUrl = (
    process.env.FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    ""
  ).trim();

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, ""); // normalize in case of accidental trailing slash
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `FRONTEND_BASE_URL is not set. Falling back to ${DEFAULT_FRONTEND_BASE_URL} for password reset emails.`
    );
    return DEFAULT_FRONTEND_BASE_URL;
  }

  const message =
    "FRONTEND_BASE_URL is not configured. Unable to send password reset email with a valid link.";
  console.error(message);
  throw new Error(message);
};

const buildPasswordResetUrl = (resetToken) => {
  if (!resetToken) {
    throw new Error("Reset token is required to build the password reset URL.");
  }

  const baseUrl = getFrontendBaseUrl();
  return `${baseUrl}/reset-password/${resetToken}`;
};

exports.buildPasswordResetUrl = buildPasswordResetUrl;

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// ---------- 1.  password‑reset ----------
exports.sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = buildPasswordResetUrl(resetToken);

  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   email,
    subject: "Alpine Groove • Password Reset Link",
    html: `
      <div style="font-family:Arial,sans-serif;text-align:center">
        <img src="cid:logo" width="100" alt="Alpine Groove Guide logo"/>
        <h2>Password Reset Request</h2>
        <p>Click to reset your password:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>If you didn't request this, ignore the e‑mail.</p>
      </div>
    `,
    attachments: [inlineImage(LOGO_PATH, "logo")]
  });
};

// ---------- 2.  registration ----------
exports.sendRegistrationEmail = async (email, first, last) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   email,
    subject: `Welcome to Alpine Groove, ${first}!`,
    html: `
      <div style="font-family:Arial,sans-serif;text-align:center">
        <img src="cid:logo" width="100" alt="Alpine Groove Guide logo"/>
        <h2>Welcome, ${first} ${last}!</h2>
        <p>Thanks for registering—time to share some gigs.</p>
      </div>
    `,
    attachments: [inlineImage(LOGO_PATH, "logo")]
  });
};

// ---------- 3.  event‑submission receipt ----------
exports.sendEventReceiptEmail = async (event, userEmail) => {
  const editProtocol = "Email Reid (reid@alpinegroove.com) with corrections.";

  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   userEmail,
    subject: `Alpine Groove received “${event.title}” 🎶`,
    html: `
      <div style="font-family:Arial,sans-serif;text-align:center">
        <img src="cid:logo" width="90" alt="Alpine Groove Guide logo"/>
        <h2>Your event is in review!</h2>
        <p>Title: <strong>${event.title}</strong></p>
        <p>Date:  ${event.date}</p>
        <p>${editProtocol}</p>
        <p>We'll notify you once it's approved.</p>
        <img src="cid:poster" width="250" style="margin-top:12px" alt="Event poster"/>
      </div>
    `,
    attachments: [
      inlineImage(LOGO_PATH, "logo"),
      ...(event.poster ? [inlineImage(event.poster, "poster")] : [])
    ]
  });
};

// ---------- 4.  event approved ----------
exports.sendEventApprovedEmail = async (event, userEmail) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   userEmail,
    subject: `Your event “${event.title}” is live on Alpine Groove 🎉`,
    html: `
      <div style="font-family:Arial,sans-serif;text-align:center">
        <img src="cid:logo" width="90" alt="Alpine Groove Guide logo"/>
        <h2>🎉 Congrats! Your event is published.</h2>
        <p>View it here: <a href="${process.env.CORS_ORIGIN}/eventRouter/${event.slug}">event link</a></p>
        <img src="cid:poster" width="250" style="margin-top:12px" alt="Event poster"/>
      </div>
    `,
    attachments: [
      inlineImage(LOGO_PATH, "logo"),
      ...(event.poster? [inlineImage(event.poster, "poster")] : [])
    ]
  });
};

exports.sendBookingInquiryEmail = async ({ artist, inquiry }) => {
  const recipient = artist.booking_email || artist.contact_email;
  if (!recipient) {
    throw new Error("Artist does not have a booking email.");
  }

  const profileUrl = `${getFrontendBaseUrl()}/artists/${artist.slug}`;
  const subject = `Booking inquiry for ${artist.display_name}`;

  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    replyTo: inquiry.email,
    to: recipient,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <img src="cid:logo" width="90" alt="Alpine Groove Guide logo"/>
        <h2>New booking inquiry</h2>
        <p><strong>Profile:</strong> <a href="${profileUrl}">${escapeHtml(artist.display_name)}</a></p>
        <p><strong>Name:</strong> ${escapeHtml(inquiry.name)}</p>
        <p><strong>Email:</strong> <a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a></p>
        <p><strong>Date:</strong> ${escapeHtml(inquiry.date || "Not provided")}</p>
        <p><strong>Venue / Event:</strong> ${escapeHtml(inquiry.eventName || "Not provided")}</p>
        <p><strong>Budget range:</strong> ${escapeHtml(inquiry.budget || "Not provided")}</p>
        <p><strong>Notes:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(inquiry.notes || "No notes provided.")}</p>
        <hr/>
        <p style="font-size:12px;color:#555">This inquiry was sent through Alpine Groove Guide.</p>
      </div>
    `,
    attachments: [inlineImage(LOGO_PATH, "logo")]
  });
};

exports.sendVenueBookingRequestEmail = async ({ venue, inquiry }) => {
  const recipient = venue.booking_email || venue.contact_email;
  if (!recipient) {
    throw new Error("Venue does not have a booking email.");
  }

  const profileUrl = `${getFrontendBaseUrl()}/artists/${venue.slug}`;

  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    replyTo: inquiry.email,
    to: recipient,
    subject: `Venue booking request for ${venue.display_name}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <img src="cid:logo" width="90" alt="Alpine Groove Guide logo"/>
        <h2>New venue booking request</h2>
        <p><strong>Venue:</strong> <a href="${profileUrl}">${escapeHtml(venue.display_name)}</a></p>
        <p><strong>Artist:</strong> ${escapeHtml(inquiry.artistName)}</p>
        <p><strong>Email:</strong> <a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a></p>
        <p><strong>Genre / style:</strong> ${escapeHtml(inquiry.genre || "Not provided")}</p>
        <p><strong>Draw estimate:</strong> ${escapeHtml(inquiry.drawEstimate || "Not provided")}</p>
        <p><strong>Preferred dates:</strong> ${escapeHtml(inquiry.preferredDates || "Not provided")}</p>
        <p><strong>Links:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(inquiry.links || "No links provided.")}</p>
        <p><strong>Support needs:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(inquiry.supportNeeds || "No support needs provided.")}</p>
        <p><strong>Notes:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(inquiry.notes || "No notes provided.")}</p>
        <hr/>
        <p style="font-size:12px;color:#555">This booking request was sent through Alpine Groove Guide.</p>
      </div>
    `,
    attachments: [inlineImage(LOGO_PATH, "logo")]
  });
};

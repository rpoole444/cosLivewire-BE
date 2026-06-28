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

exports.escapeHtml = escapeHtml;

const formatDate = (value) => {
  if (!value) return "Date TBA";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatTime = (value) => {
  if (!value) return "Time TBA";
  const [hoursRaw, minutesRaw = "00"] = String(value).split(":");
  const hours = Number.parseInt(hoursRaw, 10);
  const minutes = Number.parseInt(minutesRaw, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return String(value);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
};

const eventUrl = (event) => (
  event?.slug ? `${getFrontendBaseUrl()}/eventRouter/${event.slug}` : null
);

const profileUrl = (profile) => (
  profile?.slug ? `${getFrontendBaseUrl()}/artists/${profile.slug}` : null
);

const baseEmailShell = ({ title, eyebrow = "Alpine Groove Guide", body }) => `
  <div style="margin:0;padding:0;background:#0b0f14;color:#f4e7b8;font-family:Arial,sans-serif">
    <div style="max-width:680px;margin:0 auto;padding:24px">
      <div style="border:1px solid #c9962e;background:#101610;padding:22px">
        <p style="margin:0 0 8px;color:#4f7870;font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase">${escapeHtml(eyebrow)}</p>
        <h1 style="margin:0 0 18px;color:#e0b861;font-family:Georgia,serif;font-size:28px;line-height:1.15">${escapeHtml(title)}</h1>
        ${body}
      </div>
      <p style="margin:16px 0 0;color:#9b9275;font-size:12px;line-height:1.5">
        You received this because you use Alpine Groove Guide to share or manage live music listings.
      </p>
    </div>
  </div>
`;

const fieldRow = (label, value) => `
  <tr>
    <td style="padding:8px 10px;border-bottom:1px solid #263f38;color:#9b9275;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;vertical-align:top;width:34%">${escapeHtml(label)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #263f38;color:#f4e7b8;font-size:14px;vertical-align:top">${value || "Not provided"}</td>
  </tr>
`;

const eventListItems = (events = []) => events.map((event) => {
  const url = eventUrl(event);
  const title = escapeHtml(event.title || event.artist_display || "Untitled event");
  const linkedTitle = url
    ? `<a href="${url}" style="color:#e0b861;text-decoration:none">${title}</a>`
    : title;
  return `
    <li style="margin:0 0 12px;padding:0 0 12px;border-bottom:1px solid #263f38">
      <strong style="color:#f4e7b8">${linkedTitle}</strong><br/>
      <span style="color:#c9c0a0">${escapeHtml(event.venue_name || event.location || "Venue TBA")}</span><br/>
      <span style="color:#9b9275">${escapeHtml(formatDate(event.date))} at ${escapeHtml(formatTime(event.start_time))}${event.region ? ` • ${escapeHtml(event.region)}` : ""}</span>
    </li>
  `;
}).join("");

const readableSourceName = (batch, sourceLabel) => (
  batch?.source_name || sourceLabel || batch?.source || "calendar"
).replace(/^Provided by\s+/i, "");

exports.buildImportBatchSummaryEmailHtml = ({
  batch = {},
  sourceLabel,
  promotedEvents = [],
  skippedEvents = [],
  submittedBy,
}) => {
  const sourceName = readableSourceName(batch, sourceLabel);
  const title = `${promotedEvents.length} ${promotedEvents.length === 1 ? "event" : "events"} accepted`;
  const skippedSection = skippedEvents.length
    ? `
      <h2 style="margin:24px 0 10px;color:#e0b861;font-size:18px">Skipped or duplicate rows</h2>
      <ul style="margin:0;padding-left:18px;color:#c9c0a0;font-size:14px;line-height:1.5">
        ${skippedEvents.map((event) => `
          <li style="margin-bottom:8px">
            ${escapeHtml(event.title || event.artist_display || "Untitled row")} — ${escapeHtml(event.venue_name || event.location || "Venue TBA")}
            <span style="color:#9b9275">(${escapeHtml(event.reason || "Skipped")})</span>
          </li>
        `).join("")}
      </ul>
    `
    : "";

  return baseEmailShell({
    title,
    eyebrow: sourceName,
    body: `
      <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
        Your batch has been processed as one calendar import. The accepted events are now in Alpine Groove Guide for final review/publishing.
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
        ${fieldRow("Batch", escapeHtml(sourceName))}
        ${fieldRow("Submitted by", escapeHtml(submittedBy || "Alpine Groove Guide"))}
        ${fieldRow("Accepted", escapeHtml(String(promotedEvents.length)))}
        ${fieldRow("Skipped", escapeHtml(String(skippedEvents.length)))}
      </table>
      <h2 style="margin:20px 0 10px;color:#e0b861;font-size:18px">Accepted events</h2>
      <ol style="margin:0;padding-left:20px;color:#c9c0a0;font-size:14px;line-height:1.5">
        ${eventListItems(promotedEvents)}
      </ol>
      ${skippedSection}
    `,
  });
};

exports.sendImportBatchSummaryEmail = async ({
  to,
  batch,
  sourceLabel,
  promotedEvents = [],
  skippedEvents = [],
  submittedBy,
}) => {
  if (!to || !promotedEvents.length) return;
  const sourceName = readableSourceName(batch, sourceLabel);
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: `Alpine Groove Guide: ${promotedEvents.length} ${promotedEvents.length === 1 ? "event" : "events"} accepted from your ${sourceName} import`,
    html: exports.buildImportBatchSummaryEmailHtml({
      batch,
      sourceLabel,
      promotedEvents,
      skippedEvents,
      submittedBy,
    }),
  });
};

exports.buildProfileCreatedEmailHtml = ({ profile, user }) => {
  const type = profile.profile_type === "venue" ? "venue" : profile.profile_type === "promoter" ? "promoter" : "artist";
  const url = profileUrl(profile);
  const dashboardUrl = `${getFrontendBaseUrl()}/UserProfile`;
  return baseEmailShell({
    title: `Your ${type} profile was created`,
    body: `
      <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
        This confirms that ${escapeHtml(profile.display_name)} now has a public profile draft on Alpine Groove Guide.
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
        ${fieldRow("Profile", escapeHtml(profile.display_name))}
        ${fieldRow("Type", escapeHtml(type))}
        ${fieldRow("Created for", escapeHtml(user?.email || profile.contact_email || "your account"))}
        ${fieldRow("Status", profile.is_approved ? "Approved" : "Pending admin review")}
      </table>
      <p style="margin:0 0 10px;color:#c9c0a0;font-size:14px;line-height:1.6">
        Next steps: polish your profile, add upcoming events, and claim imported shows that belong to you.
      </p>
      <p style="margin:18px 0 0">
        <a href="${dashboardUrl}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Open dashboard</a>
        ${url ? `<a href="${url}" style="display:inline-block;margin-left:8px;border:1px solid #e0b861;color:#e0b861;padding:11px 16px;text-decoration:none;font-weight:700">View profile</a>` : ""}
      </p>
    `,
  });
};

exports.sendProfileCreatedEmail = async ({ to, profile, user }) => {
  if (!to || !profile) return;
  const type = profile.profile_type === "venue" ? "venue" : profile.profile_type === "promoter" ? "promoter" : "artist";
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: `Your Alpine Groove Guide ${type} profile has been created`,
    html: exports.buildProfileCreatedEmailHtml({ profile, user }),
  });
};

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
  const subject = `New Gig Inquiry: ${inquiry.name} — ${inquiry.date || "Date TBA"}`;

  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    replyTo: inquiry.email,
    to: recipient,
    subject,
    html: baseEmailShell({
      title: "New gig inquiry",
      eyebrow: artist.display_name,
      body: `
        <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
          Someone reached out through your Alpine Groove Guide profile.
        </p>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Contact info</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
          ${fieldRow("Name", escapeHtml(inquiry.name))}
          ${fieldRow("Email", `<a href="mailto:${escapeHtml(inquiry.email)}" style="color:#e0b861">${escapeHtml(inquiry.email)}</a>`)}
          ${fieldRow("Profile", `<a href="${profileUrl}" style="color:#e0b861">${escapeHtml(artist.display_name)}</a>`)}
        </table>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Event details</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
          ${fieldRow("Preferred date", escapeHtml(inquiry.date || "Not provided"))}
          ${fieldRow("Venue / event", escapeHtml(inquiry.eventName || "Not provided"))}
          ${fieldRow("Budget", escapeHtml(inquiry.budget || "Not provided"))}
        </table>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Message</h2>
        <div style="white-space:pre-wrap;background:#0b0f14;border:1px solid #263f38;padding:14px;color:#f4e7b8;font-size:14px;line-height:1.6">${escapeHtml(inquiry.notes || "No notes provided.")}</div>
        <p style="margin:18px 0 0">
          <a href="mailto:${escapeHtml(inquiry.email)}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Reply to sender</a>
        </p>
      `,
    }),
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
    subject: `New Venue Booking Request: ${inquiry.artistName} — ${inquiry.preferredDates || "Dates TBA"}`,
    html: baseEmailShell({
      title: "New venue booking request",
      eyebrow: venue.display_name,
      body: `
        <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
          An artist sent a request through your Alpine Groove Guide venue page.
        </p>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Contact info</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
          ${fieldRow("Artist", escapeHtml(inquiry.artistName))}
          ${fieldRow("Email", `<a href="mailto:${escapeHtml(inquiry.email)}" style="color:#e0b861">${escapeHtml(inquiry.email)}</a>`)}
          ${fieldRow("Venue", `<a href="${profileUrl}" style="color:#e0b861">${escapeHtml(venue.display_name)}</a>`)}
        </table>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Booking details</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
          ${fieldRow("Genre / style", escapeHtml(inquiry.genre || "Not provided"))}
          ${fieldRow("Draw estimate", escapeHtml(inquiry.drawEstimate || "Not provided"))}
          ${fieldRow("Preferred dates", escapeHtml(inquiry.preferredDates || "Not provided"))}
        </table>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Links</h2>
        <div style="white-space:pre-wrap;background:#0b0f14;border:1px solid #263f38;padding:14px;color:#f4e7b8;font-size:14px;line-height:1.6">${escapeHtml(inquiry.links || "No links provided.")}</div>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Support needs</h2>
        <div style="white-space:pre-wrap;background:#0b0f14;border:1px solid #263f38;padding:14px;color:#f4e7b8;font-size:14px;line-height:1.6">${escapeHtml(inquiry.supportNeeds || "No support needs provided.")}</div>
        <h2 style="margin:18px 0 10px;color:#e0b861;font-size:18px">Notes</h2>
        <div style="white-space:pre-wrap;background:#0b0f14;border:1px solid #263f38;padding:14px;color:#f4e7b8;font-size:14px;line-height:1.6">${escapeHtml(inquiry.notes || "No notes provided.")}</div>
        <p style="margin:18px 0 0">
          <a href="mailto:${escapeHtml(inquiry.email)}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Reply to artist</a>
        </p>
      `,
    }),
    attachments: [inlineImage(LOGO_PATH, "logo")]
  });
};

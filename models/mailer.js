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

const brandedEmailAttachments = () => (
  fs.existsSync(LOGO_PATH) ? [inlineImage(LOGO_PATH, "agg-logo")] : []
);

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
  <div style="margin:0;padding:0;background:#0b0f14;color:#f4e7b8;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(title)}</div>
    <div style="max-width:680px;margin:0 auto;padding:24px">
      <div style="border:1px solid #c9962e;background:#101610;padding:0;box-shadow:0 18px 50px rgba(0,0,0,0.35)">
        <div style="padding:22px 22px 16px;border-bottom:1px solid #263f38;background:#0b0c09">
          <table role="presentation" style="width:100%;border-collapse:collapse">
            <tr>
              <td style="vertical-align:middle;width:78px">
                <img src="cid:agg-logo" width="64" height="64" alt="Alpine Groove Guide" style="display:block;border:0;border-radius:12px;background:#0b0c09"/>
              </td>
              <td style="vertical-align:middle">
                <p style="margin:0;color:#9fc8bf;font-size:12px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase">${escapeHtml(eyebrow)}</p>
                <p style="margin:5px 0 0;color:#e0b861;font-family:Georgia,serif;font-size:20px;font-weight:700;letter-spacing:0.03em">Alpine Groove Guide</p>
              </td>
            </tr>
          </table>
        </div>
        <div style="padding:24px 22px 26px">
        <h1 style="margin:0 0 18px;color:#e0b861;font-family:Georgia,serif;font-size:30px;line-height:1.15">${escapeHtml(title)}</h1>
        ${body}
        </div>
      </div>
      <p style="margin:16px 0 0;color:#9b9275;font-size:12px;line-height:1.5">
        You received this because you use Alpine Groove Guide to share or manage live music listings.
      </p>
    </div>
  </div>
`;

const emailFooter = ({ unsubscribeUrl } = {}) => `
  ${unsubscribeUrl ? `<p style="margin:16px 0 0;color:#9b9275;font-size:12px;line-height:1.5"><a href="${unsubscribeUrl}" style="color:#e0b861">Unsubscribe from platform update emails</a></p>` : ""}
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
    attachments: brandedEmailAttachments(),
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
    attachments: brandedEmailAttachments(),
  });
};

exports.buildProfileReviewedEmailHtml = ({ profile, approved, adminNotes }) => {
  const type = profile.profile_type === "venue" ? "venue" : profile.profile_type === "promoter" ? "promoter" : "artist";
  const url = profileUrl(profile);
  return baseEmailShell({
    title: approved ? `Your ${type} profile is approved` : `Your ${type} profile needs changes`,
    body: `
      <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
        ${approved
          ? `${escapeHtml(profile.display_name)} is approved and can be shown in the Alpine Groove Guide directory.`
          : `${escapeHtml(profile.display_name)} was reviewed, but it is not approved yet.`}
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
        ${fieldRow("Profile", escapeHtml(profile.display_name))}
        ${fieldRow("Type", escapeHtml(type))}
        ${fieldRow("Status", approved ? "Approved" : "Needs changes")}
        ${adminNotes ? fieldRow("Admin notes", escapeHtml(adminNotes)) : ""}
      </table>
      <p style="margin:18px 0 0">
        <a href="${getFrontendBaseUrl()}/UserProfile" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Open dashboard</a>
        ${url ? `<a href="${url}" style="display:inline-block;margin-left:8px;border:1px solid #e0b861;color:#e0b861;padding:11px 16px;text-decoration:none;font-weight:700">View profile</a>` : ""}
      </p>
    `,
  });
};

exports.sendProfileReviewedEmail = async ({ to, profile, approved, adminNotes }) => {
  if (!to || !profile) return;
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: approved
      ? `Your Alpine Groove Guide profile is approved`
      : `Your Alpine Groove Guide profile needs changes`,
    html: exports.buildProfileReviewedEmailHtml({ profile, approved, adminNotes }),
    attachments: brandedEmailAttachments(),
  });
};

exports.buildEventRejectionEmailHtml = ({ event, adminNotes }) => baseEmailShell({
  title: "Your event was not approved",
  body: `
    <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
      Your event submission was reviewed and not approved for the public calendar.
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
      ${fieldRow("Event", escapeHtml(event.title || "Untitled event"))}
      ${fieldRow("Date", escapeHtml(formatDate(event.date)))}
      ${fieldRow("Venue", escapeHtml(event.venue_name || event.location || "Venue TBA"))}
      ${adminNotes ? fieldRow("Admin notes", escapeHtml(adminNotes)) : ""}
    </table>
    <p style="margin:0;color:#c9c0a0;font-size:14px;line-height:1.6">
      You can submit a corrected listing any time from Alpine Groove Guide.
    </p>
  `,
});

exports.sendEventRejectedEmail = async ({ to, event, adminNotes }) => {
  if (!to || !event) return;
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: `Your event “${event.title || "Untitled event"}” was not approved`,
    html: exports.buildEventRejectionEmailHtml({ event, adminNotes }),
    attachments: brandedEmailAttachments(),
  });
};

exports.buildEventSubmissionDigestEmailHtml = ({ events = [], user }) => baseEmailShell({
  title: `${events.length} ${events.length === 1 ? "event is" : "events are"} in review`,
  body: `
    <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
      We received your event batch. These listings are now waiting for admin review.
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
      ${fieldRow("Submitted by", escapeHtml(user?.email || "Your account"))}
      ${fieldRow("Events submitted", escapeHtml(String(events.length)))}
    </table>
    <ol style="margin:0;padding-left:20px;color:#c9c0a0;font-size:14px;line-height:1.5">
      ${eventListItems(events)}
    </ol>
  `,
});

exports.sendEventSubmissionDigestEmail = async ({ to, events = [], user }) => {
  if (!to || !events.length) return;
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: `Alpine Groove received ${events.length} ${events.length === 1 ? "event" : "events"} for review`,
    html: exports.buildEventSubmissionDigestEmailHtml({ events, user }),
    attachments: brandedEmailAttachments(),
  });
};

const claimProfileLabel = (claim) => claim?.claim_type === "venue" ? "Venue profile" : "Artist profile";

exports.buildClaimSubmittedEmailHtml = ({ claim, event, artist }) => baseEmailShell({
  title: "Claim request submitted",
  body: `
    <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
      Your request to claim this event was sent to Alpine Groove Guide for admin review.
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
      ${fieldRow("Event", escapeHtml(event?.title || "Untitled event"))}
      ${fieldRow(claimProfileLabel(claim), escapeHtml(artist?.display_name || claimProfileLabel(claim)))}
      ${fieldRow("Status", escapeHtml(claim?.status || "pending"))}
    </table>
  `,
});

exports.sendClaimSubmittedEmail = async ({ to, claim, event, artist }) => {
  if (!to || !claim) return;
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: `Claim request submitted for “${event?.title || "event"}”`,
    html: exports.buildClaimSubmittedEmailHtml({ claim, event, artist }),
    attachments: brandedEmailAttachments(),
  });
};

exports.buildClaimReviewedEmailHtml = ({ claim, event, artist, approved, adminNotes }) => baseEmailShell({
  title: approved ? "Claim approved" : "Claim not approved",
  body: `
    <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
      ${approved
        ? "Your claim was approved. You can now edit this listing and make it stronger."
      : "Your claim request was reviewed and not approved."}
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
      ${fieldRow("Event", escapeHtml(event?.title || "Untitled event"))}
      ${fieldRow(claimProfileLabel(claim), escapeHtml(artist?.display_name || claimProfileLabel(claim)))}
      ${fieldRow("Status", approved ? "Approved" : "Rejected")}
      ${adminNotes ? fieldRow("Admin notes", escapeHtml(adminNotes)) : ""}
    </table>
    ${approved ? `
      <p style="margin:18px 0 0">
        <a href="${eventUrl(event) || getFrontendBaseUrl()}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Improve this listing</a>
      </p>
    ` : ""}
  `,
});

exports.sendClaimReviewedEmail = async ({ to, claim, event, artist, approved, adminNotes }) => {
  if (!to || !claim) return;
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject: approved
      ? `Your claim was approved for “${event?.title || "event"}”`
      : `Your claim was not approved for “${event?.title || "event"}”`,
    html: exports.buildClaimReviewedEmailHtml({ claim, event, artist, approved, adminNotes }),
    attachments: brandedEmailAttachments(),
  });
};

exports.buildNewsletterEmailHtml = ({ subject, message, previewText, unsubscribeUrl }) => {
  const paragraphs = String(message || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 14px;color:#c9c0a0;font-size:15px;line-height:1.65;white-space:pre-wrap">${escapeHtml(paragraph)}</p>`)
    .join("");

  return baseEmailShell({
    title: subject || "Alpine Groove Guide update",
    eyebrow: "Community update",
    body: `
      ${previewText ? `<p style="margin:0 0 16px;color:#4f7870;font-size:13px;font-weight:700">${escapeHtml(previewText)}</p>` : ""}
      ${paragraphs || '<p style="margin:0;color:#c9c0a0;font-size:15px;line-height:1.65">No message provided.</p>'}
      <p style="margin:18px 0 0">
        <a href="${getFrontendBaseUrl()}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Open Alpine Groove Guide</a>
      </p>
      ${emailFooter({ unsubscribeUrl })}
    `,
  });
};

exports.sendNewsletterEmail = async ({ to, subject, message, previewText, unsubscribeUrl }) => {
  if (!to || !subject || !message) return;
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to,
    subject,
    html: exports.buildNewsletterEmailHtml({ subject, message, previewText, unsubscribeUrl }),
    attachments: brandedEmailAttachments(),
  });
};

// ---------- 1.  password‑reset ----------
exports.buildPasswordResetEmailHtml = ({ resetUrl }) => baseEmailShell({
  title: "Reset your password",
  eyebrow: "Account security",
  body: `
    <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
      We received a request to reset your Alpine Groove Guide password. Use the button below to choose a new password.
    </p>
    <p style="margin:18px 0">
      <a href="${resetUrl}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:13px 18px;text-decoration:none;font-weight:800;border-radius:4px">Reset password</a>
    </p>
    <p style="margin:0;color:#9b9275;font-size:12px;line-height:1.6">
      If you did not request this, you can ignore this email. The reset link is only useful to someone with access to this inbox.
    </p>
  `,
});

exports.sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = buildPasswordResetUrl(resetToken);

  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   email,
    subject: "Alpine Groove • Password Reset Link",
    html: exports.buildPasswordResetEmailHtml({ resetUrl }),
    attachments: brandedEmailAttachments(),
  });
};

// ---------- 2.  registration ----------
exports.buildRegistrationEmailHtml = ({ first, last }) => {
  const fullName = [first, last].filter(Boolean).join(" ") || "there";
  return baseEmailShell({
    title: `Welcome, ${fullName}`,
    eyebrow: "Account created",
    body: `
      <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
        Your Alpine Groove Guide account is ready. A login account lets you submit shows, create artist or venue pages, claim imported gigs, and manage your music presence.
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
        ${fieldRow("Account", escapeHtml(fullName))}
        ${fieldRow("Next step", "Create or manage your public profile")}
      </table>
      <p style="margin:18px 0 0">
        <a href="${getFrontendBaseUrl()}/UserProfile" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">Open your dashboard</a>
      </p>
    `,
  });
};

exports.sendRegistrationEmail = async (email, first, last) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   email,
    subject: `Welcome to Alpine Groove, ${first}!`,
    html: exports.buildRegistrationEmailHtml({ first, last }),
    attachments: brandedEmailAttachments(),
  });
};

// ---------- 3.  event‑submission receipt ----------
exports.buildEventReceiptEmailHtml = ({ event }) => baseEmailShell({
  title: "Your event is in review",
  eyebrow: "Event submitted",
  body: `
    <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
      We received your event submission. An admin will review it before it appears on the public calendar.
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
      ${fieldRow("Event", escapeHtml(event.title || "Untitled event"))}
      ${fieldRow("Date", escapeHtml(formatDate(event.date)))}
      ${fieldRow("Time", escapeHtml(formatTime(event.start_time)))}
      ${fieldRow("Venue", escapeHtml(event.venue_name || event.location || "Venue TBA"))}
      ${fieldRow("Status", "Waiting for review")}
    </table>
    <p style="margin:0;color:#9b9275;font-size:12px;line-height:1.6">
      Need to correct something? Reply to this email or contact Alpine Groove Guide with the updated details.
    </p>
  `,
});

exports.sendEventReceiptEmail = async (event, userEmail) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   userEmail,
    subject: `Alpine Groove received “${event.title}”`,
    html: exports.buildEventReceiptEmailHtml({ event }),
    attachments: brandedEmailAttachments(),
  });
};

// ---------- 4.  event approved ----------
exports.buildEventApprovedEmailHtml = ({ event }) => {
  const url = eventUrl(event);
  return baseEmailShell({
    title: "Your event is live",
    eyebrow: "Event approved",
    body: `
      <p style="margin:0 0 16px;color:#c9c0a0;font-size:15px;line-height:1.6">
        Your event has been approved and published on Alpine Groove Guide.
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#0b0f14;border:1px solid #263f38">
        ${fieldRow("Event", escapeHtml(event.title || "Untitled event"))}
        ${fieldRow("Date", escapeHtml(formatDate(event.date)))}
        ${fieldRow("Time", escapeHtml(formatTime(event.start_time)))}
        ${fieldRow("Venue", escapeHtml(event.venue_name || event.location || "Venue TBA"))}
      </table>
      ${url ? `
        <p style="margin:18px 0 0">
          <a href="${url}" style="display:inline-block;background:#e0b861;color:#0b0f14;padding:12px 16px;text-decoration:none;font-weight:700">View live event</a>
        </p>
      ` : ""}
    `,
  });
};

exports.sendEventApprovedEmail = async (event, userEmail) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USERNAME,
    to:   userEmail,
    subject: `Your event “${event.title}” is live on Alpine Groove`,
    html: exports.buildEventApprovedEmailHtml({ event }),
    attachments: brandedEmailAttachments(),
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
    attachments: brandedEmailAttachments(),
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
    attachments: brandedEmailAttachments(),
  });
};

import * as v from '../validate.js';

const COLUMNS = `company_name, cin, registered_office, currency_prefix, footer_text, filename_pattern,
  email_from_name, email_subject, email_body, recipient_preference, logo_primary_object_id, logo_secondary_object_id, updated_at`;

export function toSettings(row) {
  return {
    companyName: row.company_name,
    cin: row.cin,
    registeredOffice: row.registered_office,
    currencyPrefix: row.currency_prefix,
    footerText: row.footer_text,
    filenamePattern: row.filename_pattern,
    emailFromName: row.email_from_name,
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    recipientPreference: row.recipient_preference,
    logoPrimaryObjectId: row.logo_primary_object_id ?? null,
    logoSecondaryObjectId: row.logo_secondary_object_id ?? null,
    updatedAt: row.updated_at,
  };
}

export function parseSettingsInput(input) {
  return {
    companyName: v.string(input.companyName, 'Company name', { max: 200 }),
    cin: v.string(input.cin, 'CIN', { required: false, max: 40 }) ?? '',
    registeredOffice: v.string(input.registeredOffice, 'Registered office', { required: false, max: 300 }) ?? '',
    currencyPrefix: v.string(input.currencyPrefix, 'Currency prefix', { max: 8 }),
    footerText: v.string(input.footerText, 'Footer text', { required: false, max: 120 }) ?? '',
    filenamePattern: v.string(input.filenamePattern, 'PDF filename pattern', { max: 200 }),
    emailFromName: v.string(input.emailFromName, 'From name', { max: 120 }),
    emailSubject: v.string(input.emailSubject, 'Email subject', { max: 250 }),
    emailBody: v.string(input.emailBody, 'Email body', { max: 5000 }),
    recipientPreference: v.oneOf(input.recipientPreference, 'Recipient preference', ['official', 'personal']),
  };
}

export function createSettingsService({ database }) {
  async function get(db = database) {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM payroll_settings WHERE id`);
    return toSettings(rows[0]);
  }

  async function update(actor, input) {
    const s = parseSettingsInput(input);
    const { rows } = await database.query(
      `UPDATE payroll_settings SET
         company_name = $1, cin = $2, currency_prefix = $3, footer_text = $4, filename_pattern = $5,
         email_from_name = $6, email_subject = $7, email_body = $8, recipient_preference = $9,
         registered_office = $11, updated_by = $10, updated_at = now()
       WHERE id
       RETURNING ${COLUMNS}`,
      [s.companyName, s.cin, s.currencyPrefix, s.footerText, s.filenamePattern,
        s.emailFromName, s.emailSubject, s.emailBody, s.recipientPreference, actor.id, s.registeredOffice],
    );
    return toSettings(rows[0]);
  }

  /** slot: 'primary' (left, Keystone) or 'secondary' (right, Liwip). objectId null = bundled logo. */
  async function setLogo(slot, objectId) {
    const column = slot === 'primary' ? 'logo_primary_object_id' : 'logo_secondary_object_id';
    const { rows } = await database.query(
      `UPDATE payroll_settings SET ${column} = $1, updated_at = now() WHERE id RETURNING ${COLUMNS}`,
      [objectId],
    );
    return toSettings(rows[0]);
  }

  return { get, update, setLogo };
}

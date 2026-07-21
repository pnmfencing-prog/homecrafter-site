export const PNM_FENCING_EMAIL_SENDING_PAUSED = false;

export const FENCECRAFTERS_THREAD_SENDER_NAME = 'FenceCrafters';
export const FENCECRAFTERS_THREAD_SENDER_EMAIL = 'fencecrafters@homecrafter.ai';
export const FENCECRAFTERS_THREAD_REPLY_TO_EMAIL = 'fencecrafters@homecrafter.ai';
export const FENCECRAFTERS_THREAD_DEFAULT_SUBJECT = 'Following up from FenceCrafters';

export const CRM_PROFILES = {
  fencecrafters: {
    key: 'fencecrafters',
    label: 'FenceCrafters',
    senderName: 'FenceCrafters',
    senderEmail: 'fencecrafters@homecrafter.ai',
    replyToEmail: 'fencecrafters@homecrafter.ai',
    defaultSubject: 'Following up from FenceCrafters',
    smsSignature: 'Scott\nFenceCrafters',
  },
  pnm_fencing: {
    key: 'pnm_fencing',
    label: 'PNM Fencing',
    senderName: 'PNM Fencing',
    senderEmail: 'pnmfencing@homecrafter.ai',
    replyToEmail: 'pnmfencing@homecrafter.ai',
    defaultSubject: 'Following up from PNM Fencing',
    smsSignature: 'PNM Fencing',
  },
} as const;

export type CrmProfileKey = keyof typeof CRM_PROFILES;

export function normalizeCrmProfile(value: unknown): CrmProfileKey {
  return value === 'pnm_fencing' ? 'pnm_fencing' : 'fencecrafters';
}

export function crmProfileConfig(value: unknown) {
  return CRM_PROFILES[normalizeCrmProfile(value)];
}

export function pnmFencingEmailPausedResponse() {
  return {
    error: 'PNM Fencing email sending is paused',
    message: 'Email was not sent. PNM Fencing customer/proposal email is paused until communications are moved to the approved Brevo setup.',
  };
}

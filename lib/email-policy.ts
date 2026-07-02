export const PNM_FENCING_EMAIL_SENDING_PAUSED = false;

export const FENCECRAFTERS_THREAD_SENDER_NAME = 'FenceCrafters';
export const FENCECRAFTERS_THREAD_SENDER_EMAIL = 'fencecrafters@homecrafter.ai';
export const FENCECRAFTERS_THREAD_REPLY_TO_EMAIL = 'fencecrafters@homecrafter.ai';
export const FENCECRAFTERS_THREAD_DEFAULT_SUBJECT = 'Following up from FenceCrafters';

export function pnmFencingEmailPausedResponse() {
  return {
    error: 'PNM Fencing email sending is paused',
    message: 'Email was not sent. PNM Fencing customer/proposal email is paused until communications are moved to the approved Brevo setup.',
  };
}

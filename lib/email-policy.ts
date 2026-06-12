export const PNM_FENCING_EMAIL_SENDING_PAUSED = true;

export function pnmFencingEmailPausedResponse() {
  return {
    error: 'PNM Fencing email sending is paused',
    message: 'Email was not sent. PNM Fencing customer/proposal email is paused until communications are moved to the approved Brevo setup.',
  };
}

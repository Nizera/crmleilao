/** Tipos de notificação do sino — compartilhados com o header (client). */

export type CustomerNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

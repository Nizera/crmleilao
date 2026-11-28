import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidade dos leilões",
  description:
    "Como Os Caras das Legends usa os dados do formulário de interesse nos leilões.",
  alternates: { canonical: "/privacidade-leiloes" },
};

const instagramUrl = "https://www.instagram.com/oscarasdaslegends/";
const linkStyle = "font-medium underline underline-offset-4";

export default function AuctionPrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <article className="space-y-7 leading-relaxed">
        <header className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            Os Caras das Legends
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Política de privacidade dos leilões
          </h1>
          <p className="text-sm text-muted-foreground">
            Atualizada em <time dateTime="2026-11-28">28 de novembro de 2026</time>
          </p>
          <p>
            Os Caras das Legends é responsável pelo uso dos dados que recebe
            pelo formulário de interesse nos leilões no Facebook e no Instagram.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Dados coletados e finalidade</h2>
          <p>
            Quando você envia o formulário, recebemos o nome e o e-mail que
            você confirmou. Se o formulário pedir telefone e você o informar,
            também recebemos esse número. Usamos os dados para registrar seu
            interesse nos leilões e atender solicitações sobre o cadastro.
          </p>
          <p>
            Depois do envio, o formulário exibe o link para o grupo de leilões
            no WhatsApp. Você decide se quer abrir o convite e solicitar entrada.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Quem tem acesso aos dados</h2>
          <p>
            Nossa equipe acessa o cadastro para as finalidades acima. A Meta
            recebe os dados para operar o formulário, conforme sua{" "}
            <a className={linkStyle} href="https://www.facebook.com/privacy/policy/">
              Política de Privacidade
            </a>
            .
          </p>
          <p>
            Se você abrir o convite e entrar no grupo, o WhatsApp tratará as
            informações da sua conta conforme sua{" "}
            <a className={linkStyle} href="https://www.whatsapp.com/legal/privacy-policy">
              Política de Privacidade
            </a>
            . Seu número de telefone e outros dados de perfil podem ficar
            visíveis para participantes do grupo, conforme suas configurações
            e o funcionamento do WhatsApp.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Por quanto tempo guardamos os dados</h2>
          <p>
            Mantemos o cadastro pelo tempo necessário para registrar seu interesse
            e atender solicitações relacionadas. Podemos conservar informações
            pelo prazo necessário para cumprir obrigações legais ou exercer
            direitos.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Seus direitos e nosso contato</h2>
          <p>
            Você pode pedir confirmação do uso dos seus dados, acesso, correção
            e exclusão, quando aplicável, além de exercer os demais direitos
            previstos na LGPD.
          </p>
          <p>
            Envie uma mensagem privada ao perfil oficial{" "}
            <a className={linkStyle} href={instagramUrl}>
              @oscarasdaslegends
            </a>{" "}
            no Instagram com o assunto “Privacidade dos leilões”.
          </p>
        </section>
      </article>
    </main>
  );
}
